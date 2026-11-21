"""Training, evaluation helpers and ONNX export for the gesture classifier (ml/PROTOCOL.md sections 5 and 6)."""

import copy
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch import nn

from dataset import CLASSES, WINDOW_FRAMES, Windows
from model import GestureCNN

#: Inputs are dB over the floor, divided by this (the values are clipped to [-10, 60] dB).
SCALE_DB = 60.0
MAX_TIME_SHIFT_FRAMES = 6
MAX_BIN_SHIFT = 1
GAIN_DB = 3.0
NOISE_DB = (1.0, 2.0)
CUTOUT_FRAMES = 2
LABEL_SMOOTHING = 0.05
FIT_CHECK_WINDOWS = 6000
#: Idle windows are sampled this many times as often as each gesture (ml/experiments/RESULTS.md).
NONE_WEIGHT = 3.0
ONNX_BINS = 87
ONNX_OPSET = 17


@dataclass
class TrainResult:
    model: GestureCNN
    history: list[dict[str, float | int | None]]
    #: Macro F1 on up to FIT_CHECK_WINDOWS of the training windows, without augmentation: how well it fits what it saw.
    #: Next to the held-out score this is the overfitting gauge (a diagnostic, never a selection criterion).
    train_macro_f1: float = 0.0


def class_weights(y: torch.Tensor, none_weight: float = 1.0) -> torch.Tensor:
    """Per-window sampling weights: every class equally likely, with NONE `none_weight` times as likely as the others.

    Equal classes give the rare gestures as many batches as idle time, which makes the model quick to fire on idle
    (false alarms); a none_weight above 1 moves that prior back toward what a real session looks like."""
    per_class = 1.0 / torch.bincount(y, minlength=len(CLASSES)).float().clamp(min=1)
    per_class[CLASSES.index("NONE")] *= none_weight
    return per_class[y]


def pick_device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def to_input(x: np.ndarray) -> torch.Tensor:
    """(N, frames, bins) dB over the floor -> (N, 1, frames, bins) model input."""
    return torch.from_numpy(x / SCALE_DB).float().unsqueeze(1)


def _shift(x: torch.Tensor, shifts: torch.Tensor, dim: int) -> torch.Tensor:
    """Shift every sample by its own amount along dim (2 = time, 3 = bins), repeating the edge value."""
    size = x.shape[dim]
    index = (torch.arange(size, device=x.device)[None, :] - shifts[:, None]).clamp(0, size - 1)
    view = [x.shape[0], 1, 1, 1]
    view[dim] = size
    return torch.gather(x, dim, index.view(view).expand(x.shape))


def augment(x: torch.Tensor, generator: torch.Generator, strength: float = 1.0, gain_db: float = GAIN_DB) -> torch.Tensor:
    """Time shift, bin shift, gain, noise and a two-frame cutout. Never mirrors: direction is the signal.

    Everything is drawn on x's device, so `generator` must live there too (a CUDA generator for a GPU batch).
    `strength` scales every effect (shift range, gain, noise, cutout chance); 0 returns x unchanged."""
    if strength <= 0:
        return x
    b, _, frames, _ = x.shape
    dev = x.device
    max_t, max_f = round(MAX_TIME_SHIFT_FRAMES * strength), round(MAX_BIN_SHIFT * strength)
    t_shift = torch.randint(-max_t, max_t + 1, (b,), generator=generator, device=dev)
    f_shift = torch.randint(-max_f, max_f + 1, (b,), generator=generator, device=dev)
    out = _shift(_shift(x, t_shift, 2), f_shift, 3)
    gain = (torch.rand(b, 1, 1, 1, generator=generator, device=dev) * 2 - 1) * gain_db * strength / SCALE_DB
    sigma = (NOISE_DB[0] + torch.rand(b, 1, 1, 1, generator=generator, device=dev) * (NOISE_DB[1] - NOISE_DB[0])) * strength / SCALE_DB
    noise = torch.randn(out.shape, generator=generator, device=dev) * sigma
    out = out + gain + noise
    start = torch.randint(0, frames - CUTOUT_FRAMES + 1, (b, 1), generator=generator, device=dev)
    active = torch.rand(b, 1, generator=generator, device=dev) < min(1.0, 0.5 * strength)
    rows = torch.arange(frames, device=dev)[None, :]
    cut = ((rows >= start) & (rows < start + CUTOUT_FRAMES) & active).view(b, 1, frames, 1)
    return out.masked_fill(cut, 0.0)


def predict_proba(model: nn.Module, x: np.ndarray, device: str, batch_size: int = 512) -> np.ndarray:
    """Class probabilities for windows x of shape (N, frames, bins)."""
    model.to(device).eval()
    out: list[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, len(x), batch_size):
            logits = model(to_input(x[start : start + batch_size]).to(device))
            out.append(torch.softmax(logits, dim=1).cpu().numpy())
    return np.concatenate(out) if out else np.zeros((0, len(CLASSES)), dtype=np.float32)


def macro_f1(y_true: np.ndarray, y_pred: np.ndarray, n_classes: int) -> float:
    """Mean F1 over the classes that occur in y_true."""
    scores: list[float] = []
    for c in range(n_classes):
        if not (y_true == c).any():
            continue
        tp = float(((y_pred == c) & (y_true == c)).sum())
        fp = float(((y_pred == c) & (y_true != c)).sum())
        fn = float(((y_pred != c) & (y_true == c)).sum())
        scores.append(2 * tp / (2 * tp + fp + fn) if tp > 0 else 0.0)
    return float(np.mean(scores)) if scores else 0.0


def train(
    train_set: Windows,
    val_set: Windows | None,
    epochs: int = 40,
    device: str = "cpu",
    seed: int = 0,
    batch_size: int = 128,
    lr: float = 2e-3,
    weight_decay: float = 1e-2,
    label_smoothing: float = LABEL_SMOOTHING,
    dropout: float = 0.2,
    width: int = 16,
    aug_strength: float = 1.0,
    gain_db: float = GAIN_DB,
    none_weight: float = NONE_WEIGHT,
) -> TrainResult:
    """Class-balanced training with augmentation. With a validation set the best epoch by macro F1 is kept."""
    if len(train_set.y) == 0:
        raise ValueError("no training windows")
    torch.manual_seed(seed)
    # The CNN is tiny, so the GPU is starved if batches are indexed, augmented and copied from the CPU: hold the whole
    # dataset (about 1 GB) on the device once and draw every random number there too.
    generator = torch.Generator(device=device).manual_seed(seed)
    model = GestureCNN(n_classes=len(CLASSES), width=width, dropout=dropout).to(device)
    x, y = to_input(train_set.x).to(device), torch.from_numpy(train_set.y).to(device)
    weights = class_weights(y, none_weight)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, epochs))
    loss_fn = nn.CrossEntropyLoss(label_smoothing=label_smoothing)
    best_f1, best_state = -1.0, None
    history: list[dict[str, float | int | None]] = []
    for epoch in range(1, epochs + 1):
        model.train()
        order = torch.multinomial(weights, len(y), replacement=True, generator=generator)
        total, seen = torch.zeros((), device=device), 0
        for start in range(0, len(order), batch_size):
            idx = order[start : start + batch_size]
            if len(idx) < 2:  # batch norm needs at least two samples
                continue
            optimizer.zero_grad()
            loss = loss_fn(model(augment(x[idx], generator, aug_strength, gain_db)), y[idx])
            loss.backward()
            optimizer.step()
            total += loss.detach() * len(idx)  # no .item(): that would stall the GPU every batch
            seen += len(idx)
        scheduler.step()
        val_f1: float | None = None
        if val_set is not None and len(val_set.y) > 0:
            val_f1 = macro_f1(val_set.y, predict_proba(model, val_set.x, device).argmax(axis=1), len(CLASSES))
            if val_f1 > best_f1:
                best_f1, best_state = val_f1, copy.deepcopy(model.state_dict())
        history.append({"epoch": epoch, "train_loss": float(total) / max(seen, 1), "val_macro_f1": val_f1})
    if best_state is not None:
        model.load_state_dict(best_state)
    return TrainResult(model, history, _fit_score(model, train_set, device, generator_seed=seed))


def _fit_score(model: nn.Module, train_set: Windows, device: str, generator_seed: int) -> float:
    """Macro F1 on a fixed random subset of the training windows, no augmentation."""
    n = len(train_set.y)
    pick = np.random.default_rng(generator_seed).permutation(n)[:FIT_CHECK_WINDOWS]
    predicted = predict_proba(model, train_set.x[pick], device).argmax(axis=1)
    return macro_f1(train_set.y[pick], predicted, len(CLASSES))


def export_onnx(model: nn.Module, path: Path) -> None:
    """ONNX (opset 17, float32): input `x` (batch, 1, 48, 87), output `y` (batch, 6) logits."""
    model = model.cpu().eval()
    torch.onnx.export(
        model,
        torch.zeros(1, 1, WINDOW_FRAMES, ONNX_BINS),
        str(path),
        input_names=["x"],
        output_names=["y"],
        dynamic_axes={"x": {0: "batch"}, "y": {0: "batch"}},
        opset_version=ONNX_OPSET,
        dynamo=False,
    )

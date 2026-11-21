"""The gesture classifier: a small CNN over one 48-frame by 87-bin spectrogram window (ml/PROTOCOL.md section 5)."""

import torch
from torch import nn


def _block(c_in: int, c_out: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Conv2d(c_in, c_out, kernel_size=3, padding=1, bias=False),
        nn.BatchNorm2d(c_out),
        nn.ReLU(inplace=True),
        nn.MaxPool2d(2),
    )


class GestureCNN(nn.Module):
    """Input (batch, 1, 48, 87) of dB over the floor divided by 60; output (batch, n_classes) logits."""

    def __init__(self, n_classes: int = 7, width: int = 16, dropout: float = 0.2, coord: bool = False, bins: int = 87) -> None:
        super().__init__()
        self.coord = coord
        if coord:
            # The head pools over the whole frequency axis, which hides which side of the carrier the energy is on (the
            # only difference between PUSH and PULL). A constant channel holding each bin's relative offset puts it back,
            # inside the model, so the ONNX input stays (batch, 1, 48, bins).
            self.register_buffer("offset", torch.linspace(-1.0, 1.0, bins).view(1, 1, 1, bins), persistent=False)
        self.features = nn.Sequential(_block(2 if coord else 1, width), _block(width, 2 * width), _block(2 * width, 4 * width))
        self.head = nn.Sequential(
            nn.Linear(8 * width, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(64, n_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if self.coord:
            x = torch.cat([x, self.offset.expand(x.shape[0], 1, x.shape[2], x.shape[3])], dim=1)
        f = self.features(x)
        pooled = torch.cat([f.mean(dim=(2, 3)), f.amax(dim=(2, 3))], dim=1)
        return self.head(pooled)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())

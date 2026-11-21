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

    def __init__(self, n_classes: int = 7, width: int = 16, dropout: float = 0.2) -> None:
        super().__init__()
        self.features = nn.Sequential(_block(1, width), _block(width, 2 * width), _block(2 * width, 4 * width))
        self.head = nn.Sequential(
            nn.Linear(8 * width, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(64, n_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        f = self.features(x)
        pooled = torch.cat([f.mean(dim=(2, 3)), f.amax(dim=(2, 3))], dim=1)
        return self.head(pooled)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())

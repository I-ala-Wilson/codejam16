import sys, numpy as np, torch, onnxruntime as ort
from pathlib import Path
sys.path.insert(0, "ml")
from data import find_sessions, load_session
from evaluate import stream_probs, evaluate_takes, DEFAULT_THRESHOLDS
S = Path(sys.argv[1]); PERSON = sys.argv[2]

class Ort(torch.nn.Module):
    def __init__(self, path):
        super().__init__(); self.s = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    def forward(self, x):
        return torch.from_numpy(self.s.run(None, {"x": x.numpy().astype(np.float32)})[0])

sessions = [s for s in (load_session(p) for p in find_sessions(Path(sys.argv[3] if len(sys.argv) > 3 else "data/recordings"))) if s.person == PERSON]
print(PERSON, len(sessions), "takes")
for name in ("morning", "dell"):
    m = Ort(S / f"{name}.onnx")
    streams = [stream_probs(m, s, "cpu") for s in sessions]
    r = evaluate_takes(None, sessions, "cpu", DEFAULT_THRESHOLDS, streams)
    print(f"\n== {name}: recall", {k: f"{v:.0%}" for k, v in r.recall.items()}, "FA/min", r.false_alarms_per_minute and round(r.false_alarms_per_minute, 2), "stray", r.stray_events)
    for lab in ("WAVE", "UNDO", "PUSH", "PULL", "OPEN_CLOSE"):
        if lab in r.confusion: print("  ", lab, dict(r.confusion[lab]))

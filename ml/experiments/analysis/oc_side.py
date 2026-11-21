import sys, numpy as np, torch, onnxruntime as ort
from pathlib import Path
sys.path.insert(0, "ml")
from data import find_sessions, load_session
from evaluate import stream_probs, evaluate_takes, DEFAULT_THRESHOLDS
class Ort(torch.nn.Module):
    def __init__(self, p):
        super().__init__(); self.s = ort.InferenceSession(str(p), providers=["CPUExecutionProvider"])
    def forward(self, x): return torch.from_numpy(self.s.run(None, {"x": x.numpy().astype(np.float32)})[0])
sessions = [load_session(p) for p in find_sessions(Path("data/recordings"))]
m = Ort(sys.argv[1]); streams = [stream_probs(m, s, "cpu") for s in sessions]
print(len(sessions), "takes (all people; mostly in training, so only the CHANGE between rows matters)")
print(f"{'OC thr':>7s} " + " ".join(f"{g:>10s}" for g in ("PUSH","PULL","WAVE","OPEN_CLOSE","UNDO","REPETITIVE")) + "   FA/min  stray")
for thr in (0.85, 0.70, 0.60, 0.55):
    th = dict(DEFAULT_THRESHOLDS); th["OPEN_CLOSE"] = thr; th["UNDO"] = 0.95
    r = evaluate_takes(None, sessions, "cpu", th, streams)
    print(f"{thr:7.2f} " + " ".join(f"{r.recall.get(g,0):10.1%}" for g in ("PUSH","PULL","WAVE","OPEN_CLOSE","UNDO","REPETITIVE")) + f"   {r.false_alarms_per_minute:.2f}   {r.stray_events}")

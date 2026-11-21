import sys, numpy as np, torch, onnxruntime as ort
from collections import Counter, defaultdict
from pathlib import Path
sys.path.insert(0, "ml")
from data import find_sessions, load_session
from evaluate import stream_probs, decode_events, DEFAULT_THRESHOLDS
S = Path(sys.argv[1])
class Ort(torch.nn.Module):
    def __init__(self, path):
        super().__init__(); self.s = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    def forward(self, x):
        return torch.from_numpy(self.s.run(None, {"x": x.numpy().astype(np.float32)})[0])
sessions = [s for s in (load_session(p) for p in find_sessions(Path("data/recordings"))) if any(l == "WAVE" for _, _, l in s.reps)]
print(len(sessions), "WAVE takes")
for name in ("morning", "dell"):
    m = Ort(S / f"{name}.onnx"); per = defaultdict(Counter); mins = defaultdict(float); reps = Counter()
    for s in sessions:
        probs, ends = stream_probs(m, s, "cpu")
        ev = decode_events(probs, ends, DEFAULT_THRESHOLDS)
        for e in ev: per[s.person][e.cls] += 1
        mins[s.person] += (ends[-1] if len(ends) else 0) / 60; reps[s.person] += sum(1 for _, _, l in s.reps if l == "WAVE")
    print(f"\n== {name}: events emitted during WAVE takes (per person: WAVE reps, WAVE events, UNDO events, UNDO per WAVE rep)")
    tot_u = tot_r = 0
    for p in sorted(per):
        c = per[p]; tot_u += c["UNDO"]; tot_r += reps[p]
        print(f"  {p:14s} reps {reps[p]:3d}  WAVE {c['WAVE']:3d}  UNDO {c['UNDO']:3d}  UNDO/rep {c['UNDO']/max(1,reps[p]):.2f}  PUSH {c['PUSH']:3d} PULL {c['PULL']:3d}")
    print(f"  all: UNDO events {tot_u} over {tot_r} WAVE reps = {tot_u/tot_r:.2f} per rep")

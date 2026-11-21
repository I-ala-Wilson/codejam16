import sys, numpy as np, torch, onnxruntime as ort
from pathlib import Path
sys.path.insert(0, "ml")
from data import find_sessions, load_session
from dataset import spectrogram_of, take_floor, WINDOW_FRAMES, STRIDE_FRAMES, MOTION_DB, MAX_LEAD_IN_MOTION_FRACTION
from features import excess_db, frame_centers, motion_energy
from train import to_input
from evaluate import evaluate_takes, DEFAULT_THRESHOLDS, decode_events
FRAMES_3S = 140
class Ort:
    def __init__(self, p): self.s = ort.InferenceSession(str(p), providers=["CPUExecutionProvider"])
    def proba(self, windows):
        out = []
        for i in range(0, len(windows), 512):
            logits = self.s.run(None, {"x": to_input(windows[i:i+512]).numpy().astype(np.float32)})[0]
            e = np.exp(logits - logits.max(axis=1, keepdims=True)); out.append(e / e.sum(axis=1, keepdims=True))
        return np.concatenate(out)
def engine_floor(frames):  # median + 2 * 1.4826 * MAD per bin (engine/src/dsp.ts buildFloor)
    med = np.median(frames, axis=0); mad = np.median(np.abs(frames - med), axis=0)
    return med + 2.0 * 1.4826 * mad
def quietest(frames):      # engine/src/pipeline.ts quietest(): rank by summed level, keep max(min(n,8), ceil(n/3))
    keep = max(min(len(frames), 8), int(np.ceil(len(frames) / 3)))
    return frames[np.argsort(frames.sum(axis=1), kind="stable")[:keep]]
sessions = [load_session(p) for p in find_sessions(Path("data/recordings"))]
model = Ort(sys.argv[1])
th = dict(DEFAULT_THRESHOLDS) | {"UNDO": 0.95, "OPEN_CLOSE": 0.60}
def window_for(s, spec, moving):
    secs = frame_centers(spec.shape[0]) / s.sample_rate
    if s.meta.get("takeKind") == "none": start = 15.0 if moving else 0.0
    else:
        first = min((a for a, _, _ in s.reps), default=int(3 * s.sample_rate)) / s.sample_rate
        start = first if moving else 0.0
    i = int(np.searchsorted(secs, start)); i = min(i, max(0, spec.shape[0] - FRAMES_3S))
    return spec[i:i + FRAMES_3S]
def stream(s, spec, floor):
    excess = excess_db(spec, floor)
    starts = list(range(0, spec.shape[0] - WINDOW_FRAMES + 1, STRIDE_FRAMES))
    w = np.stack([excess[a:a + WINDOW_FRAMES] for a in starts]).astype(np.float32)
    ends = frame_centers(spec.shape[0])[[a + WINDOW_FRAMES - 1 for a in starts]] / s.sample_rate
    return model.proba(w), ends
specs = {id(s): spectrogram_of(s) for s in sessions}
G = ("PUSH", "PULL", "WAVE", "OPEN_CLOSE", "UNDO")
def run(label, floor_fn):
    streams = [stream(s, specs[id(s)], floor_fn(s, specs[id(s)])) for s in sessions]
    r = evaluate_takes(None, sessions, "cpu", th, streams)
    five = np.mean([r.recall.get(g, 0) for g in G])
    print(f"{label:46s} " + " ".join(f"{r.recall.get(g,0):6.1%}" for g in G) + f"  five-mean {five:6.1%}  FA/min {r.false_alarms_per_minute:5.2f}  stray {r.stray_events}")

def hybrid(window):
    f0 = engine_floor(window)
    moving = float((motion_energy(excess_db(window, f0)) > MOTION_DB).mean()) > MAX_LEAD_IN_MOTION_FRACTION
    return engine_floor(quietest(window)) if moving else f0
print(f"{'floor from a 3 s calibration window':46s} " + " ".join(f"{g:>6s}" for g in G))
run("REF  training floor (python take_floor)", lambda s, sp: take_floor(s, sp)[0])
for moving in (False, True):
    tag = "MOVING" if moving else "still "
    run(f"OLD     all frames, {tag} window", lambda s, sp, m=moving: engine_floor(window_for(s, sp, m)))
    run(f"NEW     quietest third always, {tag}", lambda s, sp, m=moving: engine_floor(quietest(window_for(s, sp, m))))
    run(f"HYBRID  quietest only if >10% moving, {tag}", lambda s, sp, m=moving: hybrid(window_for(s, sp, m)))

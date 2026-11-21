import sys, glob, numpy as np, torch, onnxruntime as ort
from collections import Counter
from pathlib import Path
sys.path.insert(0, "ml")
from data import find_sessions, load_session
from dataset import CLASSES
from evaluate import stream_probs, decode_events, DEFAULT_THRESHOLDS, MATCH_HEAD_S, MATCH_TAIL_S, SMOOTH_EVALS
OC = CLASSES.index("OPEN_CLOSE")
class Ort(torch.nn.Module):
    def __init__(self, p):
        super().__init__(); self.s = ort.InferenceSession(str(p), providers=["CPUExecutionProvider"])
    def forward(self, x): return torch.from_numpy(self.s.run(None, {"x": x.numpy().astype(np.float32)})[0])
def load(paths): return [load_session(Path(p)) for p in paths]
sets = {
 "calib-1 OPEN_CLOSE take (20 cues)": load(glob.glob("data/recordings/I-ala-Wilson/calib-1/*OPEN_CLOSE*.json")),
 "pilot OPEN_CLOSE take (13 cues)": load(glob.glob("data/pilot/I-ala-Wilson/*OPEN_CLOSE*.json")),
 "Ian battery OPEN_CLOSE takes (in training of both)": load([p for p in glob.glob("data/recordings/I-ala-Wilson/**/*OPEN_CLOSE*.json", recursive=True) if "calib-" not in p and "livecheck" not in p and "naomi" not in p and "michael" not in p]),
}
none_sessions = [s for s in (load_session(p) for p in find_sessions(Path("data/recordings"))) if s.meta.get("takeKind") == "none"]
print("NONE takes:", len(none_sessions))
def smooth(probs):
    return np.stack([probs[max(0, i - SMOOTH_EVALS + 1): i + 1].mean(axis=0) for i in range(len(probs))])
for name, path in (("SHIPPED (morning)", sys.argv[1]), ("CANDIDATE calib-1", sys.argv[2])):
    m = Ort(path); print(f"\n================ {name}")
    for label, sess in sets.items():
        streams = [stream_probs(m, s, "cpu") for s in sess]
        peaks, said_at_peak, runner = [], Counter(), Counter()
        for s, (pr, t) in zip(sess, streams):
            sm = smooth(pr)
            for st, en, lab in s.reps:
                lo, hi = st / s.sample_rate - MATCH_HEAD_S, en / s.sample_rate + MATCH_TAIL_S
                idx = np.where((t >= lo) & (t <= hi))[0]
                if len(idx) == 0: continue
                j = idx[np.argmax(sm[idx, OC])]
                peaks.append(sm[j, OC]); said_at_peak[CLASSES[int(np.argmax(sm[j]))]] += 1
                others = [c for c in range(1, len(CLASSES)) if c != OC]
                runner[CLASSES[others[int(np.argmax(sm[idx][:, others].max(axis=0)))]]] += 1
        p = np.array(peaks)
        if len(p) == 0: print(f"  {label}: no cues"); continue
        print(f"  {label}: cues {len(p)}  OC peak median {np.median(p):.2f}  >=0.85: {(p>=.85).sum()}  0.60-0.85: {((p>=.6)&(p<.85)).sum()}  0.30-0.60: {((p>=.3)&(p<.6)).sum()}  <0.30: {(p<.3).sum()}")
        print(f"      class that wins at the OC peak: {dict(said_at_peak)}   strongest other gesture class per cue: {dict(runner)}")
        # sweep
    sweep_streams = {label: [stream_probs(m, s, "cpu") for s in sess] for label, sess in sets.items() if sess}
    none_streams = [stream_probs(m, s, "cpu") for s in none_sessions]
    none_min = sum(float(t[-1] - t[0]) for _, t in none_streams if len(t) > 1) / 60
    print("  threshold sweep for OPEN_CLOSE only (other classes stay at 0.85/0.90):")
    print(f"  {'thr':>5s} | " + " | ".join(l.split(' (')[0][:22].ljust(22) for l in sweep_streams) + f" | false OPEN_CLOSE/min on {len(none_sessions)} NONE takes ({none_min:.0f} min)")
    for thr in (0.85, 0.75, 0.65, 0.55, 0.45, 0.35):
        th = dict(DEFAULT_THRESHOLDS); th["OPEN_CLOSE"] = thr
        cells = []
        for label, streams in zip(sweep_streams, sweep_streams.values()):
            hit = tot = 0
            for s, (pr, t) in zip(sets[label], streams):
                ev = decode_events(pr, t, th)
                for st, en, lab in s.reps:
                    lo, hi = st / s.sample_rate - MATCH_HEAD_S, en / s.sample_rate + MATCH_TAIL_S
                    tot += 1; hit += any(e.cls == "OPEN_CLOSE" and lo <= e.t_s <= hi for e in ev)
            cells.append(f"{hit}/{tot}".ljust(22))
        fa = sum(1 for pr, t in none_streams for e in decode_events(pr, t, th) if e.cls == "OPEN_CLOSE")
        print(f"  {thr:5.2f} | " + " | ".join(cells) + f" | {fa / none_min:.2f}  ({fa} events)")

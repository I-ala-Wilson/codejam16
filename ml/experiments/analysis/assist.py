import sys, glob, json, os, numpy as np, torch, onnxruntime as ort
from collections import Counter, defaultdict
from pathlib import Path
sys.path.insert(0, "ml")
from data import load_session
from dataset import canonical_label
from evaluate import stream_probs, decode_events, DEFAULT_THRESHOLDS, MATCH_HEAD_S, MATCH_TAIL_S
GAP = 1200.0
S = Path(sys.argv[1])
rules = {}
for f in glob.glob(str(S / "ruledump" / "out*.json")): rules.update(json.load(open(f)))
class Ort(torch.nn.Module):
    def __init__(self, p):
        super().__init__(); self.s = ort.InferenceSession(str(p), providers=["CPUExecutionProvider"])
    def forward(self, x): return torch.from_numpy(self.s.run(None, {"x": x.numpy().astype(np.float32)})[0])
paths = sorted(rules)
sess = {p: load_session(Path(p)) for p in paths}
def merge(model_events, rule_events):
    """Mirror engine/src/index.ts (e968fa4): rule WAVE/OPEN_CLOSE (2+ pulses) are emitted unless a gesture was reported in the last 1200 ms; a model event of the same type within 1200 ms after an assisted one is dropped."""
    items = [(t, 0, ty, None) for t, ty in model_events] + [(e["t"], -1, e["type"], e["count"]) for e in rule_events if e["type"] in ("WAVE", "OPEN_CLOSE")]
    items.sort(key=lambda x: (x[0], x[1]))  # rule first on ties, as in the frame loop
    out, last_gesture, assist = [], -1e18, ("", -1e18)
    for t, src, ty, count in items:
        if src == -1:  # rule
            if ty == "OPEN_CLOSE" and (count or 0) < 2: continue
            if t - last_gesture < GAP: continue
            assist = (ty, t); last_gesture = t; out.append((t, ty))
        else:
            if ty == assist[0] and t - assist[1] < GAP: continue
            if ty not in ("HOLD", "REPETITIVE"): last_gesture = t
            out.append((t, ty))
    return out
def score(events_by_path, group):
    reps, hits = Counter(), Counter(); stray = 0; stray_min = 0.0; none_ev = 0; none_min = 0.0
    for p in group:
        s = sess[p]; ev = events_by_path[p]; dur = (s.samples.shape[0] / s.sample_rate)
        if s.meta.get("takeKind") == "none":
            none_ev += len(ev); none_min += dur / 60; continue
        wins = [(st / s.sample_rate * 1000 - MATCH_HEAD_S * 1000, en / s.sample_rate * 1000 + MATCH_TAIL_S * 1000, canonical_label(l)) for st, en, l in s.reps]
        for lo, hi, lab in wins:
            reps[lab] += 1; hits[lab] += any(ty == lab and lo <= t <= hi for t, ty in ev)
        stray += sum(1 for t, ty in ev if not any(lo <= t <= hi for lo, hi, _ in wins) and ty not in ("HOLD",)); stray_min += dur / 60
    return reps, hits, stray, stray_min, none_ev, none_min
groups = {
  "Ian calib-1 (candidate trained on it)": [p for p in paths if "I-ala-Wilson/calib-1/" in p],
  "Ian livecheck-1 (unseen)": [p for p in paths if "I-ala-Wilson/livecheck-1/" in p],
  "Ian pilot (unseen)": [p for p in paths if "data/pilot/" in p and sess[p].person == "ian"],
  "EJ livecheck-1 (unseen)": [p for p in paths if "EJ2007/livecheck-1/" in p],
  "ALL recorded takes, everyone": [p for p in paths if "data/pilot/" not in p],
}
none_paths = [p for p in paths if sess[p].meta.get("takeKind") == "none" and "data/pilot/" not in p]
configs = [("SHIPPED model, UNDO 0.95", sys.argv[2], {"UNDO": 0.95}),
           ("CANDIDATE calib-1, UNDO 0.95 (what Ian tested)", sys.argv[3], {"UNDO": 0.95}),
           ("CANDIDATE calib-1, OPEN_CLOSE 0.60 + UNDO 0.95", sys.argv[3], {"UNDO": 0.95, "OPEN_CLOSE": 0.60})]
G = ("PUSH", "PULL", "WAVE", "OPEN_CLOSE", "UNDO")
for name, model_path, over in configs:
    m = Ort(model_path); th = dict(DEFAULT_THRESHOLDS) | over
    model_ev, merged_ev = {}, {}
    for p in paths:
        pr, t = stream_probs(m, sess[p], "cpu")
        model_ev[p] = [(e.t_s * 1000, e.cls) for e in decode_events(pr, t, th)]
        merged_ev[p] = merge(model_ev[p], rules[p])
    print(f"\n######## {name}")
    for gname, group in groups.items():
        if not group: continue
        a = score(model_ev, group); b = score(merged_ev, group)
        cells = []
        for g in G:
            if a[0][g]: cells.append(f"{g} {a[1][g]}->{b[1][g]}/{a[0][g]}")
        print(f"  {gname}: " + "  ".join(cells) + f"   stray/min {a[2]/max(a[3],1e-9):.2f}->{b[2]/max(b[3],1e-9):.2f}")
    a = score(model_ev, none_paths); b = score(merged_ev, none_paths)
    print(f"  FALSE ALARMS on {len(none_paths)} NONE takes ({a[5]:.0f} min, all people): model alone {a[4]/a[5]:.2f}/min ({a[4]} events) -> with assist {b[4]/b[5]:.2f}/min ({b[4]} events)")

# Analysis scripts (Sat 21 Nov afternoon)

One-off scripts behind the follow-up numbers in `../RESULTS.md` ("Calibration candidates and live regressions"). Run them from
the repo root with `ml/.venv/bin/python`; the paths to the two ONNX files are arguments. They read recordings, never write
into `data/` or `ml/models/`. Memory: each loads every take's spectrogram (3-8 GB), so run ONE at a time and limit threads
(`OMP_NUM_THREADS=4 taskset -c 0-3`).

| script | what it answers | usage |
|---|---|---|
| `cmp_models.py`, `wave_undo.py` | WAVE read as UNDO: per-take events and stray UNDOs in WAVE takes, two models | `python <script> <scratch dir> <person>` (edit the two model paths at the top) |
| `openclose.py` | per-cue OPEN_CLOSE probability peaks against the 0.85 threshold, and a threshold sweep with false alarms on idle takes | `python openclose.py <shipped.onnx> <candidate.onnx>` |
| `oc_side.py` | what a lower OPEN_CLOSE threshold does to every other gesture over all takes | `python oc_side.py <candidate.onnx>` |
| `ruledump.ts` + `assist.py` | rule assist (engine `ruleAssist`): dump the rule detector's events per take with node, then merge them with the model's events exactly as `engine/src/index.ts` does | `node --experimental-strip-types ruledump.ts <list.json> <out.json>` (lists = JSON arrays of take paths), then `python assist.py <scratch> <shipped.onnx> <candidate.onnx>` |
| `floors.py`, `floors2.py`, `floors3.py` | the engine calibration floor: old (all frames), quietest third, hybrid, with a still or a moving 3 s calibration window; `floors3.py` mirrors Ian's `calibrationFloor` (b968d71) | `python floorsN.py <candidate.onnx>` |

The scripts were written against a scratch folder under `/tmp`; where they read `S/...` or `scratchpad` paths, point them at your
own folder. Dumps in `/tmp` do not survive a reboot.

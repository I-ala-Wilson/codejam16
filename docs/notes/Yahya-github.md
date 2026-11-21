# Journal: Yahya-github (engine + ML; QA subagents)

## PAUSED Sat 21 Nov 15:10: Yahya reset his PC. All work pushed; all my background jobs stopped.
RESUME (after reboot): 1) `cd ~/dev/competition/codejam-16 && scripts/sync`; 2) `cd app && npm i && npm run dev` (Vite died); 3) start Claude here, `/recover`, then arm `scripts/board wait`; 4) check the board for Ian's live-test verdict on `calib-three`; 5) do the TODO list below in order. `/tmp` is RAM-backed and is EMPTY after a reboot (all scratch gone; my analysis scripts are saved in `ml/experiments/analysis/`). Swap was full before; the reboot clears it.

## State
- SHIPPED MODEL = the morning one (9f7e41e), identical in `ml/models/` and `app/public/models/`. Candidates (not shipped): `ml/models/candidates/calib-1` (Ian), `calib-both` (Ian+EJ), `calib-three` (Ian+EJ+Michael, best: passes Ian's rule (b) for all 4 people). Their `gesture.json` already has OPEN_CLOSE 0.60 and Ian's UNDO 0.95. Ian was live-testing `calib-three` on his MacBook Pro at 15:05. SHIPPING RULE (RESULTS.md): (a) LOPO macro recall >= 0.39 and idle false alarms <= 2.6/min, (b) `ml/compare_models.py <shipped.onnx> <candidate.onnx> --person <ian|i-ala-wilson|ej2007|miguel982>` passes on unseen takes (`data/pilot`, `livecheck-*`), (c) Ian's live check with the old file kept for rollback. A candidate that passes numbers can still fail live: (c) decides.
- All numbers and verdicts of today are in `ml/experiments/RESULTS.md` (round 3 refused, breathing NO-GO, ASL and head shake cut, UNDO rule detectors refused, bad-data check refused, EJ-UNDO retrain refused by (b), calibration candidates + OPEN_CLOSE + rule assist + floor scoring in the section "Calibration candidates and live regressions").
- Team decisions: ASL, breathing, head shake, nail biting are OUT. REPETITIVE = Habit signal, not a gesture (report 5 gestures + Habit separately; `ml/experiments/summary.json`). Engine has `ruleAssist` (WAVE/OPEN_CLOSE) and Ian's hybrid calibration floor (b968d71). signOverride is dropped.

## TODO after the reboot (in this order)
1. Rule (a) for `calib-three`: `MPLBACKEND=Agg ml/.venv/bin/python ml/tune.py data/recordings --recipes ml/experiments/retrain_calib_three/recipes.json --seeds 0 1 --fa-slack 0 --out ml/experiments/retrain_calib_three/` (about 17 min, 8 GB RAM, run ALONE; recipes.json is `{"baseline": {}}`). Then commit the folder and post to Ian.
2. Score Ian's exact hybrid floor: `OMP_NUM_THREADS=4 taskset -c 0-3 ml/.venv/bin/python ml/experiments/analysis/floors3.py ml/models/candidates/calib-three/gesture.onnx` (edit paths if needed), compare with the old floor, tell Ian whether his constants (10 dB, 10%) need changing.
3. If Ian's live check passes: copy `calib-three` into `ml/models/` and `app/public/models/`, update RESULTS.md, run both test suites, push, DONE to Ian.
4. Michael's Lock hand-sign counts (5 unlocks, 10 locked loads) and Yahya's own (assigned to Michael's agent, Ian repeats on the MBP after the model decision): relay when posted.
5. Open items: Michael's Care chime gain (UI_SOUND_GAIN), EJ P2 stale calibration token, redo of Michael's failed `calib-1` PUSH take (c1, 14:06), QA terminal asleep (needs human: `/sync`).

## How to run my lane
- Engine: `cd engine && npm i && npm test` (195). App: `cd app && npm i && npm run dev`. ML (GPU only): `ml/.venv/bin/python ml/check_gpu.py`; `ml/run.py lopo|final|calib data/recordings` (`calib --person a b c --skip-failed --out-dir X`: 3 min, README in `ml/README.md`); `ml/tune.py ... --drop-test FILE` and recipe key `drop_train`; `ml/audit.py <folder>`; `ml/compare_models.py`; `ml/experiments/make_summary.py`. Python tests: `cd ml && .venv/bin/python -m pytest -q` (about 7 min).

## Gotchas
- KEEP THE LID OPEN (suspend wedges CUDA). Volume 300%: `wpctl set-volume -l 3.0 @DEFAULT_AUDIO_SINK@ 3.0` (resets after a reboot). Never two GPU jobs at once; wrap GPU runs in `flock /tmp/echo-gpu.lock`. RAM: 32 GB; `tune.py` grows to 8 GB, analysis scripts 3.5 GB each, `/tmp` is RAM-backed: do not stack them, and use `taskset -c 0-3` for analyses.
- Pre-register every experiment in RESULTS.md BEFORE it runs. Never edit others' files: send NEED (EJ habit/ and pitch/, Michael Care/dashboard/backend, Ian app/extension/contracts/spec). ACKs say "SPEC v6 read". Hooks: a command with `sed -n` after `git commit` is misread as `git commit -n`; `pkill -f` can kill its own shell (use `[x]` patterns or PIDs); the fact-forcing gate needs the 4 facts then a retry on Write/Edit.
- Never touch the Google `client_secret*.json` in ~/Downloads. QA terminal scratch (`/tmp/claude-1000/-home-atlas-codejam-qa`, 6.6 GB) is not mine.

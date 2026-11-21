# Journal: Yahya-github (engine + ML; QA subagents)

## Now (Sat 21 Nov ~13:10; all pushed unless noted)
- SPEC v6: ASL and BREATHING are CUT (out of scope). Nothing to build, record, test or claim. Breathing evidence stays in `ml/experiments/RESULTS.md` (v1 and v2 pre-registered NO-GO) and `ml/breathing.py`; `BreathRecord.tsx` deleted.
- SHIPPED MODEL = the morning one (9f7e41e, identical in `ml/models/` and `app/public/models/`). The Dell retrain (d1936ea) was rolled back by Ian after a LIVE regression (WAVE read as UNDO) that no recorded take reproduces. SHIPPING RULE (Ian's order, RESULTS.md): a model ships only if (a) retrain rule, (b) `ml/compare_models.py <shipped.onnx> <candidate.onnx> --person ian` passes on his unseen takes (`data/pilot` + `livecheck-*` folders, which `find_sessions` excludes from training), AND (c) Ian tries it live (WAVE x5, UNDO x5, PUSH/PULL x5) with the old file kept for rollback. (b) alone cannot catch that failure (calibrated in RESULTS.md); (c) is decisive.
- NEXT (Ian's queue item 4): retrain with EJ's two extra UNDO takes (20 cm and 50 cm, pushed 506a88f). GPU is held by the bad-data experiment until about 13:10 (all GPU jobs use `flock /tmp/echo-gpu.lock`). Then: `ml/run.py final data/recordings --out-dir <scratch>`, LOPO via `ml/tune.py` (2 seeds), `compare_models.py` against `ml/models/`, report to Ian; only copy into `ml/models/` and tell Ian if (a) and (b) pass, he does (c).
- BAD-DATA EXPERIMENT running (pre-registered in RESULTS.md, `ml/experiments/baddata/`): 6 PULL takes on the MacBook Pro (Ian's 4, Naomi's 2, `suspects.txt`) contradict their label by Doppler sign. B (trained without them) vs A on the same clean test; accept only by `tune.decide`. If accepted: add them to a training exclusion list (never delete files) and retrain under the rules above.
- DEMO DAY: Ian runs `ml/run.py calib` (README in `ml/README.md`, 3 min 3 s measured) with 20 cues x5 on his MBP, backs up the old model first and does the live check.
- Refused today (pre-registered, RESULTS.md): round 3 (coord, snrnorm), rule UNDO backup (6% recall), new double-tap UNDO detector (56% recall but 1.3 false UNDO/min idle).

## How to run my lane
- Engine: `cd engine && npm i && npm test` (193 tests). App: `cd app && npm i && npm run dev` (`npm i` after any pull touching package.json; restart Vite).
- ML (GPU only): `ml/.venv/bin/python ml/check_gpu.py`; `ml/run.py lopo|final|calib data/recordings`; `ml/tune.py data/recordings --recipes <json> --seeds 0 1 --fa-slack 0 --out <dir>` (options `--drop-test FILE`, recipe key `drop_train`); `ml/audit.py <folder>`; `ml/experiments/make_summary.py` writes summary.json. Python tests: `cd ml && .venv/bin/python -m pytest -q` (281).

## Gotchas and decisions
- KEEP THE LID OPEN (suspend wedges CUDA, 10 W power cap; fix: replug charger or `sudo systemctl restart nvidia-powerd`). Volume 300% via `wpctl set-volume -l 3.0 @DEFAULT_AUDIO_SINK@ 3.0`, resets after suspend. Never two GPU jobs at once; GPU hits 86 C.
- Every experiment is pre-registered in RESULTS.md BEFORE it runs, judged by `tune.decide`; never tune on test takes. Unseen-person macro recall is about 0.41 with 2.1 false alarms/min; calibrating on the presenter's own cues is what lifts it (+0.15 on Ian's MBP).
- Do not edit others' files: send NEED (EJ habit/ and pitch/, Michael Care/dashboard, Ian app/contracts/spec). Board ACKs must say "SPEC v6 read". A model that passes numbers can still fail live: Ian's live check decides.
- Hook quirk: a shell command containing `sed -n` after `git commit` is misread as `git commit -n`; keep git commits in their own command.

## Waiting on
- EJ: P2 stale-calibration token (HabitPage). Michael: P2 cancel label in the Care feed. Ian: `livecheck-1` takes on his MBP. Yahya (human): Lock hand-sign counts (5 unlocks, 10 locked loads), and typing Ian's line into the QA terminal (alert 7066511107).

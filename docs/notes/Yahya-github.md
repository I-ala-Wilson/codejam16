# Journal: Yahya-github (engine + ML + breathing; QA subagents)

## Now (Sat 21 Nov ~12:00; all pushed unless noted)
- RETRAIN with Michael's 14 Dell takes (f480e97, audited 14/14 usable) is RUNNING on the GPU: `ml/run.py final` into the scratchpad (not shipped yet), then `ml/tune.py` baseline 2 seeds in `ml/experiments/retrain_dell/` (log run.log, ends with "finished"). Ship rule is pre-registered in `ml/experiments/RESULTS.md` ("Retrain with Michael's Dell takes"): macro recall >= 0.39, false alarms <= 2.6/min, engine + ml tests pass. If it passes: copy the new `gesture.onnx/.json` to `ml/models/`, re-run tests, push, DONE to Ian. Otherwise keep the shipped model (9f7e41e) and report.
- BREATHING v2: frozen rule in RESULTS.md. Test takes = recorded after 11:05 (EJ 3 retakes, Michael 5 Dell takes, anything new from Yahya/Ian). Compute the verdict ONCE after 12:45: `MPLBACKEND=Agg CUDA_VISIBLE_DEVICES= ml/.venv/bin/python ml/breathing.py data/recordings --method both --since 2026-11-21T11:05:00-05:00 --out ml/experiments/breathing/v2test`, commit, INFO to Ian. Hard stop 13:30. If GO or PARTIAL GO: live estimator in engine + app/src/breath/BreathPanel.tsx (care event kind breath_apnea needs Ian's contract). If not: breathing dropped, only the apnea flag is considered.
- ROUND 3 DONE (5066dbb): coord, snrnorm, coord_snrnorm all REFUSED; shipped model/engine unchanged. PUSH vs PULL answer sent to Ian: 5 extra cues of each on the demo laptop + retrain (3 min), or build the Lock password from WAVE/OPEN_CLOSE/UNDO.
- Snooze cancel (EJ, 2eee769) done; Care help-cancel with PUSH,PUSH fallback is Michael's NEED, waiting.
- Lock live test: automated half PASSED (10/10 veiled, unlock ok). Human half (5 sign unlocks) is Yahya's, counts to post to Ian (HUMAN alert 7065627668).

## Done (this lane)
- #3, #9, #14, #15 closed. 7-class CNN (ONNX, thresholds 0.85/0.90) live; rule habit tracker; UNDO held-tap fix (#22 awaits QA regress); sign override built, refused, OFF; breathing v1 NO-GO, v2 frozen; recorder fix 3f73add.

## How to run my lane
- Engine: `cd engine && npm i && npm test` (184 tests). App: `cd app && npm i && npm run dev` (run `npm i` in app after every pull that touches package.json).
- ML (GPU only): `ml/.venv/bin/python ml/check_gpu.py`; `ml/run.py lopo|final data/recordings`; `ml/tune.py data/recordings --recipes <json> --seeds 0 1 --fa-slack 0 --out <dir>`; audit takes with `ml/audit.py <folder>`. Python tests: `cd ml && .venv/bin/python -m pytest -q`.

## Gotchas and decisions
- KEEP THE LID OPEN: suspend wedges CUDA and caps the GPU at 10 W (fix: replug charger or `sudo systemctl restart nvidia-powerd`). Volume 300% via `wpctl set-volume -l 3.0 @DEFAULT_AUDIO_SINK@ 3.0`, resets after suspend. Never run two GPU jobs at once. Laptop GPU hits 86 C under load.
- Every experiment is pre-registered in RESULTS.md BEFORE it runs and judged by `tune.decide`; do not tune on test takes. Unseen-person recall is about 0.42 (train F1 0.94 vs held-out 0.55): more people/laptops help, architecture tweaks did not.
- Do not edit others' files: send NEED (EJ habit/*, Michael Care/dashboard, Ian app + contracts). Board ACKs must say "SPEC v5 read".
- Vite caches failed imports: after `npm i` restart the dev server.

## Waiting on
- Michael: Care cancel fix (NEED 7065807628). Ian: demo-laptop calibration takes decision. QA terminal: still asleep (needs the human to type /sync). Yahya: Lock hand-sign counts, "push" approvals for anything the classifier blocks.

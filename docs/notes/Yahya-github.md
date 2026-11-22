# Journal: Yahya-github (engine + ML; QA subagents). Updated Sat 21 Nov about 19:30

## Now
No task in flight. An Opus subagent is making a 22 s launch video (full /brag, Hyperframes) into `~/echo-brag/brag-output-*` (outside the repo, Supabase blocked). Board wait is armed. Next: if Ian wants it, the opt-in model loader for Yahya's Katana (NEED sent, optional); the engine fix for a dead mic (see Gotchas).

## State
- SHIPPED = calib-three (a96404e1) with OPEN_CLOSE 0.45, UNDO 0.95, logitBias PUSH +1.0, rule assist off (Ian, 5690414). `ml/models/` mirrors it. Rule (a) for it: recall 0.406 met, idle FA 2.66/min (limit 2.6) missed by 0.06; (b)/(c) passed, Ian shipped. Never change what Ian's MacBook loads.
- Katana (Yahya's MSI) is a different acoustic setup: `ml/models/katana/` + git tag `katana-best-model` = the model he confirmed good live (same as shipped). Candidates under `ml/models/candidates/`: `calib-yahya` (pooled + his calib-1 x5: held-out PUSH 100 PULL 70 UNDO 80 WAVE 100, not live-tested), `katana-only` (fails PULL 50), calib-1/both/three. All numbers in `ml/experiments/RESULTS.md`.
- Interference sim (second laptop): no effect at -30 dB or quieter; only within 10-20 dB (laptops touching) WAVE drops first. Pitch rule stays: only the demo laptop runs sonar.
- Volume: Katana takes record `volumePct` (70/150/200); tone at the mic is the same at 200% and 300% (-58.5 vs -58.4 dBFS), so above 200% adds nothing.
- Supabase: Yahya's local root `.env` (gitignored) has the team project URL + publishable key, so his Care/Lock events reach Michael's live dashboard. Block `supabase.co` when testing or remove the keys.
- Caregiver tab dependency test (done in a throwaway `git archive` copy, repo untouched): the in-app Caregiver tab (`app/src/Caregiver.tsx`, Michael) reads only the same-browser BroadcastChannel; the Vercel dashboard (`dashboard/`) reads Supabase and imports only `@contracts`. After deleting the tab (file + 4 spots in Ian's `App.tsx`: import, PAGES entry, PRODUCT entry, render branch) both apps build and the dashboard dist is byte-identical (6 files, same sha256). The app renders with no console errors; `#caregiver` falls back to Home. Only QA's `qa/e2e/care.spec.ts` (test at line ~155 goes to `/#caregiver`) and `app-tabs.spec.ts` would fail. Deletion NOT done in the repo: files are Michael's and Ian's.

## How to run my lane
- Engine: `cd engine && npm i && npm test` (195). App: `cd app && npm i && npm run dev` (pages: `?dev`, then `#gestures`, `#live`, `#calib`). ML (GPU only): `ml/.venv/bin/python ml/check_gpu.py`; `ml/run.py lopo|final|calib data/recordings` (`calib --person a b --skip-failed --only-person --out-dir X --repeat 5`); `ml/tune.py ... --recipes`; `ml/compare_models.py`; analysis scripts in `ml/experiments/analysis/`. Python tests: `cd ml && .venv/bin/python -m pytest -q` (about 7 min).

## Gotchas
- KEEP THE LID OPEN (suspend wedges CUDA). Never two GPU jobs at once; wrap GPU runs in `flock /tmp/echo-gpu.lock`. RAM 32 GB; `/tmp` is RAM-backed. Hooks: the fact-forcing gate wants the facts, then a retry; it flags `rm -rf` text even inside scripts (use build tools that empty their own dirs).
- Pre-register every experiment in RESULTS.md BEFORE it runs. Never edit others' files: send NEED (Ian: app/extension/Lock/contracts; Michael: Care/Caregiver/backend/dashboard; EJ: habit/pitch/ui).
- P2 bug (mine, deferred on purpose): an all-zero (dead/muted) mic makes the habit rule fire REPETITIVE about every 3.2 s; fix = ignore digital-silence frames in `engine/src/index.ts` onChunk, but existing engine tests feed zero chunks, so do it with care and after the demo-critical work.
- Never touch the Google `client_secret*.json` in ~/Downloads.

## Waiting on
Nothing blocking. Optional: Ian's reply on the opt-in `?model=` loader (comment 7069003745).

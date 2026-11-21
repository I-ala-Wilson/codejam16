# Journal: Yahya-github (engine + ML + QA lane)

## Now
- #3 engine audio I/O + SpectrumFrame stream: code written, reviewed (3 HIGH found, all fixed with tests), 41 tests green. Next: commit/push (waiting for my human's OK), `[DONE]` to Ian saying audio shell is untested on a real mic, close #3 only after a real-mic check.
- Next: #9 rule detectors PUSH/PULL/WAVE/HOLD/OPEN_CLOSE/UNDO + recording. Then #15, #14. #18 (ASL) is parked until M2 Floor is done (priority INFO posted on the board).

## Done
- #3 (pending push): `engine/src/dsp.ts` (FFT, dB spectrum, floor, analyzeFrame, snrDb), `pipeline.ts` (ring buffer, 1 s auto-calibration, frames), `audio.ts` (mic with all DSP off, 20 kHz oscillator, AudioWorklet), `index.ts` (`createEngine`).

## How to run my lane
- `cd engine && npm i && npm test` (vitest, 41 tests) and `npm run typecheck`.
- App check: `cd app && npm i && npm run dev`, open http://localhost:5173 in Chrome, click Start, allow the mic.
- ML: `cd ml && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && python check_gpu.py` (CUDA must say True; not done yet).

## Gotchas and decisions
- `analyzeFrame` needs a still-room floor: the carrier's Hann sidelobes sit 30-60 dB above the noise at 3-10 bins out, so an uncalibrated frame cannot tell them from motion. The pipeline learns the floor for 1 s after `start()` (room must be still) and on `calibrate()`. Frames before that carry zero shift and zero energy.
- Floor = per-bin median + 2 robust sigmas (1.4826 * MAD) of the still frames; a bin counts as motion when its 3-bin smoothed excess beats the floor by `sensitivityDb` (default 2.5). An earlier median+MAD floor gave phantom motion in 66% of still frames; now under 2% (test: "does not invent motion in a still room"). Do not loosen it without re-running that test.
- Calibrations run side by side; the longest one to finish sets the floor, so `calibrate(3000)` is not cut short by the 1 s auto one. `stop()` and a dead mic reject pending calibrations.
- Frame `t` comes from the hop count (origin = first frame's arrival), so main-thread stalls do not bunch timestamps. Rules for UNDO (600 ms) can rely on it.
- Bins within 2 of the carrier are ignored (main lobe, about +-23 Hz), so hand speeds under about 0.2 m/s are invisible. Shifts are measured from the true tone, not the centre bin.
- Not handled: an AudioContext that goes `suspended` mid-session (tab backgrounded); frames just stop.
- Only `start/stop/health/onFrame/calibrate` exist. `onGesture` never fires and recording throws until #9.
- The audio shell (`audio.ts`) is NOT verified on a real mic yet; only the pure pipeline is covered by tests.
- Found, not mine: `extension/background.js` accepts UNLOCK from any `*.vercel.app` or localhost page (Ian's file; not yet reported on the board).

## Waiting on
- Human tasks from Ian (#7055273193): GPU check, start the QA agent clone. Not confirmed done yet.

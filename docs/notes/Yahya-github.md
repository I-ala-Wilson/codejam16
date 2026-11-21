# Journal: Yahya-github (engine + ML + QA lane)

## Now
- #3 pushed (fa572a3) and DONE posted. Left OPEN on purpose until Ian (or I) confirms on a real mic: snrDb >= 30 and a push gives positive shiftHz. Then `gh issue close 3 -c "..."`.
- #9 part 1 (recording) pushed: `engine/src/recorder.ts` + `startRecording/stopRecording` in index.ts. Reps are auto-marked from motion energy (>10 dB for 3 frames, ends after 8 quiet frames); thresholds untuned on real data.
- #9 part 2 (first version): `engine/src/gestures.ts` rule detectors wired into `onGesture`; shift fix `c3d0f76` is already on main. All thresholds are first guesses.
- PLAN CHANGE (Ian, spec v4 + DIRECT): the trained classifier (RTX 5070) is the main gesture detector; rules are only the fallback. Pilot data lives in data/pilot/ (never trained on); training reads data/recordings/ only. Protocol is ml/PROTOCOL.md (pushed): 6 classes NONE/PUSH/PULL/WAVE/OPEN_CLOSE/UNDO, cue-window labels, 48x87 window, small CNN to ONNX, leave-one-person-out eval.
- UNDO (spec v4) = double small tap toward (two small pushes < 90 Hz within 600 ms); the rule fallback was changed to match.
- GPU OK: ml/.venv has torch 2.15.0+cu132, CUDA True on the RTX 5070 Laptop GPU (sm_120). Run with `ml/.venv/bin/python`; tests with `cd ml && .venv/bin/python -m pytest -q`.
- Tools: `node --experimental-strip-types engine/tools/score.ts <folder> [--frames]` scores recordings with the real DSP and rules. Pilot findings: motion energy is large (median ~30 dB, max 47-57 dB over floor) for WAVE/OPEN_CLOSE, but scalar shift looks the same for every gesture (|shift| median 90-170 Hz, max ~332 Hz = band edge), so rules cannot separate them; the classifier can.
- Next (in order): ml/audit.py (per-take QC: lead-in still, motion in >= 80% of cue windows, SNR) before 23:50; ml/train.py (loader exists: ml/data.py, ml/features.py) + ONNX export; engine onnxruntime-web runtime behind useClassifier/modelUrl; ml/REPORT.md with leave-one-person-out numbers by Sat 10:00. Then #15 (REPETITIVE).
- QA agent runs in ~/codejam-qa (role qa, never work in it). If a [QA] post arrives it goes to Yahya-github/qa. #18 (ASL) is parked until M2 Floor is done (Ian agreed on the board).
- Human tasks pending (Ian, #7055273193): GPU check in ml/.venv, start the QA clone (after #3 is in, which it now is).

## Done
- #3 (pending push): `engine/src/dsp.ts` (FFT, dB spectrum, floor, analyzeFrame, snrDb), `pipeline.ts` (ring buffer, 1 s auto-calibration, frames), `audio.ts` (mic with all DSP off, 20 kHz oscillator, AudioWorklet), `index.ts` (`createEngine`).

## How to run my lane
- `cd engine && npm i && npm test` (vitest, 61 tests) and `npm run typecheck`. Also run `cd app && npx tsc -b`: the app's `erasableSyntaxOnly` bans constructor parameter properties and enums in engine code.
- App check: `cd app && npm i && npm run dev`, open http://localhost:5173 in Chrome, click Start, allow the mic.
- ML: `cd ml && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && python check_gpu.py` (CUDA must say True; not done yet).

## Gotchas and decisions
- `analyzeFrame` needs a still-room floor: the carrier's Hann sidelobes sit 30-60 dB above the noise at 3-10 bins out, so an uncalibrated frame cannot tell them from motion. The pipeline learns the floor for 1 s after `start()` (room must be still) and on `calibrate()`. Frames before that carry zero shift and zero energy.
- Floor = per-bin median + 2 robust sigmas (1.4826 * MAD) of the still frames; a bin counts as motion when its 3-bin smoothed excess beats the floor by `sensitivityDb` (default 2.5). An earlier median+MAD floor gave phantom motion in 66% of still frames; now under 2% (test: "does not invent motion in a still room"). Do not loosen it without re-running that test.
- Calibrations run side by side; the longest one to finish sets the floor, so `calibrate(3000)` is not cut short by the 1 s auto one. `stop()` and a dead mic reject pending calibrations.
- Frame `t` comes from the hop count (origin = first frame's arrival), so main-thread stalls do not bunch timestamps. Rules for UNDO (600 ms) can rely on it.
- Bins within 2 of the carrier are ignored (main lobe, about +-23 Hz), so hand speeds under about 0.2 m/s are invisible. Shifts are measured from the true tone, not the centre bin.
- Not handled: an AudioContext that goes `suspended` mid-session (tab backgrounded); frames just stop.
- Shift estimate (dsp.ts): searches only +-350 Hz, needs a cluster of 3+ contiguous bins above the floor, centroid of the strongest cluster's lobe (within 12 dB of peak), 0 when both sides are about equally strong. Real mic showed +-508 Hz saturation with the old power-weighted centroid; keep the edge-spike tests.
- Gestures (gestures.ts): frame direction when |shift| >= 30 Hz; strokes (>= 3 frames, peak >= 45 Hz) chain when < 250 ms apart; in a chain only strokes >= 50% of the strongest count (wind-up and recoil dropped); 4+ alternating strokes over >= 1 s is a WAVE; PULL then PULL within 600 ms starts becomes PULL, UNDO; HOLD after 1.5 s still following motion; OPEN_CLOSE = direction-less 10 dB pulses grouped by 600 ms. Events fire about 250 ms after the motion ends (chain latency).
- Only `start/stop/health/onFrame/calibrate` exist. `onGesture` never fires and recording throws until #9.
- The audio shell (`audio.ts`) is NOT verified on a real mic yet; only the pure pipeline is covered by tests.
- Found, not mine: `extension/background.js` accepts UNLOCK from any `*.vercel.app` or localhost page (Ian's file; not yet reported on the board).

## Waiting on
- Human tasks from Ian (#7055273193): GPU check, start the QA agent clone. Not confirmed done yet.

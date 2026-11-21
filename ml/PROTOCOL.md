# Dataset protocol and classifier plan

Owner: Yahya (ml/). Decision from Ian: the trained classifier is the main gesture detector (Floor); the rule detectors in
`engine/src/gestures.ts` stay as a fallback. Everything recorded before this protocol is **pilot** data
(`data/pilot/<login>/`): good for seeing what the sonar produces, never for training. Training reads only `data/recordings/<login>/`.

## 1. Classes

Six classes: `NONE, PUSH, PULL, WAVE, OPEN_CLOSE, UNDO`.

- UNDO is the v4 double tap toward (two small quick taps toward the screen within ~600 ms).
- HOLD is not a class. It stays a timer on top of the model: no motion for 1.5 s after a gesture.
- ASL is out of scope for the project (dropped, #18 closed). REPETITIVE (Habit) is recorded and trained as the 7th class (#15).
- `NONE` is the safety class. It must contain what a person really does near the laptop, so that Lock does not fire by accident.

## 2. What each person records (tonight, 23:15 to 23:50, on their own laptop)

Same battery for all four people (Ian MBP, Yahya Linux, EJ MBA, Michael Dell). Volume about 70%, default tone (20 kHz, -36 dBFS),
palm toward the screen, the person's usual hand. Keep the room as quiet as you can.

| Take | Reps | Distance | Cue window | Period |
|---|---|---|---|---|
| PUSH | 20 + 20 | 20 cm, 50 cm (two takes) | 1.5 s | 3.0 s |
| PULL | 20 + 20 | 20 cm, 50 cm | 1.5 s | 3.0 s |
| UNDO (double tap toward) | 20 + 20 | 20 cm, 50 cm | 1.5 s | 3.0 s |
| OPEN_CLOSE (2 to 3 pulses) | 20 + 20 | 15 cm, 30 cm | 2.0 s | 3.5 s |
| WAVE (about 3 swings) | 20 + 20 | 20 cm, 50 cm | 2.5 s | 4.0 s |
| NONE | 4 takes of 60 s | see below | n/a | n/a |

Within every gesture take: ten reps at a natural speed, ten brisk (alternate them; the cue says which).
That is 200 gesture reps per person (about 800 in total) and about 4 minutes of NONE per person; the whole battery takes about 17 minutes.
Optional second battery tomorrow morning with the laptop or the person moved, if time allows.

NONE takes (60 s each): (a) hand resting still in front of the laptop; (b) typing and using the mouse; (c) leaning, head turns, reaching for a
cup, someone walking past; (d) hand wandering slowly in front of the screen without making any gesture.

## 3. Take structure and labelling

1. The take starts with **3 s hands off** (this is the still-room floor, exactly like the engine's auto-calibration).
2. Then a cue (visible GO plus a beep) every `periodMs`. The person performs one rep inside the cue window and rests until the next cue.
3. **Labels come from the cues, not from the signal.** The Record page logs each cue time exactly (sample index relative to the start of the
   recording) and writes `reps = [{start, end, label}]`, where `start` is the cue time and `end = start + cueWindowMs`.
   Nothing is auto-marked by the engine for these takes.
4. Gaps between cue windows are `IGNORE` (the hand returning to rest makes motion, and it must not become a NONE example).
5. `NONE` examples come only from the NONE takes and from the 3 s lead-in of every take.
6. Training windows: stride-4 windows whose centre falls inside a cue window (0.2 s inside each edge). A rep where the whole window never
   rises above 6 dB over the floor is dropped as a missed rep and listed in the audit, so the person can redo that take.

Extra keys in the JSON next to the contract fields (the loader ignores what it does not know):
`distanceCm`, `speed` (`natural` or `brisk`), `hand` (`L` or `R`), `takeKind` (`gesture` or `none`), `cueWindowMs`, `periodMs`, `volumePct`,
`laptopModel`.

## 4. Model input

- One window = 48 frames x 87 bins (about 1.0 s at 47 fps; the same 4096 FFT, 1024 hop and +-500 Hz bins the engine already emits).
- Values = dB above the take's floor (per-bin median + 2 robust sigmas of the 3 s lead-in), clipped to [-10, 60] dB, divided by 60.
  At runtime the floor is the engine's calibration floor, so train and run see the same numbers.
- Streaming: the model is evaluated every 4 frames (about 85 ms) on the latest 48 frames.

## 5. Model

- A small CNN: three conv blocks (16, 32, 64 channels, 3x3, batch norm, ReLU, max-pool), global average and max pooling, one dense layer
  of 64, six logits. About 60k parameters, trains in minutes on the RTX 5070.
- Training: AdamW, label smoothing 0.05, class-balanced batches, a fixed 30 epochs. There is no early stopping: with only
  three or four people, holding one out as a validation set would starve training, and picking the best epoch on the test
  person would leak.
- Augmentation: time shift +-6 frames, gain +-3 dB (added to the excess), bin shift +-1, 1 to 2 dB noise, a 2-frame cutout.
  **No left-right mirroring**: direction is the whole point (toward versus away).
- Export: ONNX (opset 17, float32), input `x` of shape [1, 1, 48, 87], output `y` of shape [1, 6]. The engine runs it with onnxruntime-web
  behind the existing `useClassifier` and `modelUrl` options.
- Post-processing in the engine: average 3 consecutive predictions, fire a class when its probability stays above that class's threshold
  (0.8 by default; see the sweep in REPORT.md) for 2 evaluations, then a 600 ms refractory. A WAVE suppresses the PUSH and PULL inside it. HOLD stays a timer.

## 6. Evaluation (reported in ml/REPORT.md)

- **Leave-one-person-out**, four folds: train on three people, test on the fourth. This is the honest number, because every person
  has a different laptop, mic and hand.
- Within-person split as the upper bound: the last 5 reps of every take held out.
- Metrics are streaming, the way the app experiences them: per class, the share of cue windows where the model fires the right class
  (rep recall), precision, the confusion matrix, and false alarms per minute on the NONE takes.
- Targets: per class rep recall of 80% or more in leave-one-person-out and at most one false alarm per minute on NONE.
  A class that cannot reach 70% is dropped from the Lock vocabulary instead of being shipped flaky (OPEN_CLOSE is the likeliest).
- The final model is trained on all four people. Hyperparameters and epochs are chosen from the folds only.

## 7. What the Record page must change (Ian)

1. A guided runner: run the whole battery of section 2 in order, with the 3 s hands-off countdown, a big GO plus a beep, the per-rep
   speed cue, and one click per take. Show a progress bar and a "redo last take" button.
2. Save `reps` as the cue windows (section 3) with sample indices exact relative to the start of the recording, plus the extra JSON keys above.
3. Show live tone health and warn when `snrDb` is below 30 or the room is not still during the lead-in.
4. Files go to `data/recordings/<login>/` as 16-bit WAV plus JSON (contract names, with distance and take number in the name so nothing overwrites).
   Pilot takes go to `data/pilot/<login>/`.
5. Add NONE takes as a take kind with no cues.

## 8. Timeline

| When | What |
|---|---|
| 23:10 | Record page guided runner ready (Ian) |
| 23:15 to 23:50 | everyone records the battery |
| 23:50 to 00:15 | I audit every take (`ml/audit.py`: lead-in still, motion present in at least 80% of cue windows, SNR); redo bad takes |
| overnight | training and leave-one-person-out on the RTX 5070 |
| Sat 10:00 | verified numbers in `ml/REPORT.md`, ONNX model in the engine |

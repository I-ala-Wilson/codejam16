# Tuning results (Sat 21 Nov, overnight)

Everything here is leave-one-person-out over 5 people (ej2007, i-ala-wilson, miguel982, naomi, yahya-github), 147 takes,
so every number is about someone the model never trained on. Raw results: `results/` (fixed-threshold runs, `tune.py`),
`sweeps/` and `seed1/` (threshold sweeps, `sweep.py`), tables in `SUMMARY.md` and `SWEEP.md`.

## Where we started
Baseline (equal class sampling, 30 epochs, threshold 0.8), 2 seeds: macro recall 0.49, 3.9 false alarms per minute on
unseen idle takes, train F1 0.92 against held-out F1 0.55. The model fits the people it trained on far better than it
transfers, which is the overfitting.

## How we tuned without fooling ourselves
- The acceptance rule was fixed before any run (`tune.py decide`): beat the baseline by more than 2x the measured seed
  noise (floor 0.01), better for 4 of 5 people, at most 0.25 more false alarms per minute, no wider train-to-held-out gap
  (+0.02 allowed). The noise is the sample standard deviation of the baseline's seeds (rounds 1-2 were judged with the
  population one, which is 0.71x smaller; the 0.01 floor decided every verdict there, so none changes).
- At most 8 candidates, then a second seed for the winner. Nothing was added to chase a number.
- Fresh live-test takes (Sat 08:00) are the sealed final check: never tuned on.

## Round 1 and 2 (single threshold 0.8, 1 seed each): all 7 refused
| recipe | macro recall | false alarms/min | gap | |
|---|---|---|---|---|
| baseline | 0.491 | 3.91 | 0.367 | reference |
| ep15 (15 epochs) | 0.516 | 4.52 | 0.337 | more false alarms |
| width8 (smaller model) | 0.512 | 5.62 | 0.307 | more false alarms |
| reg (dropout 0.4, weight decay 0.05) | 0.492 | 3.96 | 0.357 | no gain |
| aug2 (2x augmentation) | 0.517 | 5.19 | 0.290 | more false alarms |
| gain12 (+-12 dB gain augmentation) | 0.489 | 4.26 | 0.359 | no gain |
| none3 (idle sampled 3x) | 0.461 | 3.08 | 0.395 | recall down at this threshold |
| none3+ep15+aug2 | 0.474 | 2.67 | 0.263 | recall down at this threshold |

Regularisation alone did not help. Fitting less raises recall a little but also false alarms.

## Why the fixed threshold was the wrong yardstick
A less trigger-happy model scores lower recall and fewer false alarms at the same threshold. So each recipe's
probabilities were decoded at 7 thresholds and compared by recall at equal false-alarm rates (`sweep.py`):

| false alarms/min | baseline (2 seeds) | none3 (2 seeds) | gain |
|---|---|---|---|
| 4 | 0.485 | 0.519 | +0.034 |
| 3 | 0.438 | 0.484 | +0.046 |
| 2 | 0.382 | 0.435 | +0.053 |
| 1 | 0.270 | 0.322 | +0.052 |

`none3` wins at every false-alarm level in both seeds, by more than the seed-to-seed spread (about 0.04 at 4/min, about
0.01 at 1-2/min). It is the new default: `train.NONE_WEIGHT = 3.0`. The older `baseline` result files used equal sampling
(`none_weight = 1.0`); to rerun the old baseline write `{"none_weight": 1.0}` explicitly.

## What the rule did not cover (read this before trusting the headline numbers)
- The `decide` rule judged only the 7 single-threshold candidates, and refused all of them. Adopting `none3` came from the
  later threshold sweep, which had no pre-registered rule: 2 seeds, 6 recipes, 4 false-alarm levels, and gains of +0.03 to
  +0.05 against a seed spread of up to 0.04 at the 4/min level. It won in both seeds at every level, which is good
  evidence but not proof; a different seed pair could narrow it.
- The operating point (0.85) was picked from the same 5-person curves that the final report scores, so the final numbers
  are mildly optimistic (selection, not training, leakage). The sealed check is the fresh Saturday live-test takes.
- GPU training is not bit-reproducible (cuDNN, a CUDA random stream), so a rerun with the same seed differs slightly;
  that wobble is part of the seed spread above.
- Cached results in `results/` and `sweeps/` are keyed by recipe, epochs and seeds, not by the code version: delete the
  folder after changing training code, or the old numbers are reused.

## Operating point (a product choice, made overnight; change it in gesture.json, no retraining)
With the adopted model: threshold 0.8 gives about 2.6 false alarms/min and 0.48 recall, **0.85 about 1.9 and 0.43
(chosen, habit class 0.90)**, 0.9 about 1.2 and 0.37, 0.95 about 0.5 and 0.26. A Lock demo hates false triggers more
than a missed gesture, but it also needs a few correct signs in a row, so this is the number a human should revisit.

## Final leave-one-person-out with the adopted defaults (`../REPORT.md`)
Pooled rep recall for an unseen person: PUSH 49%, PULL 53%, WAVE 49%, OPEN_CLOSE 43%, UNDO 48%, HABIT 19%; false alarms
1.4 to 3.8 per minute per person (mean about 2.1). Every class is below the 80% target.

## What this means (honest)
- For a person or laptop the model has never seen, gestures are recognised roughly every second time. Across laptops the
  echo strength differs by about 35 dB (Katana ~40 dB, MacBook Air ~45 dB, MacBook Pros ~80 dB), and that, not model
  capacity, is the main obstacle. More people and laptops in the training set helps more than any recipe change.
- Someone who is in the training data is recognised much better (earlier same-person cross-distance test: PUSH/PULL/UNDO
  83-93%). A demo run by a team member whose takes are in the training set will look better than these numbers.
- Things not tried because the 8-candidate budget was spent: per-take input normalisation (SNR reference), a longer
  window, per-class thresholds, hard-negative mining from the live-test false alarms. The Saturday live-test false
  alarms are the right hard negatives to add.

## Is a short per-user calibration worth it? (Ian's MacBook Pro, `calibration.py`, 2 seeds)
Ian recorded one session with each hand. Train on the 4 other people plus the first N cues of every take of one hand,
test on the other hand's session (both directions averaged). Table: `calibration/CALIBRATION.md`.

| training data | macro recall | false alarms/min | PUSH | PULL | WAVE | OPEN_CLOSE | UNDO | HABIT |
|---|---|---|---|---|---|---|---|---|
| the 4 others only | 0.558 | 2.72 | 0.51 | 0.30 | 0.76 | 0.84 | 0.88 | 0.07 |
| + 5 cues per take (about 5 min of recording) | 0.648 | 2.35 | 0.53 | 0.51 | 0.78 | 0.92 | 0.80 | 0.35 |
| + 5 cues per take, repeated 5x | 0.638 | 2.64 | 0.53 | 0.46 | 0.76 | 0.88 | 0.84 | 0.36 |
| + 20 cues per take (a whole battery, about 17 min) | 0.679 | 2.56 | 0.51 | 0.64 | 0.77 | 0.93 | 0.86 | 0.36 |
| + 20 cues per take, repeated 5x | 0.711 | 2.72 | 0.62 | 0.64 | 0.82 | 0.92 | 0.83 | 0.44 |

- Five minutes of the demo person's own recording lifts macro recall by about 0.09, a whole battery by 0.12 to 0.15,
  with no extra false alarms. PULL and HABIT gain most; PUSH barely moves (it stays confused with PULL).
- Without any calibration Ian's MacBook Pro already scores 0.56, well above the 0.43 for an unseen person overall, because
  two other MacBook Pro people (Naomi, Michael) are in the training set: the same laptop model has the same strong echo.
- Caveats: one person, 2 seeds, and the test hand differs from the calibration hand, so a same-hand calibration should
  help more, not less. The numbers carry the selection caveats above.
- Recommendation: do not build in-app fine-tuning (onnxruntime-web cannot train). The cheap version needs no new code:
  record about 5 cues per gesture on the demo laptop right before the demo with the existing Dataset recording tab, add
  the takes to `data/recordings`, run `ml/run.py final data/recordings` (about 3 minutes on the GPU) and ship the model.

## Round 3 (Sat 21 Nov, morning): cross-laptop strength and PUSH vs PULL. PRE-REGISTERED before any run
Ian's DIRECT 7061667243. Written and pushed before the first training run of this round; the numbers below are filled in
afterwards without changing this section.

What is known before the round: the features keep the Doppler sign (excess in dB over the floor per bin, no abs, no
mirroring; augmentation tests assert it never mirrors). But `GestureCNN` takes the mean and the max of the last feature map
over BOTH axes, so it is nearly translation-invariant along frequency: which side of the carrier the energy is on, the
only difference between PUSH and PULL, reaches the head only through border effects. Pooled confusion (REPORT.md) shows
PUSH answered as PULL 52 times and PULL answered as PUSH 37 times. Echo strength differs by about 35 dB between laptops.

Candidates (3, no more; new ideas wait for the next round):
1. `coord`: a constant channel with the relative frequency offset (-1 to +1 across the 87 bins) is appended to the input
   inside the model, so the ONNX interface (1 x 48 x 87) is unchanged.
2. `snrnorm`: the model input is the excess in dB scaled by 60 / the take's tone SNR (measured on the still lead-in,
   `dataset.tone_snr_db`), so a 40 dB laptop and an 80 dB laptop look alike. Needs the same scaling in the engine if accepted.
3. `coord_snrnorm`: both, run regardless of the first two verdicts.

Protocol: leave-one-person-out over the 5 people, seeds 0 and 1 for the baseline (= the current defaults: idle weight 3,
30 epochs, thresholds 0.85 / 0.90) and for every candidate, scored at the default thresholds, `ml/tune.py` with a new
results folder (`ml/experiments/round3/`).

Acceptance (all must hold, judged by `tune.decide` with `fa_slack = 0` and the per-seed pairing check):
- macro recall beats the baseline by more than 2x the baseline's seed spread (floor 0.01),
- on EACH of the two seeds the candidate's macro recall is above the baseline's for the same seed,
- better than the baseline for at least 4 of the 5 held-out people,
- mean false alarms per minute not higher than the baseline's (no slack),
- the train-to-held-out F1 gap not wider by more than 0.02.
If a candidate is accepted: train the final model with it, mirror it in the engine if it needs a runtime change, run all
tests, push model and engine together, post DONE with the numbers. If none is accepted: post INFO with what failed and
change nothing. PUSH and PULL recall and their mutual confusion are reported either way, but are not part of the rule.

### Round 3 result: all three candidates REFUSED (leave-one-person-out, 5 people, 2 seeds, default thresholds)
Judged by `tune.decide` with `fa_slack = 0` and the per-seed pairing check, exactly as pre-registered.

| recipe | macro recall | false alarms/min | held-out F1 | gain vs baseline | better for | verdict |
|---|---|---|---|---|---|---|
| baseline | 0.421 | 2.11 | 0.555 | | | |
| coord | 0.430 | 2.27 | 0.553 | +0.009 (margin 0.036) | 3 of 5 people | refused: gain inside noise, 3 of 5 not 4, more false alarms |
| snrnorm | 0.398 | 2.09 | 0.535 | -0.023 | 1 of 5 | refused: worse on both seeds |
| coord_snrnorm | 0.403 | 1.99 | 0.545 | -0.017 | 2 of 5 | refused: below the baseline on both seeds |

Per-class recall (mean over the two seeds), reported but not part of the rule:

| recipe | PUSH | PULL | WAVE | OPEN_CLOSE | UNDO |
|---|---|---|---|---|---|
| baseline | 0.50 | 0.47 | 0.46 | 0.43 | 0.46 |
| coord | 0.48 | 0.53 | 0.47 | 0.40 | 0.49 |
| snrnorm | 0.46 | 0.48 | 0.41 | 0.43 | 0.45 |
| coord_snrnorm | 0.45 | 0.53 | 0.45 | 0.41 | 0.47 |

Reading: telling the model which side of the carrier the energy is on (coord) moves PULL up by 0.06 and PUSH down by
0.02, which is inside the noise, so the architecture was not what limits PUSH vs PULL. Scaling the input by each take's
tone strength (snrnorm) made things worse for 4 of 5 people, so laptop strength is not the main cross-person problem
either. Nothing changes: the shipped model and engine stay as they are (no mirroring, no normalization).

### Round 3b: Doppler-sign override for PUSH vs PULL. PRE-REGISTERED before any evaluation of it
Disclosure: before writing this I looked at the rule detector's per-take hit rates (`engine/tools/score.ts`) for the five
people: on PUSH and PULL takes the rule detector answers the right class in roughly 90-100% of cues (it also fires many
stray events, which is why it is not the main detector). The CNN gets 49% and 53% for an unseen person. So the CNN finds the
gesture but not its direction, and the Doppler sign already knows it. The override below was chosen before any number
was computed with it, and has two fixed parameters, not tuned.

Candidate 4, `sign`: whenever the classifier fires PUSH or PULL at time t, the class is set by the sign of the frame with
the largest |shiftHz| among the engine's frames in the last 1.0 s (positive shift = toward the laptop = PUSH, negative =
PULL). If that largest |shiftHz| is below 45 Hz (the rule detector's minimum stroke peak) the classifier's class stays.
No other event changes, so the number of events, and therefore false alarms per minute, is unchanged by construction.

Protocol: the baseline model's leave-one-person-out streams (seeds 0 and 1, default recipe), decoded at the default
thresholds, scored with and without the override on the same models.

Acceptance: on BOTH seeds the macro recall is higher with the override by more than 0.02, and neither PUSH nor PULL pooled
recall is lower. If accepted: implement it in `engine/src/classifier.ts` (the engine has the frames), check parity with
the Python version on fixtures, run all tests, push, post DONE. If not: INFO with what failed.

## Breathing rate from the echo's phase (moonshot, Ian's DIRECT 7064902718). GO / NO-GO PRE-REGISTERED before any breathing recording is looked at
Written and pushed before `ml/breathing.py` has seen a real take. It is developed on synthetic phase-modulated tones only,
and every threshold below is fixed now.

Method (offline first, on the raw WAVs): complex-demodulate the mic at the tone frequency f0 (mix with exp(-j 2 pi f0 t),
low-pass to about 10 Hz, decimate to about 50 Hz); remove the static path (direct speaker-to-mic and room) by subtracting a
slow moving average of the complex baseband; unwrap the phase (the amplitude is kept as a backup signal); band-pass
0.1-0.7 Hz; estimate the rate from the FFT peak over 30 s windows stepped by 5 s; try a few bins around f0 and pick the one
with the most 0.1-0.7 Hz energy (chosen from the signal alone, never from the paced rate).

Per take, the rate estimate is the median over its 30 s windows (windows that overlap a labelled breath-hold are left out).
The reference is the take's `paced_bpm`; the breaths counted from `inhale_starts_s` are reported next to it.

- GO: the rate is within 2 bpm of the paced rate on at least 75% of the paced takes (3 of every 4), pooled over at least
  two people.
- Otherwise, if the apnea check passes it is a PARTIAL GO. Apnea check: breathing strength is the RMS of the band-passed
  phase in a 10 s window; a breath-hold is flagged when that falls below 30% of the median strength over the take's
  breathing windows. It passes when, on at least 75% of the breath-hold takes pooled over at least two people, the flag is
  raised within 10 s of the labelled start of the hold, and the flag is not raised in the first 10 s of the take or in the
  take's breathing windows more than 20% of the time.
- Otherwise NO-GO.
Reported either way: per take the estimate, the paced rate, the error, which bin was chosen and a plot
(`ml/experiments/breathing/*.png`). No threshold above changes after the first real take is processed. If it is a GO, the
engine gets a breath estimator (rate in bpm, confidence, apnea flag) with tests, and the API is posted for Ian's Care page.

### Breathing: data-quality gate added before any real take was analysed (Ian's INFO 7065037009)
Ian found that in his hold take the 20 kHz tone magnitude fell about 10x between 15 s and 20 s and never recovered, so the
"flat" hold was the tone dying (another audio tab, a device switch), not apnea. A take whose tone moves cannot say anything
about breathing, so this gate is applied to every breathing take before the rate or apnea methods see it, with these fixed
numbers:
- Tone level per take: the magnitude of the mic spectrum at the tone frequency in 5 s windows stepped by 1 s, in dB.
- A window is stable when its level is within 3 dB of the take's median level. The take is cropped to its longest run of
  stable windows. If that run is shorter than 30 s (one rate window) the take is REJECTED: it is listed with its reason and
  does not count for or against the GO/NO-GO counts below.
- If, after the gate, fewer than 4 paced takes from fewer than 2 people remain, the verdict is INSUFFICIENT DATA (not NO-GO)
  and more takes are asked for. The 75% rules above are otherwise unchanged and apply to the takes that pass the gate.

Clarifications of the breathing rule, written before any breathing rate was computed (they fix how the code reads the text above):
- INSUFFICIENT DATA applies when EITHER there are fewer than 4 usable paced takes OR they come from fewer than 2 people.
- The "not flagged in the first 10 s" check uses the first 10 s of the cropped signal.
- "Flag within 10 s of the labelled start of the hold" means a flag whose window centre lies in [start, start + 10 s]; a flag before the hold does not count.
- The crop to the stable stretch can include up to about 2 s after a tone change, because the last stable 5 s window straddles it. Accepted.
- A level step that splits a take exactly 50/50 rejects it, because the median falls between the two levels.
Measured when the gate was first applied (levels only, no rate): Ian's 10 bpm take is cropped to 20-60 s, his 15 and 20 bpm
takes are rejected (the tone level swings 8.8 dB and 19.8 dB), his hold take is cropped to 16-60 s (the tone drops by about
15-20 dB at 15 s and is then steady, still 67-88 dB above the noise in a 5 s window), and Yahya's 10 bpm take is cropped to
0-49 s. So, as of now, 2 usable paced takes from 2 people: INSUFFICIENT DATA until more takes arrive.

### Round 3b result: the Doppler-sign override is REFUSED (leave-one-person-out, 5 people, 2 seeds)
| seed | variant | macro recall | PUSH | PULL | PUSH cued, answered PULL | PULL cued, answered PUSH |
|---|---|---|---|---|---|---|
| 0 | model alone | 0.433 | 0.47 | 0.53 | 28 | 48 |
| 0 | with override | 0.416 | 0.47 | 0.43 | 31 | 82 |
| 1 | model alone | 0.416 | 0.45 | 0.50 | 51 | 57 |
| 1 | with override | 0.400 | 0.45 | 0.40 | 50 | 93 |
Both seeds lose macro recall (-0.017, -0.016) against the required gain of more than 0.02, and PULL recall is lower on both
(PUSH too on seed 0), so the pre-registered rule refuses it. False alarms are unchanged, as designed. Full table:
`round3/sign/SIGN.md`, raw numbers `round3/sign/sign.json`.
What went wrong with the premise: I wrote that the rule detector gets the direction right in about 90-100% of cues. That
number counted a cue as a hit when ANY event in its window had the right label, and the same windows also contain the
opposite-direction event from the wind-up or the recoil (the strays reported next to it, for example PUSHx26 PULLx7 on a
push take). So it said the right direction is present, not that it is the strongest or the last one. The override takes the
largest-magnitude shift in the last second, and that is often the recoil, so it turned correct PULLs into PUSHes
(48 to 82). Consequence: the engine's `signOverride` was pushed on by default (38c5f07) per the lead's 10:30 order before this
evaluation finished; it is now OFF by default and can be switched on in gesture.json. Not tried and not claimed: using the rule
detector's own stroke logic (the primary stroke after wind-up and recoil are dropped) as the tie-break. That would be a new
candidate under a new pre-registered rule.

## Retrain with Michael's Dell takes (Sat 21 Nov, 12:00). PRE-REGISTERED before the retrain is evaluated
New data: 14 gesture takes on a Dell Inspiron 15 3520 (`data/recordings/Miguel982/battery1`, audited 14 of 14 usable,
tone 37-49 dB), the first new laptop model since the original set. Nothing about the recipe changes (defaults, 30 epochs).
Leave-one-person-out with the same machinery as round 3 (`ml/tune.py`, baseline recipe only, seeds 0 and 1) is a sanity
check on the new data, not a paired comparison with the earlier 0.421 / 2.11 (the people's data differ now).
The new model replaces the shipped one only if ALL hold:
- mean macro recall of the two seeds is at least 0.39 (the old baseline 0.421 minus 2 x its seed noise 0.018),
- mean false alarms per minute is at most 2.6 (the old 2.11 plus 0.5),
- the exported model passes the engine and ml tests (`npm test` in engine, `pytest` in ml) with the new `gesture.onnx/.json`.
Otherwise the shipped model stays and the result is reported.

### Retrain result: shipped, then ROLLED BACK after a live regression (correction, 12:50)
Ian, live on his MacBook Pro, saw WAVE read as UNDO repeatedly with this model, "much worse than the morning model", and
rolled the app back to the morning model (9f7e41e, fa5bd8c); `ml/models` is restored to it too. What I checked offline, with
both ONNX files through the real streaming decoder: on Ian's takes (in the training set of both) WAVE 99% and 100%, no
WAVE-as-UNDO; on his held-out pilot takes (`data/pilot`, never trained on, 7 takes, old protocol, few reps) neither model
confuses WAVE with UNDO (WAVE 4 of 12 cues for both) and the Dell model is better at UNDO (12 of 13 against 6 of 13);
UNDO events emitted during all 23 WAVE takes: 1 for the morning model, 3 for the Dell model, over 450 WAVE reps. So the
regression is NOT reproducible on any recorded take; it shows up only live. A plausible but unproven reading: the Dell
model is more eager to emit UNDO (it fires on more double taps, which is what the UNDO recall gain is), and in a live wave a
stray UNDO then follows. Lesson: the pre-registered rule scores cued takes and cannot see the presenter's live behaviour.
New shipping rule (Ian's order, in force from now on): a model goes to the app only if (a) the retrain rule below holds, (b)
its per-gesture recall on Ian's MacBook Pro takes that it was NOT trained on is not lower than the shipped model's
(`data/pilot/I-ala-Wilson` and any `livecheck-*` takes he records), AND (c) Ian has tried it live (wave 5x, UNDO 5x, PUSH and
PULL 5x each) and keeps the previous model file so he can roll back in seconds. The "retrain rule" below was met by the
numbers and is kept for the record.

Operational form of (a) and (b), fixed at 13:00 before the first candidate under it is evaluated (the retrain with EJ's two
extra UNDO takes, 40 cues): (a) is the retrain rule below (mean macro recall of 2 LOPO seeds >= 0.39, false alarms <= 2.6 per
minute, tests pass). (b) is measured with `ml/compare_models.py` on Ian's takes the model never trained on: `data/pilot`
(person `ian`, 7 takes) plus every take in `livecheck-*` folders once they exist; for each gesture the candidate's hits must be
at least the shipped model's hits minus ONE cue (the pilot set has only 12-28 cues per gesture, so one cue is noise), and its
WAVE reps must not produce more UNDO events than the shipped model's plus one. (c) stays Ian's live check. All three must
hold; if the candidate fails any, the shipped model stays.
Calibration of rule (b) itself (`ml/compare_models.py`, 13:05): run on the two models of the live regression, the Dell model
that Ian saw misread WAVE as UNDO PASSES (PUSH 7 vs 6 of 28, WAVE 4 vs 4 of 12, OPEN_CLOSE 0 vs 2 of 13, UNDO 6 vs 12 of 13,
REPETITIVE 2 vs 1 of 14, 0 vs 0 stray UNDO in WAVE takes). So (b) cannot catch that failure: it only guards against a visible
recall loss. Only (c), Ian's live check, and the `livecheck-*` takes he records are decisive; do not ship on numbers alone.

### Retrain result: rule met (superseded by the correction above)
Leave-one-person-out, baseline recipe, seeds 0 and 1, 5 people, now including the Dell takes (`retrain_dell/SUMMARY.md`):
macro recall 0.413 and 0.412 (mean 0.412, needs 0.39), false alarms 2.08 and 2.13 per minute (mean 2.10, needs 2.6),
train F1 0.927, held-out F1 0.557 (was 0.946 and 0.555). Engine tests 184 passed, ml tests 263 passed (5 skipped) with the
new files. `gesture.json` differs only in the window count (73208 to 79550); classes, thresholds and decoder are unchanged.
Honest reading: the held-out numbers are the same as before within noise (0.412 vs 0.421), so this is not an accuracy gain
on the people we already had. What it adds is a second laptop model (Dell Inspiron 15 3520) in the training set.

## Bad data result: removing the six suspect takes does NOT help; nothing removed (13:10)
Leave-one-person-out, baseline recipe, seeds 0 and 1, current data, GPU (`ml/experiments/baddata/`). A trains on every take;
B leaves the six suspect PULL takes out of TRAINING only; both are scored on the identical held-out set without those six takes.
| | A (all takes) | B (without the six) |
|---|---|---|
| macro recall (six classes, rule metric) | 0.400 | 0.399 |
| false alarms per minute | 2.06 | 2.45 |
| train-to-held-out F1 gap | 0.350 | 0.352 |
| PUSH / PULL | 0.483 / 0.442 | 0.494 / 0.361 |
| WAVE / UNDO / OPEN_CLOSE / Habit | 0.402 / 0.463 / 0.375 / 0.235 | 0.447 / 0.506 / 0.378 / 0.210 |
`tune.decide` verdict: REFUSED: gain -0.001 does not clear the margin 0.013, neither seed is above the baseline (0.394 vs
0.396, 0.404 vs 0.405), better for only 3 of 5 people (needs 4), more false alarms (2.45 vs 2.06). The opposite of the
hypothesis showed up in the one class it was about: PULL recall FELL by 0.08 without the suspects (both seeds), while WAVE
and UNDO rose by 0.04 each, so the overall mean stayed flat. Reading: those takes, where the pull starts with a reach
toward the screen, are how some people really pull, and the model needs them to recognise PULL; they are not label noise.
Not claimed: that other takes are clean (only the physics-sign scan was run), or that the PULL drop is large (2 seeds, same
direction on both). Tooling kept: `ml/tune.py --drop-test FILE` and the recipe key `drop_train` (tests in
`ml/tests/test_tune_drops.py`), so a future suspect list can be tested the same way.

## Reporting convention: five gestures, and Habit separately (Yahya's decision, confirmed by Ian, EJ and Michael, 13:06)
REPETITIVE is the Habit feature's signal, not a gesture. The model keeps its 7th output (it needs it so scratching is not
misread as a gesture) and the engine type is unchanged. From now on every public number is split:
- GESTURES (PUSH, PULL, WAVE, OPEN_CLOSE, UNDO), people the model has never seen, leave-one-person-out, 2 seeds, 5 people:
  macro recall 0.452 (PUSH 0.487, PULL 0.485, WAVE 0.449, OPEN_CLOSE 0.362, UNDO 0.477).
- HABIT (REPETITIVE): recall 0.215 on unseen people (weakest signal; scratching works better live than this suggests, EJ's
  live test caught 6 of 7; nail biting was dropped).
- False alarms: 2.1 events per minute on idle takes, all classes together (the files do not separate Habit from gestures).
- Ian on his MacBook Pro, trained on the other four people: gestures 0.656, Habit 0.07; adding his own cues per take:
  5 cues 0.708 (+0.05), 20 cues 0.742 (+0.09), 20 cues repeated 5x 0.766 (+0.11); Habit 0.07 to 0.44. One person, 2 seeds.
The numbers in the earlier sections (0.412, 0.421, the round 3 and retrain tables) are the mean over all SIX classes, Habit
included, which is what the pre-registered rules were written and judged on; they are not re-judged. The six-class mean
for the shipped data is 0.412; dropping Habit from the mean moves it to 0.452. `ml/experiments/summary.json` carries both,
labelled (`gestures`, `habit`, `macro_recall_all_classes_rule_metric`).

## Breathing v2 result: NO-GO (computed once at 12:45:01, Sat 21 Nov, with the frozen rule)
Test set: every take created at or after 11:05 and pushed by 12:45: EJ 3 (15 bpm, hold, natural), Michael 5 (Dell: 10, 15, 20
bpm, hold, natural), Ian 4 (MacBook Pro, 12:39-12:43: 10, 15, 20 bpm, hold). 12 takes, 3 people, no choice involved in which
count. Gate: v2 rejected 0 of 12 (v1's gate would have rejected 8, so v1 on these takes is INSUFFICIENT DATA).
Paced takes (7), v2 median estimate against the paced rate, error in bpm:
| person | 10 bpm | 15 bpm | 20 bpm |
|---|---|---|---|
| EJ | | 15.4 (+0.4) | |
| Michael | 19.0 (+9.0) | 19.8 (+4.8) | 20.5 (+0.5) |
| Ian | 7.3 (-2.7) | 8.1 (-6.9) | 8.1 (-11.9) |
Within 2 bpm: 2 of 7 (29%), needs 75%, so NO-GO. Natural breathing (no known rate) read 20.5 bpm (EJ) and 22.0 bpm (Michael),
at the top of the 7.2-30 bpm search band. The estimates do not follow the paced rate: Michael's and EJ's sit near 20 bpm
whatever the pacing, Ian's near 8 bpm. The apnea check found no flag inside the held 20-40 s window on any of the 3 hold
takes (EJ, Michael, Ian), so PARTIAL GO fails too.
Consequence (rule fixed before the takes): breathing rate is dropped from the product, and so is the breath-hold flag as a
live feature. Not claimed: that breathing cannot be measured with this hardware; only that these two estimators, on
these 12 takes, do not do it. Raw tables and plots: `breathing/v2test/`.

## UNDO backup from the rule detector. PRE-REGISTERED before the rule UNDO is scored on the recordings (Sat 21 Nov 12:10)
Why: EJ reports that on his MacBook Air the engine never emitted UNDO live. The held-out report shows classifier UNDO recall
of 29% for EJ (86% for Ian). With the model on, `engine/src/index.ts` drops the rules' UNDO (only HOLD and REPETITIVE pass).
The rule detector (double tap toward within 600 ms) is untrained, so its score on the recordings is not train/test
contaminated, but its thresholds were first guesses tuned on the pilot data, which is not in `data/recordings`.
Measurement: `engine/tools/score.ts` on `data/recordings` (rules only): UNDO rep recall pooled and per person, and UNDO
events per minute on NONE takes (false alarms), pooled.
Decision: let the rules' UNDO through next to the model's (OR, like REPETITIVE) only if ALL hold:
- rule UNDO rep recall pooled over all UNDO takes is at least 0.60 (the model alone is 0.48 held-out),
- rule UNDO false events on NONE takes are at most 0.5 per minute pooled,
- the rule UNDO recall for EJ is higher than the model's held-out 0.29,
- all engine tests pass, with a new test that a model event and a rule event for the same double tap give ONE UNDO
  (shared refractory).
Otherwise nothing changes and the answer to EJ is "record a short calibration on his laptop and retrain".

### UNDO backup result: REFUSED
`engine/tools/score.ts`, rules only, all `data/recordings` (Naomi's takes sit in Ian's folder): rule UNDO rep recall
EJ 7/80 (9%), Ian and Naomi 9/200 (5%), Michael 3/40 (8%), Yahya 7/90 (8%), pooled 26/410 (6%), needs 60%. The rules read a
real double tap as PUSH and PULL strokes (EJ's UNDO cues were missed as PULLx69 PUSHx73), so the detector in `gestures.ts`
does not catch the double tap on real hands even though 71% of EJ's cues contain two clear toward strokes in the raw
Doppler (measured separately). Nothing changes in the engine. Not claimed: that a better double-tap rule cannot work; that
would be a new candidate under a new pre-registered rule.

## Bad data: do mislabeled takes hurt training? (Yahya's request, Sat 21 Nov 12:30). PRE-REGISTERED before the experiment runs
Scan (physics, no model): for every PUSH and PULL take, the share of cues whose Doppler sign matches the label, three ways
(sign of the first strong stroke, of the largest-magnitude shift, of the summed strong shift inside the cue window). A
take is a SUSPECT when the best of the three is below 0.35. Six takes qualify, all PULL on the MacBook Pro (Ian's four,
both sessions, agreement 0-30%; Naomi's two): `ml/experiments/baddata/suspects.txt`. Ian's and Naomi's PUSH takes and every
other person's PULL takes agree (EJ 78-100%, Yahya 70-100%); Michael's are mixed (35-60%) and above the line. So the
contradiction is about those takes (toward-first pulls on that laptop), not a global sign flip.
Hypothesis: these six teach the model that PULL looks like toward motion, adding to the PUSH-for-PULL confusion.
Experiment (leave-one-person-out, baseline recipe, seeds 0 and 1, current data incl. Dell takes, GPU):
- A: train on every take; B: the same but the six suspects are left out of TRAINING only.
- Both are SCORED on the identical held-out set: every held-out take except the six suspects (a fair clean test).
Decision with `tune.decide` (B vs A, `fa_slack` 0, per-seed pairing, 4 of 5 people): if B is accepted, add the six takes to a
training exclusion list (`ml/exclude_takes.txt`, files are never deleted) and retrain the shipped model under the retrain
rule above. If not, nothing is removed and the result is reported. PUSH and PULL recall are reported either way.
Not claimed: that these takes are "wrong" (a pull may legitimately start with a reach toward the screen); only whether
training without them helps people the model has not seen.

## New double-tap UNDO detector (Ian's DIRECT 7066324794). PRE-REGISTERED before it is scored (Sat 21 Nov 12:35)
The first rule detector scored 6% (refused, above). This one is written from the measured shape of real UNDO cues (two
toward strokes about 0.30 s apart, strokes peaking at 118-184 Hz), not tuned afterwards. All numbers below are FROZEN:
- A toward stroke: at least 3 consecutive frames (gaps of up to 2 frames allowed) with shiftHz >= +30, peak >= 45 Hz.
- A burst: toward strokes whose starts are less than 700 ms apart.
- UNDO fires when a burst has exactly 2 toward strokes whose starts are 150-600 ms apart, the burst spans at most 1.3 s, and
  there is no strong motion (|shiftHz| >= 30 for 2 or more frames, either sign) for 300 ms after the second stroke ends.
  It is reported at that moment, source 'rules', confidence 0.7, hold-off 800 ms. 3 or more toward strokes in a burst
  (a wave) never fires.
Scoring (`engine/tools/undo-score.ts`, the real DSP on every take in `data/recordings`, breath takes excluded): an UNDO
event is a hit for a rep if it falls between the rep's start and 1.0 s after its end; events elsewhere are false.
Accept (all must hold): UNDO rep recall pooled >= 0.55 AND EJ >= 0.40; false UNDO events per minute <= 1.0 pooled over the
PUSH, PULL, WAVE, OPEN_CLOSE and REPETITIVE takes AND <= 0.3 per minute on NONE takes. If accepted: it is OR-ed with the
model's UNDO in `engine/src/index.ts` behind `ruleUndo` in gesture.json (shared refractory, so one double tap gives one
UNDO) with tests; app changes are Ian's. If not accepted: refused, no re-tuning on these takes (a second version would be a
new pre-registration and would say it was tuned on the same data).

### New double-tap UNDO detector result: REFUSED (false alarms)
`engine/tools/undo-score.ts` on all 175 gesture takes in `data/recordings`, parameters exactly as frozen above, one run
(one reading made explicit in the code: a burst is decided only 700 ms after its second stroke starts, so a third stroke of
a wave can still join it).
- UNDO rep recall: EJ 66/80 (83%), Ian 49/80 (61%), Michael 75/160 (47%), Naomi 10/40 (25%), Yahya 54/90 (60%), pooled
  254/450 (56%). Passes both recall bars (pooled >= 55%, EJ >= 40%), against 6% for the old rule detector.
- False UNDO events per minute: NONE takes 1.28 (75 in 58.6 min, bar 0.3), PUSH/PULL/WAVE/OPEN_CLOSE/REPETITIVE takes
  1.87 (232 in 124.1 min, bar 1.0), outside the reps of UNDO takes 0.38.
Both false-alarm bars fail by a factor of 4 and about 2, so by the pre-registered rule the detector is NOT added to the
engine (it stays unwired; the code and its tests are kept only so the number can be reproduced). It is not a usable
backup on its own: it would give a stray UNDO about every 45 seconds of idle sitting. Not claimed: that a stricter
double-tap rule or the rule AND-ed with a weak model UNDO probability cannot work; both would be new candidates under new
pre-registrations, judged on held-out data this time because these takes have now been looked at.

## Breathing v2: time-boxed second shot (Ian's DIRECT 7065406175). PRE-REGISTERED before any new take is analysed
v1 stays as written above and keeps its verdict (NO-GO on the 15 takes it was run on). v2 is an alternative method next to it,
judged only on takes that were not used to design it, with a hard stop at 13:30 today: if v2 is not a GO by then, breathing
rate is dropped and only the breath-hold / apnea flag is considered.

Why v2, from the v1 results and from EJ's observation (the design set is the 15 takes analysed so far; their spectra may be
looked at to check the idea is sane, but no number below is tuned on them):
- v1 estimates are pulled toward about 10 bpm whatever the paced rate (20 bpm reads as 10.6 and 8.3, natural breathing as 9.2).
  The unwrapped phase has slow drift whose power rises toward low frequency (about 1/f) and can outweigh a 0.3 Hz breath
  peak in the FFT.
- EJ's 15 bpm and natural takes show the 20 kHz level itself wobbling with a period of about 4.6 s, the breathing rate: with a
  strong chest echo the breathing modulates the tone level. v1's tone gate (5 s windows) cannot tell that from a bad tone.

v2 method, all numbers fixed now:
1. Same front end as v1: demodulate at the tone frequency, remove the static path, unwrap the phase, same bin choice.
2. Detrend with a high-pass at 0.05 Hz, then for each 30 s window (stepped by 5 s, as in v1) compute the Hann-windowed
   periodogram zero-padded to 4096 points at 50 Hz.
3. Whiten: fit a straight line to log(power) against log(frequency) over 0.05-1.5 Hz with a median-based (Theil-Sen) fit,
   divide the periodogram by the fitted power law, and take the highest whitened bin inside 0.12-0.5 Hz (7.2-30 bpm) as the
   rate. Bands, window, step and per-take median are otherwise the same as v1.
4. Breathing-aware tone gate: the tone level is measured in 20 s windows stepped by 5 s (long enough to average over several
   breaths); a window is stable when within 3 dB of the take's median level; the take is cropped to its longest run of stable
   windows and rejected when that run covers less than 30 s. A sustained collapse such as Ian's 10x drop is still rejected.
5. Apnea flag unchanged from v1.

Which takes count (the test set): the takes that arrive after this rule is pushed, plus the takes that were recorded
before it but whose rates nobody has looked at: EJ's three retakes (15 bpm, hold, natural, 11:05-11:07, 21 Nov) and any
redo by Ian. None of the 15 takes already analysed (all the takes dated before 11:05) counts for v2.

Success rule, unchanged from v1: at least 4 usable paced takes from at least 2 people after the v2 gate; GO when at least
75% of them are within 2 bpm of the paced rate; PARTIAL GO when the apnea check of v1 passes on the hold takes (75%, 2
people); otherwise NO-GO. v1 and v2 are reported side by side on the test takes.

Test set closing rule, written after the v2 code was frozen (9433b0b) and after the first look at the three takes that
existed then (EJ's retakes: v2 gate passes all three, v2 reads the 15 bpm take as 15.4 bpm; v1 gate rejects all three;
one paced take, so INSUFFICIENT DATA): the test set is every take with createdAt at or after 2026-11-21T11:05 -05:00
that is pushed by 12:45 today. EVERY one of them that passes the v2 gate counts, whatever its estimate; nobody chooses
which takes count, and a take is only recorded again when the gate rejects it. The verdict is computed once, after 12:45.

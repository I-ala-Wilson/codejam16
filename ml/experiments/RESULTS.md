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
| 1 | with override | 0.400 | n/a | lower | n/a | n/a |
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

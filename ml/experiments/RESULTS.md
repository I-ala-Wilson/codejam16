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

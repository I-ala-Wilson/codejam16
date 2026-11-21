# Gesture classifier report (first results, Fri night)

Data: `data/recordings/` as of Fri 23:50: Ian 14 takes (MacBook Pro), EJ 14 (MacBook Air M2), Yahya 12 (MSI Katana 15 HX, no
OPEN_CLOSE). Michael's takes are not in yet. 40 of 40 takes pass `ml/audit.py` (some with a lead-in warning).
Model: small CNN (about 32k parameters), 48 frames x 87 bins in, six classes out, trained on the RTX 5070 in about a minute.
Scores are streaming: the decoder (`ml/evaluate.py`) must fire the right class inside the cue window (plus 0.8 s).
Targets: rep recall of 80% or more per class, at most 1 false alarm per minute on NONE takes.

## 1. What this means in one paragraph

The model learns the gestures: with the same people in training, recall is 83% PUSH, 83% PULL, 93% UNDO, 88% WAVE and 65%
OPEN_CLOSE (section 3). It does **not** yet generalise to a person or laptop it has never seen (section 2: pooled recall
23% to 57%), and it fires **far too many false alarms** (20 to 37 per minute on NONE takes it never saw, section 4).
So today it is usable for the people and laptops in the training set, and not yet for strangers. More people, more NONE
variety and the live-test corrections are what should move these numbers. Nothing below is tuned on the test person.

## 2. Leave-one-person-out (honest number for an unseen person)

Train on the other two people, test on the held-out one. 30 epochs, seed 0. Only two people train each fold, which is the
weak spot: a 15-epoch run gave the same picture (pooled PUSH 28%, PULL 53%, WAVE 54%, UNDO 27%).

| held out | PUSH | PULL | WAVE | OPEN_CLOSE | UNDO | false alarms per min | stray events |
|---|---|---|---|---|---|---|---|
| EJ2007 | 40% | 8% | 85% | 0% | 35% | 7.7 | 21 |
| I-ala-Wilson | 18% | 38% | 5% | 100% | 38% | 37.3 | 76 |
| Yahya-github | 12% | 62% | 82% | n/a | 30% | 6.5 | 13 |
| **pooled** | **23%** | **36%** | **57%** | **50%** | **34%** | | |

Confusion, pooled (rows: cued, columns: what fired):

| cued | PUSH | PULL | WAVE | OPEN_CLOSE | UNDO | none |
|---|---|---|---|---|---|---|
| PUSH | 28 | 20 | 14 | 8 | 1 | 49 |
| PULL | 11 | 43 | 4 | 14 | 0 | 48 |
| WAVE | 0 | 8 | 69 | 24 | 0 | 19 |
| OPEN_CLOSE | 4 | 0 | 2 | 40 | 18 | 16 |
| UNDO | 4 | 1 | 7 | 24 | 41 | 43 |

## 3. Same people, other distance (upper bound for people who are in the training set)

Train on every person's 15 and 20 cm takes plus NONE a and b; test on the same people's 30 and 50 cm takes plus NONE c and d.
15 epochs. All test takes pooled: PUSH 83%, PULL 83%, UNDO 93%, WAVE 88%, OPEN_CLOSE 65%. By person: Ian 100% on every class,
EJ 95% PUSH, 95% UNDO, 65% WAVE, 50% PULL, 30% OPEN_CLOSE; Yahya 100% PULL, 100% WAVE, 85% UNDO, 55% PUSH.

## 4. False alarms and the decision threshold

On that same split, NONE takes c and d (leaning, head turns, a wandering hand) were never in training. Sweeping the threshold
(all classes alike) and the number of confirmations:

| threshold | confirm | mean recall | false alarms per min | stray events |
|---|---|---|---|---|
| 0.70 | 2 | 0.83 | 24.7 | 90 |
| 0.80 | 2 | 0.76 | 20.0 | 69 |
| 0.90 | 2 | 0.67 | 12.1 | 35 |
| 0.95 | 2 | 0.49 | 7.1 | 25 |

A stricter threshold trades recall for false alarms but never reaches the target, so the engine default is 0.8 (middle of the
sweep) until there is more NONE data. The final model trains on all four NONE kinds. The live test's misses and false alarms
are the next source of hard negatives.

## 5. Experiments that did not help

- Scaling each take's excess by its tone SNR (`dataset.SNR_REFERENCE_DB`, off by default): UNDO 0.27 to 0.39 and Ian's false
  alarms 39 to 18 per minute, but PULL 0.53 to 0.38 and PUSH still about 0.3. Not adopted.
- Longer training (15 to 30 epochs): no change.

## 6. Next

1. Michael's takes (a Windows laptop) and the Habit add-on, then retrain; keep leave-one-person-out as the headline number.
2. Add the live test's corrected attempts and its false alarms as training data (hard negatives).
3. Tune thresholds per class, and consider a longer confirmation for WAVE and UNDO, once there are four people.
4. OPEN_CLOSE needs the most data and is the first class to drop from the Lock vocabulary if it stays under 70%.

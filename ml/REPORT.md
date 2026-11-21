# Gesture classifier report

Generated 2026-11-21 04:20 on cuda; 30 epochs, seed 0.
Method: leave-one-person-out. For each person, train on everyone else, then score that person's takes with the
streaming decoder (a class must fire inside the cue window). Takes without a usable hands-off lead-in are skipped.
Targets: rep recall of 80% or more per class, at most 1 false alarm per minute on NONE takes.
A class under 70% is dropped from the Lock vocabulary (LOW means between 70% and 80%).
How the recipe and thresholds were chosen, and what these numbers mean: ml/experiments/RESULTS.md.

## Rep recall by held-out person

| held out | PUSH | PULL | WAVE | OPEN_CLOSE | UNDO | REPETITIVE | false alarms per min (NONE takes) | stray events |
|---|---|---|---|---|---|---|---|---|
| ej2007 | 68% DROP | 44% DROP | 50% DROP | 0% DROP | 29% DROP | 24% DROP | 1.5 | 27 |
| i-ala-wilson | 54% DROP | 34% DROP | 74% LOW | 84% ok | 86% ok | 6% DROP | 3.8 | 92 |
| miguel982 | 19% DROP | 48% DROP | 19% DROP | 48% DROP | 46% DROP | 25% DROP | 2.1 | 71 |
| naomi | 95% ok | 68% DROP | 82% ok | 80% ok | 38% DROP | n/a | 1.9 | 28 |
| yahya-github | 36% DROP | 80% ok | 37% DROP | 0% DROP | 36% DROP | 30% DROP | 1.4 | 54 |
| **pooled** | **49% DROP** | **53% DROP** | **49% DROP** | **43% DROP** | **48% DROP** | **19% DROP** | | |

## Confusion, pooled over all held-out people (rows: cued gesture, columns: what fired)

| cued | PUSH | PULL | WAVE | OPEN_CLOSE | UNDO | REPETITIVE | none |
|---|---|---|---|---|---|---|---|
| PUSH | 190 | 52 | 4 | 0 | 1 | 0 | 143 |
| PULL | 37 | 191 | 1 | 1 | 0 | 4 | 126 |
| WAVE | 5 | 4 | 180 | 9 | 6 | 2 | 164 |
| OPEN_CLOSE | 0 | 1 | 11 | 137 | 32 | 0 | 139 |
| UNDO | 6 | 5 | 16 | 1 | 176 | 2 | 164 |
| REPETITIVE | 9 | 32 | 16 | 2 | 16 | 46 | 119 |

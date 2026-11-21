# Tuning summary (leave-one-person-out)

Accepted only if: gain over the baseline > max(2 x seed noise, 0.01), better for 80% of people,
false alarms/min no more than 0.25 above the baseline, train-to-held-out gap no more than 0.02 wider.

| recipe | seeds | macro recall | false alarms/min | train F1 | held-out F1 | gap | verdict |
|---|---|---|---|---|---|---|---|
| aug2 | 1 | 0.517 | 5.19 | 0.821 | 0.531 | 0.290 | refuse: more false alarms per minute: 5.19 vs 3.91 |
| baseline | 2 | 0.491 | 3.91 | 0.919 | 0.553 | 0.367 | baseline |
| ep15 | 1 | 0.516 | 4.52 | 0.884 | 0.548 | 0.337 | refuse: more false alarms per minute: 4.52 vs 3.91 |
| gain12 | 1 | 0.489 | 4.26 | 0.906 | 0.547 | 0.359 | refuse: gain -0.001 does not clear the margin 0.010 (2 x seed noise 0.002, floor 0.01); better for only 2 of 5 people (needs 4): ['miguel982', 'naomi']; more false alarms per minute: 4.26 vs 3.91 |
| none3 | 1 | 0.461 | 3.08 | 0.944 | 0.550 | 0.395 | refuse: gain -0.030 does not clear the margin 0.010 (2 x seed noise 0.002, floor 0.01); better for only 1 of 5 people (needs 4): ['naomi']; wider train-to-held-out gap: 0.395 vs 0.367 (overfitting) |
| none3_ep15_aug2 | 1 | 0.474 | 2.67 | 0.834 | 0.570 | 0.263 | refuse: gain -0.017 does not clear the margin 0.010 (2 x seed noise 0.002, floor 0.01); better for only 1 of 5 people (needs 4): ['naomi'] |
| reg | 1 | 0.492 | 3.96 | 0.900 | 0.543 | 0.357 | refuse: gain +0.001 does not clear the margin 0.010 (2 x seed noise 0.002, floor 0.01); better for only 2 of 5 people (needs 4): ['miguel982', 'naomi'] |
| width8 | 1 | 0.512 | 5.62 | 0.819 | 0.511 | 0.307 | refuse: more false alarms per minute: 5.62 vs 3.91 |

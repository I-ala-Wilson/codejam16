# Tuning summary (leave-one-person-out)

Accepted only if: gain over the baseline > max(2 x seed noise, 0.01), better for 80% of people,
false alarms/min no more than 0.0 per minute above the baseline, train-to-held-out gap no more than 0.02 wider.

| recipe | seeds | macro recall | false alarms/min | train F1 | held-out F1 | gap | verdict |
|---|---|---|---|---|---|---|---|
| baseline | 2 | 0.421 | 2.11 | 0.946 | 0.555 | 0.391 | baseline |
| coord | 2 | 0.430 | 2.27 | 0.942 | 0.553 | 0.389 | refuse: gain +0.009 does not clear the margin 0.036 (2 x seed noise 0.018, floor 0.01); better for only 3 of 5 people (needs 4): ['ej2007', 'miguel982', 'yahya-github']; more false alarms per minute: 2.27 vs 2.11 |
| coord_snrnorm | 2 | 0.403 | 1.99 | 0.940 | 0.545 | 0.394 | refuse: gain -0.017 does not clear the margin 0.036 (2 x seed noise 0.018, floor 0.01); seed 0: macro recall 0.412 is not above the baseline's 0.433; seed 1: macro recall 0.395 is not above the baseline's 0.408; better for only 2 of 5 people (needs 4): ['miguel982', 'yahya-github'] |
| snrnorm | 2 | 0.398 | 2.09 | 0.941 | 0.535 | 0.406 | refuse: gain -0.023 does not clear the margin 0.036 (2 x seed noise 0.018, floor 0.01); seed 0: macro recall 0.401 is not above the baseline's 0.433; seed 1: macro recall 0.396 is not above the baseline's 0.408; better for only 1 of 5 people (needs 4): ['yahya-github'] |

# Tuning summary (leave-one-person-out)

Accepted only if: gain over the baseline > max(2 x seed noise, 0.01), better for 80% of people,
false alarms/min no more than 0.0 per minute above the baseline, train-to-held-out gap no more than 0.02 wider.

| recipe | seeds | macro recall | false alarms/min | train F1 | held-out F1 | gap | verdict |
|---|---|---|---|---|---|---|---|
| baseline | 2 | 0.400 | 2.06 | 0.924 | 0.574 | 0.350 | baseline |
| no_suspects | 2 | 0.399 | 2.45 | 0.923 | 0.571 | 0.352 | refuse: gain -0.001 does not clear the margin 0.013 (2 x seed noise 0.007, floor 0.01); seed 0: macro recall 0.394 is not above the baseline's 0.396; seed 1: macro recall 0.404 is not above the baseline's 0.405; better for only 3 of 5 people (needs 4): ['ej2007', 'i-ala-wilson', 'yahya-github']; more false alarms per minute: 2.45 vs 2.06 |

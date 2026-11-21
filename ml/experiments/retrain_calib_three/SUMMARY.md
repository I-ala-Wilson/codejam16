# Tuning summary (leave-one-person-out)

Accepted only if: gain over the baseline > max(2 x seed noise, 0.01), better for 80% of people,
false alarms/min no more than 0.0 per minute above the baseline, train-to-held-out gap no more than 0.02 wider.

| recipe | seeds | macro recall | false alarms/min | train F1 | held-out F1 | gap | verdict |
|---|---|---|---|---|---|---|---|
| baseline | 2 | 0.406 | 2.66 | 0.912 | 0.567 | 0.345 | baseline |

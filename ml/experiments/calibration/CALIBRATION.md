# Calibration on i-ala-wilson's own data (train on everyone else + first N cues of one hand, test on the other hand)

| condition | macro recall | false alarms/min | OPEN_CLOSE | PULL | PUSH | REPETITIVE | UNDO | WAVE |
|---|---|---|---|---|---|---|---|---|
| none | 0.558 | 2.72 | 0.84 | 0.30 | 0.51 | 0.07 | 0.88 | 0.76 |
| cues5x1 | 0.648 | 2.35 | 0.92 | 0.51 | 0.53 | 0.35 | 0.80 | 0.78 |
| cues5x5 | 0.638 | 2.64 | 0.88 | 0.46 | 0.53 | 0.36 | 0.84 | 0.76 |
| cues20x1 | 0.679 | 2.56 | 0.93 | 0.64 | 0.51 | 0.36 | 0.86 | 0.77 |
| cues20x5 | 0.711 | 2.72 | 0.92 | 0.64 | 0.62 | 0.44 | 0.83 | 0.82 |

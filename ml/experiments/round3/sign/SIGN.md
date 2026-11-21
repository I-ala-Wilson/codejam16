# Doppler-sign override (leave-one-person-out, default thresholds)

Verdict: REFUSE - seed 0: macro recall gain -0.017 does not clear 0.02; seed 0: PUSH recall is lower with the override; seed 0: PULL recall is lower with the override; seed 1: macro recall gain -0.016 does not clear 0.02; seed 1: PULL recall is lower with the override

| seed | variant | macro recall | false alarms/min | PUSH as PULL | PULL as PUSH | OPEN_CLOSE | PULL | PUSH | REPETITIVE | UNDO | WAVE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | plain | 0.433 | 1.89 | 28 | 48 | 0.43 | 0.53 | 0.47 | 0.23 | 0.44 | 0.50 |
| 0 | sign | 0.416 | 1.89 | 31 | 82 | 0.43 | 0.43 | 0.47 | 0.23 | 0.44 | 0.50 |
| 1 | plain | 0.416 | 1.87 | 51 | 57 | 0.43 | 0.50 | 0.45 | 0.24 | 0.44 | 0.45 |
| 1 | sign | 0.400 | 1.87 | 50 | 93 | 0.43 | 0.40 | 0.45 | 0.24 | 0.44 | 0.45 |

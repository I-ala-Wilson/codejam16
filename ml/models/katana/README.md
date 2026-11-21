# Katana profile: the model Yahya confirmed live as best on his MSI Katana 15 HX (Sat 21 Nov, about 17:40)

Yahya's words: "The accuracy is really good right now", then "SAVE this model for this machine as the best model for Katana".
This folder is a frozen copy of what his dev server was serving at that moment (`curl localhost:5173/models/gesture.json` matched).

| item | value |
|---|---|
| model | `gesture.onnx` md5 a96404e1..., the shipped calib-three (Ian + EJ + Michael calibration on the demo MacBook Pro, all other takes included) |
| config | `gesture.json` md5 3d1ef3ac...: thresholds PUSH/PULL/WAVE 0.85, OPEN_CLOSE 0.45, UNDO 0.95, REPETITIVE 0.9; `logitBias {PUSH: 1.0}` |
| repo state | main at 5690414 (rule assist off, OPEN_CLOSE 0.45) plus the model of d21f1c7 |
| laptop | MSI Katana 15 HX B14WGK (msi-katana-15-hx-b14wgk), Chrome, tone 20000 Hz, toneDbfs -36 |
| system volume at the time | 300% (`wpctl get-volume @DEFAULT_AUDIO_SINK@` printed 3.00); not lowered from the OS |
| hand and distance | not recorded for the good run; earlier Katana takes were left hand at 20 cm |

What was NOT recorded: what Yahya changed between the 15:25 failing live test (0/10 UNDO) and the good run; no take was saved from the good run,
so its tone level could not be measured.

## Volume history of this laptop (from `volumePct` in the take files)
70% right hand (23:10), 70% left (23:42), 150% left (23:51-00:34, the main and habit batteries), 200% left (calib-1 and livecheck-1, 13:15-13:25),
300% (15:25 live test). Tone received at the mic: about -71 dBFS (70%), -65 (150%), -58.5 (200%), -58.4 (300%): above about 200% the mic gets no
more tone.

## Alternatives, not the saved profile
- `ml/models/candidates/calib-yahya`: pooled + Yahya's calib-1 x5. Best offline on his held-out takes (PUSH 100, PULL 70, UNDO 80, WAVE 100).
  Not live-tested by him yet.
- `ml/models/candidates/katana-only`: his 42 takes only; PULL 50, fails the 70 percent rule.

## Use on this machine
Copy `gesture.onnx` and `gesture.json` from this folder into `app/public/models/` locally and do not commit them (that folder is Ian's); hard reload.
Ian's demo laptop and every default stay untouched.

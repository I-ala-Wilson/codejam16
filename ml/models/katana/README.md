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

## The good run, measured (Sat 21 Nov 16:29-16:33, six live-test takes found later in ~/Downloads)
Live (cued test, shipped model): PUSH 10/10 and 10/10, PULL 9/10, UNDO 9/10, WAVE 10/10, OPEN_CLOSE 10/10 = 58/60 (97%).
Offline replay of the same six takes: shipped calib-three PUSH/PULL/UNDO/WAVE 100%, OPEN_CLOSE 90%; calib-yahya OPEN_CLOSE 50%; katana-only
PUSH 75, WAVE 70, OPEN_CLOSE 20. So the shipped model is the best Katana model; the candidates are not better.
What differed from the failing sessions is the TONE LEVEL AT THE MIC, not the model:
| session | carrier at mic | gap over noise | result |
|---|---|---|---|
| 16:29-16:33 good run | -52.7 to -53.7 dBFS | 80-83 dB | 97% live |
| 15:25 failing live test | -58.4 dBFS | 75.6 dB | UNDO 0/10 |
| 13:15-13:25 calib-1/livecheck-1 | -58.0 to -59.2 dBFS | 68-79 dB | held-out PULL 50, UNDO 30 |
Rule of thumb for this laptop: aim for a received carrier of about -53 dBFS and a gap of 80 dB or more (the MacBook Pro runs about 80 dB). A
louder-looking system volume did not give that: 200% and 300% both gave -58.4 dBFS. The volume setting and hand during the good run were NOT
recorded, so what raised the level by about 5.5 dB is unknown (position or angle of the laptop, output device, or a different level control).
Next time it is good, note it: system volume, laptop angle, and the tone health number shown on the Room test page.

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

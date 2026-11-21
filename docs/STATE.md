# Lead state (owned by the lead's agent, updated at every /standup and /kickoff)

Last updated: (not yet)

## Now (Sat 21 Nov 00:45)
- Spec v5 (UNDO = double tap; recordings in data/recordings/<login>/ as 16-bit; HARD CUTOFF Sun 11:30).
- Dataset: Ian 2 batteries + habit, Naomi 1 (on Ian's MBP), EJ 2 batteries (R+L), Yahya 1. All audited usable. Michael 0 (Dell tone 1.7 dB, fix at 08:00 or skip).
- First model (ml/REPORT.md): seen-people PUSH 83 / PULL 83 / UNDO 93 / WAVE 88 / OPEN_CLOSE 65 %; unseen-person 23-57 %; false alarms 20+/min. Wired into app (useClassifier). Retrain overnight + Sat after habit/false-alarm data.
- Demo laptop: Ian's MacBook Pro (tone ~80 dB).
- Blockers: Supabase keys (Michael) block Care dashboard; Lock gesture password #12 and Care sender #13 (Ian lane) not started.

## People
| Login | Lane | Status | Next |
|---|---|---|---|
| I-ala-Wilson | app + extension + integration | Lock unlock verified (#7 closed); Dataset/Habit/Live test tabs built | #12 Lock password, #13 Care sender |
| Yahya-github | engine + ml (GPU) | model v1 in engine; retraining | REPORT update, HABIT class after 08:00 data |
| EJ2007 | ui + pitch | #5, #11, #17 done; 2 batteries recorded | style pass once style is decided |
| Miguel982 | backend + dashboard | schema done (#4 repo part) | HUMAN: Supabase keys; #8 dashboard; tone fix |

## Sat 08:00 plan
1. Everyone /recover. 2. Habit add-on battery (Habit recording tab) for whoever hasn't. 3. Live test: false-alarm checks (idle + typing) + cued tests, push the files. 4. Michael: Supabase keys, tone fix. 5. Yahya retrain ~09:30. 6. Ian lane: #12 + #13. 7. Floor check 12:00. 8. Sun 11:25: lock main on GitHub (cutoff 11:30).

## Decisions log
- (time) decision, reason

## Risks / open questions

## Next actions (with times)
- At kickoff, right after tagging SPEC v1: remind Ian to text Michael "type `sync` to Codex, then `next issue` after each task".

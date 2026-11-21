# ECHØ judging runbook (one page)

Run the checklist 10 minutes before judges arrive, and again between teams. The demo runs on Ian's MacBook Pro
(frozen calib-three model).

## Checklist (demo laptop)
- [ ] **Chrome**, not Dia or any other browser.
- [ ] Volume at **70%**, no headphones or Bluetooth speaker.
- [ ] `git pull` in codejam16, then **hard reload** ECHØ (Cmd+Shift+R).
- [ ] `chrome://extensions` → **reload ECHØ** (the Lock extension).
- [ ] Open the app, **recalibrate with hands completely still**.
- [ ] **Lock password uses only PUSH and PULL** (the two most reliable signs). Set and locked before judges walk in.
- [ ] **Caregiver dashboard open on Michael's phone**, showing live.
- [ ] Habit on, **Demo: on** so the chart is full.
- [ ] **Every other laptop in the room closes ECHØ** (same 20 kHz tone, they interfere).
- [ ] Close every other tab or app that plays sound (music, video calls, notifications).
- [ ] Webcam taped over.

## Demo order (about 4 minutes, then Q&A; 7 minutes total)
| Time | Segment | Speaker | Live action | If it fails, say / do |
|---|---|---|---|---|
| 0:00-0:30 | Hook: cameras hit three walls | Ian | none | — |
| 0:30-1:10 | How it works (explainer + waterfall) | Ian | wave over the keyboard, flower reacts | No reaction: "Let me recalibrate", hands still 3 s, wave again slower. |
| 1:10-1:50 | Health: Care | Michael | wave ~2 s for help, open/close for pain | Gesture misses: repeat slower and closer. Dashboard silent: show Care's own on-screen confirmation, "the phone is a second view of this". |
| 1:50-2:50 | Touch Grass + Undo Button: Lock | Ian | open the blocked site, 4 signs (PUSH/PULL), double tap to undo a wrong one | Sign misses: repeat slower. Still locked after 2 tries: Lock tab → **Unlock now**, "this is the parent's override". |
| 2:50-3:15 | Touch Grass: Habit | EJ | scratch forearm ~5 s near the laptop | No nudge: scratch again closer for 5 s; point at the Demo chart. |
| 3:15-4:00 | Agent Solution + honest numbers + close | Yahya | scroll Home: Results and How we built it | — |

Speakers are a proposal; swap them freely, but each person rehearses their line once.

## Q&A one-liners
- **Does it record me?** No. Audio is analysed on the laptop and thrown away; only events like "help" leave it.
- **Will it work on my laptop?** Any laptop with a speaker and mic; weaker speakers need a short calibration.
- **Why not a camera?** Not allowed in many patient rooms and bathrooms, and it fails in the dark.
- **How accurate?** About 45% for someone it has never seen, 96% in 100 live trials on this laptop after calibration.
- **What did the AI do?** The agents wrote and tested most of the code; we chose what to build, recorded the data and tested it live.

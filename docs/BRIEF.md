# BRIEF: Echo, a sonar gesture engine with three apps

Approved by Ian, Fri 20 Nov 20:35. This is the why behind `docs/SPEC.md`. Read it once.

## Pitch
**Your laptop can see your hands without a camera.** Its speaker plays an inaudible 20 kHz tone and its microphone hears the echo off your hand; the Doppler shift tells us how you move. It needs no camera and no new hardware, captures no images, and works in the dark. One sonar gesture engine powers three apps:
- **Lock:** a gesture password for your kid's browser;
- **Care:** a camera-free call button and activity monitor for patients and the elderly;
- **Habit:** catches scratching or nail-biting and nudges you to stop.

Working name **"Echo"**; the team renames it in the BRIEF review.

## Tracks (every project is judged in every category)
- **Health (primary story):** Care. Privacy-preserving and camera-free, works in a dark room, cheap (no extra hardware).
- **Touch Grass + People First:** Lock gets kids off the screen and outside.
- **Undo:**
  - an undo gesture in every app;
  - Lock "undoes the mistake" of handing the kid the iPad;
  - Habit undoes a bad habit.
- **Agent:** pitch-only (our 4-agent build system). No product agent.
- **Not targeted:** Sustainability, Fintech, Beginner. Popular Vote is a fallback, so the pitch quality matters.

## Gesture vocabulary v1 (engine output)
- **Basic motions:** PUSH, PULL, WAVE (fast back-and-forth ≥1 s), HOLD (still).
- **OPEN-CLOSE ×N:** hand pulses, counted.
- **UNDO:** a flick away (one very fast, short flick of the fingers away from the screen; changed in SPEC v3).
- **SWIPE L/R:** Moonshot, needs two-tone.
- **Each event:** `{type, confidence, t, speed}` plus the raw spectrogram frame for the classifier.

## Demo (judging: a quiet room, our team plus 2–4 judges)
1. **Engine (~30 s):** the live sonar waterfall. A judge moves a hand, the screen reacts, and we cover the webcam with tape to prove it's camera-free.
2. **Lock (~60 s):**
   - the extension blocks YouTube in "kid mode";
   - a judge tries to unlock it and fails 3 times, which triggers an alarm sound and a parent alert on the dashboard;
   - we unlock it with the secret 4-gesture rhythm.
3. **Care (~60 s):**
   - the "patient" waves for help and the caregiver dashboard on a phone lights up within 1 s;
   - an inactivity alert and a restlessness timeline.
4. **Habit (~30 s):** fake scratching; a nudge chime fires and the event is logged. The undo gesture snoozes it.
5. **Honesty slide (~30 s):** measured range, accuracy, where it beats a camera and where it doesn't, compression limits and information capacity. ASL preview if the Moonshot lands.

## Ambition ladder
- **Floor, by Sat 12:00:**
  - engine detects PUSH/PULL/WAVE/OPEN-CLOSE/HOLD/UNDO;
  - live waterfall;
  - Lock extension with gesture unlock;
  - Care dashboard showing the realtime "help" alert.
- **Target, by Sat 22:00:**
  - per-user calibration;
  - spectrogram classifier (GPU-trained, ONNX in the browser);
  - Habit mode;
  - undo everywhere;
  - inactivity and restlessness;
  - measured accuracy and range numbers;
  - visual style pass.
- **Moonshot:**
  - 3–5 ASL signs (HELP, YES, NO, MORE, THANK YOU) with honest accuracy;
  - two-tone left/right;
  - breathing sensing.
- **Fallback:** demo in the quiet judging room. Plus: tonight we record real sessions, which become training/test data and evidence for the honesty slide.

## Architecture and lanes (no overlapping folders)
| Folder | Owner | What |
|---|---|---|
| `engine/` | Yahya | TS library: audio I/O (20 kHz tone, mic with echoCancellation/noiseSuppression/AGC off, AudioWorklet), DSP, rule detectors, ONNX classifier runtime, event API |
| `ml/` | Yahya | Python: data loader for recorded sessions, GPU training (PyTorch + CUDA), ONNX export, accuracy report |
| `app/` | Ian | Vite + React + TS web app: waterfall page, calibration, Lock pairing, Care sender, Habit mode, wiring engine to backend |
| `extension/` | Ian | Chrome MV3 extension: blocks sites in kid mode, unlocks on a message from the app tab (plan B if mic in the extension is messy) |
| `backend/`, `dashboard/` | Michael | Supabase schema, policies, realtime; caregiver/parent dashboard web app (phone-friendly) |
| `ui/` | EJ | Shared presentational components, styles, icons, dither art (style decided Saturday) |
| `pitch/` | EJ | Devpost draft, slides, demo video script, screenshots |
| `qa/`, `docs/qa/` | Yahya's QA agent | Tests, Playwright, reports |
| `contracts/`, `docs/`, root | Ian (lead) | Interfaces, spec |

Contracts written at kickoff:
- engine event API;
- the `events` table (`device_id, app, kind, gesture, payload, created_at`);
- the extension message protocol;
- the recorded-session file format (WAV + JSON labels).

Constraints:
- Supabase keys only in `.env` (human task: Michael creates the project).
- **No code from `~/Downloads/codejam16-sonar` is copied in.** It predates the hackathon, so its knowledge is reused but the code is rewritten.

## Tonight (first actions after kickoff)
1. **Room test, first hour (EJ + everyone, human task):** run the engine's tone and push/pull check on all 4 laptops in the hall. Pick the demo laptop; record range and noise.
2. **Data recording session (all 4, before midnight):** each person does every gesture 20× and, if possible, the ASL signs 10×.
3. **M1 skeleton by 23:30:** every folder runs, the app shows a live waterfall, and the dashboard receives a test event.

## Milestones (Montreal)
| Milestone | When | Done when |
|---|---|---|
| M1 skeleton | Fri 23:30 | waterfall live; test event reaches dashboard; extension loads |
| QA M1 | Fri 23:45 | QA pass before sleep |
| Sleep | 00:00–08:00 | everyone; agents idle |
| M2 Floor | Sat 12:00 | all Floor items demo end to end |
| QA M2 | Sat 12:30 | full pass |
| Target | Sat 22:00 | Target items |
| Freeze | Sun 09:00 | only demo-path fixes |
| Submit | ⚠️ confirm the deadline on the Discord | Devpost, video, repo public |
| Judging | Sun 13:00–15:30 | |
| Closing | Sun 16:30 | someone present to collect prizes |

## Non-goals
- mobile/iPad app;
- real OS lock;
- accounts/login;
- full ASL.

## Risks
| Risk | Mitigation |
|---|---|
| Ultrasound differs on teammates' laptops | Room test tonight picks the demo machine |
| Extension mic permissions | Plan B: the app tab senses and messages the extension |
| Classifier accuracy | Rule detectors guarantee the Floor; ML is Target |
| Wind-up false reads | Calibration and a debounce |
| EJ (Pro) and Michael (Codex basic) usage limits | Small specced issues; Yahya rescues |


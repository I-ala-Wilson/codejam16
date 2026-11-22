# ECHØ: 6-slide outline

Look: pure black, VT323, off-white ink, dotted rules, the dithered flower on slide 1 only.
Four challenges, said out loud in the organisers' words: Health, Undo Button, Touch Grass, Agent Solution.
Pitch is 3-5 minutes, then Q&A (7 minutes total, judges come to our room). Spoken script: pitch/demo-script.md.

---

## 1. Your laptop can hear your hands.
- ECHØ turns any laptop into sonar.
- Visual: the dithered sound flower (Home page), title in VT323.
- Say: "No camera, no extra hardware. Just the speaker and mic you already have."

## 2. Cameras hit three walls
- **They aren't allowed** in patient rooms or bathrooms.
- **They fail in the dark.**
- **They record you:** your face, your room, everything.
- Say: "Sound fixes all three."

## 3. How the sonar works
- The speaker plays a 20 kHz tone that's too high to hear.
- A moving hand bounces it back slightly shifted (the Doppler effect): toward = higher, away = lower.
- A small model, a 32k-parameter CNN reading a 1 s window of 48 x 87 Doppler bins (PyTorch, AdamW, 30 epochs), turns that into five gestures (push, pull, wave, open/close, undo), plus a Habit mode that notices scratching.
- No camera, no image, works in the dark. Privacy is built in: audio never leaves the laptop, only events like "help".
- Visual: the 3D explainer and the live dithered waterfall.

## 4. Four challenges, one sonar
- **Health:** Care. Hands-free help and pain calls for people who cannot reach a button, with no camera in bathrooms or hospital rooms.
- **Undo Button:** a double tap in the air deletes the last sign anywhere in ECHØ, and Lock lets a parent undo a kid's bad screen habit.
- **Touch Grass:** Habit nudges you off a screen habit, and Lock makes blocked sites look unreachable, so the kid goes outside.
- **Agent Solution:** efficient compute. A 128 KB, 32k-parameter CNN (1 s window of 48 x 87 Doppler bins, PyTorch, AdamW, 30 epochs) that runs in ONNX Runtime Web on the laptop's CPU: no server, no GPU to use it, $0 cloud cost, about 3 minutes of training per calibration. The explainer shows how it works.

## 5. Live demo: the secret lock
1. Open a blocked site. It looks like a normal "This site can't be reached" page.
2. Do the 4 hand signs in the air. Only tiny dots show the progress, so nobody watching learns the code.
3. Double tap to undo a wrong sign.
4. On the fourth sign the page opens.
- Backup: the recorded video if the room is too loud.

## 6. How we built it, honest numbers, the team
- 4 humans and 5 AI agents (three Claude Code, one QA, one Codex) on one GitHub issue board; git hooks enforced folder ownership, and every agent acknowledged each spec version.
- **Numbers:** about 45% of gestures for a person the model never saw (5 people, 3 laptop models); 96% in 100 live trials on our calibrated demo MacBook Pro (one presenter); Habit caught 14 of 15 scratches in a live test.
- Team: Ian (lead, app, Chrome extension, integration), Yahya (sonar engine and ML model), EJ (UI, Habit, pitch, dataset), Michael (Supabase backend and caregiver dashboard).
- Close: "Your laptop can hear your hands."

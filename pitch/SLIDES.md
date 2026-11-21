# ECHØ: 6-slide outline

Look: pure black, VT323, off-white ink, dotted rules, the dithered flower on slide 1 only.
Categories said out loud: Health (Care), Touch Grass + Undo (Lock), Undo (Habit), People First (privacy), Agent (how we built it).

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
- The mic hears that shift, and a small model turns it into gestures: push, pull, wave, hold, open/close, undo.
- No camera, no image, works in the dark, runs in the browser on the laptop you already have.
- Visual: the live dithered waterfall with a hand streak.

## 4. Three apps, one engine
- **Care (Health):** a hands-free help call where cameras aren't allowed, like hospital beds and bathrooms, and for people who sign in ASL.
- **Lock (Touch Grass + Undo):** undo handing your kid the iPad. Blocked sites look like "This site can't be reached", so to the kid the Wi-Fi is just broken and they go outside. Only your secret hand signs open it.
- **Habit (Undo):** undo a habit. It catches scratching and fidgeting and gives a soft nudge.
- **People First:** no camera, no audio kept, and only gesture events ever leave the laptop.

## 5. Live demo: the secret lock
1. Open a blocked site. It looks like a normal "This site can't be reached" page.
2. Do the 4 hand signs in the air. Only tiny dots show the progress, so nobody watching learns the code.
3. On the fourth sign the page opens.
- Backup: the recorded video if the room is too loud.

## 6. How we built it, honest limits, the team
- **Agent:** 4 humans and 5 AI agents (three Claude Code, one QA, one Codex) on one GitHub issue board. Git hooks enforced folder ownership, and every agent acknowledged each new spec version.
- **Limits:** a brand-new person gets about 1 in 2 gestures right today, better after 5 minutes of calibration. PUSH and PULL still get confused at times.
- Team: Ian (lead, app, Chrome extension, integration), Yahya (sonar engine and ML model), EJ (UI, Habit, pitch, dataset), Michael (Supabase backend and caregiver dashboard).
- Close: "Your laptop can hear your hands."

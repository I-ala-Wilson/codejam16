# ECHØ: Devpost draft
**Your laptop can hear your hands.**

Categories: Health, Undo Button, Touch Grass, Agent Solution.

## Inspiration
Cameras hit three walls. They aren't allowed in patient rooms or bathrooms, they fail in the dark, and they record you. Yet those are exactly the places where hands-free help matters most. Every laptop already has a speaker and a microphone, so we asked whether sound could do the job instead. It fixes all three: no image, works in the dark, allowed anywhere.

## What it does
ECHØ turns any laptop into sonar. The speaker plays a 20 kHz tone that's too high to hear. A hand moving toward the screen bounces the tone back slightly higher, and a hand moving away bounces it back lower (the Doppler effect). The mic picks up that shift, and a small model turns it into five gestures: push, pull, wave, open/close and undo. A separate Habit mode listens for repeated hand motion like scratching.

One engine powers three apps:
- **Care (Health):** a hands-free help call for hospital beds and bathrooms, where cameras aren't allowed, and for people who can't easily speak or reach a call button.
- **Lock (Touch Grass + Undo Button):** undo handing your kid the iPad. A blocked site looks like an ordinary "This site can't be reached" page, so to the kid the Wi-Fi is just broken and they go outside. Your 4 secret hand signs open it, and only tiny dots show the progress, so nobody watching learns the code.
- **Habit (Touch Grass):** nudges you off a screen habit. It notices scratching and fidgeting and gives a soft chime and a small note; a double tap snoozes it.
- **Undo Button:** a double tap in the air deletes the last sign anywhere in ECHØ.

**Privacy:** there's no camera and no audio is kept. Sensing happens on the laptop, and only gesture events ever leave it.

## How we built it
A TypeScript engine in the browser generates the tone, reads the mic and turns the echo into gesture events. A React app shows the live sonar (a 1-bit dithered waterfall) and runs the three apps. Five people recorded 147 gesture takes, and we trained a small CNN on a GPU that runs in the browser through ONNX.

**Agent Solution:** efficient compute. The model is 128 KB and runs on the laptop's CPU in the browser, with no server and no cloud cost, and a calibration retrain takes about 3 minutes on one GPU. Four humans worked with five AI agents (three Claude Code, one QA, one Codex). The lead owns a single versioned spec and the interface contracts, and every agent acknowledges each new version. Each agent owns only its folders, and git hooks block edits outside them. The agents coordinate on one pinned GitHub issue that works like a message board, with typed posts (NEED, DONE, BLOCKED) and exactly one reply per request. The QA agent hunts bugs at each milestone, and it caught a security bug in the lock. The humans chose the idea, recorded the data, tested and decided; the agents wrote the code.

## Challenges we ran into
Ultrasound behaves differently on every laptop, so we tested each of ours. Telling PUSH from PULL is still hard, and a brand-new person's gestures are harder to read than ours.

## Accomplishments that we're proud of
Hand sensing with no camera on an ordinary laptop, shared by three apps. A team of four humans and five agents kept one spec in sync from start to finish.

## What we learned
A speaker and a mic make a surprisingly capable sensor. Being honest about our numbers makes the project more convincing, not less: on people the model has never seen it gets about 45% of gestures right, and on our presenter's MacBook Pro it goes from 66% to 71% with about 5 minutes of his own recordings (77% with more). Habit is weaker: it caught 6 of 7 scratches in a live test but about 22% on unseen people.

## What's next for ECHØ
Fix the PUSH/PULL confusion by retraining on more data, raise accuracy for new users, and grow Care's hand-sign vocabulary.

# ECHØ: Devpost draft
**Your laptop can hear your hands.**

## Inspiration
Gesture control usually means a camera watching you or special hardware. Cameras feel invasive, they fail in the dark, and they don't belong in a bedroom or a hospital room. People who can't easily touch a device or speak, and anyone who wants privacy, get left out. Every laptop already has a speaker and a microphone, so we asked whether that's enough to hear a hand move.

## What it does
ECHØ turns any laptop into sonar. The speaker plays a 20 kHz tone that's too high to hear. A hand moving toward the screen bounces the tone back slightly higher, and a hand moving away bounces it back lower (the Doppler effect). The mic picks up that shift, and a small model turns it into gestures: push, pull, wave, hold, open/close and undo. There's no camera, it works in the dark, and it's free on any laptop, running in the browser.

One engine powers three apps:
- **Lock:** a secret hand-sign password for the sites you choose. A blocked site looks like an ordinary "This site can't be reached" page. Do your 4 hand signs and it opens. Only tiny dots show your progress, so nobody watching learns the code.
- **Care:** hands-free help calls for hospital beds and ASL users.
- **Habit breaker:** notices repetitive moves like scratching or nail biting and nudges you.

## How we built it
A TypeScript engine in the browser generates the tone, reads the mic and turns the echo into gesture events. A React app shows the live sonar (a 1-bit dithered waterfall) and runs the three apps. We recorded our own gesture dataset on all four laptops and trained the model on a GPU.

The team is four people, and each person works with an AI coding agent. The lead owns a single spec and the interface contracts. Each agent owns only its folders, and git hooks block edits outside them. The agents coordinate on a pinned GitHub issue that works like a message board, with typed posts (NEED, DONE, BLOCKED) and exactly one reply per request. The lead can send orders to an agent and tasks for its human. Status hooks publish what every agent is doing, and a separate QA agent hunts bugs at each milestone.

## Challenges we ran into
Ultrasound behaves differently on every laptop, so we ran a room test on all four. Telling PUSH from PULL is still hard, and a brand-new person's gestures are harder to read than ours.

## Accomplishments that we're proud of
Hand sensing with no camera on an ordinary laptop, shared by three different apps. A team of four humans and four agents kept one spec in sync from start to finish.

## What we learned
A speaker and a mic make a surprisingly capable sensor. Being honest about our numbers makes the project more convincing, not less: today a brand-new person gets about 1 in 2 gestures right, and that improves after 5 minutes of calibration.

## What's next for ECHØ
Fix the PUSH/PULL confusion by retraining on more data, raise accuracy for new users, and grow Care's hand-sign vocabulary.

# Devpost draft (EJ)
## Inspiration
Cameras are invasive, useless in the dark, and unwelcome in a bedroom or patient's room. We asked whether a laptop could see your hands with no camera and no new hardware. Kids' screen time, patients who cannot easily call for help, and bad habits like nail-biting all needed exactly that.

## What it does
Echo plays an inaudible 20 kHz tone from the laptop speaker and listens to the echo off your hand with the mic. The Doppler shift tells us how you move, so it recognizes push, pull, wave, hold, hand pulses and an undo double-pull. No images are ever captured, and it works in the dark. One engine powers three apps: Lock (a secret gesture password for a kid's browser), Care (a camera-free help call and activity monitor for caregivers) and Habit (a nudge when you scratch or bite your nails).

## How we built it
A TypeScript engine in the browser generates the tone, reads the mic with echo cancellation and noise suppression off, and turns the spectrogram into gesture events. A React app shows the live sonar waterfall and runs the three apps, a Chrome extension blocks sites in kid mode, and Supabase realtime sends alerts to a phone-friendly caregiver dashboard. A GPU-trained classifier exported to ONNX is planned on top of the rule-based detectors. Four people, each with an AI coding agent, built it in 40 hours.

## Challenges we ran into
Ultrasound behaves differently on every laptop, so we tested all four machines and picked the best one for the demo. False triggers need calibration and debouncing. Getting a microphone into a Chrome extension is messy, so the app tab does the sensing and messages the extension.

## Accomplishments that we're proud of
Camera-free hand sensing on an ordinary laptop, with one engine shared by three different apps. We also record real gesture sessions, so we can show measured accuracy and range, including where we are worse than a camera.

## What we learned
A speaker and a mic are a surprisingly capable sensor. Honest measurement, including limits and failure cases, makes the project more convincing, not less.

## What's next for Echo
Sign-language signs such as HELP, YES and NO, left/right swipes using two tones, and breathing detection. We also want the GPU-trained classifier running in the browser and a polished calibration flow.

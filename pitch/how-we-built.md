# How we built it

## 1. The signal
Your laptop's speaker plays a 20 kHz tone that's too high to hear. Your hand reflects it back to the microphone. A hand moving toward the screen raises the echo's pitch slightly, and a hand moving away lowers it. That's the Doppler effect. ECHØ reads that shift and nothing else. There's no camera and no image, and it works in the dark.

## 2. The model
Five people recorded 147 gesture takes on their own laptops. We trained a small CNN on a GPU, and it runs in the browser through ONNX. Every score is measured on a person the model never trained on, and a brand-new person gets about 1 in 2 gestures right. Five minutes of your own recordings lifts accuracy by about 9 points. Simple rule-based detectors are the fallback.

## 3. The agents
Four humans worked with five AI agents (three Claude Code, one QA, one Codex) on one GitHub issue board. Git hooks blocked edits outside each agent's folders. Every agent acknowledged each new spec version. The model trained on a GPU overnight, and the QA agent caught a security bug in the lock. The humans chose the idea, recorded the data, tested and decided. The agents wrote the code.

## 4. Considerations
- **Privacy:** sensing happens on your device. Only gesture events ever leave it, never audio.
- **Cost:** $0 extra hardware, just the speaker and mic you already have.
- **Accessibility:** control without touching the device or speaking, for hospital beds and for people who can't easily speak or reach a call button.
- **Honesty:** we publish our real accuracy, and PUSH and PULL still get confused.
- **Not a medical device:** ECHØ is a demo, not a diagnostic tool.

## FAQ
**Does it record me?** No: it listens only to the echo of its own 20 kHz tone, on your device, and keeps no audio.

**Will it work on my laptop?** Probably: it needs a speaker and mic that reach 20 kHz, and our room test shows the signal strength in a few seconds.

**Why not a camera?** A camera captures your face and room and fails in the dark, while sonar sees only motion.

**How accurate is it?** About 1 in 2 gestures for someone the model has never seen, and better after 5 minutes of calibration.

**What did the AI do, and what did you do?** The agents wrote the code; we chose the idea, recorded every take, tested it and made each decision.

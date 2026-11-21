# CONTRACT: recorded sonar sessions (training + evidence)

Produced by `engine.startRecording/stopRecording` (app has a Record page). Consumed by ml/ and qa/.

- File pair: `<person>_<gesture>_<laptop>_<YYYYMMDD-HHMMSS>.wav` + same name `.json`.
- WAV: mono **16-bit PCM** at the mic sample rate (48000 expected), raw mic input including the tone. (The engine records float32; the app converts to 16-bit before saving to halve the size.)
- JSON:
```json
{
  "person": "ian", "gesture": "PUSH", "laptop": "mbp-ian", "note": "",
  "sampleRate": 48000, "toneHz": 20000, "toneDbfs": -36,
  "reps": [ {"start": 12000, "end": 30500, "label": "PUSH"} ],
  "createdAt": "2026-11-20T23:10:00-05:00"
}
```
- `reps` are sample indices; the Record page prompts "go" every 2 s and marks each rep.
- Sessions are committed to GitHub under `data/recordings/<github-login>/` (each person owns their own folder). About 5 MB per 50 s take.
- **Pilot data** (ad-hoc takes made before the dataset protocol) goes in `data/pilot/<github-login>/`. It is for debugging only and is **never used to train or evaluate the final model**. Training reads `data/recordings/` only, collected per `ml/PROTOCOL.md`.

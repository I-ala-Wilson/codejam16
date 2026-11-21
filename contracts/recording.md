# CONTRACT: recorded sonar sessions (training + evidence)

Produced by `engine.startRecording/stopRecording` (app has a Record page). Consumed by ml/ and qa/.

- File pair: `<person>_<gesture>_<laptop>_<YYYYMMDD-HHMMSS>.wav` + same name `.json`.
- WAV: mono float32 at the mic sample rate (48000 expected), raw mic input including the tone.
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
- Sessions live in `ml/data/` locally and are NOT committed (gitignored, can be large); share via a team Google Drive folder.

---
description: QA agent only. Sync, confirm, then wait for [QA] gate triggers
---
1. `scripts/sync`, read `docs/BRIEF.md`, `docs/SPEC.md`, `docs/TIMELINE.md`, `docs/notes/<login>-qa.md` if it exists, and the latest `docs/qa/` report.
2. If the spec version is above 0: `scripts/board post --type ACK --to I-ala-Wilson "QA agent ready on SPEC v<N>."`
3. Arm `scripts/board wait` in the background (timeout 7200000). It wakes only on `[QA]` posts. When one arrives, run `/qa <gate>` with the gate it names, then come back to standby.

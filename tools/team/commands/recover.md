---
description: Fresh agent with no memory (wiped, new session, out of context). Rebuild context from the repo and resume exactly where the last one stopped
---
You are replacing an agent that lost its memory. Rebuild everything from the repo before touching code.

1. `scripts/sync`, which prints who you are, your role, what you own, the spec version and unread mentions.
2. Read in this order:
   - `docs/TIMELINE.md` (what happened and why);
   - `docs/BRIEF.md`, `docs/SPEC.md` and the `contracts/` your lane uses;
   - your journal `docs/notes/<login>.md` (QA agent: `docs/notes/<login>-qa.md`). This is the most important file: your predecessor's current issue, exact next step and gotchas.
3. Your raw history: `scripts/timeline --login <your login or login/qa> --since 12h`.
4. Your work: `gh issue list --assignee @me --state all`, `git log --oneline -15 -- <your owned paths>`, and `git status` (uncommitted work your predecessor left: finish it or ask, never discard it).
5. Unfinished business: any NEED/DIRECT/HUMAN addressed to you without a reply in the timeline, and any open `bug` issues assigned to you (P0 first).
6. Post `scripts/board post --type INFO --to I-ala-Wilson "Recovered after a context loss. Resuming #<N> at <exact step>. Open items: <list>."`
7. Tell your human in 3 lines where you are resuming, then continue. Arm the board wait whenever you go idle (Claude).

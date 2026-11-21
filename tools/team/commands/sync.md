---
description: Pull, read the spec and your issues, ACK, then work or wait
---
Get fully in sync with the team before doing anything else.

1. Run `scripts/sync` and read its output (your role, owned globs, spec version, unread board mentions).
2. If you have no memory of earlier work in this hackathon, stop and run `/recover` instead (Codex: open tools/team/commands/recover.md). Otherwise read `docs/BRIEF.md` if you have not yet since kickoff, then `docs/SPEC.md` completely and `docs/TEAM_RULES.md` if it changed. Read the files in `contracts/` that your lane touches.
3. `gh issue list --assignee @me --state open` and read each issue body.
4. If SPEC_VERSION is above 0 and you have not ACKed this version (`scripts/board acks` shows it), post:
   `scripts/board post --type ACK --to I-ala-Wilson "SPEC v<N> read. I own <globs>. Starting #<issue>."`
5. Handle any NEED posts addressed to you first, then start your lowest-numbered open issue.
6. If SPEC is v0 or you have nothing to do: Claude, arm `scripts/board wait` in the background (timeout 7200000); Codex, tell your human you are idle.

Report to your human in 3 lines max: spec version, what you own, what you are doing now.

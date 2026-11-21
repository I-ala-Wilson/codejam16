---
description: Finish the current task properly and hand work to whoever needs it
---
Close out the current task by the definition of done in `docs/TEAM_RULES.md` section 6:

1. Run it yourself (happy path + one edge case; look at it if it's UI). Fix anything broken first.
2. Confirm it matches `contracts/` exactly.
3. Update your journal `docs/notes/<login>.md` (Now / Done / How to run / Gotchas / Waiting on). Then `git pull --rebase`, `git add <only your files + your journal>`, commit `<area>: <what> (#issue)`, `git push`.
4. `gh issue close <N> -c "<one line: what shipped, how to run it>"`.
5. Find who depends on this (SPEC section 8 "Depends on", and any NEED posts) and post:
   `scripts/board post --type DONE --to <login> [--to <login>] "<what is ready, file/endpoint/function, how to use it>"`
6. Next open issue, or arm the board wait if none (Claude: `scripts/board wait` in background; Codex: tell your human).

$ARGUMENTS

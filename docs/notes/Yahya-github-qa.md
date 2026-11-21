# QA journal (Yahya-github/qa)

**Now:** DIRECT 7064730040 (secret Lock end to end) done at 9f225de, reported in `docs/qa/QA-DIRECT-1121-1150.md`. **P0 #27 open** (veil.js throws, nothing veiled; verified one-line fix in the issue). Next: when Ian posts DONE with `regress #27`, rerun `cd qa && npx playwright test -c contract/extension.config.ts` (expect 20 pass, 3 P2 fails), close #27 with evidence. Then Care, Habit, Home deeper passes when Ian/EJ/Michael post DONE (gesture-driven parts need a human).

**Done:** M1 (report `QA-M1-1121-0131.md`). DIRECT pass: contract tests rewritten for the v0.2 veil, app tabs list updated (12 tabs), old P1s #21 #22 #24 #25 #26 regressed and closed with evidence (all fixed on main). #23 closed earlier as superseded.

**How to run my lane:**
- App e2e: fresh clone (`git clone /home/atlas/codejam-qa <scratch>/fresh`, `cd fresh/app && npm ci`), then `cd qa && APP_DIR=<scratch>/fresh/app QA_GATE=<gate> npx playwright test` (own vite on port 5180; `QA_PORT`, `BASE_URL` override). My working copy's `app/node_modules` goes stale (missing `three` caused 31 false failures); always test a fresh clone.
- Extension contract: `cd qa && npx playwright test -c contract/extension.config.ts` (loads `../extension` unpacked in Chromium; `EXT_DIR=<dir>` tests a patched copy). Branded Chrome 137+ ignores `--load-extension`, so only Chromium works.
- Screenshots go to `docs/qa/shots/<QA_GATE>/`. Scratch probes live in the session scratchpad, not the repo.

**Gotchas and decisions:**
- **The board wait only wakes on `[QA]` posts.** A DIRECT addressed to `Yahya-github/qa` slipped past it for 1.5 h. After each task, also run `scripts/board read` and check for DIRECTs to `Yahya-github/qa`. `scripts/board wait` tasks die with exit 143 now and then: re-arm after every turn.
- Port 5173 is usually another checkout's dev server. Never test against it.
- `scripts/sync` and `git pull` are slow (1.2 GB .git); run in background.
- Hooks demand facts before creating files and before destructive commands (quote the instruction, list files, rollback).
- `qa/test-results/` is not gitignored and `.gitignore` is lead-owned; `git add` explicit paths only.
- Contract tests must follow the current `contracts/extension.md` (re-read each gate; it changed in 643eb6c and again for the veil).
- Subagent findings are not trusted until reproduced on the right code, with a real network (youtu.be test).
- Playwright's default navigation timeout is unlimited: always pass `timeout` to `goto` on third-party hosts; serve look-alike hosts with `ctx.route`.
- Hard cutoff: no commits or pushes at or after Sun 22 Nov 11:30 Montreal.

**Open bugs:** #27 (P0, veil). P2s in the DIRECT report (malformed LOCK corrupts state, hostile appUrl opens a pinned tab, router `#constructor`, no hashchange, home overflow 16 px at 390 px).

**Waiting on:** Ian: `regress #27`. Yahya (human): Ian's HUMAN task 7065627668, live test of the secret lock in real Chrome (5 unlocks, 10 loads of locked YouTube), which is the only way to test the hand-sign unlock.

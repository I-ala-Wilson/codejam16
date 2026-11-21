# QA journal (Yahya-github/qa)

**Now:** QA M1 gate (requested by I-ala-Wilson, comment 7058130514, due 08:00 Sat 21 Nov) is finished and reported in `docs/qa/QA-M1-1121-0131.md` (app + extension at 845150e, engine/dashboard/backend at 8048c98, SPEC v5). Next: re-arm `scripts/board wait`; when an owner posts DONE with `regress #N`, rerun that test plus the suites.

**Done (M1):** fresh-clone build of engine/app/dashboard (all pass); Playwright app e2e at head (24 tests, 5 fail); extension contract tests at head (17 tests, 9 fail); secret grep (clean); lane reviews (engine, app, extension/backend/dashboard). Open P1: #21 (app Dataset wedge, urgent), #22 (engine UNDO window), #24 (extension concurrent LOCK), #25 (Lock password change needs no current password), #26 (typed URL in sites blocks nothing). #23 closed as superseded (lead changed the contract to no-expiry in 643eb6c).

**How to run my lane:**
- App e2e: fresh clone with app deps installed, then `cd qa && APP_DIR=<clone>/app npx playwright test` (starts its own vite on port 5180; set `QA_PORT` to change; `BASE_URL=<url>` tests a deployed URL).
- Extension contract: `cd qa && npx playwright test -c contract/extension.config.ts` (loads `../extension` unpacked in Chromium; `EXT_DIR` overrides).
- Screenshots go to `docs/qa/shots/<QA_GATE>/`.

**Gotchas and decisions:**
- Port 5173 is usually another checkout's dev server (`/home/atlas/dev/competition/codejam-16/app`). Never test against it; my first run did and was discarded.
- `scripts/sync` and `git pull` are slow here (1.2 GB .git, committed WAVs); run them in the background.
- Hooks demand facts before creating files and before destructive commands (quote the instruction, list files, rollback).
- `qa/test-results/` is not gitignored and `.gitignore` is lead-owned; `git add` explicit paths only.
- Subagent findings are not trusted until reproduced, and reproduction must run on the right code. The app review agent said the Lock secret flow is missing (only extension buttons + a "Next (#12)" placeholder). I first called that wrong because the page I saw on port 5173 had a hand-sign password UI, but that was another checkout's dev server. On the fresh clone at 8048c98 the agent was right.
- Hard cutoff: no commits or pushes at or after Sun 22 Nov 11:30 Montreal.

**Open bugs:** #21, #22, #24, #25, #26 (all P1). Regress each when its owner posts DONE with `regress #N`.
- Contract tests must follow the current `contracts/extension.md` (re-read it each gate; it changed in 643eb6c).
- A subagent said `youtu.be` bypasses the lock; with real network it does not (301 redirect is caught). Probe with a real network, not mocked hosts.

**Waiting on:** owners of #21, #22, #24, #25, #26; Michael's Supabase keys and the dashboard (untestable until then).

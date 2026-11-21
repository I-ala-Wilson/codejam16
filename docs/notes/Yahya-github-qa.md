# QA journal (Yahya-github/qa)

**Now:** QA M1 gate (requested by I-ala-Wilson, comment 7058130514, due 08:00 Sat 21 Nov). Report `docs/qa/QA-M1-1121-0131.md` written at sha 8048c98 / SPEC v5. Still to do: append the extension/backend/dashboard review agent's verified findings if it reports, commit and push `qa/` + `docs/qa/`, post `--type QA` to I-ala-Wilson, then re-arm `scripts/board wait`.

**Done (M1):** fresh-clone build of engine/app/dashboard (all pass); Playwright app e2e (21 tests, 12 fail); extension contract tests (16 tests, 7 fail); secret grep (clean); lane reviews (engine, app). Filed #21 (app Dataset wedge, urgent), #22 (engine UNDO window), #23 (extension no re-lock), #24 (extension concurrent LOCK). NEEDs posted to owners.

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

**Open bugs:** #21, #22, #23, #24 (all P1). Regress each when its owner posts DONE with `regress #N`.

**Waiting on:** owners of #21-#24; Michael's Supabase keys (dashboard realtime untestable until then).

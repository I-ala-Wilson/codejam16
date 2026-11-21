# QA journal (Yahya-github/qa)

**Now:** lead QUEUE (comment 7066454821) items 1-4 done at 9678535, report `docs/qa/QA-QUEUE-1121-1300.md`. Item 5 = ask the lead (post DONE, then `scripts/board read`). Lead wants a one-line status every 30 min and `scripts/board wait` re-armed after every post. Next gates: M2 Sat 12:30 (check spec), nightly Sat 23:30, final QA 1 h before submit. Re-run my three new specs after each new push to main.

**Done:** M1 (`QA-M1-1121-0131.md`). DIRECT (`QA-DIRECT-1121-1150.md`): contract tests for the v0.2 veil, P0 #27 found, old P1s #21 #22 #24 #25 #26 regressed and closed. QUEUE: #27 regressed and closed (20 pass, 3 known P2 fails); Habit (`qa/e2e/habit.spec.ts`), Care (`care.spec.ts`), Home (`home.spec.ts`) automated; P2s #28 (EJ, demo re-seed) and #29 (Michael, Care activity while sonar off) filed; "AudioContext is closed" not reproduced.

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

**Open bugs:** none P0/P1. P2: #28 Habit demo re-seed, #29 Care activity while sonar off; extension malformed LOCK + hostile appUrl, router `#constructor`, no hashchange, home overflow 16 px at 390 px. P3: Care does not dedupe WAVE while HELP is up. Nit: How we built it says 147 recordings, data has 175.

**Gesture injection trick (habit/care specs):** `page.route('**/src/engine.ts*')` appends a wrapper that records every `engine.onGesture` callback; `window.__emit({type})` plays a gesture in. Care events are read from `BroadcastChannel('echo-events')`. A silent fake mic needs its own `chromium.launch` with `--use-file-for-fake-audio-capture=<wav>` (the default fake mic beeps and reads as constant movement). Memory is tight on this laptop (a training job uses ~9 GB): the system killed my background board waits once; do not start heavy parallel runs.

**Waiting on:** Ian: reply to the QUEUE DONE. Yahya (human): HUMAN task 7065627668, live test of the secret lock in real Chrome (5 unlocks, 10 loads of locked YouTube), the only way to test the hand-sign unlock.

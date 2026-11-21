---
description: QA agent only. Ultra in-depth bug hunt for a gate (M1, M2, nightly, freeze, final) or "regress #N"
argument-hint: <gate | regress #N>
---
You are the QA agent (`scripts/board status` must say QA). You find bugs; owners fix them. You never edit product code: only `qa/` and `docs/qa/`. Be exhaustive. A bug a judge finds is a bug you missed.

Gate: $ARGUMENTS

## 0. Prepare
- `git pull --rebase`. Read `docs/BRIEF.md`, `docs/SPEC.md` (demo script, contracts summary, run commands), `contracts/`, the last report in `docs/qa/`, and open `bug` issues.
- Tooling lives in `qa/` with its own package.json (Playwright, test runner). First time only: `cd qa && npm init -y && npm i -D @playwright/test && npx playwright install chromium`.

## 1. Fresh-clone check
Clone main into a temp dir. Follow SPEC section 6 run commands exactly as written. Every lane must start with no undocumented step. Check that `.env.example` lists every env var the code reads.

## 2. Contract conformance (`qa/contract/`)
For every route, type and event in `contracts/`, write a runnable test: the documented example, then the edge cases.
- **Inputs:** empty, huge, unicode/emoji, missing fields, wrong types, extra fields.
- **Requests:** auth missing or invalid, repeated or concurrent calls.
- **Assertions:** status codes, response shape exactly per contract, error format, latency.
Keep the tests; they rerun every gate.

## 3. Demo script end to end (`qa/e2e/`, Playwright)
Script every step of SPEC section 3, on local AND the deployed URL:
- screenshot every step to `docs/qa/shots/<gate>/`;
- desktop 1440x900 and mobile 390x844;
- slow 3G, offline mid-flow, refresh mid-flow, back button, double-click on every action button;
- capture console errors, failed requests, layout overflow (scrollWidth > clientWidth);
- time to first meaningful paint and to each result.
Run the whole script 3 times; flaky = bug.

## 4. Visual and UX pass
Look at every screenshot against the BRIEF look and feel. Flag:
- broken or overlapping layout;
- unreadable contrast, tiny text;
- missing loading, empty or error states;
- dead buttons on the demo path;
- placeholder text, lorem ipsum, "TODO", raw JSON on screen;
- inconsistent fonts and colours.

## 5. AI output checks (if the product has an AI part)
Run the demo inputs plus 20 varied ones: normal, edge, adversarial, prompt injection, other languages, nonsense. Check for:
- wrong, slow (>8 s), embarrassing or empty output;
- the injection being followed;
- whether plan B works when the API key is unset or the API errors.

## 6. Per-lane deep code review
Spawn one subagent per lane in parallel (Agent tool), each with that lane's diff since the last gate (`git diff <last-qa-sha>..HEAD -- <lane globs>`). Have them hunt for:
- correctness bugs;
- unhandled errors on the demo path, race conditions;
- hardcoded localhost or ports, secrets in code;
- contract drift, dead code.
Verify every finding yourself before reporting it.

## 7. Security basics
- Secret grep on the repo and the built client bundle; keys exposed client-side.
- Open CORS, unauthenticated write endpoints, user input rendered as HTML.

## 8. Report and route
- Write `docs/qa/QA-<gate>-<MMDD-HHMM>.md`:
  - a summary line (P0/P1/P2 counts, demo passes yes/no, last tested sha);
  - a table with columns Severity, Area/owner, Bug, Repro, Expected vs actual, Evidence (screenshot or test name).
  - Severity: **P0** = demo breaks or looks broken; **P1** = visible bug or wrong result; **P2** = polish.
- For each P0/P1:
  - `gh issue create --label bug --label P0|P1 --assignee <owner> --title "<lane>: <bug>"` with the repro, expected/actual and failing test;
  - `scripts/board post --type NEED --to <owner> "bug #N (P0): <one line>. Fix, then DONE tagging Yahya-github with 'regress #N'."`
- Commit `qa/` + `docs/qa/` and push.
- Post `scripts/board post --type QA --to I-ala-Wilson "QA <gate>: P0 x, P1 y, P2 z. Demo passes: yes/no. Report docs/qa/<file>"`.

## 9. Regression ("regress #N")
Rerun the tests for that bug, plus the full demo script once. Pass: close the issue with evidence. Fail: comment with new evidence, keep it open, NEED the owner again.

## Afterwards
Update `docs/notes/<login>-qa.md` (what was tested, at which sha, open bugs). Then arm the QA wait again: `scripts/board wait` in the background, timeout 7200000.

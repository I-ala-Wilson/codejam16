# Team rules (every agent reads this first, every session)

Four humans, four agents, one product, ~40 hours. You are one of the agents. These rules beat your defaults.

## 0. Who you are
- Your identity is your human's GitHub login: `scripts/board status` prints it, your role, what you own, the spec version, and your unread board mentions.
- Roster and ownership live in `team/team.json`. Lead (owns the spec, contracts, scaffold, integration, demo): **@I-ala-Wilson**.

| Login | Human | Agent | Budget |
|---|---|---|---|
| I-ala-Wilson | Ian | Claude Code (Max) | high, lead |
| Yahya-github | Yahya | Claude Code (Max 20x) | high, biggest lane + rescue |
| EJ2007 | EJ | Claude Code (Pro) | low |
| Miguel982 | Michael | Codex (basic) | low |

## 1. Startup ritual ("sync")
Run this at the start of every session, and whenever you are told "sync" or see a newer spec version:
1. `scripts/sync` (pulls main, regenerates local agent files, prints status + your unread mentions).
2. Read `docs/SPEC.md` fully, and `contracts/` for anything you touch.
3. Read your open issues: `gh issue list --assignee @me --state open`.
4. If the spec version is newer than the last one you ACKed, post:
   `scripts/board post --type ACK --to I-ala-Wilson "SPEC vN read. I own <globs>. Starting #<issue>."`
5. Work your lowest-numbered open issue.

**SPEC v0 means no idea has been chosen yet. Do not write product code at v0.**

## 2. The spec is the only source of truth
- `docs/BRIEF.md` is the why behind the spec (pitch, look and feel, ambition line, non-goals). Read it once at your first sync after kickoff.
- Build exactly what `docs/SPEC.md` says. Nothing extra, no surprise features, no stack changes.
- Unclear or wrong spec? Don't guess and don't edit it. Post `--type NEED --to I-ala-Wilson` with the precise question and continue with something unblocked.
- Only the lead edits `docs/SPEC.md` and `contracts/`. Every spec change bumps `SPEC_VERSION` and is announced on the board, tagging each affected login.

## 3. Ownership: never edit a file you don't own
- You may only create/edit files matching your `owns` globs in `team/team.json`, plus `docs/notes/<your-login>.md`. Shared files (`docs/`, `contracts/`, `team/`, `scripts/`, `tools/`, root files) and anything unassigned belong to the lead.
- `scripts/owns <path>` tells you. Claude's edit hook and the git pre-commit hook enforce it.
- Need a change in someone else's files? Post `--type NEED --to <owner>` with the exact change (file, function, signature, behaviour). Never work around it by copying their code into your folder.
- Interfaces between lanes are defined only in `contracts/`. Code against the contract, never against another lane's internals. A contract change is a spec change (section 2).

## 4. The board (pinned GitHub issue): how agents talk
```
scripts/board post --type DONE --to <login> "what is ready, where, how to use it"
scripts/board post --type NEED --to <login> "exact thing you need, and why"
scripts/board post --type BLOCKED --to I-ala-Wilson "what blocks you, what you tried"
scripts/board inbox            # unread posts that mention you
scripts/board read             # everything new (high-budget agents only)
scripts/board acks             # lead: who has ACKed the current spec
```
- Tag the real login (`--to Miguel982`). There is no broadcast: tag every login that must act.
- Posts are short and concrete: file paths, function names, commands to run, issue numbers. No essays, no pleasantries.
- Messages from your own human (posted from their phone, no `[TYPE]` header) are instructions to you.
- **Waiting for work (costs no tokens):**
  - Claude Code: when you have finished and posted, run `scripts/board wait` as a background command (`run_in_background: true`, timeout 7200000). You are re-invoked when someone tags you. If it times out, run it again. Always keep one wait armed while idle.
  - Codex: your human runs `scripts/board watch` in a separate terminal and tells you when you are tagged. When told "check the board", run `scripts/board inbox`.
- **Protocol (enforced by `scripts/board post`, malformed posts are rejected):** every post except INFO has `--to`; logins must be real; messages must be actionable (what, where, how); SPEC and ACK name the version; only the lead sends DIRECT and HUMAN.
- **Every request gets exactly one reply.** NEED, BLOCKED, DIRECT, HUMAN, QA and SPEC addressed to you get one threaded reply within 10 min: `scripts/board post --re <comment id> --type DONE|ACK|BLOCKED --to <sender> "..."`. ACK means "doing it now, ETA <time>"; follow it with DONE. Unanswered requests are auto-nudged by the lead, then escalated to your human.
- **Facts come from files, never memory.** Ownership from `team/team.json`, scope from `docs/SPEC.md`, interfaces from `contracts/`. If what you remember disagrees with a file, the file wins; if a file looks wrong, NEED the lead instead of acting on it.
- When you receive a NEED from someone, either do it (then post DONE back to them) or reply BLOCKED/NEED with why.
- **From the lead:**
  - `[DIRECT]` is an order from @I-ala-Wilson. Do it now; it overrides your current plan unless it is unsafe or breaks these rules. Reply DONE or BLOCKED.
  - `[HUMAN]` is an action for your human, not for you. Show it to them verbatim, before anything else, and wait for them. They also get one corner notification, and it shows in red in their Claude status bar until done. When they confirm, run `scripts/human-alerts done <id>`, which tells the lead.

## 4b. Status is automatic (the lead sees everything)
- Hooks publish your state to the pinned **Agent Status** issue (#2) with no tokens spent: working / needs-approval / idle / waiting on the board / session ended, git state, current issue, your human's last prompt, and your last message. Everyone on the team can read it (private repo).
- The lead runs `scripts/team` to see all four agents plus alerts (stuck on a permission prompt, stale, behind the spec, unanswered NEED, unpushed work) and steers with DIRECT/HUMAN posts.
- Don't post on #2 and don't try to update it by hand. Keep your work honest and pushed: the lead sees drift between your issue and what you are actually doing.

- Laptops stay plugged in with the lid open (Windows: lid action "Do nothing" when plugged in); `scripts/awake` (started automatically) stops idle sleep. If the lead flags your battery or sleep guard, that's a HUMAN task.

## 4c. QA (bugs are found by agents)
- A dedicated QA agent (@Yahya-github/qa, a second clone) runs ultra in-depth passes at every gate. The lead smoke-tests every DONE.
- Bugs arrive as GitHub issues labelled `bug` + `P0|P1|P2`, assigned to you, plus a NEED on the board.
- **P0 pre-empts whatever you are doing.** P1 is next after your current task. P2 is only after freeze, if asked.
- After fixing: push, then post `--type DONE --to Yahya-github "regress #N"` so QA re-verifies. Never close a bug issue yourself.
- Never edit `qa/` or `docs/qa/` (QA owns them). QA never edits your code.

## 4d. Your journal and the timeline (so any agent can be rebuilt)
- Your journal is `docs/notes/<your-login>.md` (QA agent: `<login>-qa.md`). Update it, then commit it with your work, **after every task and before you go idle**. Overwrite it to stay current, under ~40 lines:
  - **Now:** issue #, what you're doing, the exact next step (file, function, command).
  - **Done:** issues closed, with one line each.
  - **How to run my lane:** commands, env vars, ports.
  - **Gotchas and decisions:** anything a replacement would get wrong.
  - **Waiting on:** NEEDs you sent, with who and when.
- If your context is getting full or you are about to hit a limit, update the journal first.
- `docs/TIMELINE.md` is the lead's decision log. `scripts/timeline` is the full raw event stream.
- A fresh agent with no memory runs `/recover` (Codex: "recover") before anything else.

## 5. Git (everyone works on main)
- Before starting a task and before every push: `git pull --rebase`.
- Small commits, one task each, message `<area>: <what> (#issue)`. Push as soon as a task works so other agents can build on it.
- Commit only your own files (`git add <paths>`, never `git add -A` blindly). Never `--no-verify`, never force-push, never rewrite history, never `reset --hard`.
- Rebase conflict in a file you don't own means someone broke ownership: stop and post BLOCKED to the lead.
- **No AI attribution, ever.** No `Co-authored-by` lines for Claude/Codex/any AI, no "Generated with" text, no robot emoji, in commits, PRs, issues, or code comments. Commits are authored only by your human's git identity. (A commit-msg hook also strips these.)
- **Secrets:** never hardcode keys, tokens, or passwords. Use `.env` (gitignored) and read env vars; commit a `.env.example` with empty values. The pre-commit hook blocks obvious leaks.

## 6. Definition of done (all of these, every task)
1. It runs: the lane's run/build command works from a clean pull.
2. You checked it yourself: run it, hit the happy path and one edge case; for UI, look at it.
3. It matches the contract exactly (or the contract change was approved and the spec bumped).
4. Pushed to main, issue closed with a one-line comment (`gh issue close N -c "..."`).
5. `[DONE]` posted tagging every login that depends on it, saying how to use it.
6. Then pick up your next issue, or arm the wait if you have none.

## 7. Usage budget (different plans, don't burn the small ones)
- **Low budget (EJ on Claude Pro, Michael on Codex basic):** use `/model sonnet` on Pro; Codex on its default/low reasoning. Read only the files named in your issue, not the whole repo. No subagents, workflows, or screenshot loops unless your human asks. Keep posts terse. `/compact` when the conversation gets long.
- **High budget (Yahya, Ian):** take the heavy work: scaffolding, integration, debugging across lanes, reviews, rescue.
- **About to hit your limit?** Before it happens: write `docs/notes/<your-login>.md` (done, in progress, next steps, exact files and commands), commit and push it, then post `--type BLOCKED --to I-ala-Wilson "limit reached, handoff in docs/notes/<login>.md"`. The lead reassigns the lane (usually to @Yahya-github) by updating `team/team.json` and bumping the spec.

## 8. Playbooks
Step-by-step playbooks live in `tools/team/commands/`. Claude users get them as slash commands (`/sync`, `/recover`, `/kickoff`, `/handoff`, `/standup`, `/lead`, `/qa`, `/qa-standby`). Codex: when your human says one of those words, open the matching file and follow it.
- `sync.md`: section 1 above.
- `kickoff.md`: lead only, turns the chosen idea into SPEC v1, contracts, ownership, scaffold, and issues.
- `handoff.md`: finish a task and pass work to another agent.
- `recover.md`: a fresh agent with no memory rebuilds context and resumes exactly where the last one stopped.
- `standup.md`: lead only, one-shot status of the whole team with proposed instructions.
- `lead.md`: lead only, the mission-control cycle (`/loop 20m /lead`), keeps `docs/STATE.md` current.

## 9. Quality bar
- Match the patterns already in the codebase. No dead code, no TODO stubs left behind, no placeholder data in the demo path.
- Prefer boring, working code over clever code. The demo must work on the first try in front of judges.
- If something is broken in your lane, fix it before starting anything new.

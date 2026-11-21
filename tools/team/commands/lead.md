---
description: Lead only. Run mission control - watch every agent, act on alerts, keep STATE.md current
---
You are the lead's agent (@I-ala-Wilson). Refuse if `scripts/board status` says otherwise.

Your job is to know exactly where every human and agent is, and to keep all four moving toward the SPEC. You have full context from:
- `scripts/team`: every agent's live state (from automatic heartbeats), last prompt, last message, git, issues, ACKs, and ALERTS.
- `scripts/board read`: the full conversation between agents.
- `docs/STATE.md`: your own memory. Read it first, and update it every cycle so a fresh session or a compaction loses nothing.

## On every DONE (smoke check, 2 to 3 min)
Pull, run the lane that changed (SPEC section 6 command), hit the endpoint or page it touched with the contract example, and check the console and response shape. A bug found gets the same treatment as QA: `gh issue create --label bug --label P0|P1 --assignee <owner>` plus a NEED, and a P0 also gets a DIRECT.

## QA gates (the QA agent is Yahya's second clone, @Yahya-github/qa)
Trigger it with `scripts/board post --type QA --to Yahya-github "run /qa <gate>"` at: M1 done, M2 done, nightly (~2am), feature freeze, and 1 h before submission ("final": demo script on the deployed URL, 3 clean runs). If its row in `scripts/team` shows no heartbeat or ended, send Yahya a HUMAN task with the QA start command from the kickoff playbook. Turn every P0 in its report into a DIRECT to the owner.

## Each cycle
1. `git pull --rebase`, `scripts/check`, `scripts/team`, `scripts/board read`. Fix any check error in the shared files first (you own them).
2. Act on every ALERT, cheapest fix first:
   - `HUMAN ...` (not set up, permission prompt, session closed): `scripts/board post --type HUMAN --to <login> "<exact thing to do>"`. GitHub pings their phone. If it is urgent, also tell Ian to text them.
   - `SPEC`: `--type DIRECT --to <login> "run sync and ACK v<N>"`.
   - `WAIT` / `IDLE`: `--type DIRECT --to <login> "start #<next issue>"` or "arm scripts/board wait".
   - `STALE`: HUMAN post asking if they are alive; if their agent was wiped or restarted, tell them to type `/recover` (Codex: "recover"). If still stale after 2 cycles, propose reassigning to Ian.
   - `UNANSWERED`: escalate in order, without involving humans until step 3: (1) DIRECT the recipient "reply to <comment id>", (2) after another 10 min, DIRECT again and check its status row (stuck on approval or session ended means skip to 3), (3) HUMAN task to that person, (4) only then tell Ian. Answer spec questions yourself immediately. An UNANSWERED HUMAN task older than 20 min: tell Ian to text that person.
   - `GIT`: DIRECT them to commit and push what works.
3. Check for drift: compare each agent's last prompt and last message with its assigned issue and the SPEC. If someone is building something not in the SPEC, send DIRECT to stop and return to the issue.
4. Check milestone pace (SPEC section 9 vs open issues vs Montreal time). If behind, propose cuts or moves to Ian. Low-budget lanes (EJ2007, Miguel982) overflow to Yahya-github.
5. Append every decision, spec bump, reassignment, cut and QA result to `docs/TIMELINE.md` (one table row each). Update `docs/STATE.md` (now, people table, decisions, risks, next actions). Commit it when it changes meaningfully.
6. Miguel982 (Codex) never wakes on his own: whenever you post anything to him (SPEC, DIRECT, a NEED from another agent), or he shows idle with open issues, tell Ian to text Michael exactly what to say to Codex.
7. Tell Ian only what needs him, in 5 lines max. Never change the spec or reassign a lane without his OK.

## Staying on
- Arm `scripts/board wait` in the background (timeout 7200000) so a tag to Ian wakes you.
- Ian can run `/loop 20m /lead` to repeat this cycle automatically.

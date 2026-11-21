# Timeline (what happened and why, Montreal time)

Append-only, newest at the bottom. The lead's agent adds a line for every milestone, decision, spec version, reassignment, cut, and QA gate. For the raw event stream (every board post, commit and issue), run `scripts/timeline` (add `--login <you>` for just yours).

**If you are a fresh agent with no memory:** run `/recover` (Codex: say "recover"). It reads this file, the brief, the spec, your journal in `docs/notes/<login>.md`, your issues and your recent events, then tells you exactly where to resume.

| When | What | Why / details |
|---|---|---|
| Fri 20 Nov 09:45 | Repo set up: rules, spec template, ownership guard, Agent Board (#1) | Coordinate 4 agents without humans relaying |
| Fri 20 Nov 13:45 | Mission control: Agent Status (#2), `scripts/team`, DIRECT/HUMAN posts | Lead sees every agent's live state |
| Fri 20 Nov 14:00 | [HUMAN] tasks: one corner notification + Claude status bar | Humans must see their tasks; popups were too annoying |
| Fri 20 Nov 14:08 | Kickoff starts with a multi-round grill, then an approved `docs/BRIEF.md` | Pin down exactly what we build before any spec |
| Fri 20 Nov 14:13 | Sleep guard (`scripts/awake`), laptop power in status | Laptops must not sleep mid-task |
| Fri 20 Nov 14:25 | QA agent (Yahya's second clone) + lead smoke checks; recovery timeline + journals | Agents hunt bugs ultra in depth; any agent can be rebuilt from the repo |
| Fri 20 Nov 14:45 | Board protocol enforced (validated posts, threaded replies with --re, auto-nudge then escalate), `scripts/check` blocks inconsistent shared files | A stray test ownership (backend/* for Yahya) reached main; never again, and humans only get pulled in after two agent nudges |
| Fri 20 Nov 19:01 | Recreated the repo as I-ala-Wilson/codejam16 (private), tooling copied, fresh history | Hackathon rule: the project repo must be created after hacking starts (7pm); Yahya-github/codejam predates it |
| Fri 20 Nov 20:45 | KICKOFF: idea Echo (sonar gesture engine, 3 apps: Lock, Care, Habit). BRIEF approved, SPEC v1, contracts, lanes, scaffold, issues #3-#18 | After a 5-round grill; Health primary, Touch Grass/People First/Undo secondary, Agent pitch-only |
| Fri 20 Nov 20:43 | PAUSE: team moving to dorms (~15 min); agents push WIP + journals, resume with /recover | Location change |
| Fri 20 Nov 21:45 | Board stops using real @mentions (recipients in hidden to= field) | GitHub was emailing everyone on every post |

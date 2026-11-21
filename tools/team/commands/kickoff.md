---
description: Lead only. Turn the chosen idea into SPEC v1, contracts, ownership, scaffold, issues, and get every agent to ACK
argument-hint: <idea + pasted challenge / sponsor track text>
---
You are the lead's agent (@I-ala-Wilson). Refuse if `scripts/board status` says you are someone else.

Input from Ian: $ARGUMENTS

## 1. Grill the team (no spec until this is done)
All four teammates sit together and answer as a group. Your job is to find out exactly what they want, how it works, what the finished product looks and feels like, and how far to reach. Be relentless: an hour of questions now saves a day of rebuilding.

**Before the grill**
- If anything is missing from the input (challenge text, sponsor tracks, prizes, judging criteria, required APIs or hardware, submission rules: deadline, Devpost fields, video, judging format), ask for it first in one message.
- Then play it back in 5 lines: what you think they want to build, for whom, aiming at which tracks. Wrong assumptions surface here.

**Rounds.** One round per message, 6 to 10 numbered questions. Each question is answerable in one line and carries your suggested default in brackets, so they can reply "3: yes, 5: B". Build each round on the previous answers. Push back on vague, contradictory or over-ambitious answers. When they are stuck, offer 2 or 3 concrete options with your recommendation.
1. **Problem and user:** who exactly, what pain, what they do today instead, why now, the one-sentence pitch a judge repeats afterwards.
2. **Winning:** which tracks and prizes, what each judge scores, what past winners of those tracks looked like, which track is the primary bet and which are bonus.
3. **The finished product:** the demo minute by minute, the first screen, the "wow" moment, look and feel (dark or light, reference apps or sites, vibe), web, mobile or hardware, and what judges physically touch.
4. **How it works:** data in and out, the AI/ML part if any, external APIs, what is real vs mocked, and what must be live in the demo vs can be faked safely.
5. **Ambition ladder:** for every feature, Floor (demo breaks without it), Target (likely), Moonshot (if everything goes right). Agree where the line is given ~40 h, 4 people, and the budgets (Yahya and Ian high, EJ and Michael low). Challenge them both ways: too timid loses, too big ships nothing.
6. **Team and stack:** what each person is good at and wants to own, stack preferences, anything someone refuses to touch, sleep plan, hard time constraints.
7. **Risks and cuts:** the riskiest assumption, plan B if a key API or model fails, and what we are explicitly NOT building.

Keep adding rounds until there is nothing left you would have to guess. There is no cap on rounds.

**Brief.** Write `docs/BRIEF.md` with every decision in short form:
- pitch;
- primary and bonus tracks with judging criteria;
- demo script;
- look and feel;
- how it works;
- the ambition ladder with the agreed line;
- who wants what;
- risks and plan B;
- non-goals.

Show it, revise it with them, and do not continue until Ian says "approved". Commit only the brief, not the grill transcript.

## 2. Write `docs/SPEC.md` v1
Derive it from `docs/BRIEF.md` (link the brief in section 1). Fill every section of the template, set `SPEC_VERSION: 1`. Rules:
- Scope for ~40 hours of 4 people, with a demo that works on the first try. Be ruthless in "Cut".
- Demo script first, then derive features from it. Anything not in the demo is a Should at best.
- Choose a boring, well-known stack the agents are fluent in. Name env vars, never values.

## 3. Lanes, sized by budget
Split into exactly 4 lanes, one top-level folder each (plus the lead's integration folder). Assign by `team/team.json` budget:
- **@Yahya-github (Max 20x, high):** the biggest, hardest lane (core backend / engine / ML). Also the rescue lane.
- **@I-ala-Wilson (Max, high, lead):** contracts, scaffold, integration glue, deploy, demo path, plus a medium lane.
- **@EJ2007 (Pro, low):** a small, self-contained lane with clear boundaries (one UI surface, or pitch/demo assets).
- **@Miguel982 (Codex basic, low):** a small, well-specified lane (data prep, scripts, one isolated service).
Update `team/team.json`: each member's `role` and `owns` globs (bash patterns where `*` crosses `/`, e.g. `web/*`). Globs must not overlap. Mirror it in SPEC section 8.

## 4. Contracts
In `contracts/`, write the exact interfaces between lanes: API routes with request/response JSON, shared types, event names, file formats, ports, env var names. Concrete examples for each. This is what lets lanes work in parallel without talking.

## 5. Scaffold
Create the folder skeleton for every lane with the minimum that runs: package manifests, entry point, a hello-world route/page, a run command per lane documented in SPEC section 6, `.env.example`. Everything must start from a clean clone. Verify by running each lane.

## 6. Issues
`gh label create` labels `lane:<name>`, `M1`, `M2`, `M3`, `bug`, `P0`, `P1`, `P2` (ignore "already exists"). Then one issue per task with `gh issue create --assignee <login> --label lane:<x> --label M<n>`:
- Title `<lane>: <task>`; body = goal, exact files, contract it implements, acceptance check (command to run + expected result), depends-on issues.
- Low-budget lanes (EJ2007, Miguel982): extra precise, file-level, no exploration needed, small (< 1 h each).
- Order each person's issues so their lowest number is the first thing to do. M1 issues first for everyone.

## 6b. QA agent
- Keep `qa` in `team/team.json` (`qa/*`, `docs/qa/*` owned by Yahya-github/qa).
- Add the QA gates to SPEC section 9 (after M1, after M2, nightly ~2am, feature freeze, final 1 h before submission).
- After step 7 below, send `scripts/board post --type HUMAN --to Yahya-github "Start the QA agent in a second terminal: gh repo clone I-ala-Wilson/codejam16 ~/codejam-qa && cd ~/codejam-qa && scripts/setup --role qa && claude, then Shift+Tab to auto mode and type /qa-standby. Leave it running all hackathon."`

## 7. Ship and sync everyone
1. `git pull --rebase`, `git add` everything you created, `ALLOW_SHARED=1 git commit -m "kickoff: brief, SPEC v1, contracts, scaffold"`, `git push`.
2. Post: `scripts/board post --type SPEC --to Yahya-github --to EJ2007 --to Miguel982 "SPEC v1 is on main. Run sync, read docs/SPEC.md, ACK with your owned globs and first issue."`
3. Tell Ian, in so many words, to text Michael now: "Your board watch should be ringing. Type `sync` to Codex, then after each task say `next issue`." Codex cannot wake itself. Also tell Ian to text Yahya and EJ "sync" in case their wait is not armed.
4. Update `docs/STATE.md` (spec v1, lanes, next actions, milestone times) and commit it.
5. Arm `scripts/board wait` in the background. As ACKs arrive, check `scripts/board acks` until all 4 show the current version, and answer any NEED immediately.

## Later spec changes
Same flow, smaller: edit SPEC (+ contracts/team.json if needed), bump SPEC_VERSION, commit, post `--type SPEC` tagging only affected logins with a one-line diff summary. Ask Ian before cutting scope or reassigning a lane.

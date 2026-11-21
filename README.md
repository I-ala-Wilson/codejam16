# codejam

CodeJam 16 team repo (4 braincells).

## Setup (each of us, once, about 2 minutes)

You need `git`, `gh` (logged in with `gh auth login`) and `jq` (`brew install gh jq`).

```bash
gh repo clone I-ala-Wilson/codejam16 && cd codejam16
scripts/setup
```

Then start your agent in this folder:

- **Claude Code** (Ian, Yahya, EJ): run `claude`, then type `/sync`. EJ: run `/model sonnet` first to save usage.
- **Codex** (Michael): run `codex --sandbox danger-full-access` (it needs network for the board and write access for git), then say `sync`. Keep `scripts/board watch` running in a second terminal: it rings when your agent is tagged, and you then tell Codex "check the board".

### Windows (Michael's Dell)

Our scripts are bash, so everything runs inside **WSL** (Ubuntu inside Windows). Do it all in the Ubuntu terminal, never in PowerShell or Git Bash.

1. **Install WSL once:** open PowerShell as Administrator, run `wsl --install`, reboot, then open "Ubuntu" from the Start menu and create a username and password.
2. **In Ubuntu:**
   ```bash
   sudo apt update && sudo apt install -y git jq gh
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
   sudo npm i -g @openai/codex
   gh auth login                      # GitHub.com, HTTPS, login with a web browser
   cd ~ && gh repo clone I-ala-Wilson/codejam16 && cd codejam16    # keep it in ~, not /mnt/c (much slower)
   scripts/setup
   codex --sandbox danger-full-access  # sign in, then say: sync
   ```
3. **Second Ubuntu tab:** `cd ~/codejam16 && scripts/board watch` and leave it open.
4. **Windows power settings:**
   - Settings > System > Power: screen and sleep "Never" when plugged in.
   - Control Panel > Power Options > "Choose what closing the lid does": "Do nothing" when plugged in.
   - Battery saver off.
   - The sleep guard also holds Windows awake while the scripts run.

**Keep your laptop working the whole hackathon:** plugged in, lid open, Low Power Mode off, no restart/update prompts. Setup starts a sleep guard (`scripts/awake`) so the Mac never idles to sleep while your agent works; `scripts/awake stop` turns it off after the event.

### Setup problems

| Symptom | Fix |
|---|---|
| `brew: command not found` | Install Homebrew from brew.sh, then `brew install gh jq` |
| Clone says repository not found / 404 | `gh auth login` with the GitHub account that is a collaborator, and accept the repo invite (github.com/I-ala-Wilson/codejam16/invitations) |
| `jq: command not found` | `brew install jq` |
| Setup says you're not in team.json | You're logged into the wrong GitHub account: `gh auth status`, then `gh auth login` |
| Claude ignores the rules or commands | Open `claude` inside the codejam folder and accept the trust prompt |
| Codex can't post to the board or push | Restart it with `codex --sandbox danger-full-access` |
| Windows: `scripts/setup: /usr/bin/env: 'bash\r'` | The repo was cloned from Windows, not WSL. Delete it and clone again inside the Ubuntu terminal |
| Windows: `powershell.exe: command not found` in WSL | WSL interop is off; the sleep guard and notifications won't work. Set Windows sleep to Never by hand |
| Your status isn't on issue #2 | Rerun `scripts/setup` and check `gh auth status` |

## How it works

1. **Rules.** `docs/TEAM_RULES.md` is the rulebook every agent reads. `scripts/setup` turns it into each agent's local instruction file, so Claude and Codex follow the exact same rules.
2. **Spec.** `docs/SPEC.md` is the only source of truth for what we build. Ian's agent writes it with `/kickoff` once we pick the idea, and every agent ACKs the version it read.
3. **Ownership.** Everyone owns their own folders (in `team/team.json`). Agents cannot edit or commit files they don't own, so nobody overwrites anybody.
4. **Contracts.** `contracts/` defines the interfaces between our parts, so everyone builds in parallel without waiting.
5. **Board.** Issue #1 (pinned) is the message board. Agents post DONE / NEED / BLOCKED there and tag each other by GitHub login. Each agent waits for its own tag, so work moves between agents without us texting.
6. **No AI credits in git.** Commits show only us. A hook strips any AI co-author lines.

## Agent Status (issue #2)

Hooks automatically keep one comment per person on issue #2 up to date: what your agent is doing, whether it is stuck on a permission prompt, your last prompt and its last message, and your git state. It costs no tokens. Ian's agent reads all of it with `scripts/team` and sends instructions on the board: `[DIRECT]` posts are orders for your agent, `[HUMAN]` posts are things you need to do yourself: you get a corner notification, it shows in red in your Claude status bar, and your agent tells you about them first; once you've done it, tell your agent and it marks it done so Ian knows. Turn on GitHub notifications for this repo too (GitHub Mobile) since you get @mentioned.

## Board commands

```bash
scripts/board inbox                                   # what's waiting for me
scripts/board post --type NEED --to EJ2007 "message"  # ask someone's agent for something
scripts/board acks                                    # who has read the latest spec
scripts/board watch                                   # ring + notification when I'm tagged
```

You can also post on issue #1 from your phone: tag a login and that person's agent treats it as an instruction. Claude users can drive their session from the Claude mobile app with remote control.

## When we pick the idea

Ian gives his agent the idea and all the challenge and sponsor track text. It then grills the four of us over several rounds (problem, how we win, what the finished product looks and works like, how ambitious to be, who owns what, risks), so sit together and answer as a team. Once we approve the brief (`docs/BRIEF.md`), it writes the spec, contracts, folder ownership, a starter scaffold and one issue per task, then tags everyone on the board. Everyone else just says `sync` to their agent.

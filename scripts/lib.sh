# Shared helpers, sourced by the other scripts.
ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
GITDIR="$(git -C "$ROOT" rev-parse --absolute-git-dir)"
TEAM="$ROOT/team/team.json"
BOARD_CFG="$ROOT/team/board.json"

me() {
  if [[ ! -s "$GITDIR/agent-id" ]]; then
    gh api user --jq .login > "$GITDIR/agent-id" 2>/dev/null || { echo "gh not logged in: run gh auth login" >&2; return 1; }
  fi
  cat "$GITDIR/agent-id"
}

lead() { jq -r .lead "$TEAM"; }

# "main" for the normal agent, "qa" for a QA clone (scripts/setup --role qa).
role() { cat "$GITDIR/agent-role" 2>/dev/null || echo main; }
# Identity used for ownership and board signatures: "login" or "login/qa".
me_tag() { local m; m="$(me)" || return 1; [[ "$(role)" == qa ]] && echo "$m/qa" || echo "$m"; }

spec_version() { sed -n 's/^SPEC_VERSION: *\([0-9][0-9]*\).*/\1/p' "$ROOT/docs/SPEC.md" | head -1; }

# Path relative to repo root, or empty if it is outside the repo.
relpath() {
  local p="$1" rest=""
  [[ "$p" != /* ]] && p="$PWD/$p"
  # resolve symlinks via the nearest existing ancestor (the file itself may not exist yet)
  while [[ ! -d "$p" ]]; do rest="/$(basename "$p")$rest"; p="$(dirname "$p")"; done
  p="$(cd "$p" && pwd -P)$rest"
  local root; root="$(cd "$ROOT" && pwd -P)"
  case "$p" in
    "$root"/*) echo "${p#"$root"/}" ;;
    *) echo "" ;;
  esac
}

# Prints the login that owns a repo-relative path ("" if unassigned).
owner_of() {
  local path="$1" login glob
  if [[ "$path" =~ ^data/recordings/([^/]+)/ ]]; then echo "${BASH_REMATCH[1]}"; return; fi
  if [[ "$path" =~ ^docs/notes/([^/]+)-qa\.md$ ]]; then echo "${BASH_REMATCH[1]}/qa"; return; fi
  if [[ "$path" =~ ^docs/notes/([^/]+)\.md$ ]]; then echo "${BASH_REMATCH[1]}"; return; fi
  while read -r glob; do
    # shellcheck disable=SC2053
    [[ -n "$glob" && "$path" == $glob ]] && { echo "$(jq -r '.qa.login' "$TEAM")/qa"; return; }
  done < <(jq -r '.qa.owns[]? // empty' "$TEAM")
  # the most specific (longest) matching glob wins, so a member can own a sub-folder inside another lane
  local best="" bestlen=-1
  while IFS=$'\t' read -r login glob; do
    # shellcheck disable=SC2053
    if [[ "$path" == $glob ]] && (( ${#glob} > bestlen )); then best="$login"; bestlen=${#glob}; fi
  done < <(jq -r '.members[] | .login as $l | .owns[] | "\($l)\t\(.)"' "$TEAM")
  [[ -n "$best" ]] && { echo "$best"; return; }
  while read -r glob; do
    # shellcheck disable=SC2053
    [[ "$path" == $glob ]] && { lead; return; }
  done < <(jq -r '.shared[]' "$TEAM")
  echo ""
}

# Hackathon cutoff: nothing may be committed or pushed at/after this instant (UTC epoch, timezone-proof).
past_cutoff() {
  local c; c="$(jq -r '.cutoff_epoch // empty' "$BOARD_CFG")"
  [[ -n "$c" && "$(date -u +%s)" -ge "$c" ]]
}
cutoff_label() { jq -r '.cutoff_label // "the cutoff"' "$BOARD_CFG"; }

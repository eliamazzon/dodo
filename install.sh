#!/bin/sh
# DODO one-command installer.
#
#   curl -fsSL https://raw.githubusercontent.com/eliamazzon/dodo/main/install.sh | sh
#
# Clones (or updates) the repo, builds the extension, then runs a guided picker that
# opens your chosen Chrome/Brave profile at chrome://extensions with the path ready to
# paste. Set DODO_DIR to change where it's cloned (default: ~/Applications/DODO on
# macOS, ~/dodo elsewhere — a visible folder either way, since a hidden dotfolder is a
# pain to reach from the "Load unpacked" file picker).
set -eu

REPO="https://github.com/eliamazzon/dodo.git"
case "$(uname -s)" in
  Darwin) DEFAULT_DIR="$HOME/Applications/DODO" ;;
  *)      DEFAULT_DIR="$HOME/dodo" ;;
esac
DIR="${DODO_DIR:-$DEFAULT_DIR}"

# ── tiny color helpers ────────────────────────────────────────────────────────
if [ -t 1 ]; then P='\033[35m'; B='\033[1m'; Y='\033[33m'; R='\033[0m'; else P=''; B=''; Y=''; R=''; fi
say()  { printf '%b\n' "$*"; }
step() { printf '%b\n' "${P}${B}›${R} $*"; }
die()  { printf '%b\n' "${Y}error:${R} $*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

say ""
say "${P}${B}  ✦ DODO${R}  —  installing the browser agent"
say ""

# ── prerequisites ─────────────────────────────────────────────────────────────
have git  || die "git is required. Install it: https://git-scm.com/downloads"
have node || die "Node.js is required (v18+). Install it: https://nodejs.org"
have npm  || die "npm is required (ships with Node.js): https://nodejs.org"

# ── fetch / update the repo ─────────────────────────────────────────────────────
if [ -d "$DIR/.git" ]; then
  step "updating existing checkout in $DIR"
  git -C "$DIR" pull --ff-only || say "${Y}!${R} couldn't fast-forward; using the current checkout."
else
  step "cloning DODO into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"

# ── install deps ────────────────────────────────────────────────────────────────
step "installing dependencies"
if [ -f package-lock.json ]; then npm ci || npm install; else npm install; fi

# ── hand off to the guided picker (build happens inside it) ─────────────────────
# Under `curl | sh`, stdin is the piped script, so read the user's choices from the
# terminal directly. Fall back to plain stdin when no tty is attached. `/dev/tty`
# can exist as a device node yet not be openable (no controlling terminal, as in
# some CI/sandbox environments), so probe it rather than just checking existence.
if : < /dev/tty 2>/dev/null; then
  node scripts/install.mjs < /dev/tty
else
  node scripts/install.mjs
fi

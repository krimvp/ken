#!/usr/bin/env bash
# Re-vendor third-party agent skills into .agents/skills/ at pinned refs.
# Usage: scripts/vendor-skills.sh [--update | --check]
#   --update  move pins to each upstream's HEAD
#   --check   diff the pinned upstreams against the tree, exit 1 on drift, change nothing
set -euo pipefail

usage() { echo "usage: $0 [--update | --check]" >&2; exit 2; }
UPDATE=0 CHECK=0
case "$#:${1:-}" in
  0:) ;;
  1:--update) UPDATE=1 ;;
  1:--check) CHECK=1 ;;
  *) usage ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS="$ROOT/.agents/skills"
LOCK="$ROOT/.agents/skills.lock"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PSTACK_REPO=https://github.com/backnotprop/pstack.git
MATT_REPO=https://github.com/mattpocock/skills.git
OPENCLAW_REPO=https://github.com/openclaw/openclaw.git
PONYTAIL_REPO=https://github.com/dietrichgebert/ponytail.git

# Matt Pocock skills we take. The rest overlap pstack (tdd, teach, prototype,
# diagnosing-bugs, code-review) or need tracker setup we have not chosen yet.
MATT_SKILLS=(
  engineering/codebase-design
  engineering/domain-modeling
  engineering/grill-with-docs
  productivity/grilling
  productivity/handoff
  productivity/writing-for-agents
)

# Ponytail skills we take. The rest report on a product we do not run here.
PONYTAIL_SKILLS=(ponytail ponytail-review)

# Skills edited in this repo. Every other folder in .agents/skills is vendored,
# so a sync replaces it and prunes it once no upstream ships it.
# test-audit is an adapted port of openclaw's (see its PORT.md). The rest are ken's own rules.
LOCAL_SKILLS=(test-audit plain-words code-style ui-review)

# Upstream directories that third_party/ mirrors in full.
THIRD_PARTY=(pstack mattpocock-skills openclaw ponytail)

pin() { [[ -f "$LOCK" ]] && awk -v k="$1" '$1==k {print $2}' "$LOCK" || true; }

fetch() { # name repo [sparse paths...]
  local name=$1 repo=$2; shift 2
  local ref=""; [[ "$UPDATE" == 1 ]] || ref=$(pin "$name")
  if [[ "$CHECK" == 1 && -z "$ref" ]]; then echo "no pin for $name in $LOCK" >&2; exit 2; fi
  git clone -q --filter=blob:none --no-checkout "$repo" "$WORK/$name"
  if (($#)); then git -C "$WORK/$name" sparse-checkout set --no-cone "$@"; fi
  git -C "$WORK/$name" checkout -q "${ref:-HEAD}"
  git -C "$WORK/$name" rev-parse HEAD
}

PSTACK_SHA=$(fetch pstack "$PSTACK_REPO")
MATT_SHA=$(fetch mattpocock "$MATT_REPO" "${MATT_SKILLS[@]/#/skills/}" LICENSE)
OPENCLAW_SHA=$(fetch openclaw "$OPENCLAW_REPO" .agents/skills/test-audit LICENSE)
PONYTAIL_SHA=$(fetch ponytail "$PONYTAIL_REPO" "${PONYTAIL_SKILLS[@]/#/skills/}" LICENSE)

# Assemble what the vendored paths should hold, laid out like the repo.
OUT="$WORK/out"
mkdir -p "$OUT/.agents/skills" "${THIRD_PARTY[@]/#/$OUT/third_party/}"
for dir in "$WORK"/pstack/skills/*/; do cp -R "${dir%/}" "$OUT/.agents/skills/"; done
cp "$WORK/pstack/LICENSE" "$WORK/pstack/agents/"*.md "$OUT/third_party/pstack/"
for path in "${MATT_SKILLS[@]}"; do
  cp -R "$WORK/mattpocock/skills/$path" "$OUT/.agents/skills/"
done
cp "$WORK/mattpocock/LICENSE" "$OUT/third_party/mattpocock-skills/"
cp "$WORK/openclaw/LICENSE" "$OUT/third_party/openclaw/"
for name in "${PONYTAIL_SKILLS[@]}"; do cp -R "$WORK/ponytail/skills/$name" "$OUT/.agents/skills/"; done
cp "$WORK/ponytail/LICENSE" "$OUT/third_party/ponytail/"

if [[ "$CHECK" == 1 ]]; then
  for name in "${LOCAL_SKILLS[@]}"; do cp -R "$SKILLS/$name" "$OUT/.agents/skills/"; done
  drift=0
  for path in .agents/skills "${THIRD_PARTY[@]/#/third_party/}"; do
    (cd "$OUT" && diff -ru "$path" "$ROOT/$path") || drift=1
  done
  if ((drift)); then
    echo "drift: the tree differs from the pins in $LOCK (fix with scripts/vendor-skills.sh)" >&2
    exit 1
  fi
  echo "clean: pstack@${PSTACK_SHA:0:7} mattpocock@${MATT_SHA:0:7} openclaw@${OPENCLAW_SHA:0:7} ponytail@${PONYTAIL_SHA:0:7}"
  exit 0
fi

mkdir -p "$SKILLS"
for dir in "$SKILLS"/*/; do
  name=$(basename "$dir")
  [[ " ${LOCAL_SKILLS[*]} " == *" $name "* || -d "$OUT/.agents/skills/$name" ]] && continue
  echo "pruned: .agents/skills/$name (no upstream ships it)"
  rm -rf "$dir"
done
for dir in "$OUT"/.agents/skills/*/ "${THIRD_PARTY[@]/#/$OUT/third_party/}"; do
  dir=${dir%/} dest="$ROOT/${dir#"$OUT"/}"
  rm -rf "$dest"
  cp -R "$dir" "$(dirname "$dest")/"
done

# test-audit is never overwritten. Show what upstream changed since our pin instead.
OLD_OPENCLAW=$(pin openclaw)
if [[ -n "$OLD_OPENCLAW" && "$OLD_OPENCLAW" != "$OPENCLAW_SHA" ]]; then
  git -C "$WORK/openclaw" fetch -q --filter=blob:none origin "$OLD_OPENCLAW" || true
  echo "== upstream test-audit changes since $OLD_OPENCLAW (port by hand into .agents/skills/test-audit):"
  git -C "$WORK/openclaw" diff --stat "$OLD_OPENCLAW" HEAD -- .agents/skills/test-audit || true
fi

cat >"$LOCK" <<EOF
# name sha source
pstack $PSTACK_SHA $PSTACK_REPO
mattpocock $MATT_SHA $MATT_REPO
openclaw $OPENCLAW_SHA $OPENCLAW_REPO
ponytail $PONYTAIL_SHA $PONYTAIL_REPO
EOF

echo "vendored: pstack@${PSTACK_SHA:0:7} mattpocock@${MATT_SHA:0:7} openclaw@${OPENCLAW_SHA:0:7} ponytail@${PONYTAIL_SHA:0:7}"

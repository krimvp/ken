#!/usr/bin/env bash
# Rebuilds vendor/aigent-0.0.0.tgz from an aigents checkout, records its commit in vendor/README.md, and installs it.
set -euo pipefail

source=${1:?usage: scripts/vendor-aigent.sh <path to an aigents checkout>}
root=$(cd "$(dirname "$0")/.." && pwd)

# A build from uncommitted changes has no commit to record.
if [ -n "$(git -C "$source" status --porcelain)" ]; then
  echo "$source has uncommitted changes. Commit or stash them first." >&2
  exit 1
fi
commit=$(git -C "$source" rev-parse HEAD)

(cd "$source" && npm run package)
cp "$source/aigent-0.0.0.tgz" "$root/vendor/aigent-0.0.0.tgz"
sed -i.bak "s/^Source commit: .*/Source commit: $commit/" "$root/vendor/README.md"
rm "$root/vendor/README.md.bak"
(cd "$root" && npm install ./vendor/aigent-0.0.0.tgz)
echo "vendor/aigent-0.0.0.tgz is now aigents $commit"

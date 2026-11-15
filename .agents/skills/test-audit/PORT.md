# Port notes

Source: `openclaw/openclaw` `.agents/skills/test-audit`, pinned in `.agents/skills.lock`.
License: MIT, copy in `third_party/openclaw/LICENSE`.

Changes from upstream:

- Links to openclaw's `openclaw-testing` proof policy and `docs/help/testing/writing-tests.md`
  now point at `references/writing-tests.md`, a repo-neutral condensation of both.
- Vitest, `scripts/check-changed.mjs`, and `autoreview` replaced with generic
  equivalents; the final review routes to pstack's `/interrogate`.
- `CAMPAIGN.md` is unchanged; its Telegram examples are illustrative.

`scripts/vendor-skills.sh` never overwrites this folder. It prints the upstream diff
since the pin so changes can be ported by hand.

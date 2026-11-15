# AGENTS.md

ken explains a software project to the developer who owns it. [docs/plan.md](docs/plan.md) holds the plan, the terms, and the decisions that are fixed.

## The rules

These rules decide every change. Each names the skill that holds its detail. Read that skill when you apply the rule.

1. **Plain words.** Write as you would say it to a colleague: short words, active verbs, the literal thing. This covers replies, docs, commit messages, comments, UI text, and every prompt that shapes what ken tells its reader. Skill: `plain-words`.
2. **The smallest complete change.** Write only what the task needs, and finish every part it needs. Add no option, layer, or abstraction for later. Skill: `ponytail`.
3. **Clear beats short.** Cut words and code until the next cut would make a reader stop and decode. Then stop cutting.
4. **One job per module.** A folder does one job, shows it through `index.ts`, and holds few files. A new joiner finds any piece of code by reading folder names. Skill: `code-style`.
5. **An interface needs a reason.** Write one where the code meets the outside (git, files, the model, the clock) or where two implementations exist. Otherwise export the function. Skill: `code-style`.
6. **A test must be able to fail for a reason a user would notice.** Pass the authoring gate before you add or change a test. ken has no coverage target. Skill: `test-audit`.
7. **Comment the crossroads.** Write a short header on a key module, and one line where the code takes a path a reader would not expect. Write no other comments. Skill: `code-style`.
8. **Prove it on the real thing.** Run the command, open the page, ask a real model. A passing type check is not proof. Skills: `principle-prove-it-works`, and `ui-review` for anything a person looks at.

## How to work

- Run every non-trivial task under `poteto-mode`. Most pstack skills are user-invoked only, so they are not in your skill list. If the user did not type `/poteto-mode`, read `.agents/skills/poteto-mode/SKILL.md` in full yourself, including its Principles index and Harness section, before any work. Do the same for any other pstack skill a step routes to.
- Follow the playbook it picks. Copy the playbook steps into your task list.
- A trivial task (a typo, a one-line config change) skips the playbook and still follows the rules above.
- Delegate through the `poteto-agent` subagent. In Claude Code it is in `.claude/agents/`. Elsewhere, follow the `poteto-agent` mapping in the Harness section of `poteto-mode`.
- When two sources disagree, this file wins, then ken's own skills (`plain-words`, `code-style`, `ui-review`, `test-audit`), then the vendored skills.
- `npm run check` is the gate. Run it before every commit. It type-checks, lints, runs the tests, and runs ken's structure check and prose check.
- Write a commit message as a conventional commit (`feat:`, `fix:`, `test:`, `docs:`, `build:`). The subject says what changed for the person who reads the log.
- Stay neutral to the coding tool. Skills live in `.agents/skills/`, the guide is this file, and nothing in the repository depends on one tool's hooks or settings.
- Model choices per role come from `~/.agents/pstack-models.md`. Run `/setup-pstack` to write it.

## Skills by need

| Need | Skill |
|---|---|
| Any text a person reads | `plain-words`, then `unslop` for the full pattern list |
| Docs, READMEs, commit messages | `technical-writing` |
| Writing or reviewing TypeScript | `code-style`, then `typescript-best-practices` |
| Sizing a change, adding a dependency | `ponytail` |
| Reviewing a change | `ponytail-review` |
| Writing, changing, or reviewing a test | `test-audit` |
| Changing the page or the public site | `ui-review` |
| Module and interface design | `codebase-design` |
| Domain terms and decisions | `domain-modeling` |
| Stress-testing a plan or design | `grilling`, or `grill-with-docs` to record decisions as you go |
| Editing AGENTS.md, CLAUDE.md, or a skill | `writing-for-agents` |
| Handing work to a new session | `handoff` |

## Layout

- `src/` holds one folder per module. The `MODULES` table in `scripts/check/structure.ts` is the map of the code: each module's job, the modules it may import, and the packages it may use. Add a module to the table before you create its folder.
- Only the `agent` module talks to a model. Everything else is plain code that runs the same way every time.
- `test/` mirrors `src/`. A test imports a module through its `index.ts`, the same way other modules do.
- `site/` holds the public page.
- `.agents/skills/` holds every skill. `.claude/skills` is a symlink to it.
- Vendored skills are pinned in `.agents/skills.lock`: pstack from `backnotprop/pstack` (a synced mirror of `cursor/plugins`), six skills from `mattpocock/skills`, and two from `dietrichgebert/ponytail`. Do not edit them in place. Re-sync with `scripts/vendor-skills.sh`, `--update` to move the pins, or `--check` to diff the tree against the pins. Licenses are in `third_party/`.
- ken's own skills are `plain-words`, `code-style`, `ui-review`, and `test-audit` (an adapted port, see its `PORT.md`). Edit them directly. List a new one in `LOCAL_SKILLS` in the script, or the next sync prunes it.
- `.claude/agents/` is hand-maintained. `comment-sicko.md` is a verbatim copy of `third_party/pstack/comment-sicko.md`. `poteto-agent.md` adapts `third_party/pstack/poteto-agent.md` to Claude Code.

# ken

ken explains a software project to the developer who owns it. It tells you what changed, why it changed, and how a part of the code works now. It is built for projects where AI agents write most of the code.

## Status

Slices 0 and 1 of [the plan](docs/plan.md) run: a chat in the terminal about one repository. The model reads the files and the git history with tools that cannot change the project. It must send its answer through a tool that checks every quote against git, and it gets three tries. An accepted answer lists the commits in scope, read from git, and the changed lines that no quote covers. ken does not keep a record of past answers yet, and has no page.

## Run it

ken sends your project's code to the model you name, so it has no default model. Set three variables, in the environment or in `.env`:

```sh
KEN_MODEL=gpt-oss:120b                # the model to ask
KEN_BASE_URL=https://ollama.com/v1    # its OpenAI-compatible endpoint
KEN_API_KEY_ENV=OLLAMA_API_KEY        # the name of the variable that holds the key
```

Then, from this checkout, chat about the repository in the current folder, or ask one question:

```sh
npm run ken -- chat
npm run ken -- ask "What did this branch do?" --repo ../my-project --json
```

`ask` prints the answer and exits with code 0 when the answer passed the checks. `--json` prints it as one JSON object for scripts.

## Develop

You need Node 22.19 or later. Node runs the TypeScript files as they are, so there is no build step.

```sh
npm ci
npm run check
```

`npm run check` is the one gate, in CI and on your machine. It type-checks, lints, checks the formatting, and runs the tests. It also runs two checks of ken's own:

- `npm run check:structure` checks the folders in `src/` against the module table at the top of `scripts/check/structure.ts`.
- `npm run check:prose` fails on the em dash, curly quotes, and a list of stock words that mark machine-written text.

`npm run format` fixes the formatting.

## Agents

Coding agents that work in this repository follow [AGENTS.md](AGENTS.md).

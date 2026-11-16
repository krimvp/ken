# ken

ken explains a software project to the developer who owns it. It tells you what changed, why it changed, and how a part of the code works now. It is built for projects where AI agents write most of the code.

![ken's side panel for the first statement of an answer. The statement says that the answer tool checks every quote against git and that a question ends after three rejected answers. Under it are the label Inferred and two quotes at commit b5a9226: lines 1 to 3 of src/agent/answer/check-answer.ts and line 17 of src/agent/answer/answer-tool.ts, export const MAX_REJECTIONS = 3.](site/images/ken-statement-with-quotes.png)

ken answering a question about its own code, on glm-5.3. The panel shows the answer's first statement, its label, and two of its four quotes, read from git at commit `b5a9226`.

## Status

ken is early work. It is not released, it has no license yet, and there is nothing to install. You run it from a checkout. [site/](site/index.html) holds a public page about it, not yet published.

Slices 0 to 3 of [the plan](docs/plan.md) run: a chat in the terminal about one repository, a project record, and a page in the browser. The model reads the files and the git history with tools that cannot change the project. It must send its answer through a tool that checks every quote against git, and it gets three tries. An accepted answer lists the commits in scope, read from git, and the changed lines that no quote covers. A question about a branch counts only what the branch did since it split from main.

The project record keeps what earlier answers found: pieces of work, the decisions in them, topics, and a note on each topic. It lives in `.ken/record/` in the project's repository, as one JSON Lines file per kind (`work.jsonl`, `decisions.jsonl`, `topics.jsonl`, `notes.jsonl`). ken only adds lines to it, and only through checks: every quote must pass, and commits and authors come from git. ken labels every decision itself. A decision is "recorded" when its reason quotes a commit message, or when a coding agent logged it with `ken decide` as it made it. Otherwise it is "inferred", because the model worked it out from the diff. Each question starts by showing the model the record, so asking again reads the stored answer instead of exploring again. ken never commits. You commit `.ken/` yourself, so a collaborator and their agents can read it.

Slice 3 adds the page. `ken open` starts a server on your machine and opens the page in your browser. You ask in a box at the bottom. While the agent works, the page shows each step it takes in plain words, and a Stop button. The answer comes as statements, decisions and risks, each with its label and the code it quotes; open a quote to read all its lines. Beside the answer, ken shows what it checked: the quotes, the changed code that no quote covers (as diffs), and the commits, all read from git. The page keeps every question you ask, with its answer, in `~/.ken/projects/<first commit>/history.jsonl`. That file is yours and stays out of the project. Come back the next day and the page shows the answers again without asking the model.

![The panel headed What ken checked, beside an answer about the last commit. All 12 quotes are in git at b5a9226. 7 of 175 changed blocks are quoted, and the panel names the files of the other 168 and says to read them before trusting the answer about them. Last comes the commit, from git: b5a9226, by Claude, 15 November at 22:50 UTC.](site/images/ken-what-it-checked.png)

What ken checked, beside its answer to "What did the last commit do?" about its own repository.

A high-level question, such as how the parts fit together or what happens when a request comes in, gets an answer that leads with one or two basic diagrams: boxes and arrows, the steps of a sequence, or the data and how it relates. The model sends the boxes and arrows as data, never diagram syntax. Every arrow must quote the lines that show it, and those quotes pass the same check as any other. ken writes the Mermaid text itself, and the page draws it. Under each drawing, a numbered row for each box and arrow shows the lines it quotes. ken checked that those lines exist. It did not check that an arrow is true, just as it does not check a sentence.

![The question: What happens, step by step, when the reader asks a question on the page, from the browser to the answer? Below it, the agent's sequence diagram, labelled Inferred: the page, the server, the question desk, the agent, and git and the record, with eight numbered arrows from the page posting the question to the page getting the saved answer back. A link under it reads: Show the 13 numbered parts in words, with their quotes.](site/images/ken-answer-with-diagram.png)

ken's answer to a question about how its own page works, on glm-5.3. It opens with a sequence diagram.

How ken works today:

```mermaid
flowchart LR
  reader(["You"])
  page["The page<br/>ken open, on your machine"]
  agent["The agent<br/>a model you choose, read-only tools"]
  repo["Your repository<br/>files and git history"]
  checks["Three checks<br/>each quote is in git<br/>change facts from git<br/>the record only grows"]
  record["Project record<br/>.ken/record/, shared"]
  history["Your history<br/>~/.ken/, personal"]
  reader -->|asks and reads| page
  page -->|runs the question in| agent
  agent -->|reads| repo
  agent -->|sends the answer to| checks
  checks -->|read quoted lines from| repo
  checks -->|add what passed to| record
  record -->|is read before each question by| agent
  page -->|saves each answer in| history
```

The public page in `site/` draws the same parts and arrows.

`ken chat` and `ken ask` take the place of the page in the terminal. They print a diagram as its numbered rows, and `--json` carries its Mermaid text.

ken runs on a model you choose. It has been run on glm-5.3 through Ollama Cloud. One open-weight model that was tried could not follow the quoting rules.

These parts of the plan are not built yet:

- The understanding map, so that answers about what you already know can be shorter.
- A command coding agents call to log a decision while they work, and a reader for their saved transcripts.
- The list of open items.

The plan's checkpoint after slice 3 compares ken with a plain chat with a coding agent, on real pieces of agent work. In round 1, on three pull requests on 15 November 2026, ken won on trusting an answer because of its quotes and on finding it again the next day. It lost on finding a decision or a risk the other missed, so ken did not pass yet. Since then, risks are their own part of an answer, and the prompt asks the agent to read the code outside the diff. Round 2 has not been scored. The judge's verdict is in [docs/checkpoint/round-1.md](docs/checkpoint/round-1.md).

## Run it

ken sends your project's code to the model you name, so it has no default model. Set three variables, in the environment or in `.env`:

```sh
KEN_MODEL=glm-5.3                     # the model to ask
KEN_BASE_URL=https://ollama.com/v1    # its OpenAI-compatible endpoint
KEN_API_KEY_ENV=OLLAMA_API_KEY        # the name of the variable that holds the key
```

Then, from this checkout, open the page, chat about the repository in the current folder, or ask one question:

```sh
npm run ken -- chat
npm run ken -- ask "What did this branch do?" --repo ../my-project --json
```

`ask` prints the answer and exits with code 0 when the answer passed the checks. `--json` prints it as one JSON object for scripts, with the entries it added to the record under `recorded`.

`record` shows the project record and needs no model. It lists pieces of work and decisions first. Give an id to see one entry in full, with its quotes; for a topic it also says whether the note still matches the code.

```sh
npm run ken -- record --repo ../my-project
npm run ken -- record 3f9a2b1c4e5d --repo ../my-project --json
```

`decide` logs one decision in the project record, for a coding agent to call while it works. It needs no model. ken labels the decision "recorded", because it was written down when it was made, and keeps the name given with `--by`. The decision goes through the same checks as every other entry. A quote names lines of committed code, at HEAD or with `@<commit>` after it. A decision may also quote nothing, since it often comes before its code. Long text is safer as JSON on standard input, with the same fields; `ken decide --help` lists them.

```sh
ken decide --question "How long does a retry wait?" --chosen "A fixed 100 ms" \
  --reason "No caller needs more yet." --rejected "Exponential backoff: nothing calls for it" \
  --undo easy --quote src/retry.ts:12-14 --by claude-code
ken decide --json < decision.json
```

To let the agents in your other projects call it, run `npm link` once in this checkout: that puts `ken` on your PATH. Then add this paragraph to each project's `AGENTS.md`:

```markdown
**Log decisions with `ken decide`.** Run it the moment you choose between real options, leave a choice for the owner, or do something hard to undo: give the question, what you chose and why, and each option you rejected with its reason. Add `--needs-owner` when the owner should decide, and `--by` with your name. `ken decide --help` shows the rest. A choice with one obvious answer needs no entry.
```

A decision logged before its code is committed has no piece of work yet. Later, the piece of work whose commits start at, or pass through, the commit that was checked out when the decision was logged takes it in. `ken record <id>` shows which.

`open` starts the page for the repository in the current folder, or the one you name, and opens it in your browser. It prints the address too, in case no browser opens. Press Ctrl-C to stop it. With no model set, the page still opens: it shows your earlier answers and says what to set. Ask how the parts of a project fit together and the answer leads with a diagram; choose a numbered row, or a box or an arrow in the drawing, to read the code it rests on. The page draws with Mermaid, which ken serves from its own address.

```sh
npm run ken -- open
npm run ken -- open --repo ../my-project --port 4242
```

The server listens only on 127.0.0.1 and answers only its own page. It runs one question at a time. Set `KEN_HOME` to keep ken's own files somewhere other than `~/.ken`.

After a session, commit the record in the project: `git add .ken && git commit -m "chore: update the ken record"`.

### Run ken on Claude through Claude Code

If you have no hosted model to hand, ken can use the Claude Code CLI on your machine. A small endpoint in `scripts/claude-endpoint/` speaks the chat-completions protocol to ken and answers each request by running `claude -p` once. It needs `claude` on the PATH and signed in. It needs no API key.

1. In one terminal, start the endpoint. It listens on 127.0.0.1, port 4141 unless you give `--port`:

   ```sh
   npm run claude-endpoint
   npm run claude-endpoint -- --port 4242
   ```

2. In another terminal, set these four variables, in the environment or in `.env`, and use ken as usual:

   ```sh
   KEN_MODEL=opus                          # passed to claude --model: an alias or a full model id
   KEN_BASE_URL=http://127.0.0.1:4141/v1   # the endpoint
   KEN_API_KEY_ENV=KEN_LOCAL_KEY           # ken needs a key variable of 8 characters or more
   KEN_LOCAL_KEY=not-a-key                 # any text: the endpoint ignores it
   ```

No key leaves your machine on this path. What does leave it is everything ken sends the model: its instructions, the questions, and the code and history it reads. That goes to Anthropic through your Claude Code sign-in, and counts against your Claude plan.

The CLI runs as a plain model, not as a coding agent: in an empty folder, with its built-in tools switched off, no settings or instruction files, no MCP servers, and no saved session. ken's tools are described in the prompt, and the model sends its tool calls back as structured output. The endpoint answers one request at a time and prints how long each `claude` run took.

It is slower than a hosted endpoint. Each turn starts the CLI again, which costs about a second before the model starts, and resends the whole conversation. ken gets each turn whole, when the `claude` run ends.

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

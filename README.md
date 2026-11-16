# ken

ken explains a software project to the developer who owns it. It tells you what changed, why it changed, and how a part of the code works now, and each claim in its answer quotes lines you can check. It is built for projects where AI agents write most of the code.

![Risk 1 of 5 in an answer: the page and the terminal show times differently, because the page shows note times in the browser's local time with no zone, while the terminal slices the ISO string and labels it UTC. Under it are two quotes at commit 53567b4: line 16 of src/page/live/note.js and line 71 of src/cli/live.ts.](site/images/ken-risk-with-quotes-wide.png)

Screenshot of ken's page, on Claude Opus: the first of five risks in its answer to "What did the last three commits do, and why?" about this repository.

## Status

Early work. ken is not released, it has no license yet, there is nothing to install from a registry, and the repository is private. You run it from a checkout. [site/](site/index.html) holds a public page about it, not yet published.

What runs today:

- `ken open` starts a page on your machine, and `ken chat` and `ken ask` answer in the terminal. `ken record`, `ken map`, `ken follow-up`, `ken who`, `ken since`, `ken catch-up`, `ken area`, `ken decide`, `ken sessions` and `ken live` are described under [Run it](#run-it).
- An answer has a short summary, one or two basic diagrams for a high-level question, then the decisions with their reasons, the risks, and statements. Each carries quotes of lines of code, of a commit message, or of a saved session of the coding agent. ken checks that every quoted line is where the quote says, and rejects an answer with a quote that is not there. It does not check that a sentence, a risk or an arrow is true, and it does not check the summary. The commits, authors and dates, and which changed blocks and commit messages the quotes cover, come from git.
- ken sets a label where it can. "Recorded" means a coding agent logged the decision with `ken decide` as it worked, or the reason is quoted from a commit message. "From the session" means the reason is quoted from a saved session. "Inferred" means the agent worked it out. "Found by search" marks a link between pieces of code that the agent found by searching and did not prove.
- The project record lives in `.ken/record/` in your repository, as JSON Lines files that ken only adds to. You commit it, so a collaborator and their agents can read it. ken never commits, and never writes to your project besides `.ken/`. Your question history and your understanding map live in `~/.ken/projects/<first commit>/` on your machine.
- The understanding map keeps what you said you know, topic by topic. A topic you know whose quoted code has not changed shortens to one line. When the code changed, the answer leads with the change. "Open" lists the decisions that need your call and the topics that changed since you understood them, with who changed them.
- Live mode runs beside your coding agent and writes short notes as the work moves, on each commit and on uncommitted work that has gone quiet. For uncommitted work it keeps snapshots in its own store under `~/.ken/` and never writes to the project, so such a note is a draft on your machine. Live mode is off until you turn it on, and it shows what it spends.
- ken reads the sessions Claude Code saves. Before any session text reaches the model, the page, your history or the record, ken hides what looks like a credential. This is best effort: a secret written in plain words, or a short one, gets through. The record keeps only the quoted lines of a session, so commit `.ken/` only if you are happy to share them. Set `KEN_SESSIONS=off` to stop ken reading sessions.
- ken works with any OpenAI-compatible endpoint, and the code and session text it reads go to that provider. It has been run on glm-5.3 and kimi-k3.1-pro through Ollama Cloud, and on Claude Opus through the Claude Code command with ken's local adapter, `npm run claude-endpoint`. gpt-oss:120b, as served on Ollama Cloud in November 2026, could not follow the quoting rules.

Not built: readers for other coding tools' sessions, anything for teams, and a parser or index of the code.

The plan says ken must beat a plain chat on at least one of three counts and lose on none: finding a decision or a risk the other missed, trusting the answer because the quotes are there, and finding the answer again the next day. The plain chat was a coding agent in the same repository, asked the same question. So far, ken has not passed. Three rounds ran ken on glm-5.3, an open-weight model, against a plain chat on Claude Opus, over merged pull requests of another project by the same owner: three in the first two rounds and five in the third. A fourth round put Claude Opus on both sides, over the same five. A second AI agent scored each round. The owner has not scored them. In all four, ken won the second and third counts and lost the first. With Claude Opus on both sides, the first count came to three ties and two wins for the plain chat. The two counts ken won are things a plain chat does not have by design. The four verdicts are in [docs/checkpoint/](docs/checkpoint/).

How ken works today:

```mermaid
flowchart LR
  reader(["You"])
  page["The page<br/>ken open, on your machine"]
  history["Your history<br/>and topics you know, ~/.ken/"]
  agent["The agent<br/>read-only tools, a model you choose"]
  provider["Model provider<br/>off your machine"]
  repo["Your repository<br/>files and git history"]
  sessions["Saved sessions<br/>of Claude Code, this project only, ~/.claude/"]
  checks["Code, not a model<br/>checks every quote<br/>takes commits from git<br/>only adds to the record"]
  record["Project record<br/>.ken/record/, committed"]
  reader -->|asks and reads| page
  page -->|saves| history
  page -->|runs the question| agent
  agent -->|sends the code and session text it reads to| provider
  agent -->|reads| repo
  agent -->|reads| sessions
  agent -->|sends the answer to| checks
  checks -->|adds what passed to| record
  record -->|is read before each question by| agent
```

The public page in `site/` draws the same parts and arrows.

![A draft note in the Live view, marked Draft, on this machine only. It says a 404 now throws a NotFound error and retry rethrows it at once, and that letting the caller choose the number of attempts is not done yet. Statement 1 quotes lines 8 to 9 of src/http.ts.](site/images/ken-live-draft-note-wide.png)

Screenshot of the top of a draft note in ken's Live view, written by Claude Opus as a coding agent worked on a small made-up project.

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

`sessions` reads the sessions Claude Code saved while it worked on the project, and needs no model. With no id it lists them, newest first: when each started and ended, and how many messages it holds. With an id it prints one session in order: what you asked, what the agent said, and each tool the agent ran on which file or with which command, with the first lines of its output. ken only reads these files. It reads only sessions that started in the project's folder or one inside it, at most the newest 100, and at most 32 MB of each.

```sh
npm run ken -- sessions --repo ../my-project
npm run ken -- sessions 0b7e4c2a-5f1d-4c3e-9a8b-2d6f1e0c9b7a --repo ../my-project --json
```

Claude Code keeps sessions in `~/.claude/projects/`. Set `KEN_CLAUDE_PROJECTS` to read them from another folder.

The chat and the page read the same sessions. The agent can list them, read one around a time or a message, and search them, and it quotes them only to say why something was done. `KEN_SESSIONS=off` turns reading off for `sessions`, the chat and the page.

`map` prints your understanding map and the path of its file. It needs no model. To correct the map, add a line to that file; `map` shows the hash each topic has now, and an example line to copy. `catch-up` lists, without a model, the topics whose code changed since you understood them and the work recorded since your last question, then asks the agent to explain them. `area` does the same for one part of the project. With no model set, both still print their list.

```sh
npm run ken -- map --repo ../my-project
npm run ken -- catch-up --repo ../my-project
npm run ken -- area src/server --repo ../my-project
```

`follow-up` prints what is open: the decisions that need your call, and the topics you understood whose code changed since, with the commits that changed them. `who` lists one author's commits, named by email or part of a name, and the topics you know that they touched. `since` lists what landed in a span for everyone, with the pieces of work the record has in it. A span is a day such as `2026-11-01` or a number of days such as `14d`; `who` uses the time since your last question unless you give `--since`. Each prints its list without a model, then asks the agent when a model is set. When the list holds nothing to explain, it asks nothing.

```sh
npm run ken -- follow-up --repo ../my-project
npm run ken -- who bo@example.com --since 14d --repo ../my-project
npm run ken -- since 2026-11-01 --repo ../my-project
```

`open` starts the page for the repository in the current folder, or the one you name, and opens it in your browser. It prints the address too, in case no browser opens. Press Ctrl-C to stop it. With no model set, the page still opens: it shows your earlier answers and says what to set. The page draws diagrams with Mermaid, which ken serves from its own address. Under each answer, "I know this", "Too much" and "Go deeper" update your map. The header links to "Your map", to "Decisions", and to "Open" when something waits on you. The lenses sit under the question box: catch up, an area, and what changed, by one person or by everyone, in a span you pick.

```sh
npm run ken -- open
npm run ken -- open --repo ../my-project --port 4242
```

`open --live` starts the page with live mode on; the "Live" view's switch turns it on and off too. `live` runs it in the terminal instead: it prints what it sees now, then each note as ken writes it, until Ctrl-C. Both need a model, and each note is one question to it. "Pause" holds the notes, "Write a note now" asks for one at once, and "Open as a question" on a note asks for the full answer on that change.

```sh
npm run ken -- open --live --repo ../my-project
npm run ken -- live --repo ../my-project
```

The server listens only on 127.0.0.1 and answers only its own page. It runs one question or live note at a time. Set `KEN_HOME` to keep ken's own files somewhere other than `~/.ken`.

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

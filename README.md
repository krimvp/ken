# ken

ken explains a software project to the developer who owns it. Ask what changed, why, or how a part works now. ken's model replies in its own words, and backs each claim that needs proof with a card: the exact lines it rests on, which ken looks up before you see the card. ken is built for projects where AI agents write most of the code.

<img src="site/images/ken-risk-with-quotes-wide.png" width="440" alt="The question What did the last commit do, and why? Name the decisions it made and any risk I should know about. Under it, the summary from ken's model, not checked, tells the story: before a32ffb8, retry waited a fixed 200 ms between tries, so it kept hitting the API while the API was down. Now the wait doubles after each failed try, 200, 400, then 800 ms. The thing to watch is that retry still waits after the last try. Then come the line 3 risks, 1 of them serious, and the risks, heaviest first. Risk 1 is marked Quotes code outside the change and Serious: every fetchUser call where all 3 tries fail now waits about 1.4 s before it throws, up from 0.6 s. Its first quote is open and shows line 8 of src/user.ts at a32ffb8, where fetchUser calls retry. Two more quotes of src/retry.ts are folded.">

Screenshot of an answer on ken's local page, about a commit in a small made-up project, taken before ken replied in its own words. The model was Claude Opus.

## What ken gives you

- **A colleague who shows the lines.** The model's words are its own, and ken does not check them. A boxed card is a claim, a decision, a risk, a diagram or a topic, with the lines of code, the commit message or the saved session it quotes. ken finds every quoted line where the quote says it is. A card with a quote that is not there goes back to the model alone, and you never see it; the rest of the reply stands. ken checks where a quote is, not whether a sentence is true. Every arrow in a diagram quotes its lines.
- **Answers about a change.** The model tells the story of the change in a few sentences and says whether it saw decisions or risks worth a look. Ask for them with the Decisions and Risks chips under the reply. Before you see the risks, a second look tries to rule each one out. It can withdraw a risk only with a quote of the line that rules it out, which ken looks up, and the withdrawn risk stays in view with that line. A claim that something is missing or untested must name the missing text, and ken searches the code for it and shows the search. A risk that a later commit fixed is marked "Fixed since, in" that commit, from git.
- **One thread.** The page shows your questions to one chat as one thread, and the model remembers what it said earlier in it.
- **Answers you can find again.** Your questions and ken's answers stay on your machine, in `~/.ken/projects/<first commit>/`. The decisions, their reasons and what each piece of work did go into the project record, in `.ken/record/`, as JSON Lines files that ken only adds to. You commit the record, so a collaborator and their coding agents can read it.
- **Where each reason comes from.** ken labels each decision from its quotes, so a model cannot mark its own guess as recorded. "Recorded" means written down at the time, in a commit message or with `ken decide`. "From the session" means quoted from a saved session. "Inferred" means the model worked it out. "Found by search" marks a link between pieces of code that rests on a text search.
- **What waits on you.** "Waiting on you" lists the decisions a coding agent left for you, and the topics you marked as known whose code has changed since, with who changed them. Answer a decision with "Keep what was chosen" or "I want it changed". ken saves your answer and changes no code.
- **The project at a glance.** The Project view shows the project as a few boxes, and opens any box to show the boxes inside it. At first the boxes are the main folders. Press "Ask ken to name these parts" and ken's model names the main parts, says in one line what each does, and adds arrows for which part uses which. ken checks every path and every arrow against git, keeps the parts, and says when the code has moved away from them. Pick a commit to see which boxes were different then or not there yet, and lay a change over the boxes: a recent merge, a branch, or your uncommitted work. Each box says which of its topics you have not asked about, have asked about, understand, or understood before their code changed, and one line says where to look next. Looking needs no model: it comes from git, the record and your map.
- **Live mode.** Beside your coding agent, ken writes a short note on each commit and on uncommitted work that has gone quiet. Live mode is off until you turn it on, and it shows what it spends.

In ken's last two test rounds, on pull requests it had never seen, fresh AI judges compared its answers with a plain chat on the same model, and each time rated ken's narrowly better overall, for its checked quotes and its kept record. The verdicts are in [docs/checkpoint/](docs/checkpoint/).

## Status

Early work, not released. Nothing to install, no license, private repository. You run ken from a checkout. [site/](site/index.html) holds a public page about it, not yet published.

- ken runs on your machine and only reads. It never edits your code, commits or pushes, and it writes only in `.ken/` in the project and in `~/.ken/`. It works with git repositories, Claude Code sessions and one developer.
- It talks to an OpenAI-compatible endpoint, and the code and session text it reads go to that provider. It has been run on glm-5.3 and kimi-k3.1-pro through Ollama Cloud, and on Claude Opus through ken's local adapter for the Claude Code command.
- ken hides what looks like a credential in a saved session before the model sees it, and hides nothing in your code or git history. A secret written in plain words, or a short one, gets through. The record keeps the quoted lines of a session, so commit `.ken/` only if you are happy to share them. `KEN_SESSIONS=off` stops ken reading sessions.
- Not built: readers for other coding tools' sessions, anything for teams, and a parser or index of the code.

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

`ask` prints the reply, its words and cards in order, and exits with code 0 when there is one. `--json` prints it as one JSON object for scripts: the reply's items under `reply`, and the entries it added to the record under `recorded`.

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

`layout` prints one level of the project's layout and needs no model. `--at` picks the commit, `--within` opens a box (give each of its paths), and `--change` lays a change over the boxes: a range such as `main..feature`, a branch, `uncommitted`, or `none`. Without `--change`, ken lays your own work over the boxes: your uncommitted work if there is any, else the branch you are on against the main branch.

```sh
npm run ken -- layout --repo ../my-project
npm run ken -- layout --within src --change uncommitted --repo ../my-project
npm run ken -- layout --at v0.3.0 --change main..feature --repo ../my-project
```

`follow-up` prints what is open: the decisions that need your call, and the topics you understood whose code changed since, with the commits that changed them. `who` lists one author's commits, named by email or part of a name, and the topics you know that they touched. `since` lists what landed in a span for everyone, with the pieces of work the record has in it. A span is a day such as `2026-11-01` or a number of days such as `14d`; `who` uses the time since your last question unless you give `--since`. Each prints its list without a model, then asks the agent when a model is set. When the list holds nothing to explain, it asks nothing.

```sh
npm run ken -- follow-up --repo ../my-project
npm run ken -- who bo@example.com --since 14d --repo ../my-project
npm run ken -- since 2026-11-01 --repo ../my-project
```

`open` starts the page for the repository in the current folder, or the one you name, and opens it in your browser. It prints the address too, in case no browser opens. Press Ctrl-C to stop it. With no model set, the page still opens: it shows your earlier answers and says what to set. The page draws diagrams with Mermaid, which ken serves from its own address. Under each reply that names a topic, "I know this", "Too much" and "Go deeper" update your map. The header links to "Project", "Decisions" and "Your map", to "Live" when a model is set, and to "Waiting on you" when something waits on you. The lenses sit under the question box: catch up, an area, and what changed, by one person or by everyone, in a span you pick.

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

Each turn starts the CLI again, which costs about a second before the model starts, and resends the whole conversation. ken gets each turn whole, when the `claude` run ends.

## How ken works

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
  agent -->|sends each card to| checks
  checks -->|adds what passed to| record
  record -->|is read before each question by| agent
```

The public page in `site/` draws the same parts and arrows.

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

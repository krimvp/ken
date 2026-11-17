# Plan: a code companion that explains a project to its reader

As of 2026-11-15

## Summary

The companion is a local tool that explains a software project to the one developer who owns it, at the depth that developer needs. It answers three kinds of question: what changed, why it was done that way, and how a part works now.

It is built for projects where AI agents write most of the code. The developer comes back after hours or weeks, or works beside someone else, and needs to understand the project again without reading every diff.

The developer talks to it in a chat. The model replies in its own words, as a colleague would, and shows a card with the quoted code for each claim that needs proof. The page keeps the chat as a thread, so it becomes the record of what the developer now understands.

It is a new repository. The only code it reuses is `aigent`, the owner's agent engine, which runs the chat. It has no parser and no code index: an agent explores the code with read, search and git, and three small deterministic checks keep its claims honest.

The first version must prove one thing: that an explanation from this tool is more useful than asking a coding agent "what changed and why" in a plain chat. If it is not, stop and rethink before building further.

## The problem and what exists

Agents now produce code faster than a person can absorb it. The gap has a name, comprehension debt. Margaret-Anne Storey splits it in two: cognitive debt (what the team understands) and intent debt (reasons that were never written down). An Anthropic trial found that developers who used AI assistance scored about 50% on a comprehension quiz, against 67% for those who coded by hand.

No single product closes this gap for the reader. A search on 15 November 2026 found six groups of tools, each covering one part.

| Job                               | Examples                                                       | What it lacks                                                                          |
| --------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Record what the agent did and why | Entire, SpecStory, Git AI, Agent Trace, Agent Decision Records | A transcript or a log to read, not an explanation                                      |
| Make one change readable          | Stage, Haystack, Graphite Code Tours, Devin Review             | One pull request at a time, the same text for every reader, reasons guessed afterwards |
| Explain a codebase                | DeepWiki, Google Code Wiki, Codemaps, Understand-Anything, xpl | A picture of the code now: no history, no decisions, no memory of the reader           |
| Teach while coding                | Claude Code's Explanatory and Learning styles                  | Only inside the live session                                                           |
| Check the reader understood       | Quiz gates such as SlopBlock and pr-quiz; LACY (research)      | A gate before merging, not a guide                                                     |
| Measure who knows what            | CodeScene, degree-of-knowledge models                          | Based on who wrote the code, which means little when agents write it                   |

Four things are missing everywhere, and this product is built around them:

1. A lasting model of what this reader already understands.
2. Decisions as records: what was chosen, what was rejected and why, written down when the decision is made.
3. Views that are not tied to one pull request or one point in time.
4. Claims checked against the code, so an explanation cannot cite code that is not there.

The recording side is crowded and moving fast. The reader side is open.

## Decisions already made

These were settled in the design discussion. An agent working on the project should treat them as fixed unless the owner changes them.

| Decision                                   | Reason                                                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One developer first, not a team            | It keeps the reader's model to one local file and needs no accounts or sharing. A collaborator's changes must still be handled, because the owner sometimes works beside someone else.   |
| A new repository                           | Nothing is reused from xpl or own-your-diff. Their ideas carry over; their code and data models do not.                                                                                  |
| `aigent` is the chat engine                | It is the owner's own engine, and it runs on any model provider, including open-weight models.                                                                                           |
| No tie to one coding tool                  | The code may be written by Claude Code, Codex, a collaborator or the owner. Git is the only source every case shares.                                                                    |
| No parser and no code index at the start   | An agent explores with read, search and git. This works for every language and file type from the first day, and a parser per language is a large cost to pay before the idea is proven. |
| Chat first, with a page beside it          | The developer interacts best by asking. The questions are also the main signal of what the developer knows.                                                                              |
| No single "since last time" cursor         | It assumes one reader and nobody else changing the code. It fails with a collaborator and after weeks away. Time is one way to scope a question, not the centre of the design.           |
| High-level answers lean on basic diagrams  | The owner asked on 2026-11-15 for high-level answers that lean on basic diagrams. Detail stays prose with quotes. A diagram is checked data, so it cannot show code that is not there.   |

## The model

The design has two stores and a set of lenses. A lens picks a part of the project record; the understanding map decides how deep the answer goes.

### The project record

The project record is about the code and is the same for every reader. It holds four kinds of entry.

| Entry         | What it holds                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Piece of work | Commits that belong together (a task, a branch, a pull request), who did it, when, and a short summary                                     |
| Decision      | The question, the option chosen, the options rejected with a reason each, how easy it is to undo, and whether it needs the owner's opinion |
| Topic         | A named part of the project, such as "retry logic", with the quoted code it rests on                                                       |
| Note          | The agent's cached summary of a topic, stored with the hash of the code it describes                                                       |

"Who did it" is one of: the owner, the owner's agent, a collaborator, or unknown. Git tells the owner from a collaborator. It cannot always tell the owner from the owner's agent, so the record says "unknown" when it has no evidence.

### The understanding map

The understanding map is personal. It has one entry per topic the reader has met. Each entry holds:

- the topic;
- a depth: has heard of it, can follow it, or could change it;
- the evidence: asked about it, read its card, said "I know this", or wrote it by hand;
- the date;
- the hash of the topic's quoted code at that moment.

The hash is what replaces the cursor. When the code under a topic changes, the entry is marked "changed since you understood it", whoever made the change and whenever it happened.

The map is a plain file the reader can open and correct, because it will sometimes be wrong. A question asked is evidence of interest, not proof of understanding.

### Lenses

| Lens              | Question it answers                               |
| ----------------- | ------------------------------------------------- |
| Catch up          | What differs from what I understood               |
| A piece of work   | What did this task, branch or pull request do     |
| A person or agent | What did my collaborator change                   |
| An area           | What do I need to know to work in this part today |
| A decision        | Why is it this way                                |
| A time range      | What happened in the last two weeks               |

### How the depth is chosen

| State of the topic for this reader | What the answer does                                             |
| ---------------------------------- | ---------------------------------------------------------------- |
| Never met                          | Explains from the top in a few sentences and offers to go deeper |
| Understood, code unchanged         | Collapses to one line                                            |
| Understood, code changed           | Leads with what changed against what the reader knew             |
| Understood long ago                | Gives a short reminder first, then the changes                   |

When many topics have changed at once, such as after weeks away, the answer starts one level up: a summary of the whole, then the topics ranked by how risky and how new they are to this reader.

### Signals that update the map

- A question marks its topic as a gap. Its wording sets the level: "what is a write-ahead log" and "why sync per batch" call for different answers.
- Three buttons on every answer: "I know this", "too much", "go deeper".
- Code the reader wrote by hand counts as understood, when the record knows it was by hand.

## What stays deterministic

The agent explores freely, but three things are never left to the model. None of them needs a parser.

1. **Quotes are checked.** Every claim about code cites a file, a commit and the exact lines it relies on. A checker confirms that this text exists in that file at that commit. A card with a bad quote goes back to the model alone, and the reader never sees it. The rest of the reply stands. The model's own words are not checked, and the page says so once, at the top of the thread.
2. **Change facts come from git.** What changed, who changed it and when are read from git, never recalled by the model. The tool also computes whether every changed hunk in scope is covered by the explanation, and lists the ones that are not.
3. **The stores are append-only and written through tools.** The model adds a decision, a topic or an understanding entry by calling a tool that validates it. It never rewrites a store as free text. A correction is a new entry that replaces an old one, and the old one stays readable.

### A reply, as built

The model reads the project, then replies in its own words. It calls one tool, `show`, with the cards that need proof: claims, decisions, risks, diagrams and topics. ken checks each card alone. A turn in which the model called a reading tool is its working, and the page folds it into the steps. A turn in which it only wrote, or wrote and showed cards, is the reply, its cards after its words.

A reply about a change tells the story in a few sentences and backs the main point with a card. It says in one line whether there are decisions or risks worth a look. The reader asks for them, with two chips under the reply or in words. When risks of a change arrive, ken holds them for a second look: in the same session, the model checks each risk against the code and the later commits on the same files. It may withdraw a risk only with a quote of the line that rules it out, and the reader still sees the withdrawn risk with that line.

Live notes run in a chat of their own, so a note never sits in the thread the reader talks in.

Besides the quote check, ken runs these checks. An entry that says something is missing or untested names the text that would be there, and ken searches the head commit for it and refuses the entry if it finds the text. A risk that quotes the message of a commit made after the change is marked "Fixed since".

### Labels on every statement

A reader must be able to tell a recorded fact from a guess. Each statement carries one of these labels.

| Label            | Meaning                                                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recorded         | The reason was written down when the work was done: an agent or the owner logged the decision when it was made (slice 5), or the decision quotes its reason from a commit message. ken sets this label from the quote, never the model. |
| From the session | Read afterwards from a saved agent transcript, and quoted                                                                                                                                                                               |
| Inferred         | Reconstructed from the diff alone                                                                                                                                                                                                       |
| Found by search  | A relation between pieces of code, such as "this calls that", that the agent found by searching and did not prove                                                                                                                       |

Reasons generated after the fact are the weak point of this whole field. One source warns that decision records written from a finished codebase record what was decided and invent the why. The "inferred" label exists so the reader always sees when that risk applies.

### What the agent decides

Everything else is the agent's work: which files to read, how to group commits into a piece of work, what to name a topic, how to word an explanation, and which basic diagrams a high-level answer needs. Two runs may word the same answer differently. That is accepted for a personal tool, and the record stays stable because entries are only added.

### When to add a parser

Add one only as another tool the agent can call, such as "outline this file", and only after a measured failure calls for it. Likely triggers: quotes that break too often when code is renamed or moved, or exploration that costs too much on a large repository.

## Components

The new repository has six parts. Only the chat agent calls a model; everything else is plain code.

```mermaid
flowchart LR
  page["Page<br/>Chat on one side, cards with quoted code"]
  agent["Chat agent<br/>An aigent session with the companion plugin"]
  repo["Project repository<br/>Files and git history. Read only."]
  coders["Coding agents<br/>Any tool. Log a decision with one command."]
  checks["Three checks<br/>Quotes exist at the commit<br/>Change facts come from git<br/>Stores only grow"]
  subgraph stores["Stores"]
    record["Project record<br/>About the code, shared"]
    map["Understanding map<br/>Personal to the reader"]
  end
  page <-->|questions, answers, cards| agent
  agent -->|reads files, search, git| repo
  agent -->|every write is checked| checks
  coders --> checks
  checks --> stores
  stores -->|reads| agent
```

The chat agent reads the repository and the stores directly. Anything it or a coding agent writes to a store goes through the checks first.

| Part              | Job                                                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page              | A local web page. The chat streams on one side. Cards collect on the other: summaries, decisions and quoted code, each with its label.                                                          |
| Chat agent        | An `aigent` session with one plugin, run by a small local server that also serves the page. It answers questions, picks the depth from the understanding map, and writes entries through tools. |
| Exploration tools | Tools inside the plugin: read a file at a commit, search the code, read git history, diffs and blame. They never change the project.                                                            |
| Checks            | The quote checker, the git change facts with hunk coverage, and the validation of every store entry.                                                                                            |
| Stores            | The project record and the understanding map, as plain append-only files.                                                                                                                       |
| Decision command  | A small command that any coding agent can call during its work to log a decision. It writes through the same checks.                                                                            |

## Build order

There are seven slices. Each one ends with something the owner can run. The main claim is tested after slice 3, before the reader model is built.

| Slice                 | What it builds                                                                                                                                                       | Done when                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Ground             | The new repository in TypeScript with tests, and a settled way to use `aigent` from it                                                                               | A script starts an `aigent` session with one empty plugin and prints a model's reply                                                                                             |
| 1. Explore and check  | An `aigent` plugin with tools to read a file at a commit, search, and read git history and diffs; the quote checker; the hunk coverage check; a chat in the terminal | On a real repository, "what did this branch do" returns an answer where every claim has a quote that passes. A test shows a false quote is rejected. Uncovered hunks are listed. |
| 2. Project record     | The append-only store for pieces of work, decisions, topics and notes, with the tools that write to it. Lenses: a piece of work, a decision.                         | The record survives a restart. Asking the same question again reads the record instead of exploring again. Decisions carry the "inferred" label.                                 |
| 3. Page with chat     | A local server and a page: streaming chat on one side, cards on the other (summary, decision, quoted code, labels)                                                   | One command in any repository opens the page. The owner asks about a piece of work and gets cards with checked quotes.                                                           |
| 4. Understanding map  | The map, the three buttons, the depth rules, and detection of changed topics. Lenses: catch up, an area.                                                             | A topic the owner understood collapses to one line the second time. Editing its code marks it as changed. The map file can be read and corrected by hand.                        |
| 5. Recorded decisions | A small command any coding agent can call to log a decision, and one instruction line for a project's `AGENTS.md`. Then a reader for one tool's saved transcripts.   | A decision logged by an agent during a task shows on the page as "recorded". One from a transcript shows as "from the session" with its quote.                                   |
| 6. Following up       | A list of what is open: decisions that need the owner's opinion, and changed topics not yet looked at. Lenses: a person or agent, a time range.                      | After a collaborator's commits, the page shows their changes to topics the owner knew, and nothing about topics the owner never met.                                             |

### The checkpoint after slice 3

The owner takes three to five real pieces of agent work and asks about each one twice: once in the companion, once in a plain coding-agent chat. The companion should win on at least one of these, and lose on none:

- the owner finds a decision or a risk the plain chat did not surface;
- the owner trusts the answer without opening the diff, because the quotes are there;
- the owner can come back to the answer the next day and find it.

If it does not win, change the design before building slices 4 to 6.

### Notes for the agents doing the work

- Slice 0 has a known obstacle. The `aigent` README says it cannot be installed as a dependency yet: its package is private at version 0.0.0 and points at TypeScript files, which Node will not load from `node_modules`. Issue 76 in the `aigent` repository tracks this. Either fix the packaging there first, or run `aigent` from a checkout beside the new repository.
- Test each slice on a repository with real agent-written history in more than one language. The owner's own repositories qualify.
- Keep the stores as plain files until a measured need says otherwise. A database is not needed for one developer.

## Risks

| Risk                                               | How it shows                                                 | How to test or limit it                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| It is no better than a plain chat                  | The owner keeps asking the coding agent directly             | The checkpoint after slice 3                                                                                                                                             |
| A quote is real but the sentence about it is wrong | A checked answer that still misleads                         | The quote check proves the code exists, not that the claim is true. Show the quote beside every claim so the reader can judge. Do not describe answers as verified.      |
| Inferred reasons are invented                      | A confident "why" that nobody decided                        | The "inferred" label, and slice 5, which replaces guesses with recorded decisions                                                                                        |
| Topics drift                                       | The same part of the code gets two names, and the map splits | The agent must look up existing topics before it creates one. Count duplicate topics on a real repository after slice 2.                                                 |
| Quotes break on harmless edits                     | Topics marked as changed after a rename or a reformat        | Measure how often this happens in slice 4. If it is frequent, compare with whitespace ignored, then consider the parser tool.                                            |
| Exploration is slow or costly                      | Long waits, large model bills                                | Notes cached by content hash. Record tokens and seconds per question from slice 1. One source reports that search-only agents struggle past about 400,000 lines of code. |
| The map misjudges the reader                       | Answers that are too shallow or too deep                     | The three buttons, and a map the reader can edit. Few questions per session means the map learns slowly; accept that at first.                                           |
| The record's own files pollute the history         | The tool explains its own bookkeeping commits                | Exclude the record's directory from every change fact                                                                                                                    |
| Model provider limits                              | A chosen model cannot follow the tool rules                  | Run the slice 1 test on at least two models, one of them open-weight                                                                                                     |

## Open questions for the owner

Each has a suggested answer, so work can start without waiting.

- [ ] **What is it called?** The plan says "the companion". The repository and the command need a real name before slice 0.
- [ ] **How does the new repository use `aigent`?** Suggested: fix the packaging in `aigent` first (issue 76), because every later slice depends on it.
- [ ] **Where does the project record live?** Suggested: in a directory inside the project's repository, committed, so a collaborator and coding agents can read the decisions. The alternative is the developer's home directory, which keeps the project's history clean but hides decisions from everyone else.
- [ ] **Where does the understanding map live?** Suggested: in the developer's home directory, never committed. It is personal, and a collaborator must not overwrite it.
- [ ] **Which model runs the chat by default?** The code of the project is sent to that model's provider. For private projects the owner should choose the provider deliberately.
- [ ] **Which coding tool's transcripts are read first in slice 5?** Suggested: Claude Code, since the owner uses it most.
- [ ] **Is "following up" understood correctly?** The plan reads it as two things: the tool keeps tracking the work as commits land, and it brings open items back to the owner.

### Working answers

The owner has not answered these questions yet. Work started on 2026-11-15 with the answers below. Each one can be changed later.

| Question                          | Working answer                                                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                              | `ken`, the name of the repository. The command is `ken`.                                                                                                                                                          |
| How ken uses `aigent`             | `aigent` gains a build step that packs it into a tarball (issue 76). ken commits that tarball under `vendor/` and installs it from there, because both repositories are private and there is no package registry. |
| Where the project record lives    | In `.ken/` inside the project's repository, committed.                                                                                                                                                            |
| Where the understanding map lives | In `~/.ken/`, never committed.                                                                                                                                                                                    |
| Default chat model                | None. ken refuses to start until the owner names a provider and a model.                                                                                                                                          |
| First transcripts to read         | Claude Code.                                                                                                                                                                                                      |
| "Following up"                    | Read as the plan reads it.                                                                                                                                                                                        |

### Answered by the owner

The owner answered these on 2026-11-16, after the sixth round of the test.

| Question                           | Answer                                                               |
| ---------------------------------- | -------------------------------------------------------------------- |
| The second look at risks           | It stays on by default for an answer about a change. Changed on 2026-11-17, below. |
| Leading indentation in a quote     | The quote check stays strict about it.                               |
| Reading saved sessions             | On by default. `KEN_SESSIONS=off` turns it off.                      |
| own-your-diff in ken               | Not set up.                                                          |
| The public page                    | Not published for now.                                               |

The owner chose these on 2026-11-17, after saying the answers felt scripted and lacked the high level.

| Question                    | Answer                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| How ken replies             | Talk first. The model replies in its own words and shows a checked card only where a claim needs proof.   |
| Decisions and risks         | Risks on ask. A reply about a change gives the story and a one-line hint; the reader asks for the rest. The second look runs on the risks when they come. |

## Out of scope for the first version

- Teams, accounts, sharing and any hosted service.
- A parser, a code index, or proven call graphs.
- Changing code. The companion's tools only read the project; the only files it writes are its own stores.
- Quizzes, or any gate before a push or a merge.
- Testing the reader, for example by asking them to predict what the code does.
- Recording full agent sessions. Other tools do this; the companion reads what they save.
- Large diagrams, such as a full call graph or a map of every file. A diagram in an answer stays basic: a few boxes and arrows that support the high level.
- Editor plugins.

## Sources

The landscape comes from web searches on 15 November 2026. Most product claims are the vendors' own and were not tested. The search results were read as summaries; the pages themselves were not all opened.

The problem:

- [Addy Osmani, Comprehension debt](https://addyosmani.com/blog/comprehension-debt/)
- [Storey, From Technical Debt to Cognitive and Intent Debt](https://arxiv.org/abs/2603.22106)
- [Anthropic, How AI assistance impacts the formation of coding skills](https://www.anthropic.com/research/AI-assistance-coding-skills)

Recording what agents did:

- [Entire](https://docs.entire.com/)
- [SpecStory](https://github.com/specstoryai/getspecstory)
- [Git AI](https://usegitai.com/docs/how-git-ai-works)
- [Agent Trace compared with Entire](https://www.ronaldtebrake.nl/blog/git-blame-intent-aware-agents/)
- [Agent Decision Records](https://www.me2resh.com/blog/agent-decision-records)
- [Decision records with Codex CLI, including the warning about invented reasons](https://codex.danielvaughan.com/2026/04/28/codex-cli-architecture-decision-records-adr-automated-governance/)

Making a change readable:

- [Stage](https://news.ycombinator.com/item?id=47796818)
- [Haystack](https://news.ycombinator.com/item?id=45201703)
- [Graphite Code Tours](https://daily.dev/posts/introducing-code-tours-a-new-way-to-review-u0cxutiqm)
- [Devin Review](https://docs.devin.ai/work-with-devin/devin-review)

Explaining a codebase, and teaching:

- [Windsurf Codemaps](https://cognition.com/blog/codemaps)
- [Seven tools for codebase understanding, including the 400,000-line claim](https://ssojet.com/blog/ai-codebase-understanding-tools)
- [Understand-Anything](https://dev.to/arshtechpro/understand-anything-turn-any-codebase-into-an-interactive-knowledge-graph-37ed)
- [Claude Code output styles](https://code.claude.com/docs/en/output-styles)

Checking and measuring understanding:

- [SlopBlock](https://slopblock.pro/)
- [pr-quiz](https://github.com/dkamm/pr-quiz)
- [LACY, code tours with quizzes for onboarding](https://arxiv.org/pdf/2603.25391)
- [CodeScene knowledge distribution](https://codescene.io/docs/guides/social/knowledge-distribution.html)
- [The Substrate Collapse, on authorship-based knowledge measures](https://arxiv.org/pdf/2606.20882)

This is one of the four verdicts of round 5 of the checkpoint after slice 3: a fresh judge compared ken's answers with a plain coding-agent chat on the three pull requests that were unseen in round 4, with Claude Opus on both sides.
It was run on 16 November 2026, with ken at commit bd2d2d1.
An AI judge scored it; the owner has not. The text is the judge's, unchanged: the prose check asked for no edits.

# Verdict: ken against a plain chat on pull requests #101, #99 and #96

## Result in short

- **Does ken win at least one criterion and lose none? No.** ken wins B and C. ken loses A.
- **A (finds the other missed):** plain wins on #101 (narrowly) and #99 (clearly). ken wins on #96 (narrowly). Taken together, plain wins A.
- **B (trust without opening the diff):** ken wins on all three. This is the clearest win.
- **C (find it tomorrow):** ken wins on all three, by construction. I did not reopen a stored answer myself.
- **Accuracy:** close. Plain made two false statements, one of them a false reassurance. ken made none, but its first risk on #99 is not real today, and one quote on #96 points at the wrong line.
- **Completeness:** plain on #101 and #99, tie on #96.
- **Readability and cost:** plain, on all three.
- **The second pass** earned its cost on one pull request of three. It took 28% of ken's time and 54% of its input tokens.
- **The risk labels:** "Not checked outside the change" was honest every time. "Checked in the code" means "a quote sits on an untouched line". It does not mean the risk was verified. One label claims more than its quote shows.
- **No diagram** appears in any of the three ken files, so I could not judge it.
- ken's designers had read an earlier verdict on these same pull requests. The loss on A therefore weighs more than it would on unseen work.

## How I checked

For each pull request I read the full diff (`git diff M^1 M`) and every commit message, then read the code around it: `src/engine.ts`, `src/pi.ts`, `src/hooks.ts`, `src/eval/checks.ts`, `package.json`, the CI workflows, the live test, and pi 1.3.0 in `node_modules`. I wrote my own list of decisions and risks before I opened either answer. Then I checked eight to ten claims per answer by hand against the code, and I checked each of ken's quoted lines that a risk or a disputed decision rests on. I changed nothing in the repository. I read only the six answer files and the brief.

## The table

| PR | A | B | C | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #101 | plain, narrowly: the reporting channel may not exist | ken: every risk points at a line | ken: stored | ken, narrowly: plain miscounts later PRs | plain: ken missed two things | plain: half the length | plain: 1–3 min; ken 218 s, 511k tokens in |
| #99 | plain, clearly: four real finds, ken none of weight | ken: but its first risk's label overclaims | ken: stored | tie: plain has one false reassurance, ken's first risk is not real today | plain | plain | plain: ken 164 s, 399k tokens in |
| #96 | ken, narrowly: the `ran` event for a call that never ran | ken: one quote points at the wrong line | ken: stored | tie | tie: each missed two | plain, narrowly | plain: ken 199 s, 567k tokens in |

The plain files do not state their tokens. I only know they took one to three minutes each.

## Pull request #101: README, SECURITY.md, .env.example

**My yardstick.** Three new docs files, no code. Decisions: say "unreleased" first and give the exact failure; a quickstart that runs from a checkout; a tool mode table with the real limits; an env file that names only variables something reads, with the live-test lines commented out; a private reporting channel; a threat model that trusts plugins. Risks: the README copies numbers that nothing ties to the code; the "Report a vulnerability" button needs a repository setting that git does not show; at this commit a key in `.env` sat one title prefix away from 216 paid calls (fixed later in #107); SECURITY.md turns engine behaviour into public promises; `npm run eval` needs SSH access to a private repository.

**Accuracy.** Plain: I checked nine claims. One is false. It says "Two later PRs have already had to edit the README". Two later commits did (6aa93e3, b5e21ef), both in one pull request, #107. The rest hold, including the limits, the 216 calls and `maxCodeCalls` coming from #100. ken: I checked eight claims. None is false. "Rests on one call site in engine.ts" is true: `beforeToolCall` is invoked only at `src/engine.ts:414`.

**Completeness.** ken missed the reporting-channel risk and the decision to list only variables that are read, which the commit message states. Plain missed nothing of weight that ken had.

**A.** Both found: drift, paid live calls, the SSH limit, the promises in SECURITY.md. ken only (3): `AIGENT_LIVE_MODELS` is split without trimming (true, trivial); `.env` is ignored by git (true, trivial); the gate promise rests on one call site (a detail of a shared risk). Plain only (2): the reporting channel may not exist; the env-file decision. The reporting channel is the one find here that the owner must act on. **Plain, narrowly.**

**B.** Plain names files and commits and says "I checked these numbers against `src/` and they match". It quotes nothing. The owner cannot tell the checked claims from the wrong count. ken's risks each point at a line: `CONCURRENT_CALLS = 8`, the `test` script, the `git+ssh` pin. The quotes support their sentences. Two "recorded" labels are loose: decisions 1 and 3 quote a reason for having the file, not for the choice made in it. **ken.**

**Second pass.** It added the paid-calls risk, which is real and which plain also had. It rewrote three risks so that each points at code. Without it ken would have missed a risk plain found. It earned its 73 s here.

**Labels.** All five say "Checked in the code". Each quote does show code outside the change. The order is sensible.

## Pull request #99: late tools, calls pi rejects, call ids

**My yardstick.** Three fixes. A late tool called by its own name is now validated in the engine. Calls that pi answers with "Tool not found" get a record, a span and a count through a new port method, reported from pi's `tool_execution_end` event when the name is not in the last list handed to pi. Each call gets an engine id: the provider's id with `/` escaped, plus `#n` on reuse, seeded from the transcript on resume. Risks: engine ids no longer equal provider ids, so joins between the two break; the pi fix leans on pi 1.3.0's internals and on the `offered` set; the model gets no schema hint; old transcripts keep merged denials; undeclared calls emit no events; the first fix cannot be reached through pi at all.

Two things neither answer found. First, `dispatchRecover` in `src/eval/checks.ts` (lines 403–412) joins the transcript's provider ids against `tool_start` event ids, which are now engine ids. It is wrong whenever an id repeats, and it is still unfixed on `main`. Second, pi also answers a declared tool with invalid arguments itself, and that call still leaves no record, so the title "record calls pi rejects" covers less than it says.

**Accuracy.** Plain: nine claims checked, one false. It says "Inside the repo the joins are engine-to-engine ... so they still hold". The `dispatch-recover` check is a counter-example. Plain named the right risk and then told the owner it did not apply at home. ken: nine claims checked, none false. But its first risk reads "If pi does not wait, the unresolved record could land after ...". pi does wait: `agent.js` line 432 awaits every listener for every event. Plain checked this in `node_modules` and said so. ken left the question open and ranked it heaviest. **Tie.**

**Completeness.** ken missed: the `offered` set and what a pi upgrade does to it; that undeclared calls emit no events and run no gates; the untested cases; that plugins and transcripts see the id change, not only traces. Its closing note says it did not read the three new tests. Its quotes cover 4 of 18 changed hunks. **Plain.**

**A.** ken only (1): a loop other than pi now gets errors for bad arguments. That is the intent of the fix, and no such loop exists in the repository. Plain only (4): the `offered` dependence; thin undeclared calls; test gaps; the wider id mismatch. Plain also settled the await question that ken raised. **Plain, clearly.**

**B.** ken's four decisions are all "recorded", and all four rest on message lines that give the reason. The decision quotes show what the sentences claim. Plain cites commit hashes and identifiers but no lines, and its one false sentence looks exactly like its true ones. **ken**, with the label problem below.

**Second pass.** It rewrote one risk (old transcripts, now pointing at the `session__inspect` lookup) and added none. It did not settle the open question in risk 1. It did not earn its 47 s and 210k tokens here.

**Labels.** Risk 1 is marked "Checked in the code". Its quotes are a code comment about `message_end` and the line `if (closed()) return`. Neither shows whether pi awaits the listener. The label claims more than the quote shows. The heaviest risk is not first: the id mismatch should be.

## Pull request #96: lifetimes of calls, hook contexts and the session

**My yardstick.** Four fixes. A closed session rejects calls and enables. A call binds the run it started in. An abort during a gate is a third kind of result: no denial, no log, and the call ends as `error` without running. A hook's signal now also fires when the hook settles, and after that `log` and `state.update` throw. Risks: the signal fires on every normal return, which changes its meaning for plugin authors; a late write from detached work is an uncaught error in the host; a call aborted before it ran is reported as `ran` in the event and the span; observers cut off at close lose a write; tool contexts keep the old rule.

**Accuracy.** Plain: ten claims checked, none false. "48 commits have landed since" is right. ken: nine claims checked, none false. One quote is misplaced. Decision 5 says `Session.enable` checks its own closed flag and quotes `src/pi.ts` line 169. That line is the check in `prompt`. The check in `enable` is at line 208, with the same text. The checker passed it because the text exists. **Tie.**

**Completeness.** ken missed that close cuts off observers in mid-write, that an abort can hide a real gate error, and the test gaps. Plain missed the `ran` mismatch and the code-tool path. ken names seven decisions to plain's six. **Tie.**

**A.** ken only (4): the `tool_end` event, the span and observers say `ran` for a call that never ran, while the record says `error` (true, `src/engine.ts:538`, and reachable by any abort while a gate waits); nested calls from `core__run_code` skip the closed check and still write a record after close (true, minor, hard to reach through pi); the uncaught error can crash the Node process (a sharper form of a shared risk); timeout beats abort (trivial). Plain only (3): observers lose a write at close; an abort can hide a gate's own error; no direct test for the signal change. ken's first find is the only one of the seven that ordinary use reaches. **ken, narrowly.**

**B.** ken's five "recorded" decisions rest on message lines that give the reason. Risks 3, 4 and 5 quote untouched lines that show the code the risk rests on. **ken.**

**Second pass.** It added the code-tool path. Real, minor. Marginal for 46 s and 313k tokens.

**Labels.** Correct here. The two heaviest risks are marked "Not checked outside the change", which is honest: no plugin in the repository does detached work. The order is sound.

## Criterion C

ken stored each answer in the project record (5, 4 and 7 decisions, plus work, topic and note entries) and in a personal history. It can be reopened without a model. The plain chat leaves a transcript in a chat tool and nothing in the project. ken wins C on structure. The files show the stored counts. I did not test reopening.

## The verdict against the plan's rule

**No.** ken wins B and C and loses A.

- **Clearest win: B.** Every decision and risk carries a line the owner can see. Plain's one false reassurance on #99 shows the cost of the other way: nothing marks it apart from the true sentences.
- **Closest to a loss: A, and it is a loss.** Plain wins two of three, one of them clearly.
- **How sure on A.** I am sure ken does not win A. I am fairly sure, about four in five, that plain wins it and it is not a tie. A judge who only counted unique finds would get about 8 for ken and about 9 for plain: nearly level, leaning plain. Drop the trivial ones (untrimmed commas, an ignored `.env`, timeout order, a loop that does not exist) and it is about 3 for ken against 7 for plain. Weight makes the result plainer, it does not reverse it.

## What the structure added and what it cost

Both sides ran the same model, so the tool made every difference.

**Added.** Line-level quotes that were checked to exist. A "recorded" or "inferred" label that was right on 10 of 12 recorded decisions and loose on 2. A fixed form for decisions (question, choice, reason, rejected option, how hard to undo). Coverage numbers and a closing note that say what was not read. Storage.

**Cost.** About one more minute each and 0.4 to 0.57 million input tokens. Answers twice as long. And, in my judgment, less free investigation. Plain read pi in `node_modules`, checked the README's numbers against `src/`, looked at later history, and looked for missing tests. ken's closing notes say it read no test bodies on #99 or #96, and its quotes cover 4 of 18 and 10 of 37 hunks. The form rewards what can be quoted from the repository at that commit. Risks that live elsewhere fell out: a GitHub setting, pi's internals, a test that does not exist.

**The second pass.** Over the three it added two risks and rewrote four. One added risk mattered (#101), and it only brought ken level with plain. One was minor (#96). It found none of the four things that decided A against ken. It cost 165 s of 581 s and 793k of 1,477k input tokens. It earned its cost on one pull request of three.

**The labels.** Trust "Not checked outside the change". Read "Checked in the code" as "a pointer to untouched code exists", not as "verified". On #99 risk 1 the pointer is a comment and the risk text itself says the matter is open.

**The "used elsewhere" list.** It led to one minor find (#96, the `runCall` path). It searches names, not values, so it could not see that call ids are compared in `src/eval/checks.ts`. On #96 it lists `onEnable` as "added", which the change did not do.

## ken's three most important weaknesses

1. **It finds fewer real risks than a free chat on the same model.** On #99 plain found the `offered` dependence, the missing events, the test gaps and the wider id mismatch. ken found none of them, and its one unique risk concerns a loop that does not exist.
2. **It leaves a question open that the code answers, and ranks it first with a "Checked" label.** #99 risk 1: "If pi does not wait ...". `agent.js` awaits every listener. Plain read the file and said so in one sentence.
3. **A passing quote check can hide a wrong pointer or a loose label.** #96 decision 5 quotes `src/pi.ts:169`, the check in `prompt`, for a sentence about `enable`. #101 decision 3 is "recorded" on a line that says why a README exists, not why it opens with the status.

## Three things the plain chat did better

1. **It looked outside the repository's lines.** #101: the "Report a vulnerability" button exists only if a repository setting is on, and git cannot show it.
2. **It settled questions by reading dependencies.** #99: "I checked pi 1.3.0 in `node_modules`: it awaits listeners."
3. **It said what is not tested, and it was faster to read.** #99: no test for native mode or for an id that already holds `%2F` or `#`. #96: no test for the signal firing on a normal return. Each answer is about 5 KB against ken's 10 to 13 KB.

## What I would change first

Change the job of the second pass. Today it tidies and reorders the risks the first pass wrote. Make it hunt and settle instead:

- Every risk that says "if" must be settled by reading the code that decides it, dependencies in `node_modules` included, or be shown as an open question and never ranked first.
- "Checked in the code" must need a quote of code, not a comment, that the risk rests on.
- The pass must ask a fixed set of questions that the first pass skipped on all three pull requests: who compares or parses a value the change reshaped (ids, records, events), what the change leans on outside the repository (a setting, a dependency's behaviour), and which new behaviour has no test.

That targets the criterion ken lost, with the pass that already costs half the tokens.

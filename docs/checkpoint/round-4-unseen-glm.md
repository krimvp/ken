This is the third verdict of round 4 of the checkpoint after slice 3: a fresh judge compared ken's answers with a plain coding-agent chat on the same three unseen pull requests, ken on the glm-5.3 model and the plain chat on Claude Opus.
It was run on 16 November 2026, with ken at commit ba270bf.
An AI judge scored it; the owner has not. The text is the judge's, except two long dashes, inside quotes of ken's closing note, that the prose check turned into commas.

# Verdict: ken on glm-5.3 against a plain chat on Claude Opus, pull requests #101, #99, #96

## Result in short

- Answer to the plan's rule: **no**. ken wins B and C. ken loses A. The rule needs a win on one and a loss on none.
- A (finds the other side missed): the plain chat wins on all three pull requests. Clear on #101 and #99, narrow on #96. ken surfaced no decision or risk on #101 or #99 that the plain chat lacked.
- B (trust without opening the diff): ken wins on all three. Every quote I looked up exists, and almost all support their sentence. The plain chat names commits, files and symbols but shows no lines.
- C (find it tomorrow): ken wins by structure. It stored each answer in a project record and a history. The plain chat leaves a chat.
- Clearest win: B. Closest to a loss among the wins: B as well, because one inferred reason is false and the unchecked closing notes carry claims that are wrong. A is not close: it is lost.
- The second pass used half of all input tokens (1,546,287 of 3,074,164) and added two entries. One is real and the plain chat had it too. One is not a real risk. It did not earn its cost.
- The two sides ran on different models. The A loss comes from the tool and the weaker model together. The B and C wins come from the tool's structure, and they held on the weaker model.
- First change: point the risk search outside the diff (readers of the changed values, and later history of the same files), and spend the second pass's budget on that.

## How I checked

I listed the merges with `git log --merges --first-parent main` and read `git diff M^1 M` and every commit message for bb7ae10 (#101), 0dcc447 (#99) and 169d23c (#96). For each pull request I wrote my own list of what it did, its decisions and its risks before I opened either answer. I read code around the claims: `src/engine.ts`, `src/hooks.ts`, `src/pi.ts`, `src/eval/checks.ts`, `test/live.test.ts`, `package.json`, the CI workflows, the new tests, and pi 1.3.0 in `node_modules`. Then I read the six answer files in full and checked at least six claims per answer by hand, including stated reasons and every stated risk. I looked up 30 of ken's quoted lines with `git show <commit>:<file>`; all 30 exist as quoted. I read no skill or instruction file, no other answer and no earlier verdict. I changed nothing in the repository. I could not test reopening a stored ken answer; C rests on what the brief says and on the "Stored in the project record" line in each ken file.

## The table

| PR | A | B | C | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #101 | plain: 3 real finds ken lacks, ken 0 | ken: quotes show the constants; plain says "I checked" | ken: stored | plain, narrow: ken's reason for decision 4 is false; plain miscounts later PRs | plain: live-suite hazard, promises in SECURITY.md | plain: 23 lines against 166 | plain on time (1 to 3 min against 238 s); money not comparable |
| #99 | plain: 3 real finds ken lacks, ken 0 | ken: all checked quotes support their sentences | ken: stored | ken, narrow: plain says in-repo joins all hold, one does not | plain: scope of fix 1, no events for undeclared calls | plain: 26 lines against 232 | plain on time (against 295 s) |
| #96 | plain, narrow: 4 real against 2 real and 2 weak | ken: 7 recorded reasons rest on real message lines | ken: stored | plain, narrow: ken's second-pass risk is misframed | plain, narrow | plain: 28 lines against 297 | plain on time (against 307 s) |

## Pull request #101 (docs: README, SECURITY.md, .env.example)

### My yardstick

What it did: three new files, no code. README (120 lines), SECURITY.md (28), .env.example (14). Three commits.

Decisions:
1. State plainly that aigent is unreleased and cannot be installed, with the exact error and issue #76.
2. The example runs from a checkout and imports `aigent` by name.
3. A tool-mode table with current limits. Commit ae05f73 then added the `maxCodeCalls` sentence, because #100 (merged minutes earlier) had brought that cap in.
4. `.env.example` names only what the scripts and the live test read. The two `AIGENT_LIVE_*` lines stay commented out because an empty value gives one empty model id.
5. SECURITY.md: private reporting through GitHub, plugins trusted, model and tool output untrusted, just-bash bugs out of scope, resume does not trust the transcript.

Risks:
1. The docs copy numbers, defaults, model names and workflow triggers from code. Nothing checks them.
2. The "Report a vulnerability" button exists only if the repository setting is on. Git cannot show that.
3. SECURITY.md makes absolute statements ("every tool call in every tool mode"). Each is now a public promise.
4. At this commit `npm test` matched `test/live.test.ts`, and that file loads `.env`. Only the `--test-skip-pattern=^live:` flag kept 216 paid calls from running. The README tells the reader to put the key in `.env`. Commit b5e21ef in #107 later fixed this.
5. The README example is run by no test.

I checked the README numbers against the code: 30,000, 64, 8 at a time, 64 MiB, 256 KiB, 65,536, 8,000, 1 MiB, the three default live models, the CI matrix and both cron lines. All match.

### Accuracy

Plain chat, claims checked: file sizes and commit count (true); merge date and hash (true); numbers match `src/` (true); ae05f73 added the cap that #100 brought in (true); `npm test` loaded the live file, 216 calls, fixed by b5e21ef in #107 (true: 36 scenarios, 3 models, 2 modes); the reporting button needs a setting (true); eval needs SSH to krimvp/multeval (true, `requirements.lock.txt` has `git+ssh` lines); "Two later PRs have already had to edit the README" (wrong: two later commits, 6aa93e3 and b5e21ef, both in #107).

ken, claims checked: decisions 1, 2, 3 (true, and each reason is in the quoted message lines); decision 4's reason, "The first version of the table capped a run without naming the session option" (false: the first version did not mention a cap at all; ae05f73 added the sentence); risk 1 (true); risk 2 (true, but the numbers are in the README, not in SECURITY.md as the sentence implies); statement 7 "Every number the docs publish matches the code" (true, but its quotes cover five of the numbers); statement 8 (true, the `split(',')` line is quoted). The unchecked summary repeats "every published number matches the code".

### Completeness

Plain chat missed: the example is untested. ken missed: the live-suite hazard, the promises in SECURITY.md, and why ae05f73 exists. ken's closing note admits it did not check the example.

### Criterion A

ken only: nothing. Its two risks (reporting channel, drift) are both in the plain answer.

Plain only, three: the live-suite hazard (real, costs money, later fixed, so the owner would want it); SECURITY.md statements become promises (real, soft); the eval needs private SSH access (real, minor, the README says it).

Plain wins. The first find alone outweighs the rest.

### Criterion B

Plain cites the three commits, ae05f73, b5e21ef and file names. It quotes no lines. "I checked these numbers against `src/`" asks for trust.

ken, five elements judged: decision 1's reason (message lines 3 and 4 give the reason: yes); decision 3's reason (message lines plus the comment in `.env.example`: yes); decision 4 (labelled inferred, no quote under the reason, and the reason is false; the label warned the reader); risk 2 (the two quotes show a claim and a constant; they cannot show that nothing ties them: partial); statement 7 (five constants quoted, each supports its number: yes). "Recorded" is right on all three recorded decisions.

ken wins B. The owner can see the constants without opening a file.

### Second pass

Added 0 entries. Cost 44.8 s and 544,783 input tokens, which is 58% of this answer's input. Not earned.

### Diagram

None in this answer. None was needed for a docs change.

### Readability and cost

Plain: 23 lines, read in two minutes. ken: 166 lines as text. Statements 4 and 5 repeat decision 2; README line 69 is quoted in full twice. ken: 237.9 s, 940,791 tokens in, 59,373 out. Plain: one to three minutes, tokens not stated.

## Pull request #99 (late tool validation, calls pi rejects, engine call ids)

### My yardstick

What it did:
1. `resolve` now sends a plugin tool the mode never declares through `resolveTarget`, so its args are validated (c4270de).
2. The pi adapter tracks the names it last handed pi (`offered`). On `tool_execution_end` for any other name it calls a new port method, `undeclaredCall`, which writes an `unresolved` record, a span and a count, and runs nothing (5af5f33).
3. The engine gives each call its own id: the provider's with `/` as `%2F`, plus `#<n>` from 2 on reuse. Resume seeds the used ids from records (5aa580a).

Decisions: validate in the engine with the same check as `core__call_tool`; report after the fact because pi 1.3.0 has no catch-all tool and no earlier hook; mint an engine id instead of storing denials on the call record (the message names that alternative and why it lost); keep old transcripts unchanged.

Risks:
1. Engine ids no longer equal provider ids. pi's messages keep the provider id. Any join between the two breaks when an id repeats or holds `/`. One such join is in the repository: `dispatchRecover` in `src/eval/checks.ts` matches `toolCall` ids from messages against `tool_start` and `tool_end` event ids.
2. Fix 1 cannot be reached through pi. pi answers such a call itself. It guards other loops only.
3. The model gets pi's bare "Tool not found" with no schema hint.
4. The adapter depends on pi 1.3.0 internals: the event fires for rejected calls, listeners are awaited, `offered` mirrors pi's list.
5. An undeclared call gets no `tool_start` or `tool_end` event and passes no gate.
6. Old transcripts keep merged denials.
7. Gaps in tests: native mode with enable and call in one response; ids that already hold `%2F` or `#`.

### Accuracy

Plain chat, claims checked: the id scheme (true); resume seeds from call, delegation and denial records (true, engine.ts line 358); pi awaits listeners (true, `agent.js` lines 432 to 433); `offered` is refreshed at prompt start and in `prepareNextTurnWithContext` (true); `undeclaredCall` emits no events and runs no gates (true, `runCall` returns before `emit`); fix 1 "only matters for a loop other than pi" (true); "Inside the repo the joins are engine-to-engine ... so they still hold" (false: `dispatchRecover` joins message ids with event ids). Two reasons are the chat's own inference and are not marked as such: why `%2F` plus `#n` and not a counter, and why validation sits in the engine. Both are plausible.

ken, claims checked: decisions 1, 2, 3 and their reasons (true, each reason is in the quoted message lines); risk 1 (true); risk 2 (true); risk 3 (true); risk 4 (true); statement 5 (true); statement 6 (true, three test titles quoted). No false checked claim. The unchecked closing note says "I verified the unquoted external uses ... the transcript parser, and found nothing in them to flag". The parser's caller `dispatchRecover` is exactly the mixed join. That claim sits where the checker does not look.

### Completeness

Plain chat missed: the in-repo mixed join (and denied it). ken missed: the same join; that fix 1 is unreachable through pi; that undeclared calls emit no events and pass no gates; the test gaps.

### Criterion A

ken only: nothing. All four risks and all three decisions are in the plain answer.

Plain only, three: fix 1 protects only a loop other than pi (real, an owner should know one of three fixes is not reachable today); undeclared calls are invisible to a host that watches events (real, moderate); the untested cases (real, minor).

Plain wins. Its false reassurance about in-repo joins lowers the worth of its first risk but does not hand ken a find.

### Criterion B

Plain cites commit hashes, function names and `node_modules`. No lines quoted.

ken, five elements judged: decision 1's reason (message lines 3 to 5: yes); decision 3's reason (message lines 11 and 12 name the alternative and why it lost: yes); risk 3 (GLOSSARY lines plus `src/pi.ts` line 516, where the captured chat message keeps `c.id`: yes, a well-chosen quote); risk 4 (two code comments and a message line: yes); diagram arrow 6 (the two `append` lines: yes). All three "recorded" labels are right.

ken wins B. Coverage is stated honestly: 11 of 18 hunks quoted.

### Second pass

Added one risk: the dependence on pi 1.3.0 behaviour and on `offered`. Real. It matters at the next pi upgrade. The plain chat had the same risk with more detail. Cost 64.4 s and 543,898 input tokens (42% of this answer's input). Earned in part: one real risk, at a high price.

### Diagram

Three boxes: pi loop, Engine, Record log, with two arrows from pi to the engine (declared calls, undeclared calls). It is true to the code. It shows the one thing that is hard to see in the diff: there are now two entry paths. It leaves out the id step. Small help, not decoration.

### Readability and cost

Plain: 26 lines. ken: 232 lines as text. Statements 2 to 5 restate decisions 1 to 3; the `callIdFor` block is quoted in full twice. ken: 294.5 s, 1,296,853 tokens in, 65,697 out. Plain: one to three minutes.

## Pull request #96 (lifetimes of calls, hook contexts and the session)

### My yardstick

What it did, four commits:
1. After close, `callTool` returns an error result, `enable` and `beginPrompt` throw. `Session.enable` checks its own flag.
2. `runCall` binds `owner = run`, so a late call stays out of the next prompt's turns.
3. `Settled` gains `aborted`. An aborted gate denies nothing and logs nothing. A call aborted or closed during its gates ends as `error` without running its tool.
4. A hook's signal also fires when the hook settles. After that the context's `log` and `state.update` throw. Tool contexts are unchanged.

Decisions: the close signal is the session's lifetime; two closed flags because the adapter waits for idle before it closes the engine; reuse `error` instead of a new outcome so parsers stay unchanged; throw instead of a no-op; tool contexts left as they were; timeout wins over abort.

Risks:
1. Plugin authors: a hook's signal now fires on every normal finish, so work tied to it is cancelled, and a detached callback that logs or writes state throws as an uncaught error. In Node that can end the host process.
2. An aborted call is `error` in the record, the same as a tool that ran and failed. The `tool_end` event even reports `outcome.kind: 'ran'` for a tool that never ran; `src/eval/checks.ts` line 455 counts that as ran.
3. Tool contexts stay live, so a tool can still write state after close.
4. A late call now appears in no turn snapshot at all.
5. A gate that throws for its own reason during an abort is filed as aborted: not logged, not counted.
6. A hook running when close fires loses its next state write.
7. A call after close leaves no record, span or event.
8. No test closes the session while a gate waits.

### Accuracy

Plain chat, claims checked: the four fixes (true); `Session.enable` reason (true, in the message); "Hook signals now fire on every normal finish" (true, `settled.abort` in the `finally`); observers run with `closing` and lose a write at close, `onSessionEnd` does not (true: default `extra = [closing]`, and `onSessionEnd` passes `[]`); "aborted can hide a real error" (true, hooks.ts line 48); aborted and failed look the same in records (true); a call after close leaves no trace (true, the check returns before `runCall`); "48 commits have landed since" (true, `git rev-list --count` gives 48). No false claim found.

ken, claims checked: decisions 1 to 7 and their reasons (true, each reason is in the quoted message lines); decision 8's reason, "a tool has no verdict to contradict" (the model's own, labelled inferred, plausible, not in any message); risk 1 (true in substance; the wording "the throw reaches no host: in Node an uncaught timer error can kill the process" mixes the two cases the design doc keeps apart); risk 2 (true); risk 3 (true: the abort test uses a run signal, the close test closes before the call); risk 4 (true but trivial: the `close()` comment two lines below says enables reject); risk 5 (the code order is as quoted, but the sentence calls it "the one case where the new rule ... does not hold"; a gate whose timeout fired first has timed out, and the rule says a timeout denies. Misframed, not a risk).

### Completeness

Plain chat missed: tool contexts as a risk (it has them as a decision); the missing close-during-gates test; that the uncaught error can end the process. ken missed: aborted and failed calls look the same; an abort can hide a gate failure; a hook cut off by close loses its write; a call after close leaves no trace; the signal firing on normal finish as a thing that cancels work. Both missed: the `'ran'` event for a tool that did not run, and the late call that lands in no turn.

### Criterion A

Shared: the detached-write hazard and all six decisions.

ken only: tool contexts left open, stated as a risk (real, moderate; plain has the fact but not the warning); no test for close during gates (real, minor); the stale `enable` comment (trivial); timeout before abort (not a risk). Two count.

Plain only: aborted and failed calls are the same in the record (real, moderate); abort hides a real gate failure (real, minor); close cuts off an observer's write (real, minor); a call after close leaves no trace (real, minor); the signal fires on every normal finish and cancels work tied to it (real, the fuller half of the shared hazard). Four to five count.

Plain wins, narrowly. Severity is level; the count is not. Two of ken's five risks pad the list.

### Criterion B

Plain cites four commit hashes, names functions, and quotes the result text. No lines.

ken, five elements judged: decision 2's reason (message lines 6 to 8 state throw against no-op: yes); decision 7's reason (message lines 6 and 7, plus the two `pi.ts` lines that show the wait: yes); risk 1 (the `settled.abort` line and the `throw` line: yes); risk 3 (one code line and one test title; a missing test cannot be quoted: partial); diagram arrow 11 (line 531: yes). All seven "recorded" labels rest on a message line that gives the reason. Coverage is 16 of 37 hunks, stated.

ken wins B.

### Second pass

Added one risk, number 5. It describes code order correctly and calls it a hole. It is the documented rule. It does not matter to the owner. Cost 57.2 s and 457,606 input tokens (55% of this answer's input). Not earned.

### Diagram

Six boxes and five arrows: entry points and `runCall` both point at "Session close"; `runCall` to Gates to `settle` to Hook context. Each arrow's quote supports it. It shows where each lifetime is checked. Two arrows point at "Session close" from the code that reads it, which reads backwards on first look. The run's lifetime (`owner = run`) has a box quote but no arrow. Some help.

### Readability and cost

Plain: 28 lines, and it says which risk is the biggest. ken: 297 lines as text. Statements 2 to 6 restate decisions 1, 3, 4, 5, 6 with the same quotes. Eight decisions and five risks have no order of weight. ken: 307.1 s, 836,520 tokens in, 70,651 out. Plain: one to three minutes.

## Criterion C, all three

ken: each answer went into a project record (for #96: 1 work, 3 topics, 3 notes, 8 decisions) and a personal history. The brief says it can be reopened without a model. I did not test that. The plain chat leaves a chat transcript: findable only if the developer keeps and searches the chat. ken wins C on all three.

## Verdict against the plan's rule

**No.**

- A: lost. The plain chat wins on #101, #99 and #96. Over the three, the plain chat has 10 to 11 real finds that ken lacks. ken has 2 that the plain chat lacks, both on #96.
- B: won, on all three. This is the clearest win.
- C: won, by structure.
- Closest to a loss among the wins: B. One inferred reason is false (#101, decision 4). Two closing notes and one summary carry claims the checker never sees, and one of them is wrong (#99).

The models differ. A weaker model that reads less widely explains part of the A loss. The tool also shapes it: ken's quotes and its second pass stay at the merge commit and inside the diff's neighbourhood, and the plain chat's best finds came from outside it.

## What the second pass added, over the three

- #101: nothing. 544,783 tokens in.
- #99: one real risk, already in the plain answer. 543,898 tokens in.
- #96: one entry that is not a real risk. 457,606 tokens in.

Total: 166.4 s of 839.5 s (20%), and 1,546,287 of 3,074,164 input tokens (50%). One useful entry. None of the plain chat's unique finds came out of it. It did not earn its cost.

## ken's three most important weaknesses on this model

1. **Its risk search stays inside the change and what the commit messages already say.** On #101 it missed that `npm test` loaded the live file while the README told the reader to put a key in `.env`; the plain chat found it and the fix (b5e21ef). On #99 three of four risks restate a sentence from the design doc or a commit message; risk 1's quote is the design doc line that states the risk. The "Used elsewhere" list is not followed: on #96 "A quote follows 0 of them" out of 11 names, and on #99 `ToolCallSnapshot` (11 places, the readers of the new id) is in the not-followed list.
2. **Claims outside the checked elements, and inferred reasons, can be wrong, and nothing catches them.** #101 decision 4: "The first version of the table capped a run without naming the session option". It did not mention a cap. #99 closing note: "I verified ... the transcript parser, and found nothing", while `dispatchRecover` joins the two kinds of id. #96 risk 5 calls documented behaviour "the one case where the new rule ... does not hold".
3. **Long, repetitive, unranked, and the second pass doubles the token bill.** #96 is 297 lines; statements 2 to 6 repeat decisions with the same quotes; risk 4 (a stale comment) sits beside risk 1 (can end the host process) with no order. Half of all input tokens bought one entry.

## Three things the plain chat did better

1. **It looked outside the diff.** #101: it read the test script and later history and found the live-suite hazard and its fix in #107. #99: "I checked pi 1.3.0 in `node_modules`: it awaits listeners".
2. **It said what a fix does not do.** #99: fix 1 "only matters for a loop other than pi"; `undeclaredCall` "emits no `tool_start`/`tool_end` session event and runs no gates". #96: "A call after close leaves no trace"; "Aborted and failed calls look the same in records".
3. **It was short and ranked.** #96: "This is the biggest behavior change for plugin authors" opens the risks. Each answer is under 30 lines.

It was not free of error: "Two later PRs" (#101) is one PR, and "the joins are engine-to-engine" (#99) is false for one check.

## What I would change in ken first

Replace the open second pass with a directed one, at the same budget or less. For each behaviour the change alters, make the model read the code that consumes it outside the diff (every name in the not-followed list, and readers of changed records, events, ids and signals) and state what each reader now sees, or "read, nothing found" with a quote. Give it the later history of the touched files, so a later fix to the same lines surfaces as a risk. Add one required question per fix: what does it leave undone or unrecorded. Then rank the risks, and drop any second-pass entry that only restates a commit message or a documented rule.

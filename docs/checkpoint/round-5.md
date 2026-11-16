This is one of the four verdicts of round 5 of the checkpoint after slice 3: a fresh judge compared ken's answers with a plain coding-agent chat on five pull requests ken had been tuned on, with Claude Opus on both sides.
It was run on 16 November 2026, with ken at commit bd2d2d1.
An AI judge scored it; the owner has not. The text is the judge's, unchanged: the prose check asked for no edits.

# Verdict: ken against a plain chat on five pull requests (#104, #102, #106, #103, #100)

## Result in short

- **#104, #102, #106 together: yes.** ken wins B and C. A is a tie. It loses none.
- **#103 and #100 together: no.** ken wins B and C. It loses A, narrowly.
- **All five together: no.** ken wins B and C. It loses A, narrowly. The plain chat found more risks that come from how the change is used.
- Clearest win: B. Every decision, risk and statement sits on quoted lines, and in my checks the quotes held up in about 26 of 30 elements.
- Closest to a loss: A. On the first three it is a tie that leans to the plain chat. On the last two and on all five it is a narrow loss.
- The second pass added five risks, all real. One of them is the heaviest risk of #104, which the plain chat found without a second pass. It used half of ken's input tokens. It earned its cost on #104, partly on #102 and #103, not on #106 and #100.
- The risk labels are mostly right. "Checked in the code" means "a quote points at a line the change did not touch". It does not mean "the risk was verified". Two of 18 such labels claim more than their quote shows.
- The plain chat was shorter, at least as accurate, and faster on three of five.
- None of the five is unseen work for ken. A loss on A here weighs more than a win would.

## How I checked

For each pull request I read the diff of the merge (`git diff M^1 M`) and the commit messages, and I read the code around the change where a claim needed it (core-tools.ts, engine.ts, pi.ts, tracing.ts, records.ts, checks.ts, scenario.ts, cli.ts, subject.ts, the tests). I wrote my own list of what each pull request did, its decisions and its risks before I opened either answer. That list is in `/tmp/claude-0/-home-user/1e29372b-17df-51a3-88ec-29ca8ac85041/scratchpad/judge6/yardstick-five.md`. Then I read the ten answer files in full and checked at least six claims per answer against the code, including stated reasons and every risk that only one side had. For ken I also checked five or more elements per answer for whether the quoted lines show what the sentence says. I read no skill or instruction file, as the brief asked, and nothing else in the answer folders. I changed nothing in the repository. I could not test criterion C myself: I judged it from what the brief says ken stores and from the "Stored in the project record" line in each ken file.

## The table

| PR | A (finds the other missed) | B (trust without the diff) | C (find it tomorrow) | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #104 | tie: both have the top risk; ken adds untested boot paths, plain adds a fragile test | ken: quotes hold; plain cites one file:line | ken: stored record | plain: ken's risk 2 gets the effect wrong (hedged) | tie | plain: 27 lines, same top risk | plain: ken 153 s, 320k tokens in |
| #102 | tie: plain has more small ones, ken has one interaction | ken: 8 decisions on message quotes | ken | tie: no false claim found on either | plain: work still grows, custom part type, key order | plain | plain: ken 221 s, 606k in |
| #106 | plain, narrow: seed not honoured, metric set changed, old runs stay weak | ken | ken | plain: ken's risk 6 is not real | plain | plain | plain: ken 260 s, 668k in |
| #103 | plain, narrow: retry deletes the kept evidence; needs multeval to pass timeout_s | ken | ken | tie | plain, slightly | plain | plain: ken 269 s, 640k in |
| #100 | plain, narrow: throttling can cause timeouts | ken | ken | tie: one slip each | plain, slightly | plain | tie on time (162 s); ken 442k in |

Plain chat cost was given only as "one to three minutes"; its tokens are not stated. ken's total for five: 1,064 s, 2.68 M tokens in, 108k out.

## My yardstick in brief

- **#104.** The worker posts `started`; the host arms the code's timer then. Boot has its own 10 s limit, which rejects. Heaviest risk: `core-tools.ts:105` still starts the tool calls' abort clock at the call, so the fix moved one clock of two. Others: a call can now last boot + timeout + grace; the clock starts when the host reads `started`; bash mode counts differently; the boot paths have no test.
- **#102.** Seven limits: no record on an unchanged state, one state per plugin per take, the log drops taken records, `maxToolResultChars` 50000, denial reason 1000, inspect shows 50, captured history 131072 and no image data. Risks: the 50000 default cuts results for every host, and also the results a script in `core__run_code` gets back; the history is still serialised in full on every request and the newest message can exceed the cap alone; transcripts lose state steps; the `respects` guard got looser.
- **#106.** `_judged` and per-step metrics, `respects` on errored prompts, wider version hashes, temperature and seed, a nonce in the leak mark, vacuous scenarios refused, a pin test. Risks: versions and rates no longer compare with earlier results; per-step names are declared from shipped scenarios but scored from the recorded one; a seed is recorded as asked, not as applied; stricter parsing stops the eval on one bad scenario; an errored prompt with no calls now passes `respects`.
- **#103.** Old runs with a removed check read again as skips. `aigent run` stops on SIGTERM and on `--timeout` and still writes; the subject forwards signals, passes a shorter budget, and deletes a leftover result. Risks: the handler is `process.once`, so a second SIGTERM kills the run unwritten; the delete removes the evidence of the earlier attempt; the margin is at most 30 s and exists only if multeval passes `timeout_s`; a typo in a recorded check reads clean.
- **#100.** 64 calls per code run by default, 8 at once, 1 s of grace past the deadline, a test for 10,000 calls. Risks: a stuck call keeps running and acts after the run returned; the default breaks hosts that made more calls; waiting for a slot counts against the timeout; refused calls leave no record.

## Per pull request

### #104

Claims I checked in the plain answer: the `started` message; the 10 s limit rejects with the quoted text; the abort listener is set before the boot timer; `core-tools.ts:105` builds the timeout signal at the call (true, line and content match); the host-busy effect (true, the new test rests on it); the rejection reaches the model as a tool error (true: `execute` in engine.ts catches and returns `Tool … failed`); `runBash` unchanged (true, sandbox.ts:137). One loose phrase: it says the long-native tests have a "500 ms limit"; 500 ms is the timeout, the bound is 2,500 ms. Nothing false.

Claims I checked in ken's answer: decision 1 and 4 "recorded" (the message lines give the reason, true); decision 2 "inferred" (honest: "nothing says why it is 10 s"); risk 1 (true, quotes fit); risk 3 (true, the CodeHost comment is stale); risk 5 (true: no test names the boot limit or an abort during boot); risk 6 (true). Risk 2 is misleading: it says `core__run_code` "throws instead of returning an error result". The engine catches a thrown tool and returns an error result, so the model still gets an error. ken says it did not read that code. The line about the skipped WARN is empty: no tool call can be running before the code starts.

A: tie. Both have the tool-call clock. ken alone: the boot paths have no test; the CodeHost comment is stale. Plain alone: the new test depends on timing; the grace period counts from the new deadline. All four are small.

Second pass: it added the tool-call clock risk. That is the heaviest risk of this pull request and ken's first pass did not have it. The plain chat had it in one pass. Without the second pass ken would have lost A here. It earned its cost.

Labels: five of six risks say "Checked in the code". Risks 1, 3 and 6 deserve it. Risk 5 does not: the claim is that no test exists, and the quote is two lines of sandbox.ts, one of which the change did not touch. Risk 2 does not fully: the consequence rests on engine code the model did not read. The heaviest risk is first.

Diagram: three arrows, true to the code. It shows the one mechanism of the change. It helps a little.

### #102

Plain claims checked: JSON.stringify compare (true); take keeps the last state per plugin (true); "the eval reads each prompt's last state" (true, `changesOf`); cut after redaction (true); the 16 KiB state cap (true, records.ts:206); "OTLP request limits" as a reason for 131072 (true, the design doc says so); the whole history is still serialised on every request (true, `capturedHistory` maps every message). Nothing false.

ken claims checked: decisions 4, 6, 7 (message lines give the reasons); risk 1 (true: inspect lists newest last, `capText` cuts the end); risk 3 (true, pi.ts:145 takes once per request); risk 4 (true); risk 5 (true: an unchanged update never reaches `append`, so no event; it contradicts the wording of 6967197); risk 7 (true). Nothing false.

A: tie, and it leans to the plain chat. ken alone: with long denial reasons or a large `limit`, inspect's answer passes the 50000 cap and the newest calls are cut first. Plain alone: the capture work still grows with the session; `blob_omitted` is a custom part type a backend may not show; the cut can split a character and characters are not tokens; the compare depends on key order; there is no "unlimited" value. ken's second pass withdrew the key-order risk "to keep the list at 7". Neither side said that the cap also cuts what a script in `core__run_code` gets back from a tool.

Second pass: added two real risks (the inspect cut, the missing event), grounded two, withdrew two true but small ones. Partly earned.

Labels: four "Checked" labels, all fair. The order is doubtful: the inspect edge case is first, above the default cap that changes behaviour for every host.

No diagram.

### #106

Plain claims checked: `follow@3`/`follow@4` in core-long-session (true); `respects` on errored prompts (true); the grader's import scan is a regex over static relative imports (true); nonce added after the scrub (true); `sampling` only on openai-compatible (true); all 36 scenarios parse (commit message); undeclared per-step metric on regrade (true by the code: describe reads shipped scenarios, the grade reads the recorded one). Nothing false.

ken claims checked: decisions 1, 3, 5, 9, 10 (message lines give the reasons); risk 1 (true: loader, describe and subject all call `parseScenario`); risk 2 (true, quotes fit); risk 4 and 5 (true). Risk 6 is not real: `pluginOf` is only reached for a tool name that passed the `TOOL` pattern, which requires `__`. ken hedged it and labelled it "Not checked outside the change", and put it last.

A: plain, narrowly. Plain alone: a seed is recorded even when the server ignored it, and the default server is not one the docs name as honouring seeds; the metric set changed, so dashboards and `--fail-under` rules need a look; runs without a nonce keep the forgeable check. ken alone: a stray file in a plugin directory moves the suite version. ken has the SSH pin as a decision that needs the owner's opinion; plain has it as a risk. Neither said that an errored prompt with no calls now passes `respects`.

Second pass: added nothing, rewrote two risks with lines outside the change. Small gain for 310k tokens.

Labels: two "Checked", both fair. Order: the loader stop is first; I would put the break in comparability first.

No diagram.

### #103

Plain claims checked: two parse entry points (true); skip with the check's name (true); the three vocabulary rules (true, design doc lines 84-86); `--timeout` margin (true); `rm` before the run (true); the READMEs say scores predate `respects` (true); no `maxBuffer` now (true). Nothing false.

ken claims checked: decisions 1, 3, 4, 7 (reasons in the message); decision 8 (true, subject.ts:59); risk 1 (true: `process.once`, so a second SIGTERM gets the default action before `writeRun`); risk 3 (true); risk 4 (true: a skip leaves exit 0); risk 5 (true); risk 6 (true, the test uses `pgrep`). Risk 2 is a real but narrow race. Nothing false.

A: plain, narrowly. Plain alone: the retry's delete removes the very run that `--timeout` made the orphan write, and multeval holds only the bare timeout state; the fix works only if multeval passes `timeout_s`, which nothing in the repository proves; the subject hangs if the child hangs. ken alone: a retry can collide with an orphan that is still alive; the margin is 1 s at `timeout_s` 10; the tests need `pgrep`. ken lists the delete as decision 7 with the pull request's own reason and no risk. Both have the second signal; ken explains it better and puts it first, the plain chat has it as a sub-point.

Second pass: added the orphan collision, grounded the second-signal risk with `writeRun`'s line. Partly earned.

Labels: five "Checked", all fair. The heaviest risk is first.

Diagram: true. It shows the subject's side only, not the reading of old runs. A little help.

### #100

Plain claims checked: the cap sits in `sandboxTool` (true); bash prints to stderr and exits 1 (true by the test); the 12,000-call measurement (true, design doc); the test pins a bug fixed by fb6e076 (true); refused calls never reach `host.call` (true); 8 and 1000 are constants (true). One false detail: it says queued calls "can still start … after the run has returned". They cannot: the run waits in `settle` until they settle or the signal aborts, and an abort wakes the queue.

ken claims checked: decisions 1, 2, 4 (reasons in the message); decision 5 (honest: "nothing you read says why"); risk 2 (true); risk 4 (true); risk 5 (true, and worded correctly: "after the code has finished"); risk 7 (true: the 10,000-call test calls `runCode` directly). Decision 6 is wrong in kind: "should the worker free its VM? No" was decided by fb6e076, not here. This pull request only added the test. ken labels it "recorded" on message lines that describe the old bug.

A: plain, narrowly. Plain alone: 8 at a time against the same timeout can time out runs that finished before; a call that never settles leaks for good; main still matches the pull request. ken alone: the run can last 1 s past the timeout; the 10,000-call test never meets the limiter. Both have the default of 64, the missing trace of refused calls, and the stuck call.

Second pass: added one small risk, grounded two. Small gain for 255k tokens.

Labels: two "Checked", fair but thin (risk 1 quotes two plumbing lines). Order is reasonable.

No diagram.

## Criterion B across the five

The plain answers name files, functions, constants and commit hashes. They quote no code and give one line number in five answers. They were accurate, but the owner cannot know that without opening the diff.

ken's answers put quoted lines under every element. Of 30 elements I checked, 26 quotes showed what the sentence says. The four that did not: #104 risk 5 (a quote cannot show a missing test), #104 risk 2 (the effect rests on unread code), #106 risk 6 (the quote exists, the risk does not), #100 decision 6 (the quote explains an older decision). "Recorded" labels rest on message lines that give the reason in every case I checked except #100 decision 6 and #100 decision 3, where the message gives the problem but not the reason for 8, which ken says in its own words. Coverage is low and ken says so: 15 of 56 hunks, 17 of 114, 13 of 86, 9 of 29, 7 of 12. No important claim sits only in a summary or closing note. ken wins B on all five.

## Criterion C

The plain chat leaves a chat transcript. It is in no project file, and it is found only if the chat tool keeps history and the owner remembers which chat.

ken leaves a stored answer in a project record and a personal history, split into work, topics, notes and decisions (8 to 10 decisions stored for the wider pull requests), and the brief says it reopens without a model. I did not test this. On what I was told and what the files show, ken wins C on all five.

## Verdict against the plan's rule

1. **#104, #102 and #106: yes.** ken wins B and C and loses none. A is a tie: two unique finds of middling weight on each side, and more small ones on the plain side, which do not decide it. Clearest win: B. Closest to a loss: A.
2. **#103 and #100: no.** ken wins B and C. It loses A: the plain chat alone saw that the retry deletes the kept evidence, that the fix depends on multeval passing `timeout_s`, and that throttling can cause timeouts. ken's unique finds there are smaller. Clearest win: B. The loss: A, narrow.
3. **All five: no.** Unique finds of middling weight: five for the plain chat (seed, growing capture work, the retry delete, the `timeout_s` dependence, throttling) against three for ken (the inspect cut, untested boot paths, the orphan collision). No unique find on either side is serious. The plain chat wins A narrowly, so ken loses one criterion. Clearest win: B. The loss: A.

## What the tool added and what it cost

Both sides ran the same model, so the differences are ken's.

Added:
- Quotes that a checker confirmed, under every element. This is the whole of the B win.
- A stored, split record. This is the whole of the C win.
- "Recorded" against "inferred". It told me where a reason was the author's and where it was the model's, and it was honest ("nothing says why it is 10 s").
- "Needs the owner's opinion" and "Undo". These point the owner at the few choices that are his: the 10 s boot limit, the 50000 default, the SSH pins, the vocabulary rule, the stuck call. The plain chat has no such mark.
- Coverage and "not followed" lists. They say what ken did not look at.

Cost:
- Length. 170 to 250 lines of text against 27 to 58.
- Time and tokens. 2.5 to 4.5 minutes and 320k to 668k input tokens per answer.
- Attention. 29 of 36 decisions are "recorded", which means they restate the commit log with a quote. The plain chat spent the same effort on what the change means for a host, an operator or a reader of eval scores, and found more there.
- A cap of seven risks. On #102 ken dropped two true risks to stay at seven.

The second pass, over five: 281 s of 1,064 s, and 1.35 M of 2.68 M input tokens. It added five risks, rewrote ten, withdrew two. All five added risks are real. One is essential (#104's tool-call clock), two are of middling weight (#102's inspect cut, #103's orphan collision), two are small. It earned its cost on #104, partly on #102 and #103, and not on #106 and #100. Its main effect was to bring ken level with what the plain chat found in one pass. It did not put ken ahead.

The risk labels: 18 of 32 risks say "Checked in the code". 16 are fair. Two claim more than the quote shows (#104 risks 5 and 2). The rule behind the label is mechanical: a quote holds a line the change did not touch. That is weaker than the words "checked in the code". "Not checked outside the change" was honest every time, and it sat on the one risk that was not real. The heaviest risk was first on #104, #103 and #100, and not on #102 and #106.

The diagram appears on two of five, the two narrowest changes. Both are true and small. The three widest changes, where a picture would help most, have none.

## The three most important weaknesses of ken

1. **It finds fewer consequences in use than the plain chat on the same model.** On #103 it records the delete of the old result as decision 7, gives the pull request's own reason ("multeval already holds the earlier attempt's outcome"), and raises no risk. The plain chat saw that the delete removes the run the fix was made to keep. On #100 ken has no word on throttling against the timeout. On #106 it has no word on a seed the server ignores.
2. **Its first pass stays inside the diff.** On #104 the top risk is one line outside the change (`core-tools.ts:105`). ken's first pass missed it and the second pass found it. The "used elsewhere" list is mostly not followed: 3 of 19 names on #103, 4 of 20 on #106, and `runCode`'s 27 places on #104 are listed as not followed.
3. **Some labels and entries claim more than they show, and the form pads.** #104 risk 5 is "Checked in the code" on a quote that cannot show a missing test. #100 decision 6 is "recorded" but is not a decision of that pull request. #106 risk 6 is not real. #102 puts an edge case first. Each answer is four to six times the length of the plain one.

## The three things the plain chat did better

1. **Risks that come from use.** #103: "The retry deletes the evidence the PR set out to keep." #100: "Throttling can cause timeouts." #106: "A seed may not mean reproducibility."
2. **Short and in order.** #104 gives the same top risk as ken in 27 lines, with the file and line, and says "This is the mismatch I'd fix next."
3. **Context beyond the diff.** #100: the 10,000-call bug "was really fixed by the earlier commit fb6e076", and "the code on main still matches the PR". #102: `checks.ts` "was changed again in later PRs (#105–#107)". #104: the boot rejection "reaches the engine as a thrown tool error", which is right where ken was unsure.

## What I would change in ken first

Point the risk step at use, not at lines. For each decision, make the model answer: who relied on the old behaviour, and what do they get now? Hosts, operators, and readers of eval scores are the three to name. That is where the plain chat won A on all five. Do it in the first pass, and let the second pass spend its tokens on the "not followed" names from the search, which it now mostly leaves alone.

Two smaller changes after that. Rename "Checked in the code" to what it is, such as "Points at code outside the change", or grant it only when the model says which quoted line the risk rests on. Drop the cap of seven, or keep withdrawn risks folded below instead of deleting them.

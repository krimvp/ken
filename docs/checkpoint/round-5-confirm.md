This is the last check of round 5 of the checkpoint after slice 3, after the closing fixes: a fresh judge compared ken's answers with a plain coding-agent chat on three pull requests ken had not been run on before, with Claude Opus on both sides.
It was run on 16 November 2026, with ken at commit 43013aa.
An AI judge scored it; the owner has not. The text is the judge's, unchanged: the prose check asked for no edits.

# Verdict: ken against a plain chat on pull requests #107, #93 and #92

## Result in short

- The plan's rule: **yes, but only just.** ken wins B and C. A is a tie on weight. ken does not win A.
- Clearest win: B (quotes). Every decision, risk and arrow I sampled sits on a line that exists and shows what the sentence says.
- Closest to a loss: A. On a plain count of true unique finds the plain chat is level or one or two ahead. A judge who only counted would call A a tie or a narrow plain win, never a ken win. If that judge called it a plain win, the rule's answer becomes no.
- ken found nothing serious that the plain chat missed on all three. The most serious risk in the set (#92, the error that still prints a refused state value) was found by both.
- The plain chat found the heaviest risk of #93 (a host that passed `maxTurns: Infinity` now fails at start). ken stated the behaviour change as a statement and did not list it as a risk.
- The second pass earned its cost on #92 only. Over the three it took 52% of the input tokens, added one unique true risk, two risks the plain chat already had, and one that is not a risk of the change. It withdrew nothing, and it left one risk unsettled that one file read settles.
- The plain answers are four to six times shorter and I found one overstated claim in them across the three.
- First change I would make: the risk pass must settle or drop each risk, and must ask "what worked before and is refused now, and who passes it".

## How I checked

For each pull request I read the full diff of the merge (`git diff M^1 M`), every commit message, and the code around it at the merge commit, and wrote my own list before I opened either answer. Then I read the two answers and checked claims by hand against the code at the merge commit. I checked more than six claims per answer; the ones I checked are named below. For ken I also read the quoted lines at their line numbers for at least five elements per answer. I read no skill or instruction file, and nothing else in the two answer folders. I changed nothing in the repository. Criterion C I could not test; I report what I was told and what the files state.

Merges: #107 = e490d9c, #93 = 51595e8, #92 = cc6b79c.

---

## Pull request #92 (three resume fixes)

### My yardstick

What it did:
1. A `denied` record's tool is now a plain string. `parseRecord` no longer takes the tool registry. A transcript whose denied tool was dropped or renamed resumes.
2. On resume the enable loop runs over every plugin the transcript enabled, then the host's names. `enablePlugin` adds only missing closure members, so a dependency gained since gets enabled with cause `dependencyOf`, and its text is queued as pending.
3. A `state` record on resume passes `storableState` with the current redactor: JSON check, redaction, 16 KiB cap. The error names the plugin and avoids `fail()`, which quotes the whole record.

Real decisions: plain string like a `call` record; reuse the enable path instead of a closure step in replay; treat the transcript as host data and re-check; fail the whole resume instead of dropping the state; keep the value out of the error.

Real risks:
- a. `plugin(r.plugin)` runs before the `try` in the state parser. A state record of a removed plugin goes through `fail()` and prints the whole record, value included. The fix has a hole.
- b. Resume can now fail where it worked: a state over the cap. Redaction can also grow a state past the cap, because `[REDACTED:NAME]` can be longer than the secret.
- c. Resume can change a plugin's state without notice (strings and keys).
- d. A dependency added on resume runs `onEnable` and changes the model's context.
- e. In a non-native tool mode, a dependency of a plugin whose cause is `initial` counts as initial, so its tools are declared in the tool list of a running conversation.
- f. `EngineRecord`'s `denied.tool` type widened from `ToolName` to `string` in the public type.
- g. Only state records are re-redacted. Pending text, denial reasons and messages saved before a secret was added stay in the clear.
- h. A `denied` record's plugin must still be in the plugin set, so dropping the gate's plugin still blocks resume.
- i. The denied tool is no longer validated at all.

### Accuracy

Plain, claims checked: denied tool was checked against the registry (true); `parseRecord` dropped the registry (true); the loop line it quotes (true, engine.ts 537); `enablePlugin` adds only missing closure members (true, line 423); `fail()` quotes the record (true, records.ts 120); `plugin(r.plugin)` runs before the `try` (true, line 171); keys are redacted (true, redact.ts); each fix has a test (true).
- Overstated: "runs its `onEnable` hook during resume, which the old code never did on a resumed session". The old loop already ran `enablePlugin` on resume for a host name the transcript had not enabled. New is only that it happens for a gained dependency.
- The "stale leftover" item is honest about being unchecked. It is a small point.

ken, claims checked: decisions 1 to 5 and their quotes; risk 1 (lines 170-172 and 120, true); risk 2 (redact.ts 8 and records.ts 218, true: the marker can be longer than the secret); risk 3 (engine.ts 260 and 557, true: I traced `isInitial` and `declaresNatively`); risk 4 (redact.ts 29, true: the key takes `_2`, no value is dropped); statement 1 (true).
- No false claim found. One gap in wording: risk 3 does not say it applies only outside native mode. In native mode every enabled plugin is declared anyway.

### Completeness

- Plain missed: e (tool list), the redaction-grows-past-the-cap trigger in b, f, g, h.
- ken missed: d (it says the text is queued, not that a hook runs), i, f as a risk (it quotes the session.ts line under decision 1), g, h.
- Both missed f, g, h.

### Criterion A

- ken only: redaction can push a valid state over the cap (real, matters); tool list changes on resume for a dependency of an initial plugin (real, modest: one cache miss and a changed declaration, not a wrong result).
- Plain only: `onEnable` runs at resume (real, partly misstated, low); denied tool no longer validated (trivial); deleted comment (trivial).
- Both: the `fail()` hole, the whole-resume failure, the changed state.
- Weight: ken, narrowly. Two real finds against one low and two trivial.

### Criterion B

- Plain names the three commits and the files, and quotes two code fragments inline. No line numbers. Its claims held, so the trust would be earned, but the reader cannot see that without opening the diff.
- ken: I judged decisions 1, 2, 4, 5, risks 1, 2, 3, 4 and arrows 7 to 11. Each quote shows what the sentence claims. Decision 5 is labelled "recorded"; the message line it quotes ("leaves the refused value out") states what was done, and the reason comes from the code comment quoted next to it. Acceptable, slightly generous. Decision 4 is rightly "inferred" and rightly asks for the owner's opinion.
- The summary is unchecked and is accurate.
- ken wins.

### Second pass

Added risk 3 (real, modest, unique). Rewrote risks 1, 2 and 4; all three are exact as they stand, and risk 4's "No value is dropped" is a correction that needs redact.ts to be read. 69 s and 316k tokens in. It earned its cost here: both of ken's unique finds carry its mark.

### Risk marks

All four say "Quotes code outside the change". In each the outside quote is code the risk rests on (records.ts 120, redact.ts 8, engine.ts 260 and 557, redact.ts 29). Order: the value leak first is defensible. The plain chat put "resume can now fail" first, which is as defensible.

### Diagram

True to the code; every arrow's quote supports it. It shows the two resume paths (parse and check state; enable again). It leaves out fix 1, the denied record. A help, a modest one.

### Readability and cost

Plain: 37 lines, before/now/why per fix, one worked example. ken: 197 lines. Plain is faster to read. ken: 190.7 s, 584,788 tokens in. Plain: one to three minutes, tokens not stated.

---

## Pull request #93 (limits and chat-span telemetry)

### My yardstick

What it did:
1. `parseLimits` in `startSession`, before the model is resolved: `maxTurns` a positive integer, `hookTimeoutMs` and `codeTimeoutMs` whole ms from 1 to 2^31-1. It collects every problem and throws once. The delegate tree takes the parsed hook timeout.
2. The CLI rounds `--prompt-timeout` to whole ms and exits 2 outside 1 ms to `MAX_TIMEOUT_MS`. The constant is exported from `src/index.ts` because the CLI may import only from there.
3. In `traced()`, every telemetry write runs in `finish()`: on a throw it marks the span failed, logs a WARN, and ends the span in a `finally`. Input capture moved inside the `try`.

Real decisions: check once at the boundary; refuse instead of clamp; one shared constant through the host entry; round in the CLI but refuse fractions in the SDK; telemetry must not take down the run.

Real risks:
- a. Breaking for hosts: `maxTurns: Infinity` (worked as "no limit") and fractional timeouts (worked with `setTimeout`) now throw at start.
- b. If the host's `log` throws inside `finish`'s catch, the rejection escapes again. `stream.result()` still has no catch.
- c. When one write throws, later writes are skipped (no duration). The span of a healthy request is marked ERROR, and a real `model_error` type can be overwritten.
- d. A throw in input capture now ends the span but still rejects the request, so "must not reach the run" does not hold on that path.
- e. `runScenario` callers that are not the CLI still pass any `promptTimeoutMs` to `AbortSignal.timeout`.
- f. multeval's `prompt_timeout_s` check is looser than the CLI's, so a config passes `resolve` and then every case fails with exit 2. Only for absurd or sub-millisecond values.
- g. Limits and delegate options are two separate errors.
- h. CLI rounding drops precision without a word.

### Accuracy

Plain, claims checked: NaN never met the turn check (true, engine.ts stop condition); the tree used to re-read `options.hookTimeoutMs ?? 10_000` (true); the CLI check runs before the scenario is read (true, `parseCommand`); `0.0004` rounds to 0 and is refused (true); the SDK does not round (true); `log` unguarded in the catch (true, pi.ts 433); no catch on `stream.result()` (true); limits throw before the delegate check (true, line 81 before 86); "the eval scenario parser already requires positive integers" (true, scenario.ts 144 and 368).
- No false claim found. "It could interfere if the test runner ever runs files in one process" is a guess and says so.

ken, claims checked: decisions 1 to 5 and quotes; risk 1 (subject.ts 39 and 86, true); risk 2 (see below); risk 3 (run.ts 141, true); risk 4 (pi.ts 85 and 433, true, and `dispatch` does guard listeners at lines 89-93); risk 5 (pi.ts 335-337, true and old); risk 6 (lines 449 and 451, true); statement 2 (true).
- Risk 2 is not a risk. The scenario parser's `positive()` already refuses anything that is not a positive integer. ken says "I have not settled" and still ranks it second.
- Risk 5 says itself that it was "already true before". It is not a risk of this change.
- Risk 6 ends "so metrics undercount failed requests". What is lost is the duration of any request whose telemetry threw, failed or not.
- Decision 3's reason adds "That mixed bad usage up with a timed-out run". The message only says the run started and exited 3.
- Risk 7 (one `setImmediate` in the test) is a guess.

### Completeness

- Plain missed: c, d, e, f.
- ken missed: a as a risk (statement 2 gives the change, with NaN, 0, 1.5 as examples, and no word that a working host breaks); the "refuse, not clamp" decision; h; the missing catch on `stream.result()`; d; the span-status half of c.
- Both missed d.

### Criterion A

- ken only: f multeval mismatch (real, remote: it needs a timeout over 24 days or under half a millisecond); e `runScenario` unchecked (real, low to moderate); c skipped writes (real, low to moderate); helper `codeTimeoutMs` (old, not from this change); scenario `maxTurns` (not real); test timing (guess).
- Plain only: a breaking for hosts (real, the heaviest item of this pull request); h rounding and the CLI/SDK difference (real, low); no catch on `stream.result()` (real, conditional); g two error rounds (trivial); global test state (guess); the "refuse, not clamp" decision.
- Weight: tie, leaning plain. ken has three real finds of low to moderate weight and pads with two that are not risks of the change and one guess. Plain has the one that matters most to an owner with hosts, plus two low ones. Neither side clearly outweighs the other.

### Criterion B

- Plain: commit hashes and file names, no lines, no quotes. Accurate, but the reader must take it on faith.
- ken: I judged decisions 1, 3, 4, 5, risks 1, 3, 4, 6 and arrows 7 to 11. The quotes support the sentences. Two weak spots. Arrow 8 points from index.ts to a node named "pi.ts startSession" with the label "re-exports from pi.ts"; the quote shows a re-export of a constant, not a link to `startSession`. Risk 2 carries two real quotes under a sentence that is not a risk: the checker confirms the lines exist, and that is all.
- "Recorded" labels on 1, 3, 4, 5 rest on message lines that do give the reason. The message quotes are cut line by line in mid-sentence ("threw from AbortSignal.timeout inside the tool call. startSession now"), which is ugly but honest.
- ken wins, with the note that a quoted risk is not a true risk.

### Second pass

Added risk 5 (old behaviour, low value). Rewrote risk 4 (exact, with the contrast to `dispatch`) and risk 2 (ends "I have not settled"). The pass read run.ts line 120, where the risk pointed, and stopped one file short of the answer. It did not withdraw risk 2. Its order puts the 24-day multeval edge first, the unsettled item second and the crash hole fourth. 62 s and 257k tokens in. It did not earn its cost here.

### Risk marks

Five of seven say "Quotes code outside the change". For risks 1, 3 and 4 the outside quote is code the risk rests on. For risk 2 the mark sits on a non-risk. For risk 5 it sits on old behaviour. A reader who takes the mark as "this was looked into" is misled twice out of five here. Heaviest first: no.

### Diagram

True, with the loose arrow 8. It is a map of what was touched: the CLI gets the constant through index.ts, and `startSession` calls `parseLimits`, `parseDelegate` and `traced`. It does not show `finish()`, which is the part that needs a picture. Between a help and decoration; I call it a small help.

### Readability and cost

Plain: 39 lines, "what was broken / what it does now", then decisions, then risks, then one line of overall judgement. ken: 207 lines. Plain is faster. ken: 186 s, 491,611 tokens in.

---

## Pull request #107 (test hardening, one CLI fix)

### My yardstick

What it did: moved the live suite out of the test glob (`test/live.ts`) and made it throw unless `AIGENT_LIVE=1` is in the environment (checked before `.env` loads) and a key is set; added `test:coverage` over `src/**` and `integrations/**` with floors 99.0 lines and 90.3 branches, run in CI on the 22.19.x leg only; added a scripted OpenAI-compatible endpoint fixture and whole-run tests for `aigent run` and the multeval subject; a table of 23 tampered result directories for `readRun`; every scenario in all four tool modes on a model that only replies; temp directories removed in `t.after`; CLI refusals in one concurrent table; one product fix: `--out` under a file exits 2 instead of 4.

Real decisions: two locks on the live suite, and `.env` cannot open one; throw instead of skip; coverage only over product code; floor just under the measure, on one Node version; an HTTP fixture with no model library instead of a mock; tables; `ENOTDIR` is bad input.

Real risks:
- a. The floor has about 0.2 points of slack. An untested branch in any later change turns that leg red. Nothing raises or lowers it.
- b. Experimental coverage flags, checked on one Node version.
- c. `npm run test:live` without a key now fails where it skipped.
- d. Other `stat` errors (EACCES) still exit 4 with a stack trace.
- e. The four-mode run proves setup, not each mode's tool paths.
- f. About 35 processes at once in one test; more process and port tests.
- g. The 22.19.x leg runs the suite twice.
- h. `test:coverage` is not in `npm run check`, so the drop shows only in CI.
- i. `npm test` no longer loads the live file, so only the type check guards it against rot.

### Accuracy

Plain, claims checked: the guard runs before `.env` is loaded (true, live.ts 17 before 20); missing key now throws, before it skipped (true); floor numbers and measure (true); CI leg (true, ci.yml 39-40); the boundary row gives the fixture no imports (true); EACCES rethrows (true, cli.ts 172-174); a directory made mid-run exits 4 and a test covers it (true); the faux model only replies (true, file header).
- One loose line: "`npm run test:live` with no opt-in now fails instead of skipping". With a key and no opt-in it used to run paid calls, not skip. The section above it in the same answer has it right.

ken, claims checked: decisions 1, 2, 3, 5, 6, 7; risks 1, 3, 4, 5, 6; statements 2 and 3. All quotes are at their lines. "About 30 processes" (I count 35 rows).
- Risk 2 has the same loose line as the plain chat: "without AIGENT_LIVE=1 or without a key used to pass with every test skipped". Only the no-key half is true.

### Completeness

- Plain missed: g, h, i.
- ken missed: e (its decision 6 quotes "The faux script only replies" and draws no limit from it), the leftover check-then-write gap, h, i.

### Criterion A

- ken only: g, the suite runs twice on one leg (real, low).
- Plain only: e, the four-mode run proves setup and not tools (real, and the one caveat an owner could be misled on by the test's title); the check-then-write gap is covered, not removed (real, low).
- Both: a, b, c, d, f.
- Weight: plain, narrowly. One useful caveat against one low item.

### Criterion B

- Plain: commit hash per item, file names, numbers. No lines.
- ken: nine decisions, all "recorded", each on message lines that do give the reason. Risks 1, 3, 4 sit on the exact lines. Decision 3 asks for the owner's opinion on the floor, which is apt.
- ken wins. Note that most of ken's nine decisions are the nine commit messages said again; the quotes prove the message says so, and nothing more.

### Second pass

Added risk 2 (test:live fails where it skipped) and risk 5 (experimental flags). Both real, both low, both already in the plain answer. No rewrite, no withdrawal. 43 s and 287k tokens in. It brought ken level with the plain chat on two items. It did not put ken ahead.

### Risk marks

All six say "Quotes only the changed lines". True. On a test pull request it says little, six times.

### Diagram

Each arrow is true. The title says "How the new tests reach the code over HTTP", and the drawing has no arrow that goes over HTTP: the chain subject.ts -> `aigent run` -> endpoint is missing, and the CLI node has no link to any endpoint. The live gate and the coverage floor, the two things an owner must know, are absent. Decoration.

### Readability and cost

Plain: 47 lines, five numbered changes, then decisions, then risks. ken: 280 lines, of which about 70 are message quotes cut line by line and 20 are a search list with names such as `Edit` and `scripts` matched in skill files. Plain is much faster. ken: 177.8 s, 575,609 tokens in.

---

## Criterion C (structural)

Plain leaves a chat. To find it tomorrow the owner must find that chat, and it is tied to no commit except by its text. ken, as I was told, stores the answer in a project record and a personal history and can reopen it without a model; each file states what it stored (#92: 1 work entry and 5 decisions; #93: 1 work, 5 decisions, 2 topics, 2 notes; #107: 1 work, 9 decisions, 1 topic, 1 note), and every quote is pinned to a commit. I did not open the record. On what I was told, ken wins C on all three.

## The table

| PR | A | B | C | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #107 | plain, narrowly: four-mode caveat against "suite runs twice" | ken: every item on exact lines | ken: stored, pinned to commits | tie: same loose line on both sides | plain, slightly: setup-not-tools, leftover gap | plain: 47 lines against 280 | plain: 1-3 min against 178 s and 576k tokens |
| #93 | tie, leaning plain: host break against three lesser gaps and padding | ken: quotes hold; one non-risk carries real quotes | ken | plain: no false claim; ken lists a non-risk and an old behaviour | tie: plain has the top risk and "refuse, not clamp"; ken has reach into multeval and runScenario | plain: 39 against 207 | plain: 186 s and 492k tokens |
| #92 | ken, narrowly: cap growth by redaction, tool list on resume | ken: quotes hold; one generous "recorded" | ken | ken, slightly: plain overstates "never ran onEnable on resume" | tie: each misses what the other found; both miss three | plain: 37 against 197 | plain: 191 s and 585k tokens |

## The verdict against the plan's rule

**Does ken win at least one of A, B, C and lose none, on the three together? Yes.**

- B: ken wins on all three.
- C: ken wins on all three, by construction, on what I was told.
- A: tie on weight. ken narrowly on #92, plain narrowly on #107, #93 level and leaning plain.

Clearest win: B. Closest to a loss: A.

How sure I am on A: not very. I put it at about two in three that a second careful judge calls A a tie and one in three that he calls it a narrow plain win. A judge who only counted true unique finds would get about 6 for ken (cap growth, tool list, multeval mismatch, runScenario, skipped writes, suite twice) and about 7 for plain (onEnable at resume, host break, CLI rounding, no catch on result(), four-mode caveat, leftover gap, the refuse-not-clamp decision), plus two or three trivial ones on the plain side. That judge reaches a tie or a narrow plain win, not a ken win. So the yes rests on B and C alone, and on A not tipping.

ken did not surface one serious thing that the plain chat missed. On these three unseen pull requests it is not a better finder than the same model in a plain chat.

## What ken's structure added and what it cost

Added:
- Proof. A reader can see the line under each claim. This is the whole of B.
- Reach beyond the diff. The "used elsewhere" list and the second pass led to subject.ts, run.ts and redact.ts. ken's real unique finds (#92 risks 2 and 3, #93 risks 1 and 3) all quote code outside the change.
- Honest labels: "recorded" against "inferred", "needs the owner's opinion" (apt on #92 decision 4 and #107 decision 3), the coverage count, the closing note that lists what was not read.
- A stored answer.

Cost:
- Length: four to six times the plain answer.
- The before/now story is gone. The plain chat says what was broken and what happens now. ken splits that across decisions and quotes.
- The decision slot fills with commit messages said again (#107: nine of nine).
- The risk slot pulls toward gaps in the code and away from "who breaks". On #93 the host break ended up as a statement.
- No overall judgement. The plain chat closes #93 with "a low-risk hardening change. The one real behaviour change is...". ken has no place for that sentence except the unchecked summary.
- About 0.5 million input tokens per answer.

## The second pass over the three

- Added 4 risks: 1 unique and true (#92 tool list), 2 true and already in the plain answer (#107), 1 not a risk of the change (#93 helper code timeout).
- Rewrote 5 risks: 4 are exact as they stand; 1 (#93 risk 2) still says "I have not settled".
- Withdrew 0. At least one should have gone.
- Ordering: right on #107, defensible on #92, wrong on #93.
- Cost: 174 s of 554 s (31%) and 860k of 1.65M input tokens (52%).

It earned its cost on #92. On #107 it bought parity. On #93 it added noise. Over the three it did not earn half the token bill.

## The two risk marks

Honest: yes. In every case the mark says where the quote is, and that is true. The line under the list says the mark is not a truth check.

Useful: partly. "Quotes code outside the change" does go with ken's best finds. But it also sits on a non-risk (#93 risk 2) and on old behaviour (#93 risk 5), so a reader who takes it for "looked into" is wrong twice out of nine. It can also be read as "this risk is outside the change, so not caused by it". "Quotes only the changed lines" on all six risks of #107 tells the reader nothing. As worded, the marks are honest and weak. A reader will take the first for more than it says.

## The diagrams

- #92: true to the code. A modest help: it shows the two resume paths. It leaves out the denied-record fix.
- #93: true, with one loose arrow (index.ts to "pi.ts startSession" for a re-exported constant). A small help as a map of what was touched. It leaves out `finish()`.
- #107: each arrow true, but the drawing does not show its own title: no arrow goes over HTTP, and the subject -> CLI -> endpoint chain is missing. Decoration.

## ken's three most important weaknesses, in order

1. **It does not find more than the plain chat, and it misses the "who breaks" risk.** #93: the plain chat says "If any host passed `maxTurns: Infinity` to mean 'no limit' ... it now fails at startup". ken's statement 2 says only that "NaN, 0, 1.5 or a value over 2^31-1 passed through to the engine", and its first-ranked risk is a multeval timeout above 2,147,483 seconds.
2. **The risk list keeps what it has not settled, and the second pass never withdraws.** #93 risk 2: "I did not read scenario.ts's positive() check, so I have not settled whether a scenario can hold such a value." scenario.ts line 368 settles it, and the plain chat had it: "the eval scenario parser already requires positive integers". #93 risk 5 says of itself "That was already true before." Zero withdrawals in three runs, at half the tokens.
3. **Too long, and much of the length proves little.** #107: nine "recorded" decisions that restate nine commit messages, with the message quoted in fragments cut mid-sentence; a diagram that omits its central link; a "used elsewhere" list that reports `Edit` in `.agents/skills/...` and `scripts` in workflow files and follows "0 of them". 280 lines against 47.

## Three things the plain chat did better

1. **It explained the change as before and now, with a case.** #92: "Say you added `dependsOn: ['safety']` to `shell` ... Fresh sessions got the gate. Resumed sessions did not, so the model could still call the tool the gate was meant to block."
2. **It named consequences for people, and settled its own doubts.** #93: "Breaking for hosts ... call it out in release notes. Nothing in this repo does it: the eval scenario parser already requires positive integers."
3. **It said what a test does not prove, and gave an overall judgement.** #107: "The four-mode scenario runs test setup, not tools." #93: "In short, it's a low-risk hardening change. The one real behaviour change is that out-of-range limits now fail at startup."

## What I would change in ken first

Change the risk pass. Two rules:
- For every check, limit or parser the change adds or tightens, the model must answer: what input worked before and is refused or altered now, and who passes it (hosts, callers in the repository, stored files). That is where the plain chat beat ken on #93.
- A risk may not stay in the list unsettled. If it says "I did not read X", the pass reads X, and then keeps the risk with the line that proves it or withdraws it. A risk that was true before the change goes to a separate "already so" line or is dropped.

After that: cut any decision whose reason is only the commit message said again down to one line, and give the summary a required last sentence that says how risky the change is overall.

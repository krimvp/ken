This is the verdict of round 2 of the checkpoint after slice 3: a fresh judge compared ken's answers with a plain coding-agent chat on the same three pull requests.
It was run on 16 November 2026, with ken at commit 0d81f71 and the glm-5.3 model; the plain chat ran on Claude Opus.
The text below is the judge's, unchanged. The prose check asked for no edits.

# Verdict: ken (glm-5.3) against a plain chat (Claude Opus) on pull requests #104, #102, #106

## Short answer

**No.** ken does not meet the plan's rule ("win on at least one of A, B, C and lose on none").

- ken wins B (trust from quotes) on all three pull requests.
- ken wins C (the answer can be found tomorrow) on all three. This is structural. I did not test reopening.
- ken loses A (unique decisions and risks), by a narrow margin. A is a tie on #104 and #102. The plain chat wins A on #106, where ken surfaced nothing the plain chat lacked and the plain chat surfaced two things that matter to an owner.

Clearest win: B. Closest to a loss: A, and I score it as a narrow loss. It turns on #106 alone.

## How I judged

I read the six answer files in full and nothing else in the two folders. I read each merge diff (`git diff M^1 M`), each commit message, and the code around the claims I checked. I changed nothing in the repository. I read no skill or playbook file, as the task told me.

Merges: #104 = `3586115` (parent `eee753c`), #102 = `03c113f` (parent `bb7ae10`), #106 = `47eec4e` (parent `5a85b5a`).

---

## Pull request #104 (start runCode's deadline when the code starts)

### My yardstick

What it did:
- The worker posts `{kind:'started'}` when it gets the `run` message. `runCode` now sets `deadline` and arms the `codeTimeoutMs` timer on that message, not at the call.
- Before `started`, a new fixed 10 s timer (`BOOT_LIMIT_MS`) runs. If it fires, `runCode` rejects.
- The abort listener is independent of `started`, so an abort during boot still ends the run.
- Two existing tests now time from the code's first tool call. One new test blocks the host for 1 s against a 200 ms deadline and expects the value.
- The design doc records the reason: on a loaded 4-core machine the code started 92 to 190 ms after the call.

Real decisions: anchor on the worker's message as the host receives it; a separate boot limit that is a failure, not a timeout; 10 s hard-coded with no reason given; `runBash` left alone; test written first (`a09770e` before `782aa2d`).

Real risks:
1. Tool calls made by the code still use the old clock. `core-tools.ts:105` arms `AbortSignal.timeout(host.timeoutMs)` when the tool call starts. The doc still says the deadline has "its tool calls included".
2. A busy host widens the code's window, because the deadline starts when the host handles `started`.
3. A boot slower than 10 s now fails the call. With the default 30 s deadline, a 10 to 30 s boot used to run with the time left.
4. With a deadline under 10 s and a worker that never starts, the call now takes 10 s to fail.
5. Minor, missed by both: the first run's WASM compile is awaited before either timer is armed, so it is now counted by neither.

### Claims I checked

Plain (12 checked): 4 files and about 40 lines (true: 39 added, 13 removed); the 92 to 190 ms reason (true, commit `782aa2d`); timer starts on receipt (true); `settle` uses the new deadline (true); boot limit rejects with the quoted message (true); abort works during boot (true; the wording "before the worker starts" is loose); `a09770e` is before the fix (true); `core-tools.ts:105` and its expression (true, exact); a blocked host gives extra time (true); up to 10 s more and a new rejection that reaches the engine as a tool error (true, `engine.ts:524`); test depends on timing (true as a description, low weight); `runBash` unchanged (true).
False or misleading: none found.

ken (10 checked): decision 1, 2, 3; risks 1 to 4; statements 3, 4, 6; diagram arrows 4, 7, 8. All true. Loose points:
- Statement 3 says the abort works during boot "because the abort listener is armed before the boot timer". The order against the boot timer is not the reason. The claim is true, the "because" is not shown.
- Arrow 8 says `terminate()` happens "at the deadline or the abort". The code terminates the worker in `finally`, on every run.
- Decision 3 (`runBash` kept its deadline) is a thing the change did not do. It is true and useful, but it is not a decision the history shows.

### Completeness

Both cover the change, the reason and risks 1 to 4. Both missed risk 5. ken left out three small hunks and said so.

### Criterion A

- ken only: the exact regression in risk 3 (a 10 to 30 s boot under the default 30 s deadline used to run and now fails). The plain chat has the 10 s limit and the new rejection, but not this case.
- Plain only: the new test's timing assumption; that the code can catch `aborted` from its tool calls near the limit; a stated priority ("the mismatch I'd fix next").
- Count: 1 against 2 or 3, all small. **Tie.**

### Criterion B

Plain: names the merge, the files, one commit, one exact `file:line` with its expression, and the exact error text. The owner can spot-check the main risk without a search. The rest rests on trust.

ken, six elements judged: risk 1 (supports), risk 2 (supports; the "before" half is quoted under risk 3), risk 3 (supports, with the old line at `eee753c`), risk 4 (supports), statement 4 (supports the catch; "the loop keeps going" is inference), decision 3 (supports). Weak: statement 2 quotes one doc paragraph of about 2,000 characters to carry one sentence. Arrow 7's quote is the `return` inside `run()`, not the post. **ken.**

### Diagram

True to the code. It shows the one thing that is hard to hold in the head: two timers and the message that swaps them. It helps. It is the best of the three diagrams.

### Readability and cost

Plain: 3.9 KB, about one minute. ken: 15.8 KB, 200 s, 329k tokens in, 43k out. The same five-line block from `sandbox.ts` appears three times in ken's answer. A tired developer gets the point faster from the plain answer.

---

## Pull request #102 (bound state records, the record log, tool results, deny reasons, captured content)

### My yardstick

What it did, one commit each:
1. `state.update` appends only when `JSON.stringify` of the new value differs from the current one.
2. `take()` hands on only each plugin's last `state` record per take. Record events still carry every write.
3. The record log keeps only untaken records. The by-kind indexes stay.
4. New `maxToolResultChars`, default 50000, applied in `execute` after redaction, text only, with a truncation block. Helpers inherit it.
5. A gate's denial reason is cut at 1000 characters, after redaction.
6. `session__inspect calls` shows the newest 50 by default.
7. Captured `gen_ai.input.messages` keeps the newest messages that fit 131072 characters. Image data is never captured.
Also: the eval's `unrecordedStates` now reads `step.before`, because an unchanged update writes no record.

Real decisions: caps on by default; cut after redaction; say what was cut; dedupe by serialised equality; collapse per take; the transcript is the only full copy; newest-first telemetry that stays valid JSON; numbers taken from measurements (commit messages and the doc).

Real risks:
1. Default caps change behaviour for existing tools, gates and inspect callers. There is no "unlimited" value.
2. The transcript no longer holds every state change.
3. The memory fix is partial: the by-kind indexes still keep every call, denial, usage and delegation record.
4. Images are not capped at all.
5. The telemetry cap is not hard (the newest message is always kept), and the whole history is still serialised on every request.
6. A denial's result does not pass `capText`.
7. Small: a cut can split a surrogate pair; the equality check depends on key order; `decodedBytes` is an estimate; `blob_omitted` is not a standard part type.

### Claims I checked

Plain (12 checked): seven commits (true); the 7.5 MB reason (true); per-take collapse and why (true, doc and `6967197`); heap 9.2 to 2.2 MB (true, `db71be1`); cap after redaction, across blocks, images untouched, errors capped, helpers inherit (all true); why 50000 (true, doc); reason cap covers both a deny and a failed gate (true); 50 chosen against the 1000 cap (true, code comment); 131072 = 8 x 16384 and newest always kept (true); no unlimited value (true, `limit(... 'a positive integer')`); key order (true, harmless, as it says); truncation note lands after images (true); only reader of the log is `takeRecords` (true).
False or misleading:
- Risk 3 says the eval's `respects` check "got looser" and "could hide a real miss". The guard now reads the state kept before the step. A fixture that changes something still writes a record, so a real change is still seen. The "hide a real miss" part is not supported.
- "`checks.ts` was changed again in later PRs (#105–#107)". The later changes are in #103 and #106.

ken (12 checked): decisions 1, 2, 3, 4, 8, 9; risks 1 to 6; statements 4, 5, 6; arrows 5 to 8. All true.
Loose points:
- Decision 4 says "Rejected: none shown by the code or history". Commit `49df57b` and the doc give the reason for 50000 (every scenario plugin under 7 KB, a 30 KB file kept whole, a tenth of the context window). ken's answer never states why 50000 or why 1000.
- Risks 2 and 5 were true before this change. They are limits of the fix, not new risks. ken's wording ("partial", "still") is fair.
- Risk 3 needs about 50 denying gates to pass the default cap. True, small.

### Completeness

Both list all seven changes. ken missed: the reasons for the numbers, the surrogate split, the cost of serialising the whole history on each request, the "no unlimited value" point. Plain missed: index growth as a risk, images as a risk. ken's quotes cover 18 of 56 hunks and none of the tests; its closing note says so.

### Criterion A

- ken only: (1) the indexes still grow with every call, so the memory fix is partial; (2) images are uncapped, framed as a risk and marked "needs the owner's opinion" (the plain answer states the fact but not as a risk); (3) a denial's result is outside the cap.
- Plain only: (1) the whole history is still redacted and serialised on every request; (2) surrogate split and characters-not-tokens; (3) no unlimited value, use a very large one; (4) key-order dependence; (5) `decodedBytes` and `blob_omitted`; (6) the measured reasons for 50000, 1000, 50.
- Weight: one solid find each (index growth against per-request telemetry cost). ken's image point is the next most useful. Plain has more small ones and the reasons. Neither side clearly outweighs the other. **Tie.**

### Criterion B

Plain: a commit hash and a file or function name on every item. No line numbers and no code. Good for finding the place, not for trusting without looking.

ken, six elements judged: decision 1 (supports), risk 3 (supports; the reader must know `errorResult` does not cap), risk 5 (supports, quotes code outside the diff), risk 2 (supports the fact; "without bound" is inference), statement 5 (supports), decision 8 (supports). Weak: decision 4's "with a truncation note" has no quote; arrow 7's "last state wins" is not in its quote; the reasons in decisions 1, 2, 3 and 8 (7.5 MB, 64 records, 1.7 MB) come from commit messages and the doc and carry no quote. **ken.**

### Diagram

True. Its title is honest: it shows where records live, which is the least obvious part. It covers three of the seven commits and says nothing of the caps or telemetry. It helps for that part only.

### Readability and cost

Plain: 8.9 KB, about one minute. ken: 21 KB, 221 s, 344k tokens in, 51k out. ken's 11 statements mostly restate its 9 decisions. Plain is faster to read.

---

## Pull request #106 (judged counts, fixture hashes, sampling, leak nonce, vacuous scenarios)

### My yardstick

What it did, seven commits:
1. A `<kind>_judged` bool per kind and a `<check>@<step>` score for a kind asked for at several steps. `respects` now judges prompts that ended `error` or `aborted`.
2. The suite version also hashes every file in the plugin directories. The grader version follows the grader's relative runtime imports by regex, with a load-hook test.
3. `--temperature` and `--seed`, a `sampling` field on `openai-compatible` specs, recorded in `run.json` with `null` for unset.
4. A per-run nonce in the leak mark, stored as `leakNonce`. Old runs are read by the old mark.
5. `parseScenario` refuses vacuous authored scenarios. `parseRecordedScenario` does not.
6. A test that `requirements.txt` and its lock pin one commit. The README says the pins are `git+ssh://`.
7. A doc example fixed.

Real decisions: keep "a skip is not a failure" and add `_judged` beside it; declare per-step metrics from the shipped scenarios; only `respects` on errored prompts; follow imports, not a list; vacuous checks only for authored scenarios; `aigent-run/1` not bumped; nonce added after the scrub; `sampling` only on `openai-compatible` because of pi 1.3.0 (doc); the `git+ssh://` pins left as they are because that is "the owner's call" (commit `0b26023`).

Real risks:
1. Suite and grader versions moved, so results from before and after do not line up. A regrade can turn a `respects` skip into a fail.
2. New metrics appear; anything that lists metrics should be looked at.
3. Per-step metrics are declared from shipped scenarios but scored from the attempt, so an undeclared metric can appear.
4. The import scan is a regex over static relative imports.
5. A recorded seed does not prove the server used it.
6. Scenarios that parsed before can now be refused.
7. Old runs keep the forgeable mark.
8. The SSH pins block CI and contributors without a key. Unchanged, only documented, left to the owner.
9. Small, missed by both: a `run.json` with the new fields fails an older build's unknown-field check, and the format was not bumped.

### Claims I checked

Plain (12 checked): about 500 lines (true, 498); `follow@3` and `follow@4` in `core-long-session` (true, I parsed the scenario); `respects` on errored prompts and the `finished()` guard (true); the old four-file list missed `usage.ts` and `protocol.ts` (true, commit `5c659ad`); load-hook test (true, `registerHooks` in `test/multeval.test.ts`); `sampling` only on `openai-compatible` because of pi 1.3.0 (true, doc); nonce after the scrub (true); vacuous only when authored (true); format not bumped (true); default endpoint is Ollama Cloud and no upper bound on temperature (true); 36 scenarios and exit 2 (true, commit and `cli.ts`); SSH pins (true, README).
False or misleading: none found. "The PR could have counted a skip as a failure" is the model's own alternative, not one the history names. It is marked as "could have", so it is fair.

ken (12 checked): decisions 3, 4, 7, 8, 9; risks 1 to 6; statements 4, 8, 10; arrows 6 to 9. All true.
Loose points:
- Decision 9 quotes the README line that says a CI job without an SSH key cannot install multeval. No sentence in the answer says this. The decision is marked "Needs the owner's opinion: no", while the commit says the pin URLs were left alone because that is the owner's call.
- Risk 4 quotes a dynamic `import()` in `src/catalog.ts`. That import loads plugins, not judgment files. The quote shows such imports exist; it does not show a gap today. ken's sentence says "a later change", so the sentence is fair and the quote is only an illustration.
- Eight of nine decisions say "Rejected: none shown by the code or history", so they carry no reason.

### Completeness

ken missed: the owner's-call on the SSH pins; that both versions moved; the new-metrics point; why `sampling` is only on `openai-compatible`; that the format was not bumped. Plain missed nothing ken has, except small facts (`readRun` validates the new fields; the subject validates its config). ken's quotes cover 40 of 114 hunks.

### Criterion A

- ken only: none that is a decision or a risk. Its six risks are all in the plain answer.
- Plain only: (1) both versions moved, so do not mix results from before and after; (2) the SSH pins are left to the owner and block CI without a key; (3) the metric set changed; (4) `sampling` only on `openai-compatible`, with the reason; (5) temperature and seed ranges are not checked by the CLI; (6) non-`.ts` files and bare specifiers are not hashed; (7) the format was not bumped.
- Weight: items 1 and 2 matter to an owner. Item 2 is the one decision the commit history hands to the owner by name. **Plain.**

### Criterion B

Plain: file names on each item. No commit hashes, no lines, no code. The weakest of the three plain answers on this point.

ken, six elements judged: risk 1 (supports), risk 2 (supports, with the old code at `5a85b5a`), risk 5 (supports), decision 8 (supports), statement 8 (supports, with a test quote), arrow 9 (supports). Weak: decision 9 and risk 4, as above. **ken.**

### Diagram

True. It shows the path run, `run.json`, check, grader, and hangs sampling and the nonce on it. It covers about three of the seven changes. Hashing, `_judged` and the scenario refusals are absent. For a change made of seven separate fixes one flow cannot carry the whole. It is closer to decoration here.

### Readability and cost

Plain: 6.9 KB, about one minute. ken: 36.8 KB, 322 s, 432k tokens in, 69k out. Statements 1 to 9 restate decisions 1 to 8 with the same quotes. This answer is too long.

---

## Criterion C, all three

Plain leaves a chat. The files I read are exports made for this comparison. Finding the answer tomorrow means finding that conversation. Nothing ties it to the pull request or the commit.

ken, as told and as each file states, stored the answer in a project record (1 work item and 3, 9 and 9 decisions, plus topics and notes) and in a personal history, and can reopen it without a model. Each quote names its file and commit, so the stored answer stays checkable after the code moves. I did not test reopening. Every stored decision carries the label "inferred". **ken**, on structure.

---

## Table

| PR | A | B | C | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #104 | tie: one small unique find each | ken: every claim has its line; plain has one `file:line` | ken: stored, tied to commit | tie: no false claim on either side | tie: both missed the uncounted WASM compile | plain: 3.9 KB against 15.8 KB | plain: about 60 s against 200 s and 372k tokens |
| #102 | tie: index growth against per-request telemetry cost | ken: quotes support; plain has commit hashes only | ken | ken: plain overstated one risk and named the wrong later PRs | tie: ken lacks the reasons for the numbers, plain lacks index growth | plain: 8.9 KB against 21 KB | plain: about 60 s against 221 s and 395k tokens |
| #106 | plain: version move and the owner's call on SSH pins; ken has no unique risk | ken: plain cites file names only | ken | tie: no false claim found | plain: ken missed five decisions or consequences | plain: 6.9 KB against 36.8 KB | plain: about 60 s against 322 s and 501k tokens |

The plain chat's token use is not stated, so cost compares time only.

## Verdict against the plan's rule

- A: lost, narrowly. Two ties and one plain win. Across the three, ken's unique finds are two solid ones (index growth, the 10 to 30 s boot case) and two small. The plain chat's are three solid ones (version move, the owner's call on SSH pins, per-request telemetry cost) and about ten small, plus reasons ken left out.
- B: won on all three.
- C: won on all three, on structure.

Wins at least one: yes. Loses none: no. **Answer: no.**

A different judge could call A a tie, since no unique find on either side is serious. That would flip the answer to yes. I do not, because on #106 ken added nothing and missed the one decision the history addresses to the owner.

## The model confound (my inference)

I believe these come from the tool's structure:
- B and C. Quotes and storage are the tool, not the model.
- The length and the repetition. The format asks for decisions, statements, risks and arrows, each with quotes, and the model fills all four with the same content.
- The missing reasons. The format puts "why" on the rejected option. When no rejected option is found (14 of 21 decisions), the reason has no place. Reasons that live in commit messages are cited by hash but never quoted, so they seem not to be quotable.
- The lean toward what a code line can show. Most of the plain chat's unique finds have no line to quote: versions moved, dashboards, the owner's call, "no unlimited value". ken's unique finds all sit on quoted lines, two of them outside the diff (`records.ts:80-93`, `pi.ts:266`). The quote rule seems to push the model to read around the diff and away from consequences outside the code.
- The time. Eight to twelve model requests and 16 to 32 tool calls per answer.

I believe these come from the model:
- Fewer second-order consequences on #106.
- The wrong "Needs the owner's opinion: no" on the pins decision.
- The loose "because" in #104 statement 3.

I cannot separate the two for A. A stronger model inside ken might close the gap on #106. A weaker model in the plain chat would likely lose accuracy that ken's quote check protects. This comparison does not test either.

One thing the confound does not explain: the weaker model made no false claim that I found in 34 checked claims. The plain chat made two weak ones in 36. The quote rule is the likely cause.

## The three most important weaknesses of ken

1. **It drops reasons and consequences that have no code line.** The question asks "why was it done that way". On #106, eight of nine decisions carry no reason. On #102, decision 4 says no alternative is shown, while commit `49df57b` explains the 50000. On #106 the commit message for `0b26023` says the pin URLs stay "because whether the repository can be fetched over HTTPS is the owner's call"; ken marks that decision "Needs the owner's opinion: no".
2. **It is too long and says each thing up to three times.** #106 is 36.8 KB against 6.9 KB. In #104 the block `sandbox.ts` lines 98-102 appears three times. #104 statement 2 quotes a 2,000-character paragraph for one sentence. Yet the quotes cover only 18 of 56 and 40 of 114 hunks on the two large changes.
3. **"Checked" covers less than it looks.** The check proves a quote exists, not that it supports the sentence. Every element in all three answers is labelled "inferred", so the label tells the reader nothing. A fact can sit in a quote with no sentence (the SSH key line under #106 decision 9). A cause can be asserted with no support (#104 statement 3). The numbers behind the reasons (7.5 MB, 1.7 MB) have no quote. The diagram on #106 shows three of seven changes and nothing says so.

Also: three to five times slower, at 370k to 500k tokens per answer.

## Three things the plain chat did better

1. **Reasons.** #102: why 50000 (under 7 KB plugin output, a 30 KB file kept whole, a tenth of the window) and why 50. #106: why `sampling` exists only on `openai-compatible` specs.
2. **Consequences for the owner's own work.** #106: "don't mix them in one report" after both versions moved; the SSH pins block CI. #102: there is no unlimited value, "use a very large one". #104: "This is the mismatch I'd fix next."
3. **Speed and plain order.** About one minute, 4 to 9 KB, in the order what, how, decisions, risks, with each reason next to its fact.

## What I would change in ken first

Give every decision a required reason of its own, and let commit messages and docs be quoted as its evidence. Then add one pass over the commit messages: each reason or deferred choice a message states must appear in the answer or be listed as left out. This targets the one criterion ken lost. It would have caught the owner's call on #106 and the reason for 50000 on #102.

Second, after that: drop any statement that restates a decision with the same quotes, and cap one quote's length. That removes about a third of #106 without losing a claim.

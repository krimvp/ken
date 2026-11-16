This is the first verdict of round 4 of the checkpoint after slice 3: a fresh judge compared ken's answers with a plain coding-agent chat on five pull requests, with Claude Opus on both sides.
It was run on 16 November 2026, with ken at commit ba270bf.
An AI judge scored it; the owner has not. The text is the judge's, unchanged: the prose check asked for no edits.

# Verdict: ken against a plain chat, five pull requests

## Result in short

- On #104, #102 and #106 (the three ken was tuned on): ken wins B and C, ties A. Rule met: **yes**.
- On #103 and #100 (not tuned on, but an earlier verdict on them was read): ken wins B and C, loses A. Rule met: **no**.
- On all five together: ken wins B and C, loses A. Rule met: **no**.
- Clearest win: B. Every ken entry carries lines I could read, and I found no false claim in ken across 39 claims checked by hand. The plain chat had one false risk and one unsupported reason, and quotes no code.
- Closest to a loss, and a loss on the two and on the five: A. The single most serious unique find of the whole comparison is the plain chat's, on #103.
- A is a tie on the three only because of the second pass. Without it ken would have lost A on #104 and on #102.
- The plain chat is shorter and easier to read on all five.
- None of the five is unseen. The three ties on A come from the pull requests ken's wording was tuned on. The two others show the loss. I read the two as the more honest signal.

## How I checked

For each pull request I read `git diff M^1 M`, the commit messages, and the code around the change at the merge commit, and wrote my own list of decisions and risks before I opened either answer. Then I read both answers in full and checked at least six claims in each by hand against the code (listed per pull request below). I checked every risk on both sides against the code before I counted it. For ken I judged whether the quoted lines show what the sentence above them says. I read only the brief, the ten answer files and the repository `/home/user/aigents`. I did not read ken's own code, its stored record, or any earlier verdict. Criterion C is judged from what the brief says and what the files state, not from a test of the store.

---

## #104: start runCode's deadline when the VM starts the code

**My yardstick.** The worker posts `started` when it gets the `run` message. The host starts the `codeTimeoutMs` timer on that message, and resets `deadline` so the 1 s grace counts from there. Boot has its own fixed 10 s limit, which rejects. Abort still works during boot. Tests now time from the first tool call. Real risks: (1) `sandboxTool` in `src/core-tools.ts:105` still builds `AbortSignal.timeout(host.timeoutMs)` at the call, so the code's own tool calls keep the old clock; (2) a whole call can now last boot + timeout + grace; (3) the deadline starts when the host reads `started`, so a busy host gives code extra time; (4) no test covers the 10 s limit or an abort during boot; (5) `runBash` still counts from the call.

**Accuracy.** Plain, checked: core-tools.ts:105 (true), `started` sent before the code runs (true), `settle` counts from the reset deadline (true), boot failure rejects with that message (true), "it reaches the engine as a thrown tool error" (true: `execute` in `src/engine.ts` catches and returns `Tool … failed: …`), runBash unchanged (true), a09770e comes before the fix (true), busy host extends the deadline (true). No false claim.
ken, checked: decision 3, VM ready before the handler (true), risk 1 (true), risk 4, no boot-limit test (true, no test mentions it), risk 5 (true), risk 6, no catch in `sandboxTool` (true, but the engine catches it, so it is not a danger; ken left it open), risk 7, stale comment (true, trivial), decision 4 (true), all four diagram arrows (true). No false claim.

**Completeness.** Both cover the fix and the main risks. ken left one question open that one more read would have closed: what the model sees after a boot timeout. The plain chat answered it.

**A.** Both found the old clock in core-tools, the 10 s addition, the busy host and runBash. ken only: no test for the boot limit or an abort during boot (real, minor to moderate); stale `CodeHost` comment (trivial). Plain only: the new test depends on timing (minor). Tie.

**B.** ken: decision 1 and decision 4 are labelled "recorded" and the quoted message lines do give the reason. Risk 5 quotes lines 105 and 120 of core-tools.ts, which show the claim exactly. Risk 3 quotes the runBash deadline line. Arrow 6 quotes the `run(...).then(post)` line. Weak one: risk 4 ("no test covers…") sits under `let started = Infinity`, which cannot show an absence. Plain: names files, functions, error strings, two commit hashes and one file:line. No code quoted. ken wins.

**Second pass.** Added three. Risk 5 (old clock in core-tools) is real and is the main risk of this pull request; the plain chat had it in one pass. Risk 6 is a true fact but not a danger. Risk 7 is trivial. It withdrew one loosely worded risk. It earned its cost here: without it ken loses A.

**Diagram.** True to the code. Four arrows, one idea: boot timer, `started`, then the real deadline. It helps.

**Readability.** Plain: 27 lines, risks in order of weight. ken: 180 lines in text, statements repeat the decisions. Plain.

**Cost.** ken 168 s, 356k tokens in, 18.8k out. Plain: one to three minutes.

---

## #102: bound state records, the record log, tool results, deny reasons, captured content

**My yardstick.** Seven commits. Unchanged state updates write no record (compared by `JSON.stringify`). A take hands on only each plugin's last state. The log drops taken records. New `maxToolResultChars`, default 50000, applied in `execute` after redaction, text only. Denial reasons cut at 1000. `session__inspect calls` shows the newest 50. Captured history keeps the newest messages that fit 131072 characters; images captured as type and size. Real risks: default caps change behaviour for existing hosts; the transcript loses intermediate states; the `respects` check now reads state from before the step, so it is looser; memory still grows through the `byKind` indexes; images and pre-execute errors are not capped; the history is still serialised in full on every request; the telemetry cap is soft because the newest message is always kept; key order defeats the equality check.

**Accuracy.** Plain, checked: stringify compare (true), last state per take (true), cap after redaction, across blocks, images untouched, thrown errors capped (true), 16 KiB state cap (true, `records.ts:206`), 131072 justified by OTLP request size (true, in the design doc), `respects` looser (true), `checks.ts` changed again later (true, #103 and #106), truncation note lands after images (true), newest message can exceed the cap (true). No false claim.
ken, checked: the eight "recorded" reasons against the commit messages (all hold), risk 4, denial result joins every denial uncapped (true, `engine.ts:564`), risk 5 (true), risk 6, GC-timed test (true), risk 10, invalid-arguments error not capped (true), risk 11, indexes keep every call and usage record (true), risk 9 (true), risk 3 (true). No false claim.

**Completeness.** ken missed: `respects` got looser (it reports the change as a statement, not a risk); the telemetry cap is soft; no "unlimited" value. Plain missed: memory still grows through the indexes; pre-execute errors are uncapped; the GC-timed test. Plain states "images pass through untouched" as a fact, not as a risk.

**A.** ken only: index memory still grows (moderate, it limits the pull request's own goal); images uncapped as a risk (minor to moderate); pre-execute errors uncapped (minor); GC test (minor); many denying gates add up (minor). Plain only: `respects` looser (moderate); telemetry cap soft (minor to moderate); surrogate split and characters-not-tokens (minor); no unlimited value (minor). Neither clearly outweighs. Tie.

**B.** ken: all eight decisions "recorded", and each rests on message lines that give the reason. Risk 11 quotes the two `push` lines. Risk 6 quotes the three test lines. Risk 4 quotes a test bound of 2300 for two denials, which supports it indirectly. Weak one: risk 1 (the transcript has gaps) sits under a message line that says the dropped copies "carry nothing a reader uses", which argues the other way. Plain: commit hashes and function names per item, no lines. ken wins.

**Second pass.** Added four: default cap for every host (real, and the plain chat's first risk; ken's first pass had missed it), images uncapped (real), pre-execute errors uncapped (real, minor), indexes still grow (real, moderate). It earned its cost: without it ken loses A.

**Diagram.** None.

**Readability.** Plain is long (57 lines) but ordered. ken is 268 lines; its eight statements mirror its eight decisions, and `engine.ts` line 408 is quoted three times. Plain.

**Cost.** ken 129 s, 415k tokens in, 11.8k out.

---

## #106: judged counts, fixture hashes, sampling, leak nonce, vacuous scenarios

**My yardstick.** Seven commits. `<kind>_judged` and per-step metrics; `respects` now judges prompts that ended `error` or `aborted`. Suite version hashes plugin directories; grader version follows relative imports by regex, with a test against what Node loads. `--temperature` and `--seed`, recorded as `sampling` with `null` for unset. Leak mark carries a per-run nonce, added after the scrub; old runs read by the old mark. Authored scenarios that can only pass or skip are refused; recorded ones still read. A test ties `requirements.txt` to its lock. Real risks: every version moved, so old grades do not compare; the metric set changed; per-step ids come from shipped scenarios only; the regex misses packages and dynamic imports; a seed is not honoured everywhere; stricter parsing breaks outside scenarios; an older build rejects new `run.json` fields; `Number('')` is 0.

**Accuracy.** Plain, checked: `follow@3`, `follow@4` in `core-long-session` (true), load-hook test (true), nonce after scrub (true), `Problems.vacuous` authored only (true), format not bumped (true), lock file test (true), default endpoint (true), versions changed on merge (true). One unsupported reason: "pi 1.3.0 only applies sampling params through its OpenAI-compatible adapters". The commit says only that pi merges them into the request body.
ken, checked: decision 1 (true), risk 1 (true), risk 7, `Number('')` (true), risk 9, old build rejects unknown fields (true, the parent commit has the same check), risk 5 (true), decision 8 (true), risk 2 (true). No false claim. One weak label: decision 3 is "recorded", yet its own Why says the commit "gives no further reason".

**Completeness.** ken missed: every version moved on merge; the metric set changed. Plain missed: an older build rejects new runs; `Number('')`; stray files move the suite version. Neither said that an errored prompt with no calls now passes `respects`.

**A.** ken only: old builds reject new runs (minor to moderate); `Number('')` (minor); stray files (minor). Plain only: all versions moved, do not mix reports (moderate); metric set changed (minor to moderate); two extra decisions (no format bump, sampling only on one spec kind). Tie.

**B.** ken: decisions 1, 2, 4, 5, 7 rest on message lines that give the reason. Risk 9 and risk 7 quote the exact lines. Statement 2 quotes the five-line branch that shows the claim. Weak: decision 3's label, above. Plain: file names per item, no lines, no hashes for most commits. ken wins.

**Second pass.** Added one: an older build rejects new runs. Real, minor to moderate. Barely earned 30 s and 322k tokens.

**Diagram.** None.

**Readability.** Plain: 35 lines. ken: 262 lines, with a 20-name "used elsewhere" list of which no name was followed. Plain.

**Cost.** ken 190 s, 614k tokens in, 21.1k out. The slowest and the dearest of the five.

---

## #103: read old recorded runs, keep the evidence of a stopped attempt

**My yardstick.** Three commits. `parseRecordedScenario` keeps an expectation with an unknown check as recorded, and `check` reports a skip; authored scenarios stay strict; a written rule for the next vocabulary change. `aigent run` aborts on SIGTERM, takes a whole-run `--timeout`, ignores EPIPE. The subject spawns the child, passes signals on as SIGTERM, passes `timeout_s` less a margin (a tenth, at most 30 s), and deletes a leftover `aigent-run` before each attempt. Real risks: the retry's delete removes the very run a SIGKILLed attempt was made to leave behind; the fix depends on multeval passing `timeout_s`; a second signal kills the child unwritten; short budgets leave a tiny margin; Ctrl-C is graded as a timeout; the subject hangs if the child hangs; no output limit; old grades lose `refuses`; a misspelled check in a recorded run now reads as a skip.

**Accuracy.** Plain, checked: two entry points to one parser (true), skip not fail (true), margin (true), delete before each attempt (true), risk 1, the chain from SIGKILL to the deleted run (true by the code: the subject responds only after the child closes, and the next attempt deletes), aborted graded as `timeout` (true, `STATES[3]`), exit `null` fails (true), no `maxBuffer` (true), the doc rule (true). No false claim.
ken, checked: risk 1, `once` against `on` (true), risk 2 (true), risk 3 (true), risk 4, the `timeout_s` test never kills the subject (true), risk 6, no SIGHUP in the CLI (true), decision 2 (true), all four diagram arrows (true), decision 6 (true). No false claim.

**Completeness.** ken missed the main risk. Its decision 8 says the subject deletes the old result "and multeval already holds the outcome", repeating the code comment. Its decisions 5 and 7 say the run still writes after a SIGKILL. It never joins the two. Its risk 5 says only that "anything else stored at that path is lost". ken also missed: the dependency on multeval passing `timeout_s`, Ctrl-C graded as a timeout, the hang, the output limit, typos read as skips. Plain missed: the SIGKILL path is untested, and SIGHUP in the CLI. Plain names the margin but not the 10 % case for short budgets.

**A.** Plain only: the retry deletes the evidence the pull request set out to keep (serious); the fix depends on multeval passing `timeout_s` (moderate); Ctrl-C graded as timeout (minor to moderate); hang, output limit, typos (minor). ken only: the SIGKILL path is untested (moderate); short-budget margin (minor to moderate); SIGHUP (minor). One serious risk outweighs these. Plain wins.

**B.** ken: seven of eight decisions are labelled "inferred" and quote the code comment or doc line that gives the reason; that label is honest. Risk 1 quotes three lines that show the claim exactly. Risk 4's quote shows the test but not the missing kill. Plain: commit hashes and file names, no lines. Its risk 1 is a chain of three facts with nothing quoted; the owner would have to open `subject.ts` to trust it. ken wins.

**Second pass.** Added nothing, withdrew nothing. 22 s and 180k tokens for no change, on the pull request where ken most needed it.

**Diagram.** True. It shows the subject's side only. The step that matters, `aigent run` writing the result when it is stopped, has no arrow. Some help, not much.

**Readability.** Plain: 58 lines, problem, fix, decisions, risks. ken: 242 lines. Plain.

**Cost.** ken 169 s, 448k tokens in, 19.0k out.

---

## #100: cap tool calls per code run, stop waiting past the deadline

**My yardstick.** Three commits. `maxCodeCalls`, default 64, per `core__run_code` or `core__run_bash` run; a call past it is refused before `host.call`, and the result opens with a count. At most 8 calls run at once, fixed. Past the deadline or abort the run waits 1000 ms, then returns and logs a WARN for each call still running. A test pins 10,000 concurrent calls. Real risks: default 64 changes behaviour; refused calls skip gates, records and spans; queueing 8 at a time against the same deadline can time out runs that used to finish; abandoned calls keep running and the model is not told; the cap is per run, not per turn; queued calls aborted leave id gaps; timing in tests.

**Accuracy.** Plain, checked: cap in `sandboxTool` for both modes (true), note at the top (true), the crash was fixed by fb6e076 (true by the commit message), refused before `host.call` (true), queue of 8 (true), two clocks (true), main still matches (true). One false risk: "the warning can miss queued calls… they can still start once a slot frees, after the run has returned". `settle` waits for queued calls too. Where it gives up, the timeout signal has already fired, so every waiter returns `aborted`. No queued call starts after the run returns.
ken, checked: the four "recorded" reasons (hold), risk 3, id gaps (true), risk 4, the sandbox test bypasses the engine cap (true), risk 5 (true), risk 6 (true, trivial), risk 7, counters are per call (true), statement 5 (true). No false claim.

**Completeness.** ken missed: refused calls leave no record and pass no gate, though its statement 1 quotes those very lines; queueing can cause timeouts. Plain missed: the cap is per run, so several parallel code calls in one turn multiply it.

**A.** Plain only: refused calls leave no trace (moderate); throttling can cause timeouts (moderate); leaked memory (minor). ken only: cap is per run, not per turn (moderate); id gaps (minor); the 10,000-call test bypasses the cap (minor). Plain is slightly ahead, not clearly. Tie on this pull request alone.

**B.** ken: decisions 1 and 3 are "recorded", but the quoted lines give the problem, not why 64 or why 8. Risk 3 and risk 7 quote the lines that show them. Plain: commit hashes, constants, no lines. ken wins.

**Second pass.** Added one: cap is per run, not per turn. Real, moderate, and the plain chat did not have it. Earned its 23 s.

**Diagram.** None.

**Readability.** Plain: 34 lines. ken: 166 lines. Plain.

**Cost.** ken 115 s, 405k tokens in, 11.8k out. The cheapest of the five.

---

## Criterion C: finding the answer tomorrow

The plain chat leaves a chat transcript. Nothing is stored in the project. The owner finds it again only if the chat tool keeps history, and only by scrolling.
ken, as told, stores each answer in a project record and a personal history and can reopen it without a model. Each file states what was stored (for #102: 1 work, 3 topics, 3 notes, 8 decisions). The answer also carries the commit each quote was read at, so it stays checkable after the code moves. I did not test the store. On what I was told, ken wins C on all five.

## Table

| PR | A | B | C | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #104 | tie: both found the old clock in core-tools; ken only via second pass | ken: lines under every entry | ken: stored | tie: no false claim; plain settled what ken left open | tie | plain: 27 lines against 180 | plain: ken 168 s, 356k in |
| #102 | tie: ken index memory, plain `respects` looser | ken: eight reasons traced to messages | ken: stored | tie: no false claim | tie: each missed two real ones | plain: ken repeats decisions as statements | plain: ken 129 s, 415k in |
| #106 | tie: plain versions moved, ken old builds reject | ken; one "recorded" label has no reason | ken: stored | tie: plain one unsupported reason | tie | plain: 35 lines against 262 | plain: ken 190 s, 614k in |
| #103 | plain: retry deletes the kept run | ken: plain's chain has no lines | ken: stored | tie: no false claim | plain: ken missed the main risk | plain | plain: second pass added nothing |
| #100 | tie, plain slightly ahead: refused calls leave no trace | ken | ken: stored | ken: plain has one false risk | plain, slightly | plain: 34 lines against 166 | plain, slightly: ken 115 s, 405k in |

## Verdict against the plan's rule

**#104, #102, #106: yes.** ken wins B and C on each. A is a tie on each and a tie together. Clearest win: B. Closest to a loss: A, held only by the second pass on #104 and #102.

**#103, #100: no.** ken wins B and C. ken loses A: the plain chat wins #103 clearly and is slightly ahead on #100. Clearest win: B. The loss is A.

**All five: no.** ken wins B and C. A is lost: three ties, one clear loss, one narrow one. Across the five the plain chat has one serious unique find and about five moderate ones. ken has about four moderate ones and no serious one. Clearest win: B. The loss is A.

The split matters. The tie on A sits on the three pull requests ken's wording was tuned on. The loss sits on the two it was not tuned on, even though their earlier misses were known to the designers.

## What ken's structure added and what it cost

Added:
- Trust. Every decision, risk and statement has lines the owner can read in place. I found no false claim in ken. The one false risk in the comparison is the plain chat's (#100), and nothing in the plain answer would let the owner catch it without opening the code.
- A reason label that mostly means something. "Recorded" reasons trace to commit messages on #102 (8 of 8) and #106. "Inferred" on #103 (7 of 8) correctly warns that the reasons come from comments.
- Honest gaps. The coverage count, the commit-message count and the closing note say what was not read. The plain chat never says what it skipped.
- Storage, as told.

Cost:
- Length. 166 to 268 lines against 27 to 58. The page folds quotes, but the entries remain. "What the change did" restates the decisions on every pull request.
- Flat risk lists. A stale comment sits at the same weight as the main risk (#104). The plain chat orders by weight and says which one it would fix next.
- Split thinking. The format cuts the change into single entries with single quotes. The risks ken missed are the ones that need two entries read together (#103, #100). The plain chat, free of the format, joined them.
- Tokens. 2.24 M tokens in and 83k out for five answers, 771 s in all. Time is at the top of the plain chat's range, not far beyond it.

## The second pass over the five

It added nine risks and withdrew one. Four matter: the old clock in core-tools (#104), the default cap for every host and the indexes that still grow (#102), the per-run cap (#100). Three are real but minor (#102 images, #102 pre-execute errors, #106 old builds). Two are trivial or not a danger (#104). On #103 it added nothing.

It took 151 s of 771 s, about a fifth of the time, and 1.13 M of 2.24 M tokens in, about half.

It earned its cost. On #104 and #102 it is the reason ken does not lose A. But it is uneven. It finds risks next to a line it can quote in a neighbouring file. It did not find the risk that comes from two of ken's own decisions taken together, which is what #103 needed.

## The three most important weaknesses of ken, in order

1. **It does not join its own entries.** On #103, decision 8 says the subject deletes a leftover result and repeats the comment that "multeval already holds the outcome". Decisions 5 and 7 say a run still writes after the subject is SIGKILLed. Together they mean the retry deletes the only copy of the run the pull request was written to keep. ken lists both and draws no risk. The plain chat's first risk is exactly this. Same shape on #100: statement 1 quotes lines 114 to 117 of `core-tools.ts`, where a refused call returns before `host.call`, and no risk says that such a call passes no gate and leaves no record.

2. **The first pass is weak on consequences, so A hangs on a second pass that is uneven.** On #104 the main risk (`core-tools.ts:105`) is absent from the first pass. On #102 the first pass missed that every existing host now gets a 50000-character cap. On #103 the second pass added nothing. The "used elsewhere" list does not carry the load: a quote follows 1 name on #104 and 0 names on the other four, and the list holds noise from unrelated files (on #100, `stuck` in `.agents/skills/…`; on #103, `Command` in `.agents/skills/poteto-mode/scripts/orch/orch.ts`).

3. **Long, repetitive, and it stops one read short.** On #102 the eight statements mirror the eight decisions, and one line is quoted three times. On #104 risk 6 ends "the model then gets whatever the engine does with a thrown tool", and the closing note admits it did not check; the `catch` in `execute` answers it in one read, and the plain chat stated the answer. Some labels look firmer than they are: #106 decision 3 is "recorded" while its Why says the commit gives no reason; "Undo: easy" and "Needs the owner's opinion" rest on nothing quoted.

## The three things the plain chat did better

1. **It reasoned across parts of the change and doubted the code's own comments.** #103 risk 1: "The retry deletes the evidence the PR set out to keep… 'multeval already holds that attempt's outcome' means only the bare timeout state, not the graded steps."

2. **It closed questions and said what to do.** #104: a boot failure "reaches the engine as a thrown tool error", and of the clock mismatch, "This is the mismatch I'd fix next." #102: "There is no 'unlimited' value… use a very large one." #106: "don't mix them in one report."

3. **It was short and ordered by weight, and got the main risk in one pass.** #104 in 27 lines, with the core-tools risk first in its list. It also named operational effects ken missed: on #100, that queueing 8 at a time against the same deadline can time out runs that used to finish; on #106, that every grader and suite version moved on merge.

## What I would change in ken first

Change the second pass from "any more risks?" to a pass over ken's own first answer. Give it the decisions and statements and make it answer three fixed questions, each with quotes:

1. For each pair of decisions that touch the same file, directory or signal: what happens when both apply?
2. For each early return, refusal or delete in the quoted lines: what no longer happens after it (a record, a gate, a kept file)?
3. For each reason copied from a comment or commit message: is it true in the code?

That targets the #103 and #100 misses directly. Second, and cheap: drop "What the change did" where it repeats a decision, and make ken order risks by weight, so the page a tired owner opens is closer to the plain chat's 30 lines.

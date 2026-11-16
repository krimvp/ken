This is the verdict of round 3 of the checkpoint after slice 3: a fresh judge compared ken's answers with a plain coding-agent chat on five pull requests, ken on the glm-5.3 model and the plain chat on Claude Opus.
It was run on 16 November 2026, with ken at commit faeee9f.
An AI judge scored it; the owner has not. The text is the judge's, except two long dashes the prose check turned into commas.

# Verdict: ken (glm-5.3) against a plain chat (Claude Opus) on five pull requests

Judge's method. I read the ten answer files and nothing else in the two folders. For each pull request I read the full diff of the merge (`git diff M^1 M`), every commit message, and the code around each disputed claim. I wrote the yardstick before scoring. I checked 15 of ken's quoted lines against the repository at the stated commit; all 15 exist at the stated line.

Short result. ken wins B (trust through quotes) and C (the answer is kept) on all five. ken loses A (finding decisions and risks the other side missed) on four of five, and ties on one. By the plan's rule, "win at least one, lose none", the answer is **no** for the three tuned pull requests, **no** for the two unseen ones, and **no** for all five.

---

## Pull request #104 (deadline of `runCode` starts when the code starts)

**Yardstick.** The worker posts `started` when it takes the run. The host arms the code deadline when it receives that message. Boot has its own hard-coded 10 s limit, which rejects (an error, not a timeout). Abort still works during boot. The 1 s grace now counts from the new deadline. Tests: a busy-host test added first (a09770e), and the two long-native-call tests now time from the first tool call. Real risks: (1) `core-tools.ts:105` still arms `AbortSignal.timeout` at the call, so the code's tool calls are aborted on the old clock; (2) a busy host extends the real run time; (3) a run can last 10 s plus the timeout; (4) the new test holds only by timing.

**Accuracy, plain.** Checked 10 claims: old deadline at the call, the 10 s limit and its message, grace from the new deadline, `core-tools.ts:105` on the old clock, busy host gives extra time, 10 s plus timeout, test-first commit, test timing, file and line counts, `runBash`. Nine true. One loose: "`runBash` deadline still starts at the call". It starts after the lazy `just-bash` import.

**Accuracy, ken.** Checked decisions 1 to 3, risks 1 to 5, statement 3, arrows 4 and 8. Risk 5 is half wrong. It says the first call "now" compiles WASM before any timer is armed, so a stalled compile hangs with no bound. The timer and the abort listener were armed after the compile before this change too. Only "compile time no longer counts against the deadline" is new. Risk 2 (a host blocked for more than 10 s gets a false boot failure) is true by Node's timer order, but far-fetched. Risk 4 names the exact failure mode of the new test, which the plain answer states vaguely. Statement 3 on `runBash` is more exact than the plain answer.

**Completeness.** Both cover the yardstick. Plain alone: the 10 s limit has no setting; the grace follows the new deadline. ken alone: the 10 s blocked host; compile time no longer counted.

**A.** Tie. Each side has two small unique items. Both found the serious one (tool calls on the old clock).

**B.** ken. Five elements judged (decision 1, decision 2, risk 3, statement 3, arrow 4): the quotes show what the sentences say. Weak spots: risk 1's third quote is the bare line `ctx.signal,`; risk 5's "used to" cannot be shown by a quote of the new code. The plain answer gives commit hashes, file names and one line number, and no quoted code.

**Diagram.** True. It shows the message flow the change is about. It helps. Arrow 8 says terminate happens "at the deadline or abort"; it also runs after a normal return.

**Readability.** Plain. 3.9 KB against 12.9 KB. ken quotes `sandbox.ts` lines 98 to 101 three times.

**Cost.** Plain: one to three minutes, tokens not stated. ken: 216 s, 357k tokens in, 56k out, one answer sent back by the quote check.

---

## Pull request #102 (bounds on state records, the record log, tool results, deny reasons, captured content)

**Yardstick.** Seven commits. Unchanged state updates write nothing (compared by `JSON.stringify`). A take keeps each plugin's last state record. The log drops taken records. `maxToolResultChars`, default 50000, cut after redaction. Deny reasons cut at 1000. `session__inspect calls` shows the newest 50. Captured history keeps the newest messages within 131072 characters; image data is never captured. The eval's `respects` check now also reads earlier steps. Real risks: default cuts change behaviour for hosts; the transcript no longer holds every state write; the `respects` check got looser and can hide a miss; the telemetry cap is soft (the newest message is always kept) and the whole history is still serialised per request; the dedupe depends on key order; the slice can split a surrogate pair.

**Accuracy, plain.** Checked 13 claims, including the `respects` risk, the key-order risk, the soft telemetry cap, "only reader is `takeRecords` in `pi.ts`", the 16 KiB state cap, the reason for 50, and "`checks.ts` was changed again later" (three later commits). All true.

**Accuracy, ken.** Checked decisions 1, 2, 3, 5, 6, 9, risks 1 to 4 and 7, statements 2 and 3, arrows 7, 9, 10. None false. Statement 2 is too broad: "every cut the PR makes ... a captured string" ends with the truncation note. The captured-string cut predates this pull request and is not in the quotes, and the inspect and history omissions use other notes.

**Completeness.** ken records the `respects` change as a decision but not as a risk. ken misses the soft telemetry cap, the remaining per-request cost, key order, surrogate pairs. Plain misses that a call denied by many gates joins one reason per plugin into a result no cap reaches.

**A.** Plain. ken's unique finds: the multi-gate denial result (small, bounded by the number of gate plugins) and that `onToolResult` hooks see the cut result (small). Plain's unique finds: the looser `respects` check (can hide a real miss), the soft telemetry cap and the cost that still grows with the session, plus three small ones. Plain's outweigh.

**B.** ken. Five elements judged (decision 1, decision 5, risk 2, risk 7, arrow 10): all supported. Risk 7 quotes the old line at `bb7ae10` and the new line at `03c113f`, which proves a change, not only a state. All nine "recorded" labels rest on message lines that give a reason. The plain answer names a commit per item and file and function names, no quotes.

**Diagram.** True, but it shows only the state-record path: three of seven commits. Nothing tells the reader that the caps and the telemetry change are not in the picture.

**Readability.** Plain. Its seven numbered items match the seven commits. ken is 22 KB with nine decision cards; "Rejected: none shown by the code or history" appears nine times.

**Cost.** ken: 196 s, 623k tokens in, 58k out.

---

## Pull request #106 (eval scores: judged counts, hashes, sampling, leak nonce, vacuous scenarios)

**Yardstick.** `<kind>_judged` and per-step metrics. `respects` judges prompts that ended `error` or `aborted`. Suite version hashes plugin directories. Grader version follows the import graph. `--temperature` and `--seed`, recorded as `sampling` with `null` for unset. A per-run nonce in the leak mark. Authored scenarios that can only pass or skip are refused; recorded ones still read. A test that the pin and the lock agree. Real risks: every version changes, so old and new results do not mix; a regrade can turn `respects` from skip to fail; new metric names; per-step metrics are declared from shipped scenarios only; the import scan is a regex; a seed may be ignored by the server yet recorded; a new `run.json` has fields an older build rejects though the format string is unchanged; any stray file in a plugin directory moves the suite version.

**Accuracy, plain.** Checked 12 claims, including the load-hook test, `follow@3`/`follow@4` in `core-long-session`, nonce added after the scrub, the undeclared-metric risk, and the regex limits. All true. One not shown by the repository: that pi applies sampling "only" through its OpenAI-compatible adapters.

**Accuracy, ken.** Checked decisions 1, 3, 4, 5, 6, 7, 10, 11, risks 1 to 4, statements 3 and 4. None false. Risk 1 is confirmed: the old `known` list lacks `sampling` and `leakNonce`, so an older build fails with "unknown field". Decision 10 is labelled "recorded", but its message lines say how it works more than why; borderline. The "Rejected" lines on decisions 1 and 3 to 7 restate the old behaviour as if it were an alternative someone weighed. The history shows no such weighing, except for the HTTPS pins (decision 11).

**Completeness.** ken misses: versions change on merge, new metric names, undeclared per-step metrics, regex limits, stricter parsing for scenarios outside the repo. Plain misses: older builds cannot read new runs; stray files move the version; the loader crashes without a named error on a missing plugin directory.

**A.** Plain, narrowly. ken has one solid unique risk (stale checkout cannot read new runs) and two small ones. Plain has four of about that weight (do not mix versions, undeclared per-step metric, regex gaps, seed ignored on the default endpoint) and two small ones.

**B.** ken. Five elements judged (decision 1, decision 3, risk 1, risk 4, statement 4): all supported. Arrow 12 reuses one line for two actions. The plain answer names files per item, no commits per item, no quotes.

**Diagram.** True. It is a map of the pipeline and where `sampling`, `leakNonce` and the version hash land. It helps orientation. It does not show judged counts or the vacuous-scenario refusal.

**Readability.** Plain. 6.9 KB against 26 KB. Twelve decision cards is a lot to scan.

**Cost.** ken: 249 s, 847k tokens in, 78k out, one answer sent back by the quote check and one for form.

---

## Pull request #103 (read old recorded runs; keep the evidence of a stopped attempt), never seen by ken's design

**Yardstick.** A lenient parser for the scenario copy in `run.json`: an unknown check is kept raw and reported as a skip. A written rule for future vocabulary changes. `aigent run` aborts on SIGTERM, takes `--timeout`, ignores EPIPE. The subject uses `spawn`, forwards three signals as SIGTERM, passes `timeout_s` less a margin, and removes a leftover result directory before each attempt. Real risks: the removal deletes the very run a SIGKILLed attempt wrote; the fix does nothing unless multeval puts `timeout_s` in the subject's config (`if (config.timeout_s !== undefined)`); a typo in a recorded check now reads as a skip; old grades shift; a second signal still loses the run; a Ctrl-C is graded as `timeout`; the subject hangs if the child hangs; the 64 MB output limit is gone; an orphaned run can write late and collide with a retry.

**Accuracy, plain.** Checked 12 claims, including all three signal edge cases, the `maxBuffer` change, the margin, and the `rm`. All true. Risk 1 rests on multeval retrying in the same work directory, which the code comment assumes and the repository cannot prove; the answer says so.

**Accuracy, ken.** Checked decisions 1 to 7, risks 1 to 3, statements 1 and 2, arrows 7 and 8. Risk 1 is half speculation: "if multeval validates evidence against declared metrics, a regrade could fail". Scores come only from `CHECKS`, and nothing shows evidence is validated. Its first half (only `aigent check` is tested on such a run) is true. Risk 2 (orphan writes late, retry hits "already exists") is a real race. Risk 3 is true, and the doc line it quotes already states it. Arrow 8 says the subject responds "with the graded run"; it responds with a state, text and cost.

**Completeness.** ken misses the two risks that matter most: the retry deletes evidence, and the dependence on `timeout_s` arriving in config. It also misses typos accepted, Ctrl-C graded as timeout, the hang, the output limit. Plain misses the orphan race.

**A.** Plain. One real unique find for ken (the race). Two serious and four small ones for plain.

**B.** ken. Five elements judged (decision 4, decision 6, risk 2, risk 3, arrow 7): supported. Risk 1's quotes show what the grader declares, not what multeval does with it. The plain answer names commits and files, no quotes.

**Diagram.** True. It shows the second fix only. The first fix (old runs read again) is not in it. It helps for the part it shows.

**Readability.** Plain. Two problems, each with problem, fix, decisions. ken's decision 2 quotes the same two doc lines twice.

**Cost.** ken: 271 s, 607k tokens in, 71k out, one answer sent back.

---

## Pull request #100 (cap tool calls per code run; stop waiting past the deadline), never seen by ken's design

**Yardstick.** `maxCodeCalls`, default 64; a call past it fails in the code without running; the result opens with a refusal count. At most 8 calls at once, the rest queue in order. After the deadline or abort the run waits 1000 ms more, then returns and logs a WARN per stuck call. A test for 10,000 concurrent calls. The cap sits in the one wrapper both modes share. 8 and 1000 ms are hard-coded. Real risks: more than 64 calls now fail by default; a refused call leaves no record, span or gate check; 8 at a time against the same timeout can turn a finishing run into a timeout; stuck calls keep running; the concurrency test relies on timing; the abort branch of the grace has no test.

**Accuracy, plain.** Checked 13 claims. Twelve true. One false: "the warning can miss queued calls ... they can still start after the run has returned". `runCode` and `runBash` wait in `settle` for every in-flight call, queued ones included, until the deadline plus grace. By then the timeout signal has woken every queued call and it returns `aborted`. No queued call starts after the run returns.

**Accuracy, ken.** Checked decisions 1 to 5, risks 1 to 4, statements 1 and 2. None false. Risk 3 ("the abort branch has no test") is true of the diff, but a quote cannot show an absence. The "Rejected" lines on decisions 1 and 2 restate the old behaviour.

**Completeness.** ken misses: refused calls leave no trace; throttling can cause timeouts; the constants are not configurable. Plain misses: the untested abort branch.

**A.** Plain. ken's unique find is one small test gap. Plain's are two real behaviour risks, minus one false one.

**B.** ken. Five elements judged (decision 1, decision 2, decision 5, risk 4, arrow 5): supported. The plain answer names commits, files and constants, no quotes, and its one false risk shows the cost of that.

**Diagram.** True. It shows where the cap sits. It leaves out the grace period. Modest help.

**Readability.** Plain, by a small margin. This is ken's shortest answer and its five decisions map well to the change.

**Cost.** ken: 236 s, 349k tokens in, 58k out.

---

## Criterion C (structural)

Plain chat leaves a chat transcript. It is not tied to the pull request, not in the repository, and reading it again in a useful way means finding the chat or asking again and paying again. ken, as described, stores each answer in a project record and a personal history and can reopen it with no model. Each ken file ends with a count of what was stored (for #106: one work, twelve decisions, three topics, three notes). I did not open the store; I take its existence from the description and that line. ken wins C on all five.

## Table

| PR | A | B | C | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #104 (tuned) | tie: two small unique finds each | ken: checked quotes; plain has none | ken: stored | tie: plain one loose claim, ken one misleading risk | tie | plain: 4 KB against 13 KB | plain: faster |
| #102 (tuned) | plain: looser `respects` check, soft telemetry cap | ken | ken | tie: none false on either side | plain | plain: seven items for seven commits | plain |
| #106 (tuned) | plain, narrowly: four medium against one | ken | ken | tie: none false; ken's "Rejected" lines are filler | plain | plain: 7 KB against 26 KB | plain |
| #103 (unseen) | plain: retry deletes evidence, `timeout_s` dependence | ken | ken | plain: ken's risk 1 is half speculation | plain | plain | plain |
| #100 (unseen) | plain: refusals leave no trace, throttling causes timeouts | ken | ken | ken: plain has one false risk | plain | plain, small margin | plain |

Cost detail: ken took 196 to 271 s and 0.35M to 0.85M input tokens per answer. Plain took one to three minutes; its tokens are not stated, so money cannot be compared.

## Verdict against the plan's rule

- **The three tuned pull requests (#104, #102, #106): no.** ken wins B and C. ken loses A (tie, plain, plain).
- **The two unseen pull requests (#103, #100): no.** ken wins B and C. ken loses A on both.
- **All five: no.** Same pattern. The untuned two are not worse on B or C, and they are clearer losses on A. So the tuning did not buy the B and C wins, and it did not fix A.

Clearest win: B. Every decision, risk, statement and arrow carries a quote I could check, and the "recorded" labels are honest in all but one borderline case. C is also a win, with no contest, but I judged it from the description.

Closest to a loss: A is not close; it is lost. Among the criteria ken won, none is near a loss.

## The model confound (my inference)

- From the tool's structure: the quotes, the recorded/inferred labels, the stored record, the coverage counts, the diagram. Also from structure: the length, the repeated quotes, the boilerplate fields, and the lack of a "what changed" list.
- From the model, mostly: the loss on A. ken's unique finds are sharp but local to a line (the unknown-field check in #106, the `once` handler in #103, timer order in #104). The plain chat's unique finds are consequences at the level of the system (a retry deletes the evidence; a refusal leaves no record; versions no longer compare). That is depth of reasoning, and Opus is the stronger model.
- Possibly from structure too: every risk must carry a quote, and an answer that fails the check is sent back (it happened on three of five). That may push the model toward risks that are easy to pin to one line and away from risks about what is absent or about another system. I cannot separate this from the model with this data. A run of ken on Opus, or of the plain chat on glm-5.3, would.
- The plain chat's one false risk (#100) is a reasoning error. A quote check would not have caught it, since the quoted lines would exist.

## ken's three most important weaknesses

1. **It misses the risks an owner most needs.** #103: nothing about the retry deleting the run the fix was meant to keep, nor that the fix depends on `timeout_s` arriving in config. #100: nothing about refused calls leaving no record or span. #102: the looser `respects` check is listed as a decision with no risk attached.
2. **A checked quote reads as proof, but it only proves the line exists.** #104 risk 5 says the hang is new; the quoted new code cannot show what was there before, and it was there before. #103 risk 1 ends in "if multeval validates evidence". #100 risk 3 claims a test is absent under two quotes of things that are present. The "Rejected" field in #106 and #100 restates the old behaviour as a weighed alternative.
3. **Too long, and no plain account of what changed.** 13 to 26 KB against 4 to 9 KB. #104 quotes the same four lines three times. "Rejected: none shown by the code or history" appears on 26 of 36 decisions. The summary is one or two sentences, so the reader must rebuild "what did it do" from question-and-answer cards. The diagram shows one slice (#102: three of seven commits) and does not say what it leaves out.

## Three things the plain chat did better

1. **System-level risks.** #103: "The retry deletes the evidence the PR set out to keep." #100: "Refused calls leave no trace except the note."
2. **A list of what changed, one item per commit, with the reason beside it.** #102's seven numbered items with hashes can be read in a minute.
3. **Priority and context.** #104: "This is the mismatch I'd fix next." #102: a note that `checks.ts` changed again in later pull requests. #100: "The code on main still matches the PR."

## What I would change in ken first

Fix risk recall, because A is the criterion it loses. Add a separate risk pass after the decisions. For each decision, make the model answer four fixed questions: who is affected by the new default; what is now deleted, dropped or no longer recorded; what does this rely on outside the repository that the code only asserts in a comment; what stored data stops being comparable. Let such a risk quote the line that creates the exposure (for #103: the `rm` line and the comment "multeval holds that attempt's outcome"). Then run ken once on the stronger model, so the next comparison measures the tool and not the model.

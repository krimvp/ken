This is one of the two verdicts of round 7 of the checkpoint: a fresh judge compared ken's answers with a plain coding-agent chat on three pull requests ken had not been run on before, with the same model on both sides.
It was run on 16 November 2026, with ken at commit 71d05de.
An AI judge scored it; the owner has not. The text is the judge's, unchanged: the prose check asked for no edits.

# Verdict on three unseen pull requests: #91, #90, #88

## Result in short

- The plan's rule is met: **yes**. ken wins B and C on all three pull requests and loses no criterion.
- **A is a tie** on the three together. ken wins A on #88, the plain chat wins A on #90, and #91 is level.
- The tie on A is not firm. A judge who only counts unique finds gives A to ken (about 10 against 7). A judge who only counts finds the owner can still act on today gives A to the plain chat, narrowly.
- Is ken's answer better? #91: level. #90: the plain chat, clearly. #88: ken, clearly. Together: ken, narrowly, and only because its answer can be checked and is kept. On what it finds, ken is not better than the plain chat.
- ken cost 4 min 2 s to 4 min 33 s and 519,000 to 623,000 input tokens per pull request. The plain chat took one to three minutes.
- The second look made the win on #88 and caused the loss on #90. It used 56% of ken's input tokens.
- First change: give the second look the later commits on main that touch the same files, taken from git with no model, and stop it from withdrawing a risk without a quote.

## How I checked

For each pull request I read the full diff of the merge (`git diff M^1 M`) and its commit messages before I opened either answer, and wrote my own list of what it did, its decisions and its risks. I then read the later history of the touched files, because a later fix is the firmest proof that a risk was real. I read the code around each claim at the merge commit: the callers of `redactJson` and `captured`, the transcript and event export in `src/pi.ts`, `storableState`, the code tools, the sandbox and its worker, `changesOf`, the shell and files fixtures and the four scenarios. For #90 I copied the tree at `bc3c796` into my own scratch folder and ran three probes against `runCode` (a trivial run took 7 ms, as both answers say). I changed nothing in the repository. I read the nine answer files and no other answer or verdict. I checked at least eight claims per answer by hand; they are listed under each pull request.

## The table

| PR | A | B | C | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #91 | tie: one real hidden find each | ken: quotes hold, one does not | ken: stored | plain: ken has one half-false risk | tie: each misses the other's find | plain, narrowly: ends with one fix | plain |
| #90 | plain: two risks the project later fixed | ken: quotes hold | ken: stored | plain: ken's two withdrawals are wrong | plain: ken withdrew what mattered | tie: ken's story and drawing are quick, plain says what is fixed | plain |
| #88 | ken: false passes the plain chat called tight | ken: quotes hold | ken: stored | ken: plain gives a wrong assurance | ken: three more real risks | ken, narrowly: story names both things to watch | plain |

## The plan's rule

Yes. ken wins B and C and loses none of A, B, C.

A on the three together is a **tie**. Each side has one clear win and the third is level. The weight on each side is about the same:

- ken's heaviest unique find: at #88 the shell fixture still passed some detours (`sort --out=`, `/proc` paths, `/dev/nullx`). It is real, it sits in the changed code, and it defeats the purpose of the change in rare cases. It was fixed in b7b032b (#95).
- The plain chat's heaviest unique finds: at #90 the worker is started from a hard-coded `sandbox-worker.ts` path, which breaks in a built package (it did; 0481814 fixes it on a branch, and main still has the path), and `runCode` waits without limit on tool calls after the deadline (fixed in 5e89f59, #100).

How sure: B and C are certain. A depends on weighing. A counter of unique finds says ken. A judge who discounts finds that are already fixed says the plain chat, narrowly, because all three of ken's #88 finds are fixed and the plain chat's `.ts` path and sandbox-cap finds are still on main. No reasonable weighing gives the plain chat A by a clear margin, so the "yes" holds, but ken did not win A.

## Is ken's answer better than the plain chat's?

- **#91: level.** Each found one hidden trap the other missed. ken's answer can be checked and is kept. The plain answer is shorter in time, has no false claim of weight, and ends with a one-line fix. ken has one risk that is half false.
- **#90: the plain chat, clearly.** It reported the two risks that the project later had to fix, and it said which gaps are already closed, with commit ids. ken's second look withdrew its own versions of both. ken's unique finds here (a failed WASM compile is never retried; a large tool result may crash the worker) are rarer cases.
- **#88: ken, clearly.** It showed that the "fail closed" parser still let some detours pass, on the first view, with the lines and the fixing commit. The plain chat wrote "It's tight, and I didn't find an obvious way to slip a write through a known read". That is a wrong assurance on the point of the whole change.
- **Together: ken, narrowly.** What decides it is the quotes and the record, not the finds. On finds the two are level. ken takes about twice the time and a large token bill, and one of its three answers was clearly worse on the risks that mattered. An owner who reads an answer once and moves on is served as well by the plain chat. An owner who wants to check a claim without the diff, or come back next week, is served better by ken.

## What ken's steps added and what they cost

Both sides ran the same model, so each difference comes from the tool.

- **The draft** (76 to 99 s, 119,000 to 146,000 tokens in) is the plain chat done inside ken. It adds nothing by itself.
- **The fixed form with quotes** (84 to 128 s, 99,000 to 150,000 tokens in) gives B. Every decision carries its lines, and the "recorded" labels are right in all ten cases. It left out three draft points for want of a quote (two on #91, one on #90). It also gives the decisions a "needs your call" mark, which is apt on #91 and #88 and trivial on #90 (the stack limit).
- **The second look** (45 to 79 s, 229,000 to 380,000 tokens in; 198 s and 987,000 tokens in over the three, 56% of ken's input tokens). Over the three it added 4 risks, rewrote 5 and withdrew 4.
  - #88: it rewrote two risks and added one from the later commit b7b032b. All three are real. They are ken's win on #88. One withdrawal, right.
  - #91: it added the non-plain-object risk (real, ken's best find here) and a "no test" risk that is half false. It rewrote one risk into a hedged non-risk. One withdrawal, right.
  - #90: it withdrew two risks. Both withdrawals are wrong in effect. It sharpened the failed-compile risk (real) and added a "no test" risk.
  - Did it earn its cost? On #88 yes. On #91 barely. On #90 it did harm. Over the three it kept A from being lost, and it is also why #90 was lost. It reads later history by chance: it did on #88 and not on #90, where its own closing note says "I also didn't reread the code when I checked the risks".
- **The search list** ("Used elsewhere") led to no find I can trace. On #90 it lists hits for `post`, `pump` and `variant` in `package-lock.json` and skill files. That is noise.
- **The record** gives C: the answer is stored in the project record and the personal history and reopens without a model. The plain chat leaves a chat transcript.

## Pull request #91: redact before the cap, redact object keys

### My yardstick

What it did: the code tools now redact their whole result and then cut it at 8000 characters (`CodeHost` gets `redact`). One walk, `redactJson` in `src/redact.ts`, redacts every string and every object key; the adapter (events, transcript arguments), `captured` (spans) and `storableState` (plugin state) use it. `frozenJson` only copies, checks and freezes.

Decisions: redact inside the code tools, not in the sandbox. One shared walk. A key that collides after redaction takes `<name>_<n>`. Image data in events is no longer exempt (stated, no reason given). Non-plain objects come back untouched. Tests first. The boundary table lets three more files import `redact.ts`.

Risks: (1) the walk skips non-plain objects, where the old adapter walk entered every object and the old span replacer saw every string; (2) the worker's 64 KiB cut still comes before redaction, so the doc's new sentence "every cap cuts text that is already redacted" is not true by construction; (3) exported arguments can carry key names the tool never got; (4) image base64 goes through the redactor in events, at a cost, and the transcript still leaves images alone; (5) more copying in `captured`. All are minor.

### Claims I checked

Plain chat: the old cut-then-redact order (true); the replacer never saw keys (true); the three users of `redactJson` (true); state is frozen without redaction on resume, as before (true); "the second one becomes `[REDACTED:K]_2`" (wrong: the test shows the secret key gets `_2` and the literal key keeps its name); the worker cuts at 64 KiB before redaction (true); "the 8000-character cap … always drops everything past 8000 characters, so the worker's cut point never shows up" (nearly true: redaction can shorten the text, so the cut point can move inside 8000 when a long secret is printed many times); the old walk skipped image `data` (true); "The 16 KiB per-string cap on span content also runs after redaction now" (misleading: it already did).

ken: decision 1's reason quote (supports it); decision 4 quotes commit line 8 and the old line at bc3c796 (supports it); risk 1, the transcript redacts only text in tool results (true, `src/pi.ts` line 538); risk 4, the helper's answer (the helper's own engine redacts its final text at `src/engine.ts` line 596 before `delegate.ts` cuts it, so the doc's claim holds and this is not a risk; ken hedges it); risk 5, the old walk entered every object (true); risk 6, section keys and `delegated` events (true and harmless); risk 7, "No test covers plugin state that uses a secret as a key" (false: `test/engine.test.ts` lines 731 to 740 at c074c14 hold the test "a plugin state is stored with secrets redacted, keys included, and handed back frozen"; the image half is true); the withdrawal (right for `core__run_code`; `core__run_bash` output does not pass the worker's cut).

### A, both directions

- ken only: the non-plain-object passthrough as a risk (real, a trap for later; behind a click); the mismatch between events and the transcript on images (detail; first view); keys that still escape (true, harmless, padding).
- Plain only: the sandbox still cuts before it redacts and the safety rests on 8000 staying below 64 KiB (real, still on main, comes with a fix); more copying (trivial).
- One hidden trap each, both "safe today". **Tie.** ken pads with risks 3, 4 and 6.

### B

ken: five elements checked (decisions 1, 2 and 4, risks 1 and 5); the quotes show what the sentences say. Risk 7 sits under `src/records.ts` line 214, which cannot show that no test exists, and the claim is half false. The two "recorded" labels rest on message lines that give the reason. The summary is unchecked and true. The plain chat names files, functions and constants and describes the tests, with no line and no quote, and says "I also did not run the tests". **ken.**

### The rest

- Second look: see above. One real minor find, one half-false risk, one non-risk, one right withdrawal, for 380,000 tokens in.
- Risk labels: the five marked "Quotes code outside the change" do quote code the risk rests on. Risk 4 gets the mark and is not a risk, so the mark lends it weight. The heaviest is first, as far as seven minor risks have an order.
- Diagram: true. It shows who calls the shared walk. It leaves out the redact-then-cut order, which is half the change. Some help.
- Story: true. It says what was wrong, what changed and one thing to watch (images).
- Weights: all minor. That is fair, and it means the weight label tells the reader nothing here.
- First view: the story, the drawing, three risks and the image decision. The third risk shown (the cap can land inside a placeholder) is trivia. The best unique find, risk 5, needs a click. The page says "7 risks" and then "8 rest on the code. One comes from a text search", which counts risks and statements together under a heading about risks.
- Readability: the plain answer is about 600 words and ends "risk 1 is the one I would fix", with the one-line assert. ken's first view reads faster to the gist and leaves the reader with one call (images) and no action. **Plain, narrowly.**
- Cost: ken 256.9 s, 622,804 tokens in, 26,988 out. Plain: one to three minutes.

## Pull request #90: QuickJS on a worker thread

### My yardstick

What it did: `core__run_code` runs QuickJS in a worker thread. The main thread ends the worker with `terminate()` at the deadline or the abort. The WASM linear memory is capped at 64 MiB in place of QuickJS's own limit. Output, the returned value and the error text are cut at 65,536 characters inside the worker. One spare worker is booted ahead. Tool calls cross a `MessagePort` and run on the main thread.

Decisions: a worker in place of the interrupt handler; the WASM memory cap; cut inside the VM; a spare worker, with 7 to 60 ms per run against 1 ms as an accepted cost; compile once on the main thread; the worker never frees its VM; bash mode is left alone.

Risks: (1) the deadline is set before the compile and the boot (fixed later in 782aa2d, #104); (2) the worker path is a hard-coded `.ts` file (breaks in a built package; fixed in 0481814 on a branch, still on main); (3) `runCode` waits without limit on the tool calls it started (older than this change, fixed in 5e89f59, #100); (4) a rejected compile promise is cached for good; (5) timing and RSS thresholds in the new tests; (6) one idle worker per process; errors on an idle spare are swallowed; (7) a cut value is not valid JSON.

### Claims I checked

Plain chat: the memory cap by `WebAssembly.Memory` (true); the deadline counted boot, fixed in 782aa2d (true; it places the commit "on main after #107", and it came in with #104); the wait on every tool call, fixed in 5e89f59 (true; it says #104, and it came in with #100); the `.ts` worker URL (true, still on main); swallowed errors on the spare (true); "the first run boots two workers, and every run boots a new spare" (true); the test thresholds (true); the old doc's 7 s past a 300 ms deadline (true); 16 MiB to start (true).

ken: risk 1 (true); risk 3, `compiled ??=` against the old `loaded = undefined` (true); risk 4, `vm.newString(text)` takes the result uncut (true; the effect is unsettled, as ken says); decision 2 (true); decision 7, the comment was removed (true); statement 1 (true); decision 6's reason, "The host no longer holds VM handles" (loose: the worker still holds them); withdrawal 1, "nothing new can break" (false: the path broke in the built package, per 0481814); withdrawal 2, "The host's AbortSignal.timeout still ends those tool calls" (false for a tool that ignores its signal, per 5e89f59).

### A, both directions

- Plain only: the unlimited wait on tool calls (real, later fixed); the `.ts` worker path (real, later fixed on a branch, live on main); that the deadline gap is already fixed, with the commit; swallowed spare errors (minor).
- ken only: a failed compile is never retried (real, rare; first view); a large tool result may crash the worker (unsettled; behind a click); three untested paths (minor); the `./wasm` export (guess, padding).
- Both: the deadline starts too early; the latency and the idle worker; the cut value; flaky tests.
- The plain chat's two unique finds are bugs the project had to fix. ken's are rarer. **Plain, clearly.**

### B

ken: five elements checked (decisions 1, 2 and 4, risk 3, arrow 8); the quotes support them. Risk 6 ("No test covers…") and risk 7 (a `package.json` pin for a claim about an export) sit under quotes that do not show the claim. The four "recorded" labels are right. The plain chat names files, messages and commit ids, all correct except the two pull request numbers. **ken.** Note the limit: the quotes made ken's answer checkable, and the answer was still the weaker one, because a withdrawal carries no quote and nothing checks it.

### The rest

- Second look: it withdrew the two risks that mattered and gave reasons that later history shows to be wrong. It did not read the later commits. Net harm on this pull request.
- Risk labels: one mark "outside the change" (the `package.json` pin), a weak basis. The heaviest of what was left is first. The heaviest overall were withdrawn.
- Diagram: true and useful. It shows the two threads, the messages each way, the tool call going back through the host, and `terminate()`.
- Story: true. It names the cost and the deadline gap. It cannot say the gap is already fixed.
- Weights: all eight minor. Fair for a 30 s default deadline.
- First view: story, drawing, the deadline, the latency, the failed compile, and two calls. The call on the stack limit is trivia. "8 risks" beside "All 11 rest on the code" is the same miscount.
- Readability: ken's first view gives the gist faster. The plain answer tells the owner which gaps are closed and which remain. **Tie.**
- Cost: ken 272.6 s, 518,838 tokens in, 30,957 out. Plain: one to three minutes.

## Pull request #88: respects judged by recorded changes

### My yardstick

What it did: `respects` no longer matches command strings. The shell fixture reads each command and records the paths it would change in its plugin state; the files fixture records writes, deletes and moves. A new state effect `{state, path?}` reads those records through `changesOf`. The format goes to `aigent-scenario/2`, and `/1` still parses. Four scenarios moved.

Decisions: judge the effect, not the spelling. Fail closed: anything not proved a known read or a known literal write counts as every host file. Carry the record in plugin state, with no new plugin API. Bump the format and keep `/1`. A helper's recorded change counts. The two mail scenarios use `{"state": "shell"}` with no path. `safety-insist-after-denial` keeps its call effects.

Risks: (1) false failures by design, wider than the doc's list (`date`, `uname`, `id`); (2) the two mail scenarios fail on any recorded shell change; (3) scores before and after do not compare; (4) the parser still passed some writes at this commit: `sort --out=`, `sort -T`, `--compress-program`, `/proc` and `/dev` paths, `/dev/nullx` (fixed in b7b032b, #95); (5) a state effect on a plugin that records nothing can never fail; (6) a record over the 16 KiB state cap throws; (7) the host file list lives in two files.

### Claims I checked

Plain chat: the eight named detours (true); how a state effect is judged (true); `safety-insist-after-denial` loads only the files plugin (true); a `/1` file with a state effect is an error (true); nine detours and four harmless runs in the test (true); `date`, `uname`, `hostname` and `id` are not in `READS` (true); `rm /tmp/foo` fails the mail scenarios (true); `HOST` repeats the files list (true); "I didn't find an obvious way to slip a write through a known read" (wrong in effect: `sort --out=/var/log/syslog /dev/null` passes as a read at 9e7ab1c; I checked the regex).

ken: risk 3 (true: the `sort` pattern on line 54 and the `/dev/null` pattern on line 70 at 9e7ab1c, and the b7b032b message); risk 5 (true, `shell.ts` line 106 writes state only on a change); risk 6 (true); risk 2, the case hash moves with the scenario (true, `integrations/multeval/loader.ts` line 3); risk 4 (true, the old parser refused any other format); decision 5's "recorded" reason (true); risk 1 (true); the withdrawal (plausible; the helper test agrees; I did not trace `delegation.spawn`).

### A, both directions

- ken only: false passes left in the parser (real, on the point of the change; first view); a state effect that can never fail (real; behind a click); the state cap (real, minor; behind a click); multeval sees new cases (detail; first view).
- Plain only: the host list in two places (real, minor, still on main; ken names it only in its unchecked closing note as a thing it did not check); the plain diagnostics missing from the read table (detail); what to do on a failure.
- Both: the mail scenarios; scores that do not compare; false failures by design.
- **ken, clearly.** All three of its unique finds are fixed since #95, and ken says so.

### B

ken: five elements checked (decisions 2 and 5, risks 2, 3 and 5); the quotes show what the sentences say. The four "recorded" labels are right. No "no test" claim here. The plain chat names files, functions and both commit ids. **ken.**

### The rest

- Second look: three real finds and one right withdrawal. It earned its cost here.
- Risk labels: the two marks "outside the change" (the multeval loader, the state cap in the engine) both point at code the risk rests on. This is the label doing its job.
- Order and weights: the three serious risks are the three on the first view. "Scores do not compare" is weighed serious; I would call it a caution. The false passes are third; they are fixed, so the order is fair.
- Diagram: true. It shows the path from the fixtures through the state records to the check. Useful, simple.
- Story: true. Before, after, and two things to watch.
- First view: it shows what matters. The two calls (fail closed; the mail scenarios) are real calls.
- Readability: both are clear. ken's story plus three risks is quicker and tells the owner the false passes are closed. The plain answer tells the owner what to do on a failure: "look at the command in the run's events before you blame the model, and widen `READS`". **ken, narrowly.**
- Cost: ken 241.7 s, 622,799 tokens in, 24,194 out. Plain: one to three minutes.

## Criterion C

ken stored each answer in the project record (for #91: one work entry, one topic, one note, six decisions) and in the personal history. It reopens without a model, with the commit ids its quotes point at. The plain chat leaves the chat. ken wins C on all three. I did not reopen a stored answer; I rely on what the brief and the files state.

## The three weaknesses of ken, in order

1. **A withdrawal is trusted without proof.** A risk must carry a quote; a withdrawal carries a sentence. On #90 the second look withdrew the `.ts` worker risk with "nothing new can break" and the tool-call risk with "The host's AbortSignal.timeout still ends those tool calls". The repository later fixed both (0481814, 5e89f59), and the plain chat reported both. This lost #90.
2. **It reads later history by chance.** On #88 the second look read b7b032b and found three real risks. On #90 it read no later commit, so it put first a deadline gap that 782aa2d had already closed, without knowing, and it missed the wait that 5e89f59 closed. The plain chat had the same luck the other way round. A list of later commits on the same files is a git query, and ken does not make it.
3. **A quote can sit under a claim it cannot support, and the check passes it.** On #91, "No test covers plugin state that uses a secret as a key" sits under `src/records.ts` line 214. A source line cannot show that a test is missing, and the test exists (`test/engine.test.ts` lines 731 to 740). The same point had been left out of the first answer for want of a quote, and the second look brought it back. #90 risk 6 has the same shape.

Smaller ones: the first view spends a slot on trivia (#91 risk 3) while the best find is behind a click; when every risk is "minor" (#91, #90) the weight tells nothing; "7 risks" beside "8 rest on the code" confuses; the "your call" mark lands on trivia (#90 stack limit); the search list is mostly noise.

## Three things the plain chat did better

1. **It found what later broke, and said what is already fixed.** #90: "The worker is loaded from `./sandbox-worker.ts` by URL … If you ever add a build step that emits `.js`, that path breaks, and only at runtime", and "A tool that ignored its abort signal could hold `core__run_code` open forever. Fixed in `5e89f59`".
2. **It ends with what to do.** #91: "A one-line assert that `CODE_RESULT_CAP < TEXT_LIMIT`, or a comment at the cap, would make the dependency visible." #88: "look at the command in the run's events before you blame the model, and widen `READS` if it's harmless."
3. **It answers the whole question in one pass, at a third to a half of the time.** Every decision with its reason is on the page (five or six per answer). ken's first view shows one or two decisions and folds the rest. The plain chat also says what it did not do: "I also did not run the tests."

## What I would change in ken first

Give the second look, from git and with no model, the list of later commits on main that touch the files and lines of the change, with their messages. That one query made the win on #88 and its absence made the loss on #90. With it, add one rule: a risk is withdrawn only with a quote of the code that makes it false; "this is not new" lowers a risk to minor and does not remove it. After that, refuse a claim of absence ("no test covers…") unless ken itself ran the search that shows it.

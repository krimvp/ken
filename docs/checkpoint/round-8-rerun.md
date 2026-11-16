This is one of the two verdicts of round 8 of the checkpoint: a fresh judge compared ken's answers with a plain coding-agent chat on the three pull requests of round 7's unseen verdict, run again, with the same model on both sides.
It was run on 16 November 2026, with ken at commit 67b5d88.
An AI judge scored it; the owner has not. The text is the judge's, with one word changed because the prose check refused it: "firm" in "The tie on A is not firm".

# Verdict: ken against the plain chat on pull requests #90, #91 and #88 (rerun)

## Result in short

- The plan's rule: **yes**, ken passes. It wins B (proof) and C (kept) on all three. It loses none of A, B, C on the three taken together.
- Criterion A on the three together: **a tie**. #90 tie, #91 plain, #88 ken.
- The tie on A is not firm. The heaviest single find that is still open at head is the plain chat's (#91, the sandbox cuts output before redaction). I ran it: it leaks today with a long secret. A judge who weighs only open risks gives A to the plain chat, and then the rule fails.
- A judge who only counts unique finds reaches a tie, or ken by one or two entries. ken has more entries labelled "risk", but 6 of its 17 risks are "fixed later" items taken from later commit messages.
- Is ken's answer better? #90: level. #91: the plain chat, narrowly. #88: ken, narrowly. Together: level on what is found. ken is ahead on proof and on keeping. The plain chat is ahead on reading speed and cost.
- ken's one A win is on #88, the pull request it was not tuned on. Its one A loss is on #91, which it was tuned on.
- I found no false claim in ken's three answers. I found four slips in the plain answers. One matters: on #91 it calls its own best find harmless today, and that is wrong.
- Cost: ken took 14.5 minutes and 2.10 million input tokens for the three. The plain chat took one to three minutes each. The second look used 51% of ken's input tokens and added two risks, neither important.
- First change: aim the second look at the claims the change makes about itself, and mark each risk open or fixed at head, open ones first.

## How I checked

I read each diff (`git diff M^1 M`), the commit messages and the code around them before I read either answer, and wrote a yardstick. I listed the later commits that touched the same files and read the fixes among them (782aa2d, 5e89f59, d9d713c, 42d79fa, b7b032b, 3e93e00), and found which merge brought each to main. Then I read the nine answer files. I checked more than six claims per answer against the code at the merge commit, and looked up ken's quoted lines by hand for about fifteen elements. I ran two probes against the checked-out tree, with scripts kept outside the repository in `/tmp/claude-0/-home-user/1e29372b-17df-51a3-88ec-29ca8ac85041/scratchpad/judge9/mychecks/`: one for the output cap with empty lines, one for a secret cut by the worker before redaction. I changed nothing in the repository. I did not read ken's store, so criterion C rests on what the brief says and on the "Stored in the project record" line in ken's files. The plain chat's token counts are not in its files; where I need a comparison I use ken's own draft step as a stand-in for a plain chat.

## The table

| PR | A | B | C | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #90 | tie: same two serious risks, unique finds minor on both sides | ken: every claim has a located quote that fits; plain names files and hashes only | ken: stored record; plain leaves a chat | ken: no false claim; plain names the wrong pull request for both later fixes | tie: plain has a little more detail, ken has the crash path; both miss the empty-line leak | tie: ken's story is faster for the gist, plain is faster for the whole | plain: 1 to 3 min against 6 min 25 s and 1.03M tokens in |
| #91 | plain: alone finds the cut before redaction, open at head | ken: quotes fit; plain cites no lines | ken | ken: plain says its best find does no harm today, which is false | plain, narrowly: ken misses the open risk; plain misses two later fixes | plain: says which risk to fix; ken's top three are two fixed items and one unlikely one | plain: 1 to 3 min against 3 min 54 s and 556k tokens in |
| #88 | ken: alone reports the false-pass holes found later, and the effect that could never fail | ken: quotes fit, one weak pair | ken | tie: no false claim on either side | ken: plain misses the later-found holes; ken misses the duplicated host list | plain, narrowly: says what to do on a failure; ken's unique find needs a click | plain: 1 to 3 min against 4 min 14 s and 516k tokens in |

## Verdict against the plan's rule

Yes. ken wins B and C on each pull request. A is a tie on the three together, so ken loses no criterion.

Who wins A on the three together: a tie.

How sure: moderately. B and C are solid. A depends on how a judge weighs "fixed later" finds against one open find.

- A judge who counts unique finds: ken has four risks the plain chat does not surface at all (#90 crash path untested, #91 image blob in spans, #88 holes closed by b7b032b, #88 effect that could never fail), and two more where the plain chat states the fact but not the risk (#91 resumed state, #91 non-plain objects). The plain chat has four (#90 swallowed spare errors, #91 cut before redaction, #91 extra copying, #88 host list in two places) and two decisions ken lacks (#90 the 64 KiB cap is separate from the 8000 cap, #90 the first run boots two workers). That count gives a tie, or ken narrowly. So a counting judge reaches the same yes.
- A judge who weighs only what is open at head: the plain chat's #91 find outweighs everything unique on ken's side, because ken's weightier unique finds are already fixed. That judge says the plain chat wins A, and the rule's answer becomes no.

History matters here. These three were seen before, and ken was tuned on #90 and #91. On #90 it ties and on #91 it loses A. Its A win is on #88, the one it was not tuned on. So the tuning did not buy the win, and it did not prevent the loss.

## Pull request #90: QuickJS on a worker thread

### My yardstick

What it did: `runCode` moved QuickJS to a `worker_threads` worker. The main thread ends the worker with `terminate()` at the deadline or abort. WASM linear memory is capped at 64 MiB. Printed output, the returned JSON and the error text are each cut at 65,536 characters in the worker. Tool calls cross a `MessagePort` and run on the main thread. One spare worker is booted ahead.

Real decisions: kill the thread, not interrupt; cap linear memory, not QuickJS's counter; tool calls stay on the main thread; a fresh worker per run plus one spare, with a recorded cost of 7 ms or 60 ms against 1 ms; cut inside the VM before the copy; stack stays 256 KiB.

Real risks:
1. The deadline started at the call, so worker boot counted against it. Fixed later in 782aa2d (came to main with #104).
2. `runCode` waited on every in-flight tool call with no limit after a stop. Fixed later in 5e89f59 (came with #100).
3. The output cap leaks for empty lines. `left` stops at 0 and an empty line still passes `line.length <= left`. I ran `while (true) console.log('')` for 2 s and got 102,166 characters of output, past the 65,536 cap. Still open at head. Small: growth is bounded by the message rate and the deadline, and the model sees 8000 characters at most.
4. The worker entry is a `.ts` file by URL. A compiled build would break it.
5. Timing-based tests can flake. 782aa2d retimed them.
6. A worker crash rejects `runCode`. No test covers it.
7. An idle spare worker in every process that ran code. Recorded as accepted.

### Accuracy

Plain, claims checked: the 7 s past a 300 ms deadline (true, removed doc line); 2 GiB let through and 2.1 GB RSS (true, doc); message kinds (true); 48 MB of arrays (true, doc); first run boots two workers and every run boots a spare (true, lines 48 to 49); cut value is not valid JSON and `core-tools.ts` only prints it (true, line 115); stack overflow rests on the existing engine test (true); 782aa2d "on main after #107" and 5e89f59 "#104". The last two are wrong. 782aa2d came with #104 and 5e89f59 with #100. The fixes themselves are described correctly.

ken, claims checked: risk 1 and its quotes (true, line 46 and the message of 782aa2d); risk 2 (true, line 85 and the message of 5e89f59); risk 4, a crash becomes `Tool … failed` (true, `src/engine.ts` line 482); risk 5 (true, `package.json` lines 7 and 10); decision 2's memory line (true, worker line 83); statement 1 (true, message of e951713); the withdrawal's proof (true, line 115 is the only reader I found). No false claim found. One wart: the risks head says "(6)" and then "All 8 rest on the code".

### Completeness and criterion A

Both name risks 1 and 2 with the fixing commits, and risks 4 and 5. Neither finds risk 3.

- Only ken: the crash path is untested and loses the run's printed output (minor, real). A statement that error text is now built inside the VM.
- Only plain: errors on an idle spare are swallowed (minor). The first run boots two workers and the spare starts with 16 MiB. The 64 KiB cap is a transport cap and the model still sees 8000 characters. The cut-value point, kept as a caution; ken withdrew it.

A: tie. Neither side's unique finds are heavy.

### Criterion B

Plain cites file names, function names and short hashes. It quotes no lines. An owner must open files to check, and two of its pull request numbers are wrong.

ken, five elements judged: decision 1 "recorded" rests on message lines 3 to 4, which give the reason. Decision 2 the same, line 5. Risk 1 and risk 2: the quoted line and the fixing message show exactly the claim. Arrow 10 quotes worker line 145, which posts the result of `run`; it supports "returned or threw" one step removed. Decision 3's reason is the message stating a fact, which reads as the reason; fair. Nothing important sits only in the summary: both watch-outs are risks 1 and 2 below it. ken wins B.

### Second look, withdrawal, absence search

Added 0, rewrote 2 (risks 4 and 5, both minor), withdrew 1. The withdrawal (cut value is not valid JSON) is defensible: line 115 prints the value and nothing in `src` parses it. No real risk was dropped; the plain chat kept the same point with the same caveat. The absence search for `the sandbox worker exited` under `test/` found nothing. That shows no test asserts that message. It does not strictly prove no test covers a crash. I searched the tests for worker exit and crash and found none, so the claim is true. The pass cost 90.7 s and 587k input tokens, more than half of this answer's input. It did not earn that here.

### Labels, order, diagram, story

Risks 1 and 2 are marked "Quotes code outside the change". The quoted lines (46 and 85) are unchanged lines inside the changed function. The mark is technically right. A reader will take it to mean ken followed the change out to other code, which it did not for these two. Risks 4 and 5 do quote other files, and they rest on them. The heaviest two are first and the first view shows both.

The diagram is true to the code and shows the message flow in seven arrows. It helps a reader who has not seen the worker split.

The story is true. It says what was wrong, what changed and what to watch, and it says the two watch-outs are fixed.

### Readability

ken's first view gives the gist in one paragraph of about 110 words, then three risks and three decisions. The plain answer is one page of about 39 lines with everything. A tired reader gets the gist faster from ken and the whole faster from the plain chat. The folds hide three minor risks; nothing needed. The "Your call" pick (the spare worker) is odd: the design doc already records it as accepted.

### Cost

ken: 384.5 s, 1,030,026 tokens in, 41,613 out, one answer rejected and redone. Plain: one to three minutes.

## Pull request #91: redact before the cap, and redact keys

### My yardstick

What it did: the code tools redact the whole text, then cut at 8000. `redactJson` moved to `src/redact.ts`, now redacts keys, renames a colliding key to `<name>_<n>`, and serves events, transcript arguments, span capture and plugin state. `frozenJson` only copies and freezes. Event image data is no longer exempt.

Real decisions: redact before the cap by handing the session redactor to the code tools; one walk; rename on collision; drop the image exemption (no reason given); return non-plain objects untouched.

Real risks:
1. The worker cuts at 64 KiB before any redaction, and so does just-bash at 1 MiB. The doc now says every cap cuts redacted text. That is not so. I ran it: a 200-character secret printed in a loop leaves 136 raw characters of the secret inside the first 8000 of the result; an 800-character one leaves 736. Redaction shrinks the text, so the worker's cut point moves inside the cap. A 40-character secret does not leak. Open at head.
2. `redactJson` returns non-plain objects as they are. The old `pi.ts` walk and the old `captured` replacer reached strings inside them. Latent.
3. Image data in events now goes through the redactor: scan cost, and a short secret could match inside base64.
4. Renamed keys in events, the transcript and spans no longer match what the tool received.
5. Resumed plugin state was not redacted. Older than this change, on a line it touched. Fixed later in d9d713c.
6. The cap can cut a redaction marker. Trivial.

### Accuracy

Plain, claims checked: cut before redact was the bug (true); `CodeHost.redact` passed from the engine (true, `engine.ts` line 336); keys were missed in the adapter and tracing but not in the record log (true); collision naming and reserved keys (true; "the second one becomes `_2`" is loose, since it is the redacted key that is renamed); state on resume is frozen with no redaction as before (true); image exemption removed (true); "the 16 KiB per-string cap on span content also runs after redaction now" (misleading: it already ran after redaction per string); risk 1 "today that does no harm ... the worker's cut point never shows up in the result" (false, see my probe); non-plain objects pass through "so `frozenJson` can still reject them" (a guess stated as fact).

ken, claims checked: decision 1 and "the pipeline redactor still runs afterwards" (true); decision 3 (true, `redact.ts` lines 14 and 29); decision 5 (true, lines 19 to 20); risk 1 (true, `records.ts` line 174 and d9d713c); risk 2 (true as a fact, `pi.ts` line 466 and 42d79fa, but the cut of image base64 in spans is older than #91 and not caused by it); risk 3 (true); risk 5, the old walk went into every object (true, old `pi.ts` lines 610 to 612). No false claim found.

### Completeness and criterion A

- Only plain: risk 1 of my yardstick, the cut before redaction. It also names the one-line guard it would add. Its guard (`CODE_RESULT_CAP < TEXT_LIMIT`) would not close the hole, and its "no harm today" is wrong. It still puts the owner on the right spot, and ken says nothing there. Also only plain: extra copying in `captured` (minor), and a plain statement of what it did not check.
- Only ken: non-plain objects as a risk (real, latent; the plain chat states the behaviour as a decision, with a comforting reason). Resumed state as a risk with its fix (real, old, fixed; the plain chat states the fact). Image blob in spans (true, not from this change, fixed). Broken marker (trivial; the plain chat mentions it).

A: the plain chat, narrowly. One open leak path in the very property the change claims outweighs one latent risk and two fixed ones. It is narrow because the plain chat undersold its own find.

### Criterion B

Plain names files and functions, and one test's numbers. No line quotes. Its central reassurance is wrong, and an owner who trusted it without opening the code would be misled.

ken, five elements judged: decision 1 "recorded" rests on message lines 3 to 4 of 5a8044a, which give the reason. Decision 2 the same with 4f84363. Decision 3 is "recorded", but the reason ("so no value drops out") is in the code comment; the quoted message lines say what, not why. Risk 4's test lines show the renamed keys. Risk 5's two lines show the new early return and the old walk. Decision 4 says honestly that no reason is given. ken wins B.

### Second look

Added 1 (image blob in spans), rewrote 1 (non-plain objects), withdrew 0. The added risk is true but belongs to code this change did not alter, and it is fixed. The second look put it second, so the first view shows it ahead of risks 4 and 5, which are about this change and still open. Cost 65.1 s and 303,753 input tokens. It did not earn its cost here, and it made the first view worse.

### Labels, order, diagram, story

All six risks are "minor", which is fair. The order is doubtful: the first two are already fixed. The best ken-only point (risk 5) is behind "[3 more risks]", though decision 5 on the first view states the behaviour. Risk 3's "outside the change" quote (`pi.ts` line 575) is an unchanged line the risk does rest on.

The diagram is true. On the first view at 1440 pixels it is not drawn; the reader sees a list of six file names. That is decoration until clicked.

The story is true on what was wrong and what changed. Its "watch" is resumed state, which is old and fixed. It does not name anything open.

### Readability

The plain answer ends with which risk to fix and how. ken's first view ends with a feedback form. A tired reader leaves the plain answer with one action and leaves ken's first view with none. Opened fully, ken's answer is about 200 lines; the "Used elsewhere" list is noise (see weaknesses).

### Cost

ken: 233.5 s, 555,517 tokens in, 22,401 out. Plain: one to three minutes.

## Pull request #88: respects judged by recorded changes

### My yardstick

What it did: the shell and files fixtures record changed paths in plugin state. `respects` gains state effects read by `changesOf`. The shell fixture classifies commands and fails closed. Format `aigent-scenario/2` is added and `/1` still parses. Four safety scenarios move.

Real decisions: judge the effect, not the spelling; fail closed and accept false failures; carry the record in existing plugin state; bump the format but keep `/1`; `safety-insist-after-denial` keeps call effects; the two mail scenarios forbid any shell change (`{"state": "shell"}` with no path), with no stated reason; any count in a helper's state is a change.

Real risks:
1. False failures by design, including common tools not in the read table (`date`, `hostname`, `uname`, `id`).
2. The two mail scenarios are much stricter, so their rate drops with no change in the model.
3. Scores before and after the bump are not comparable.
4. False passes at merge, found and closed later in b7b032b: write operands under `/proc` or `/dev`, `sort -T`, `--compress-program`, abbreviated `--out=`, a redirect to `/dev/nullx`.
5. A state over the 16 KiB cap threw. Fixed in b7b032b.
6. A state effect on a plugin that keeps no such state could never fail. Fixed in b7b032b.
7. A state effect naming a plugin only a helper loads failed the pre-run name check. Fixed in b7b032b.
8. The host file list lives in two places (`HOST` in `shell.ts`, `FILES` in `files.ts`).

### Accuracy

Plain, claims checked: the old regex (true); eight detours from issue #68 (true, doc); count "went up" (true in effect; the code says "differs"); `safety-insist-after-denial` loads only the files plugin (true); nine failing detours and four passing runs in the first commit, plus the helper test and the format test (true, e7edef3 touches both test files); `date`, `uname`, `hostname`, `id` are not reads (true); `rm /tmp/foo` fails the mail scenarios (true); `HOST` copies `FILES` and adds the logs (true). "I didn't find an obvious way to slip a write through a known read" is honest as stated, but b7b032b found several. No false claim.

ken, claims checked: decisions 1, 4 and 5 "recorded" (true, message lines quoted give the reasons); decision 2's doc line and the two `return HOST` lines (true); decision 7 "before, only a command naming the address failed" (true); decision 8 (true, `checks.ts` lines 430 to 441); risk 4's four sub-claims against b7b032b's message and diff, and `run.ts` line 239 (true); risk 5 (true). No false claim. One wrong mark: risk 5 is labelled "Quotes only the changed lines", but its only quote is a later commit's message.

### Completeness and criterion A

Both name risks 1, 2 and 3.

- Only ken: risks 4, 5 and 7 as one entry (real; the false passes are the kind of fault a safety check must not have; fixed since). Risk 6 (real, fixed since). The helper counting rule as a decision. The mail scenarios' strictness flagged as the owner's call, with "nothing I read says why".
- Only plain: risk 8 (real, minor). The warning that every new table entry is a place a false pass could return. What to do when a failure appears.

A: ken, narrowly. The plain chat says the parser is tight and it found no hole. ken reports that holes existed at merge and names the commit that closed them. It is narrow because all of it is fixed, and because ken weighs the entry "minor" and shows it only after a click.

### Criterion B

Plain cites files, a function and two hashes, no lines.

ken, five elements judged: decision 1's message lines carry the reason. Decision 5's message lines carry the reason. Decision 2's doc line carries the trade. Arrows 6, 8 and 9 quote the lines that do what the arrow says. Risk 2's quotes are the weak pair: they show the old effect and that `rm /tmp/build.log` passes elsewhere, but not the new effect with no path; that line is quoted under decision 7. ken wins B.

### Second look

Added 1 (risk 6 of my yardstick), rewrote 0, withdrew 0. The added risk is real, minor and fixed. Cost 42.6 s and 191,829 input tokens. A small gain for the price.

### Labels, order, diagram, story

Risks 1 and 2 are weighed "serious". By ken's own definition (a normal user gets a wrong result) that holds for someone reading eval scores, though both are by design and documented. Risk 4 is "minor" because it is fixed; at merge it was the most serious thing in the change. The first view shows risks 1 to 3. Risk 4 needs a click.

The diagram is true and small: fixtures write state, `changesOf` reads it, `respects` calls `changesOf`. It helps a little.

The story is true and names the two things to watch.

### Readability

Both read well. The plain answer tells the reader what to do on a failure ("look at the command in the run's events before you blame the model, and widen `READS`"). ken's first view carries the same three risks, a "Your call" on the mail scenarios, and the note that four draft points were left out. The find that decides A for ken is hidden behind "[2 more risks]".

### Cost

ken: 253.9 s, 515,682 tokens in, 25,430 out. Plain: one to three minutes.

## Criterion C

The plain chat leaves a chat transcript. It can be found tomorrow only if the chat tool keeps it and the owner remembers which chat. Nothing lands in the project.

ken stores each answer in a project record and a personal history. The files show the counts (for #90: 1 work, 1 topic, 1 note, 6 decisions) and the brief says the answer reopens without a model. I did not open the store. ken wins C on all three, on structure.

## The owner's question: is ken's answer better?

- **#90: level.** Both find the same two serious risks and both say they are fixed. The plain answer has slightly more practical detail and two wrong pull request numbers. ken has proof on every line and is kept. ken took 6 min 25 s and a rejected answer to get there. What decides it: nothing on substance.
- **#91: the plain chat, narrowly.** It is the only one that points at the cut before redaction, which leaks today with a long secret, and it says what to fix. It is narrow because it calls that find harmless today and its fix would not close it. ken is correct in every line I checked and misses the one open risk. Its first view spends two of three risk slots on fixed items.
- **#88: ken, narrowly.** Same core answer on both sides. ken adds the holes found later and the effect that could never fail, with the commit that fixed them, and its quotes hold. The plain chat adds the duplicated host list and clearer advice. What decides it: ken corrects the plain chat's "the parser is tight".
- **The three together: level on what is found.** ken does not find more than the plain chat. ken is better where the owner wants to check a claim without opening the diff, or come back to it. The plain chat is better where the owner reads once and acts. It takes one to three minutes against ken's four to six and a half, and it reads in one pass. If proof and keeping count as the plan says, ken is ahead narrowly. If the measure is "what did I learn that I must act on", the plain chat is ahead narrowly, on #91 alone.

## What the tool's steps added and what they cost

Both sides ran the same model, so the differences come from ken.

- **The fixed form and the quotes** added a located, existing quote under every decision, risk, statement and arrow. In about fifteen elements I checked, the quotes fit the sentence in all but two weak cases. This is the whole of ken's lead on B. The form also made the model say "nothing says why" where the plain chat guessed (#91 non-plain objects, #88 mail scenarios). It cost 204.4 s, 92.1 s and 125.2 s, and one rejected answer on #90. It dropped seven draft points for want of a quote, among them one that had a line in the same answer (#90, the spare's 16 MiB, quoted under decision 2). It also removed the advice a chat gives: no ken answer says what to do next.
- **The second look** over the three: added 2 risks, rewrote 3, withdrew 1, set the order. Of the two added, one is true but not from the change and already fixed (#91 image blob), and one is real, minor and fixed (#88 effect that could never fail). The withdrawal (#90) was sound and dropped nothing real. The order was right on #90 and #88 and doubtful on #91, where the added risk pushed open risks behind a click. It cost 198.4 s and 1,082,600 input tokens, 51% of ken's input for the three. It did not earn its cost. It never tested a claim the change makes about itself, which is where the plain chat found its #91 risk.
- **ken's own marks.** "Recorded" and "inferred" were right in all but one case (#91 decision 3). The "outside the change" mark is technically right and says little: on #90 it marks unchanged lines inside the changed function. On #88 risk 5 the mark is wrong.
- **The text search for names** ("Used elsewhere") produced mostly noise.
- **The store** gives C.
- **Total cost:** 871.9 s, 2,101,225 tokens in, 89,444 out, against one to three minutes per plain answer. Against ken's own draft step, which is close to a plain chat, the full run is 2.9 to 4.3 times the time and 3.3 to 6.8 times the input tokens.

## The three most important weaknesses of ken

1. **It does not look harder than a chat, and it missed the one open risk.** On #91 ken never tests the doc line the change added ("Every cap cuts text that is already redacted"). The plain chat did, found the 64 KiB cut in `src/sandbox-worker.ts`, and I confirmed a leak of 136 raw characters of a 200-character secret. ken's unique risks come mostly from later commit messages: 6 of its 17 risks are "fixed later" (#90 risks 1 and 2, #91 risks 1 and 2, #88 risks 4 and 5). Only two ken-only risks are open at head (#90 crash path, #91 non-plain objects), and both are minor.
2. **The first view does not put first what the owner most needs.** On #91 the three risks shown are a fixed one, a fixed one that is not from the change, and an unlikely one; risks 4 and 5, open and about the change, need a click. On #88 the find that beats the plain chat (risk 4) is weighed "minor" and hidden behind "[2 more risks]". No first view says what to do next. On #91 the diagram is a list of six file names.
3. **Much machinery for a small gain, and some of it misleads.** The second look takes half the tokens and added two unimportant risks. "Used elsewhere" lists `variant` in `.agents/skills/poteto-mode/playbooks/eval.md`, `pump` in `package-lock.json` and `post` in skill files as uses of names the change touched. The risks head says "(6)" and then "All 8 rest on the code". #88 risk 5 is marked "Quotes only the changed lines" and quotes no changed line. The quote rule dropped a true point that had a line (#90, 16 MiB idle memory).

## Three things the plain chat did better

1. **It found the open risk and named an action.** #91 risk 1, and the closing line: "risk 1 is the one I would fix. A one-line assert that `CODE_RESULT_CAP < TEXT_LIMIT`". The reassurance and the fix are both short of right, but the owner is sent to the right place.
2. **It reads in one pass and says what to do.** #88: "When you see a `respects` failure, look at the command in the run's events before you blame the model, and widen `READS` if it's harmless." #91 ends with a plain list of what it did not check, tests included.
3. **It kept small true details and cost a fraction.** #90: the first run boots two workers, the spare holds 16 MiB to start, the 64 KiB cap is separate from the 8000-character cap the model sees. #88: `HOST` duplicates `FILES`. One to three minutes each, against 3 min 54 s to 6 min 25 s.

## What I would change in ken first

Re-aim the second look. Today it re-reads ken's own risks. Have it take each claim the change makes about itself, in the commit messages and in the doc lines the change added, and look for code that breaks the claim. On #91 that is the step that would have found the cut before redaction. With it, have ken check each risk against head and mark it "open" or "fixed since by X", and show open risks first. That fixes the #91 first view and moves the #88 holes to where they belong: a note on history, not a hidden risk.

After that: add one "what to do next" line per risk the model weighs serious or leaves open, and drop or filter the "Used elsewhere" list.

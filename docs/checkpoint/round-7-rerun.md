This is one of the two verdicts of round 7 of the checkpoint: a fresh judge compared ken's answers with a plain coding-agent chat on the three pull requests of round 5's last check, run again, with the same model on both sides.
It was run on 16 November 2026, with ken at commit 71d05de.
An AI judge scored it; the owner has not. The text is the judge's, unchanged: the prose check asked for no edits.

# Verdict: ken against the plain chat on pull requests #107, #93 and #92 (rerun)

## Result in short

- The plan's rule: **yes**. ken wins B and C on all three pull requests. It wins A narrowly on the three together. It loses none.
- Criterion A on the three together: **ken, narrowly**. The margin rests on two finds: the multeval timeout mismatch on #93 and the redaction growth on #92. On #107 ken found nothing the plain chat did not.
- The owner's question, "is ken's answer better?": **narrowly yes, on proof and keeping, not on insight.** #107 is level. #93 goes to ken narrowly. #92 goes to ken narrowly. No answer on either side found a serious risk the other missed.
- ken cost 4.7 to 5.3 minutes and 0.67 to 0.72 million input tokens per answer. The plain chat took one to three minutes. ken's own draft step, which is the plain chat's work, used about a fifth of ken's input tokens.
- I found one false clause in ken (the top risk of #92, on the first view) and one overstatement in the plain chat (#92, on `onEnable`). Every other claim I checked on both sides held.
- The second look added 2 risks, withdrew 1 false one, rewrote 7 and set the order. It took 18% of ken's time and 45% of its input tokens. It earned its place on #107, was marginal on #93 and showed no gain on #92.
- These three pull requests were not unseen. An earlier judge's list of what ken missed was read by the people who built this version. A narrow win on A here is weak evidence for unseen work.
- First change I would make: show the top decisions with their reasons on the first view. The question asks for them, and the first view of #93 shows none.

## How I checked

I read the brief, then built a yardstick for each pull request from `git diff M^1 M`, the commit messages and the code around the change, before I opened either answer for that pull request. The merges are e490d9c (#107), 51595e8 (#93) and cc6b79c (#92). Then I read the nine answer files and checked claims against the repository at the merge commit. I checked at least eight claims per answer by hand; each section below names them. I checked every risk on both sides against the code. I checked 30 of ken's quoted lines by printing the file at the stated commit and line; all 30 were there. I read no skill, no draft, no earlier verdict and nothing under /home/user/ken. I changed nothing in /home/user/aigents. The plain chat's token cost was not given to me, so I compare time on both sides and tokens on ken's side only.

## The table

| PR | A (unique finds) | B (trust without the diff) | C (find it tomorrow) | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #107 | tie: ken has no unique find, plain has two small ones | ken: checked quotes, 9 reasons quoted from commit messages | ken: stored record | tie: no false claim on either side | plain, narrowly: names the limit of the four-mode test and the fixture's import rule | plain, narrowly: ken's first view hides the main decision and shows one long line twice | plain: 1 to 3 min against 4.7 min and 666k tokens in |
| #93 | ken: multeval mismatch, verified, plus two small telemetry finds | ken: checked quotes, 5 reasons quoted from commit messages | ken: stored record | tie: no false claim on either side | ken, narrowly: has the multeval gap; plain has "refuse, not clamp" | ken, narrowly: half the reading, the right three risks shown; but no decision shown | plain: 1 to 3 min against 4.7 min and 702k tokens in |
| #92 | tie: ken has redaction growth, plain has the silent change of state | ken: checked quotes, 3 reasons quoted from commit messages | ken: stored record | tie: one error each; ken's sits in its top risk | tie: each misses the other's find, both miss the same two | tie: ken is shorter, plain explains the mechanism | plain: 1 to 3 min against 5.3 min and 725k tokens in |
| Together | ken, narrowly | ken | ken | tie | tie | tie | plain |

## Pull request #107 (merge e490d9c)

### My yardstick

What it did. Nine commits, sixteen files, almost all tests and tooling.
1. The paid live suite is gated twice. `test/live.test.ts` became `test/live.ts`, so the test glob misses it. The file throws unless `AIGENT_LIVE=1` is set, and it checks that before it loads `.env`. A missing key now throws where each test used to skip. `npm test` dropped its skip pattern.
2. A coverage script with floors of 99.0% lines and 90.3% branches over `src/**` and `integrations/**`. CI runs it on the 22.19.x leg only. It uses Node's experimental coverage flags. It is not part of `npm run check`.
3. A new fixture, `test/fixtures/compat.ts`: a local endpoint that streams one scripted turn per request. Tests now drive `aigent run` and the multeval subject through whole runs.
4. A table of 23 tampered result directories for `readRun`, asserting the first problem only.
5. Every scenario runs in all four tool modes on a model that only replies.
6. Every test removes its temp directories in `t.after`.
7. The CLI refusals run as one table, about 35 processes at once.
8. One product fix: an `--out` path under a file exits 2 with a reason, where it exited 4 with a stack trace.

Real decisions: file name plus environment variable, with `.env` unable to opt in; throw, not skip, on a missing key; floors just under the measure; coverage on one leg; an HTTP fixture and not a mock; first problem only in the tamper table; concurrency for speed; ENOTDIR alone joins exit 2.

Real risks, none serious: the floor is 0.19 and 0.27 points under the measure, so a small uncovered addition fails one CI leg; the flags are experimental; `test:live` without the opt-in now fails where it skipped (no workflow calls it, I searched); other `stat` errors still exit 4; many processes at once on a loaded runner; the four-mode run proves setup, not tool paths; the tamper table is tied to error text.

### The plain chat

Claims I checked: the glob no longer picks up `live.ts` (true); the `AIGENT_LIVE` check runs before `.env` loads (true, lines 17 to 21); a missing key throws now and skipped before (true); the floors and the measure (true); coverage on 22.19.x only (true); ENOTDIR exits 2 and EACCES still rethrows (true); the fixture's boundary row allows it no model library (true, `packages: []`); the four-mode run never calls a tool (true, the file header says so); a directory that appears mid-run exits 4 and a test covers it (true). I found no false claim.

It cites a commit hash for every item and names files and flags. It gives no line numbers and quotes one message string. An owner can find each claim in `git show <hash>` in a minute, but must open the diff to do it.

Risks: seven, all real. The last one ("more tests depend on processes and ports") is generic.

### ken

Claims I checked: the slack numbers in risk 1 (true); "No CI workflow calls it" in risk 2 (true by my search); risk 5 on `outProblem` (true); "about 35" and "11 more" processes in risk 6 (true, I counted 35 and 11); the old skip line in decision 2 (true, at 47eec4e line 34); the recorded reason of decision 5 (the message line gives it); decision 11's assert at line 269 (true); the reason for the withdrawal (true: `writeRun` runs after `runScenario` returns, and the stalled endpoint never answers). I found no false claim.

Quotes against sentences, five picked: decision 1 (the message lines and the five lines of `live.ts` show the claim); decision 4 (floor and measure both quoted); risk 5 (the three lines show it); diagram arrow 7 (the `Promise.all` line shows it); risk 2 (the quote `- run: npm run check` exists but cannot show that no workflow calls `test:live`). Four of five support their sentence. The nine decisions labelled recorded all rest on a message line that gives the reason.

Risk labels: risk 2 is the only one marked "Quotes code outside the change", and its outside quote is the weak one above. The mark is honest about what it says, but here it suggests a look beyond the change that proves less than the sentence claims.

Weights and order: the floor is first, which is right. "Serious" is too heavy for it by ken's own definition. A red CI leg on a later pull request costs little and is what a floor is for.

Diagram: true to the code. It shows which test files reach the CLI, the subject and the fixture. It leaves out the live gate and the coverage gate, which are the two things an owner needs from this pull request. It is close to decoration.

Story: true. It says what was wrong, what changed and the one thing to watch.

Second look: withdrew one risk (the exit-4 test "rests on timing") and its reason is correct. Added one (experimental flags), which is real and which the plain chat also has. Cost 36.8 s and 264k tokens in. It earned its cost here, because it removed a false alarm.

### Criterion A

- ken only: nothing of substance. It gives the process counts (35 and 11), which sharpens a risk the plain chat states in general words.
- plain only: the four-mode run proves setup and not tool paths (minor, real); the check-then-write gap remains and a test now pins it (information, not a new risk); the fixture's boundary row.
- Shared: tight floor, experimental flags, `test:live` now fails, other `stat` errors, load on the runner.
- Weight: plain's extras are small. **Tie.**

### First view and folds

The first view shows the story, the diagram, the three heaviest risks and the one decision that needs a call (where the floor sits). All three risks are shared finds. The main decision of the pull request, the two locks on the live suite, is behind "[10 other decisions]". The same 250-character `package.json` line appears twice. The line "All 8 rest on the code" sits above a list of 6 risks and is not explained. The full file is 281 lines; it quotes that `package.json` line five times, and its "Used elsewhere" list is noise (`scripts`, `Edit`, `Turn`, `baseUrl`).

### Which serves the owner better

**Level.** The two answers find the same risks. The plain chat explains the reasons in the open and took a third of the time. ken can be checked and is kept. On a test-only change with no serious risk, the proof buys little.

## Pull request #93 (merge 51595e8)

### My yardstick

What it did. Two commits.
1. `parseLimits` in `startSession` checks `maxTurns` (a positive integer) and the hook and code timeouts (whole milliseconds from 1 to 2^31-1), before the model is resolved, and throws once with every problem. The delegate tree takes the parsed hook timeout. The CLI rounds `--prompt-timeout` to whole milliseconds and exits 2 outside the range. `MAX_TIMEOUT_MS` is exported from the host entry.
2. In `traced`, every telemetry write runs in `finish`, which marks the span failed, logs a WARN and ends the span in `finally`. The input capture moved inside the `try`.

Real decisions: refuse, do not clamp; check at the boundary before any network call; collect every problem; round in the CLI but refuse fractions in the session API; a new public constant; swallow telemetry failures as a failed span and a WARN.

Real risks: a host that passed `maxTurns: Infinity` for "no limit" now fails at open (the heaviest); the multeval subject still accepts any positive `prompt_timeout_s` and now gets exit 2 from the CLI; a host `log` that throws inside the `catch` brings the unhandled rejection back; `stream.result()` has no rejection handler; a meter that throws after a model error overwrites `error.type`; a throw partway drops the rest of that request's metrics.

### The plain chat

Claims I checked: NaN never met the turn check (true, `run.turns >= maxTurns`); `parseLimits` runs before `resolve` (true, lines 81 and 82); the delegate tree takes the parsed value (true, line 300); 1.0001 becomes 1000 ms (true); the host `log` is unguarded in the `catch` (true, line 433); no `.catch` on `stream.result()` (true, line 441); limits throw before the delegate check, so two rounds (true); the scenario parser already requires positive integers (true, `scenario.ts` line 368); the otel test swaps the global meter and restores it (true). I found no false claim. The last risk (tests "could interfere" if files shared a process) is speculation and says so.

It cites both commit hashes and names functions and files. No line numbers, a few code fragments.

### ken

Claims I checked: risk 1 on `Infinity` (true); risk 2 on the multeval subject (true: `subject.ts` line 39 accepts any positive number, line 78 passes it on, line 86 fails on exit 2); risk 3 on the host log (true); risk 4 on `error.type` (true: `fail` at `tracing.ts` line 124 overwrites it); risk 5 on dropped metrics (true); risk 6 on a delegate profile's `maxTurns` (true and trivial); risk 7 on helper sessions and `codeTimeoutMs` (true, and the risk says itself that the change did not cause it); the recorded reasons of decisions 3 and 4 (the message lines give them). I found no false claim.

Quotes against sentences, five picked: risk 1 (`engine.ts` line 635 shows why `Infinity` worked before; a good outside quote); risk 2 (both lines show it); risk 4 (both quotes show it); decision 6 (the nine lines of `finish` show it); diagram arrow 11 (shows the log is passed). All five support their sentence. The five recorded decisions rest on message lines that give the reason.

Risk labels: seven risks carry "Quotes code outside the change". For risks 1, 2, 4 and 8 the outside quote is the code the risk rests on. For risk 3 it is `const writeLog = options.log ?? writeStderr`, which shows where the log comes from and no more.

Weights and order: `Infinity` is first and is the heaviest. Right. No minor risk is serious.

Padding: ten risks. Risks 6, 7, 8 and 10 are trivial or not caused by the change. Two of them are the same point (a `maxTurns` above `MAX_SAFE_INTEGER`) in two places. This list does not win A by its length.

Diagram: true. It is a map of what the change touched. It does not show the `finish` wrapper or the change in behaviour. Decoration.

Story: true. It names both things to watch, including the multeval gap. The closing note says two claims (the 1 ms firing, the `AbortSignal.timeout` throw) come only from the commit message. That caveat matters for trust and sits behind "[Show the whole note]".

Second look: added risk 5 (dropped metrics; real, minor, unique to ken) and rewrote three. Cost 60.1 s and 372k tokens in, the largest input of ken's three steps. Marginal.

### Criterion A

- ken only: the multeval subject's looser check (real, verified, shown on the first view and in the story); `error.type` overwritten (minor); metrics dropped partway (minor); four trivial ones.
- plain only: no handler on `stream.result()` (real only if pi's `result()` can reject, which neither answer checked); two rounds of errors (trivial); the global state of the otel test (speculative); "refuse, not clamp" named as a decision.
- Shared: `Infinity`, the unguarded host log, CLI rounds while the API refuses.
- Weight: ken's multeval find is concrete and outside the diff. **ken, narrowly.**

### First view and folds

The first view shows the story and three risks, and all three are real. It shows **no decision**: the line reads "[7 decisions in this change]". The owner asked "why was it done that way" and must click for any reason. The plain chat's four decisions with reasons take ten lines.

### Which serves the owner better

**ken, narrowly.** It finds one more real thing, shows it first, and can be checked and found again. It took two to four times as long, and its first view answers half the question.

## Pull request #92 (merge cc6b79c)

### My yardstick

What it did. Three commits, three fixes to resume.
1. A `denied` record's tool is a plain string. `parseRecord` no longer takes the registry. A dropped or renamed tool no longer blocks a resume.
2. The enable loop on resume runs over every plugin the transcript enabled, then the host's names. `enablePlugin` adds only missing dependencies, with cause `dependencyOf`, runs their `onEnable` and queues their text.
3. A resumed `state` record passes `storableState` with today's redactor: plain JSON, redacted, capped at 16 KiB. The error names the plugin and leaves the value out.

Real decisions: bring `denied` in line with `call`; reuse `enablePlugin` and not a separate closure step; treat the transcript as untrusted; fail the whole resume on a state over the cap; throw without quoting the record.

Real risks: a resume that worked can now fail (state over the cap); redaction can lengthen a state and push it over the cap; a plugin's state comes back changed, keys included, with no notice; a state record for an unknown plugin still goes through `fail`, which quotes the value; a new dependency's `onEnable` runs inside resume. Two more that I found and **neither answer has**: `transcript()` exports a `state` record as stored (`exportMessage` returns it untouched), so the secret stays in the clear in the saved transcript after the plugin's view is redacted; and every `state` record is checked, not only the latest, so an old, replaced record over the cap fails the resume.

### The plain chat

Claims I checked: `denied.tool` is a plain string and the parser lost the registry (true); the loop is `[...enabled(), ...options.enabled.map(parseName)]` (true); `enablePlugin` adds only missing closure members (true, line 423); the state parser runs `storableState` (true); `plugin(r.plugin)` runs before the `try`, so `fail` quotes the record (true, lines 171 and 120); keys are redacted too (true, `redact.ts`); the comment was removed and the registry line stays (true); a dependency's `onEnable` now runs during resume, "which the old code never did on a resumed session" (**overstated**: the old loop already ran `onEnable` on resume for a plugin the host newly named; what is new is that it runs for a dependency of a plugin the transcript enabled).

It cites each commit hash, names files and quotes one expression. No line numbers.

Risks: six, all real. Two are trivial (looser validation, the leftover comment). One names its fix.

### ken

Claims I checked: risk 1 (**partly false**: "or not plain JSON now fails the resume, though it resumed before". The old parser already ran `frozenJson` on the value and failed on anything that was not plain JSON. Only the cap is new); risk 2 on redaction growth (true: the cap is measured after redaction, `records.ts` lines 213 to 218, and `redact.ts` line 8 replaces each match with a longer mark); risk 3 (true); risk 4 on the native tool list (true: `isInitial` at `engine.ts` line 260 counts a dependency of an initial plugin as initial); risk 5 (true); risk 6 on test gaps (true as far as I searched); decision 6 on the removed comment (true, at c074c14 line 339); statement 2 on the type (true); the recorded reasons of decisions 1, 2 and 4 (the message lines give them).

Quotes against sentences, five picked: risk 2 (both quotes show it); risk 3 (both show it); decision 5 (the comment and the throw show it); diagram arrow 9 (shows that a write uses the same check); risk 1 (the quote from `src/pi.ts` line 104 shows that pi passes the records on and nothing about what fails). Four of five support their sentence. The false clause in risk 1 sits beside two checked quotes; the checker confirms the lines exist and cannot catch it.

Risk labels: five risks carry "Quotes code outside the change". For risks 2, 3, 4 and 5 the outside quote is the code the risk rests on. For risk 1 it is not.

Weights and order: the failing resume is first, which is right. "Serious" is defensible. The secret that `fail` still quotes is weighed minor; that is fair, it needs an unknown plugin.

Diagram: true. It shows that a write and a resume now pass the same check, and that resume calls `enablePlugin` again. It helps a little. It is the only one of the three that carries an idea.

Story: true. It names both things to watch.

Second look: added none, withdrew none, rewrote four. I cannot see the earlier wording, so I cannot say what the rewrites fixed. One rewritten risk holds the false clause. Cost 67.2 s and 310k tokens in. No visible gain.

### Criterion A

- ken only: redaction alone can push a state over the cap (real, verified, on the first view and in the story); a new dependency's tools join the native tool list on resume in dispatch mode (real, minor, one click); test gaps (minor, one click).
- plain only: resume quietly changes a plugin's state (real; ken states the mechanism in decision 4 but names no risk); looser validation of `denied` (trivial).
- Shared: the failing resume, the value quoted by `fail`, `onEnable` at resume, the removed comment.
- Weight: ken's growth find and plain's silent change are of like weight. ken has two more small ones. Neither side clearly outweighs. **Tie**, leaning to ken.

### First view and folds

The first view shows the story, the diagram, three real risks and the one decision that needs a call. The `onEnable` risk is one click away. The reasons for the other five decisions are folded. The plain chat puts before, now and why for each fix in the open, which teaches the mechanism better.

### Which serves the owner better

**ken, narrowly.** The finds are level. ken can be checked and found again, and its story is the fastest way in. Against that: its top risk has a false clause, it took about three times as long, and the plain chat explains the change better.

## Criterion C

- The plain chat leaves a chat transcript. Nothing in the files shows a record that can be searched or reopened by topic.
- ken stored each answer in the project record and the personal history, by the brief. The full files show what was stored: #107 `work 1, topic 3, note 3, decision 11`; #93 `work 1, decision 7`; #92 `work 1, topic 1, note 1, decision 6`. #93 named no topic ("does not change your map"), so it will be harder to find by subject than the other two.
- **ken wins C on all three.** This is structural; I did not test a reopen.

## The verdict against the plan's rule

**Yes.** ken wins B and C and loses no criterion.

Who wins A on the three together: **ken, narrowly.** Unique finds with any weight: ken has about six (multeval mismatch, redaction growth, native tool list on resume, `error.type` overwrite, dropped metrics, test gaps on #92). The plain chat has about four (silent change of state, the four-mode limit, the unhandled `result()`, "refuse, not clamp"). None on either side is serious.

How sure. B and C: sure. A: not sure. A judge who only counted unique finds would reach the same answer by a small count. A judge who ignored minor finds would call A a tie. I see no fair reading in which the plain chat wins A, so the "yes" holds; the margin on A does not. Because these pull requests had been seen before, I would not expect the A margin to repeat on unseen work.

## The owner's question: is ken's answer better?

- **#107: level.** Same risks on both sides. Plain is cheaper and explains more in the open. ken is checkable and kept.
- **#93: ken, narrowly.** One more real find, shown first. Decided by the multeval mismatch and the quotes.
- **#92: ken, narrowly.** Finds level. Decided by the quotes and the record, set against one false clause.
- **Together: ken, narrowly.** What decides it is that the owner can trust a claim without opening the diff and can find the answer again. What does not decide it is insight: with the same model, ken found about the same things. What it costs: 14.8 minutes and 2.09 million input tokens for the three, against three to nine minutes for the plain chat. If the owner reads an answer once and moves on, the plain chat serves as well for a third of the time. If the owner must rely on the answer later or show it to someone, ken is the better one.

## What the tool added and what it cost

Both sides ran the same model, so the differences come from ken's steps.

- **The draft step** is the plain chat's work: 61 to 80 s, 131k to 174k tokens in.
- **The fixed form with quotes** added: a checked quote under every decision, risk and arrow; the recorded and inferred labels; the story; the diagram; the stored record. It cost the most time of the three steps: 147 to 186 s and 20k to 25k output tokens per answer. It also thinned the reasoning. Of 24 decisions, 2 name a rejected option. Two draft points were dropped for want of a quote (prompt caching on #92, the 1 ms timer on #93); neither mattered.
- **The second look** over the three: added 2 risks (dropped metrics on #93, unique and minor; experimental flags on #107, which the plain chat also has); withdrew 1 (the timing worry on #107, correctly); rewrote 7 (4 on #92, 3 on #93); put the heaviest first, correctly, in all three. It cost 164 s of 887 s and 946k of 2.09 million input tokens. It earned its cost on #107, was marginal on #93 and showed nothing on #92. Overall it earned its time and not its tokens.
- **The "Used elsewhere" list** cannot be credited with a find from these files. It carries false matches from skill documents (`Limits` in `slack.md`, `traced` in a prompt file, `Edit`, `scripts`).

## The three most important weaknesses of ken

1. **Little more insight for three times the cost.** Over three pull requests ken's unique finds of weight are two, and on #107 it has none. It also missed what the plain chat found: on #92 it lists no risk that resume silently changes a plugin's state; on #107 it does not say the four-mode run proves setup only. Both answers missed that `transcript()` still exports the old state with the secret in the clear.
2. **The first view does not answer "why".** On #93 it shows no decision at all ("[7 decisions in this change]"). On #107 it shows one of eleven, and not the main one (the two locks on the live suite). The space goes to a diagram that is decoration on two of three, to a 250-character line shown twice on #107, and to "All 8 rest on the code" above six risks.
3. **A checked quote proves the place, not the claim, and the page does not make that plain enough where it matters.** #92's top risk says a state that is not plain JSON "resumed before"; it did not, and two verified quotes sit under it. #107 risk 2 backs "No CI workflow calls it" with `- run: npm run check`. #93 pads to ten risks, four of them trivial or, in its own words, "already true before the change".

## Three things the plain chat did better

1. **It gives the reason and the option not taken, in the open.** #93: "Reject bad values instead of clamping them. A timeout past the max fails. It isn't quietly capped." #107: `.env` holds the key, so if it could also hold the opt-in, "having a key would be enough to spend money".
2. **It says what a risk means for the owner and what to do.** #92: "Resume can quietly change a plugin's state ... with no warning", and for the quoted value, "The fix is to check the plugin without quoting the record". #93: "call it out in release notes".
3. **It is one short read with nothing hidden, in a third of the time.** #107: seven risks and seven decisions in 47 lines, including the limit ken left out: "The four-mode scenario runs test setup, not tools."

## What I would change in ken first

Put the decisions and their reasons on the first view: the three that matter most, one line each, "chosen, because". Take the room from the diagram when it only maps what was touched. This costs no model time, and it closes the one place where the plain chat is plainly the better read.

Next, aim the second look at code outside the change that keeps a different rule for the same value. That is the only kind of find that clearly beat the plain chat here (the multeval subject on #93). Re-reading its own risks cost 45% of the input tokens and changed little. Clean the "Used elsewhere" list first, so it leaves out skill documents and common words.

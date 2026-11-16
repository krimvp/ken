This is one of the two verdicts of round 8 of the checkpoint: a fresh judge compared ken's answers with a plain coding-agent chat on three pull requests ken had not been run on before, with the same model on both sides.
It was run on 16 November 2026, with ken at commit 67b5d88.
An AI judge scored it; the owner has not. The text is the judge's, unchanged: the prose check asked for no edits.

# Verdict on three unseen pull requests: #52, #50, #49

## Result in short

- The plan's rule: **yes, but only just.** ken wins B (quotes) and C (kept for tomorrow) on all three. It does not win A. A is a tie by weight.
- Who wins A on the three together: **a tie, leaning to the plain chat.** Each side has one serious find the other missed. The plain chat has more unique finds by count (about 9 to 6) and holds the only unique find that is still open today.
- A judge who only counted unique finds would give A to the plain chat. The answer to the rule would then be **no**. My "yes" rests on weighing, not counting. I am fairly sure of B and C and not sure of A.
- Is ken's answer better than the plain chat's? On what the owner learns: **level.** As something to check and keep: **ken, clearly.** On time and tokens: **the plain chat, clearly.** Taken together: **ken narrowly**, and only because of the quotes and the record.
- ken did not find more than a chat on pull requests nobody had tuned it for. Its steps bought proof and storage, not finds.
- The second look cost about 46% of ken's input tokens and gave two minor risks, one rewrite and one withdrawal. It did not earn its cost here.
- ken missed a real defect of #52 whose later fix commit (87f0a5a) touches the same file. The plain chat found that defect by reading the code.
- First change: make the second look account for every later fix commit ken hands it, one by one, and fix the risk label that says "Quotes only the changed lines" on risks that quote no changed line.

## How I checked

I read the brief, then the three merge diffs (`git diff M^1 M` for 357f378, 963c2f2, 223533f), their commit messages, and the code around the claims. I wrote my own list of decisions and risks for each pull request before I opened either answer for it. I then read the nine answer files and nothing else in those folders. I checked at least six claims per answer by hand against the code, including reasons and risks. I looked up later commits on main to see which risks were real: 42d79fa, 4f84363, 87f0a5a, 5af5f33, 4c7ada3, 55dd19a. I checked pi's real provider ids in `node_modules`, the two `endTurn` call sites, `package.json`, and the head state of the argument capture line. I changed nothing in the repository. Token cost for the plain chat is not in the files, so I compare time only where tokens are missing.

---

## Pull request #52 (metrics, propagation proof, content capture)

### My yardstick

What it did: one meter in `src/tracing.ts`, built lazily per provider. Duration and token histograms per model request. Three engine counters. Tests and a doc pattern for `traceparent` over HTTP and through a child's env. Opt-in `telemetry.captureContent`, host-only, inherited by helpers, redacted per string, cut at 16384 characters per string.

Real risks at merge:
1. Captured history has no bound per attribute. Fixed later in 42d79fa.
2. Image base64 is captured and cut into an invalid blob. Fixed in 42d79fa.
3. `void stream.result().then(...)` has no catch, and input capture sits outside the `try`. A throw in telemetry leaves the span open and an unhandled rejection. Fixed in 87f0a5a.
4. Redaction covers string values, not keys. Fixed in 4f84363.
5. Redaction knows only declared secrets. User data goes to the backend.
6. Arguments are captured before the gates run, so a denied call's arguments land on the span. Still so at head (`src/engine.ts` 554 before 556).
7. Token points are recorded for a request that ended in error.
8. Dev pin on instrumentation-undici 0.33.0.
9. Calls pi answers itself never reach `callTool`, so the counter undercounts. Fixed in 5af5f33.

### Accuracy

Plain, claims checked: lazy instruments, cached tokens, bounded attributes, host-only capture, result only on success, the pin's reason, per-string cap, images, denied-call arguments, the floating `.then`, zero-token points, attributes instead of the event. All true. One is imprecise: it says the floating `.then` bites "if pi's `result()` ever rejects". The later fix names a different trigger (a throw inside the callback). The place and the effect are right.

ken, claims checked: the summary's four claims, risks 1 to 7, decisions 1, 3, 4, 6, 9, 10, both statements, all six arrows. All true. Risk 4 rests only on a later commit message, which I confirmed.

Neither answer holds a false claim.

### Completeness

- ken missed: the floating `.then` (serious), denied-call arguments on the span (still open), zero-token points.
- Plain missed: key redaction (serious), the pi "Tool not found" undercount.
- ken left out two true points for want of a quote: the conventions mark these attributes Development, and the event option. Both survive only in the unchecked closing note.

### Criterion A

- ken only: key redaction (serious, fixed since). Tool-not-found undercount (minor). Failed requests form a separate metric series (minor).
- Plain only: floating `.then` with no catch (serious, fixed since). Denied-call arguments captured (moderate, still open). Zero-token points (minor).
- Count: 3 to 3, or 3 to 5 if ken's left-out points count for the plain chat. Weight: one serious each. The plain chat's second find is still open and ken's is not. **Tie, leaning plain.**

ken quotes line 697 (`gen_ai.tool.call.arguments`) under a diagram arrow. It did not notice that this line runs before the gate.

### Criterion B

Plain: names files, functions and commit hashes. No line numbers, no quoted code. True, but the owner cannot know that without the diff.

ken: I judged decisions 1, 3, 8, risks 1, 2, 6, statement 1 and arrow 10. The quoted lines show what the sentences claim. The seven "recorded" decisions each rest on a message line that gives the reason. Decisions 7 and 9 are labelled inferred though the design doc states their reasons; that is cautious, not wrong. **ken.**

### The second look

Added 0, withdrew 0, rewrote 1 (the image risk). 48.8 s and 339,643 input tokens, half of the answer's input. It did not turn fix 87f0a5a into a risk. **Not worth its cost here.**

### Labels, weights, order

All seven risks carry "Quotes only the changed lines". Risk 4 quotes only a later commit message, so its label is wrong on its face. The first view says "All 9 rest on the code" under a list of 7 risks; the 9 seems to add the 2 statements. The order is right: the three heaviest come first. Risk 5 (user data goes to the backend) is weighed minor and folded. That is defensible, but it is the first thing an owner should know before turning capture on.

### Diagram and story

The diagram is true. It shows what calls into `tracing.ts`. It helps a little. It says nothing of the propagation half of the change. The story is true and names the thing to watch. It also says "Later commits fixed all three", which the plain chat never says.

### Readability

The plain answer is 32 lines and shows every risk in one pass. ken's first view gives the gist faster, through the story and three risks with their fix commits. Its three visible decisions are the three metric ones; the capture decisions, which matter more, are behind a click. **Tie.** ken tells the owner what is already fixed. The plain chat presents three fixed problems as live.

### Cost

ken: 239.8 s, 663,423 tokens in, 23,935 out. Plain: one to three minutes.

---

## Pull request #50 (structured log records)

### My yardstick

What it did: the host's `log` gets a `LogRecord` instead of a string (breaking). Attribution moves from a text prefix to attributes (fixes #27). `ctx.log` gains `warn` and `error`. Hook failures are logged inside the hook span, ERROR for a gate and WARN for the rest. Progress becomes a DEBUG log record and leaves the span. The default writer prints INFO and above.

Real risks:
1. Every host with a string callback breaks.
2. Progress is gone from spans; the default writer drops DEBUG.
3. The stderr line escapes newlines but not spaces, so it can still be forged. Still so at head.
4. A host `log` that throws now throws inside the hook span before `span.end()`, and inside `ctx.progress`.
5. A gate that returns no verdict denies and logs nothing.
6. `LogRecord` has no timestamp.
7. The "listener threw" record has no attribution.

### Accuracy

Plain, checked: record fields, attribution attributes, the severity table, logging inside the span, the writer's format, "Logs API is 0.x" (in the design doc), stderr forging, the silent non-verdict gate, nested helpers naming only the inner profile, "113 commits since". All true.

ken, checked: the summary, risks 1 to 6, decisions 1, 3, 4, 5, 6, 7, 8, the four statements. One defect: risk 4 says "In this change, a gate that hit its timeout kept a working context". That behaviour is older than #50. The quote is a later fix message; it shows the bug existed, not that this change brought it. Risk 6 (trace ids need an async context manager) is marked as not settled, which is honest.

### Completeness

Neither answer found risks 4 or 6 of my list. Both found 1, 2 and 3.

### Criterion A

- ken only: the unattributed "listener threw" record (minor). Dependence on an async context manager (minor, unsettled). The timed-out gate (minor, not from this change).
- Plain only: the non-verdict gate logs nothing (minor). Nested helpers record only the inner profile (minor). More work per log call (trivial).
- **Tie.** Every find that matters is in both.

### Criterion B

Plain: file and function names, one concrete forged body. No lines.

ken: I judged decision 1, decision 3, decision 6, risk 2, risk 3, statement 3. The quotes support them. Decision 7 is "recorded", but its quoted message gives the reason for dropping DEBUG only, not for escaping newlines. The absence search (`logFailures` under `src/`, nothing found) proves what it claims. **ken.**

### The second look

Added 2 minor risks (5 and 6), withdrew 0. Risk 5 had been left out of the answer for want of a quote, and the second look found the line. 40.4 s and 280,151 input tokens. **Marginal.**

### Labels, weights, order

Risk 4 quotes only a commit message and still says "Quotes only the changed lines". "All 10 rest on the code" sits under 6 risks. The order and the weights are right.

### Diagram and story

The diagram is true and is the most useful of the three: it shows the one path a record takes. It leaves out progress. The story is true and ends on the breaking change.

### Readability

Both read well. The plain answer gives six reasons in one pass. ken's first view gives the same three top risks with a quote each. **Tie.**

### Cost

ken: 301.4 s, 646,107 tokens in, 34,306 out, one answer rejected by its checks. Plain: one to three minutes.

---

## Pull request #49 (span conformance, helper and event links)

### My yardstick

What it did: caret range on `@opentelemetry/api`. One shared, versioned tracer in a new `src/tracing.ts`. `error.type` on every failed span. Provider names mapped to the conventions. Chat input tokens now include cached ones, with the split in two new attributes. Helper spans carry the delegating call id; denials and ancestor hooks carry their level, which now travels down the chain. Tool, progress and turn_end events carry trace ids.

Real risks:
1. `gen_ai.usage.input_tokens` changed meaning on chat spans.
2. `gen_ai.provider.name` changed values.
3. `error.type` can be any thrown class name, so the set is not closed.
4. `turn_end` takes the active span.
5. The caret range lets any later 1.x in.
6. A span that is not sampled still has valid ids, so an event can point at a span nobody exported.
7. The scope version is `0.0.0`.

### Accuracy

Plain, checked: the caret reason, which spans had `error.type` before, the provider table, the level-down reason, the test in `pi.test.ts`, version `0.0.0` and Node `>=22.19`, the two changed signatures are not exported. All true. One loose line: "progress is still a span event, not its own span". #30 was about a log event, not a span, and #50 did it the same day.

ken, checked: the summary, risks 1 to 3, the withdrawn risk, decisions 1, 2, 3, 5, 7, 8, 9, 11, both statements. One false line: decision 11 says the progress span event "is still open for the owner to schedule". Commit 5a47570 (PR #50, "Refs #30") closed it. ken shows this decision on the first view as one of two that "need your call".

### Completeness

Neither found risk 6. ken left out four points for want of a quote, among them the caret risk and the JSON import; they sit in the closing note. Plain has risks 3, 5 and 7, which ken's checked answer lacks.

### Criterion A

- ken only: `unknown_tool` never appears for calls pi answers itself (minor, the same find as in #52). A query that already added cache tokens now counts twice (a detail of a shared risk). Two extra decisions: how an unresolved call is classed, and that a denial is not a failure.
- Plain only: scope version `0.0.0` (minor). Class names keep `error.type` open (minor). Changed internal signatures (minor). The caret risk, if a closing note does not count (minor).
- **Tie.** The two serious risks are in both.

### Criterion B

Plain: file names and identifiers. No lines.

ken: I judged decisions 1, 5, 7, risks 1 and 2, statement 2. The quotes support them, and risks 1 and 2 quote the line before and the line after. The reason of decision 11 goes past its quote, as said above. **ken.**

### The second look and the withdrawn risk

Withdrew 1 risk: `turn_end` and the active span. The proof quotes the `invoke_agent` callback and the `endTurn` call inside it. I checked both call sites (`src/pi.ts` 136 and 181). Both run inside that callback today. The risk was about a future change, so the withdrawal is fair, and the risk stays visible. The plain chat keeps it as a risk; that is also fair. No real risk was dropped. 53.1 s and 305,492 input tokens. **Marginal.**

### Labels, weights, order

Risk 3 quotes only a commit message under "Quotes only the changed lines". The order and weights are right.

### Diagram and story

The diagram is an import graph. It is true and it is decoration. The hard part of the change, the level that travels down the helper chain, is not in it. The story is true and names the thing to watch.

### Readability

ken's first view shows both serious risks and the thing to watch in under a minute. It also asks the owner for a call on a matter that is closed. The plain answer has all six risks in one pass. **Tie.**

### Cost

ken: 274.4 s, 677,921 tokens in, 26,662 out, one answer rejected. Plain: one to three minutes.

---

## Criterion C

ken stores each answer in a project record and a personal history (for #52: 1 work, 2 topics, 2 notes, 10 decisions), and it can be reopened without a model. The plain chat leaves a chat transcript and nothing in the project. I take the storage from the brief and from the "Stored in the project record" line; I did not open the store. **ken, on all three.**

## The table

| PR | A | B | C | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #52 | tie: one serious find each; plain also has the open denied-arguments find | ken: line quotes; plain has none | ken: stored | tie: no false claim on either side | tie: each missed one serious risk | tie: ken gives the gist and "fixed since"; plain shows all in one pass | plain: 1 to 3 min against 4 min and 663k tokens |
| #50 | tie: all main risks shared | ken: quotes and one absence search | ken: stored | plain, narrowly: ken blames an older bug on this change | tie: both miss the throwing host log | tie | plain: 1 to 3 min against 5 min, one rejected answer |
| #49 | tie: only minor unique finds | ken: before-and-after quotes | ken: stored | tie: both stale on #30; ken's sits under "your call" | plain, narrowly: ken left four points out | tie | plain: 1 to 3 min against 4.5 min |

## Verdict against the plan's rule

Does ken win on at least one criterion and lose on none? **Yes.** It wins B and C. It ties A.

Who wins A on the three together: **a tie.** Serious unique finds: one each (key redaction for ken, the floating `.then` for the plain chat). After that the plain chat has one moderate find that is still open and about six minor ones. ken has about five minor ones, one of them used twice and one not caused by the change. Minor lists do not win A, so I call it a tie that leans to the plain chat.

How sure: B and C are safe. A is not. A judge who only counted unique finds would say the plain chat wins A, and the rule's answer would be no. ken's "yes" depends on that reading.

## Is ken's answer better than the plain chat's?

- **#52: level.** ken has key redaction, the fix commits and the quotes. The plain chat has the floating `.then` and the denied-call arguments, the one unique risk still open today, at a third of the time. Neither clearly serves the owner better.
- **#50: level on content, ken narrowly overall.** The same three risks matter in both. ken's can be checked and is kept. It took five minutes.
- **#49: level.** The same two serious risks. ken's quotes show the before and after. ken's first view asks for a call on a closed matter. The plain chat adds three small true risks.
- **Together: ken narrowly.** What decides it is not what ken finds. It is that each claim carries a line the owner can read, that risks fixed since are marked as fixed, and that the answer is still there tomorrow. An owner who wants the risks once and moves on is served as well by the plain chat, in a third of the time.

## What the tool added and what it cost

Both sides ran the same model, so the difference is the tool.

- **The fixed form with quotes** added proof for every decision, risk and statement, the recorded and inferred labels, and a count of what was left out. It cost the longest step (123 to 195 s) and one rejected answer on two of three. It also drops true points that have no line: the caret risk, the Development status of the conventions. Those fall into the unchecked closing note.
- **The later commits** added "fixed since" on #52. This is the one place where ken tells the owner something useful that the plain chat did not. It still missed fix 87f0a5a on the same file.
- **The second look** over the three: added 2 minor risks, rewrote 1, withdrew 1 with sound proof, kept the order right. It cost 142 s and about 925,000 input tokens, 46% of ken's input. It found none of the risks that the plain chat found and ken missed. It did not earn its cost.
- **The search for names used elsewhere** added no find I can trace. Its list is full of noise: `packages`, `devDependencies`, `captured` in vendored skill scripts.
- **The diagram** helped on #50, a little on #52, not on #49.
- **The store** gives C.
- **Total cost:** 4 to 5 minutes and about 650,000 input tokens per question, against 1 to 3 minutes.

## The three main weaknesses of ken

1. **It does not find more than a chat, and it misses what its own inputs point at.** #52: `void stream.result().then(...)` has no catch. Fix 87f0a5a ("end the chat span and log when its telemetry throws") is a later commit on `src/pi.ts`, the kind the second look is given. ken has no such risk. The plain chat found it from the code. ken also quotes `src/engine.ts` line 697 under an arrow and does not see that it runs before the gate.
2. **Its labels and counts say more than was checked.** "Quotes only the changed lines" stands on risks whose only quote is a later commit message (#52 risk 4, #50 risk 4, #49 risk 3). All 16 risks carry the same label, so it tells the reader nothing. "All 9 rest on the code" stands under 7 risks. #49 decision 11 is flagged "your call" and says #30 "is still open"; PR #50 closed it the same day. #50 risk 4 says "In this change" about an older bug.
3. **It costs two to four times the time, and the first view does not always spend its space well.** #52 shows three metric decisions first. The decision that only the host turns capture on, and the risk that user data goes to the backend, need a click. Half the tokens of each answer go to a second look that changed little.

## Three things the plain chat did better

1. **It read the code for what is wrong, not only the messages for what was meant.** #52: the floating `.then`, and "arguments of a denied call are captured too", which is still true at head.
2. **It kept true points that have no line to quote.** #52: the conventions are in Development and names may change. #49: the caret range "cuts both ways", the scope version is `0.0.0`, class names keep `error.type` open.
3. **It was faster and complete in one pass, and said what it had not done.** About 30 lines each, every risk visible. "I didn't run the tests." "Main has moved about 113 commits" (true: 113).

## What I would change in ken first

Give the second look one fixed job before any other: for each later fix commit ken hands it, answer "was this defect present in the change?" with a quote of the line at the merge, or "no" with the line that rules it out. That would have caught 87f0a5a, and it turns the later history into finds, which is where ken does not win. In the same change, stop putting "Quotes only the changed lines" on a risk that quotes no changed line, and make the count under "Risks" match the risks.

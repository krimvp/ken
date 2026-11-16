This is one of the four verdicts of round 5 of the checkpoint after slice 3: a fresh judge compared ken's answers with a plain coding-agent chat on three pull requests ken had not been run on before, with Claude Opus on both sides.
It was run on 16 November 2026, with ken at commit bd2d2d1.
An AI judge scored it; the owner has not. The text is the judge's, unchanged: the prose check asked for no edits.

# Verdict on the three unseen pull requests (#105, #95, #94)

## Result in short

- The plan's rule is met: **yes**. ken wins B and C on all three pull requests. It does not lose A.
- A is close. ken wins it on #95 and ties on #105 and #94. The win on A rests on one find.
- The clearest win I could verify myself is B (quotes). C is a win by construction: the plain chat leaves nothing behind.
- The closest to a loss is A.
- The plain chat wins readability and cost on all three.
- I found no false claim in the three plain answers. I found one false risk in ken's answers (#94, risk 5). It carries the label "Checked in the code".
- The second pass used 52% of ken's input tokens. It added three risks: one that matters, which the plain chat found without help, and two small ones. It earned its cost on #95 at most.
- The label "Checked in the code" cannot be read as "this risk is true". It only says a quote sits outside the change.
- First change I would make: rename that label to what it measures, and make the second pass state and test the premise of each risk before it keeps it.

## How I checked

I found the three merges on main (5a85b5a, e9cb11c, 1cbc6ac) and read each diff and its commit messages before I opened either answer. For each I wrote my own list of what it did, its decisions and its risks. I read the code around the changes at the merge commit: `startSession`, `parseLimits`, `parseDelegate`, `resolveModel`, `redactEvent`, `exportMessage` and `redactor` for #105; both fixtures, `changesOf`, `unrecordedStates`, the engine's `state.update`, `STATE_CAP`, the CLI and the later commit 3e93e00 for #95; `parseCatalog`, `loadPlugins`, the import guard, `parsePlugin`, the plugin types, the boundary test and the symlink tests for #94. Then I read the six answer files and nothing else in those folders. I checked every risk on both sides against the code, and at least six claims per answer by hand (listed per pull request below). For one ken risk I ran a small Node test outside the repository to see what `import.meta.dirname` gives under a symlinked checkout. I changed nothing in the repository.

## The table

| PR | A | B | C | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #105 | tie: ken has 2 small unique finds, plain has "a resume fails too" and the enum-value gap | ken: every item has file, commit, line and the quoted code; plain cites commits and names only | ken: stored record; plain leaves a chat | tie: no false claim on either side; both overstate "one error message" for the model key | tie: each misses what the other found; plain keeps the doc's examples | plain: bug, fix, reason, risk, with examples | plain: 1 to 3 min; ken 246 s, 534k tokens in |
| #95 | ken: the cap fallback can still give a false pass, and one throw loses the whole CLI report | ken: same reason; old and new `sort` lines quoted side by side | ken | tie: no false claim on either side | ken, narrowly: plain misses the two risks above; ken misses "more false failures" and the scope line | plain: opens by saying what `respects` is | plain: ken 212 s, 467k tokens in |
| #94 | tie: ken 3 small true finds and 1 false one; plain 2 small finds and a sharper form of a shared risk | ken, with a dent: one false risk sits under real quotes and a "Checked" label | ken | plain: ken's risk 5 is false | tie | plain; ken's diagram helps a little | plain: ken 202 s, 437k tokens in |

## Verdict against the plan's rule

**Yes.** ken wins B and C and loses no criterion on the three together.

- **B, ken wins.** The plain answers name commits, files and functions. They quote no code and give no line numbers. To trust them the owner must open the diff. In my checks they were right each time, but the owner cannot see that. ken puts the exact lines under each item, and a checker confirmed the lines exist.
- **C, ken wins.** Each ken file says it stored 1 work, 2 topics, 2 notes and 6 decisions in the project record. The plain chat leaves scrollback. One open point: the stored counts list 6 decisions and no risks. The files do not show that the 5 to 7 risks reach the project record. If they sit only in the personal history, say so.
- **A, ken wins narrowly, does not lose.** Details below.

**How sure I am on A.** I am sure ken does not lose A. I am not sure it wins A. Unique true finds that an owner would care about, by my count: ken 7 (2 on #105, 2 on #95, 3 on #94), plain 6 (2 on #105, 1 on #95, 3 on #94). ken also has one unique false find. A judge who only counted would say "tie" or "ken by one". Such a judge would not say "plain". By weight, one ken find stands out (#95: the cap fallback drops paths and can pass a harmful run), and one plain find stands out (#105: a resume with a short secret also fails). So A does not decide the rule. B and C do.

## Pull request #105

**My yardstick.** Two fixes. (1) Session open refuses a non-empty secret, model key or helper-profile key under 8 characters. The host secrets are checked in `parseLimits`, together with the limits. The merged set with the model keys is checked later in `startSession`, in a second throw. The constant moves into `src/session.ts`, which was types only, and becomes public. Events keep `type` and record `kind` whole; everything else is still redacted. (2) `onSessionEnd.turns` is now the number of usage records, restored ones included. Decisions: refuse, not redact more cleverly; one floor shared with the eval runner; exempt only the two discriminants; derive the count, not store it; `maxTurns` unchanged. Risks: hosts with short secrets or keys break, on resume too; an OpenAI-compatible server with a dummy key such as `ollama` now needs 8 characters, because an unset key is refused as well; `turns` changed meaning; old transcripts undercount; the count rests on the adapter calling `observeUsage` once per request; the remaining gap for names and enum values; a new public constant.

**Claims I checked, plain:** two check places and what each covers (true); helpers reuse the parent's checked set (true); "every problem in one message" (true for host secrets, not for the model key, which is a second throw); a resume fails too (true, `parseLimits` runs before the transcript is read); `maxTurns` unchanged (true); the 2026-10-25 date (in the doc); the invariant is not enforced in code (true, it lives in one listener in `src/pi.ts`); the public export (true). Unsupported: the reason "simpler and safer than word boundaries" is the model's own; no message says it. It is not marked as a guess.

**Claims I checked, ken:** decisions 1, 3, 5, 6 and risks 1 to 7. All true. Risk 2 is true: the runner's comment promises a `ScenarioError` for a short model key, and line 107 only checks OpenAI-compatible models. Statement 2 repeats the "every problem at once" overstatement.

**Quotes against sentences (ken).** Decision 1: supports. Decision 4 ("names are still redacted"): the quote is the comment about `type` and `kind`; it does not show names being redacted. Risk 3: the quote is the hook's signature; it shows the hook exists, nothing more. Risk 4: the quote is one `push` line; the fact that old transcripts lack usage records comes from the commit message, not from that line. Risk 6: supports. All five "recorded" labels rest on message lines that give the reason. Decision 6 says openly that no message gives a reason.

**A.** ken only: the eval runner's promise does not hold for built-in keys (true, small; real provider keys are never that short); delegation events redact the profile name (true, remote). Plain only: a saved session with a short secret cannot be resumed (true, and an owner would hit it); enum values such as `unresolved` are part of the gap, and the gap reaches the catalog, system prompt and transcripts (true, from the doc). Neither: the dummy-key case for local servers; the model key arriving in a second error. **Tie.**

**Second pass.** Added risk 2 and placed it second, above the change of meaning of `turns`. That is too high. Rewrote three. It did not earn 265k tokens here.

**Labels.** Six of seven say "Checked in the code". Risks 3 and 4 rest on thin quotes. The heaviest risk is first.

**Diagram.** None.

**Readability.** Plain. It shows the bug with the doc's examples (`core__en[REDACTED:X]ble_plugin`). ken says "rewrote tool names" and moves on.

## Pull request #95

**My yardstick.** The `respects` check passed runs that changed the logs. Fixes in the shell fixture: write paths are normalized, paths under `/proc` and `/dev` count as every host file, `sort` gets an option allowlist, `> /dev/nullx` is no longer read as `/dev/null`. Files fixture: relative, `/proc` and `/dev` paths count as every host file. Both: a record over the 16 KiB cap falls back to "every host path changed"; state is written on every call. Checker: a state effect on a plugin that ran but kept no `changed` state throws; a state effect may name a helper-only plugin. Risks: the throw depends on the engine writing a record per update; the bare `catch` hides other errors; more false failures; two host lists; the fallback forgets paths outside the host list; one throw ends the whole `check`; every call now adds a state record to the transcript.

**Claims I checked, plain:** the cap case with 1200 temp files (true, it is a test case); delete and move record state when the file is missing (true); the validator used to reject a helper-only plugin (true); 3e93e00 stopped writing unchanged records and patched `unrecordedStates` to read `step.before` (true, I read that diff); the bare `catch` (true); two host lists (true); nothing in the runtime changed (true). No false claim.

**Claims I checked, ken:** decisions 2, 4, 5, 6 and risks 1 to 5. Risk 1 is true: `src/cli.ts` line 89 calls `check(run)` with no catch. Risk 2 is true: `changesOf` only walks the keys still in the last state, so after the fallback a path such as `/tmp/x` is gone and an effect on `^/tmp/` passes. No false claim.

**Quotes against sentences (ken).** Decision 2 quotes the new regex and the old line at the parent commit: strong. Decision 4: strong. Risk 1: supports. Risk 2: both lines show the mechanism. Risk 3: the later commit's message says it outright. Labels on decisions are right.

**A.** ken only: the fallback's false pass (real; it is a false pass in a fix whose whole point is no false passes; narrow, since it needs a state effect on a path outside the host list); the CLI prints no report at all (real, modest). Plain only: more false failures, with examples (real, and it changes how to read a failed score; the design doc accepts it); the scope line. Both: the engine coupling, the bare `catch`, the duplicated list. **ken.**

**Second pass.** Added risk 3, the coupling to 3e93e00. That one matters. The plain chat found it in its first and only pass, and explains it better: it says which step would throw. Rewrote risks 1, 2 and 4. I cannot see the first versions, so I cannot say whether the pass found the false pass or only reworded it. If it did, it earned its cost here. This is the one pull request where it may have.

**Labels.** Risk 3 is true and important and says "Not checked outside the change". The other four say "Checked". Order is fair; I would put the false pass first.

**Diagram.** None.

**Readability.** Plain. It starts by saying what `respects` asks and that the fixtures run nothing. ken says that only in statement 1, after the decisions and risks.

## Pull request #94

**My yardstick.** (1) `parsePlugin` returns a frozen copy: lists copied, six hooks by name, functions bound to the original objects, tool `parameters` shared. `loadPlugins` hands these frozen copies to the host. Built-ins are not parsed. (2) `pluginUnits` resolves each entry to its real path, lets links point outside the directory, refuses an index outside its unit and overlapping units, skips dangling links unless the name is a module name. Risks: overlap is checked inside one call only, while the guarded set is process-wide; a link to a broad directory guards code that is not a plugin, aigent's own `src` included; `parameters` stay live; fields outside the type are dropped; a dangling module-named link throws a raw error; validation reads the fields once and the copy reads them again, so a getter can hand the copy a value nobody validated; a host that changes a loaded plugin now hits a frozen object.

**Claims I checked, plain:** `Dirent.isDirectory()` is false for a link, so linked directories were skipped (true); risk 1, a link to a folder holding `src` (true by the code: `denial` refuses any target inside `SRC` for a file in a guarded unit; `src` even has an `index.ts`); risk 2 (true); risk 3 (true, `engine.ts` reads `parameters` live); risk 5 (true); risk 6 (true, small). One loose sentence: "the host's own object is left alone" is true for `createSession`, but `loadPlugins` gives the host the frozen copy.

**Claims I checked, ken:** all four diagram arrows, decisions 2 and 5, risks 1 to 7, statement 2. True: risk 1 (`run.ts` line 223 does load several directories), risk 2, risk 3 (line 458 validates against the live schema), risk 4, risk 6, risk 7, statement 2 (the tests skip themselves when symlinks are refused). **False: risk 5.** It says the boundary test builds `ROOT` from `import.meta.dirname` "without realpath", so a symlinked checkout breaks it. Node already gives the real path there. I ran it: under a symlinked folder, `import.meta.dirname` printed the real folder. The commit itself rests on that fact ("Node runs a module from its real path"). The risk does not exist as written.

**Quotes against sentences (ken).** Arrows: each line shows the call. Decision 3: the destructuring line shows `parameters` passed on as it is. Risk 1: strong. Risk 5: both quotes exist and neither shows the premise. Risk 7: supports. Decision 5 is marked "inferred" although the commit message gives the same reason; harmless.

**A.** ken only: raw ENOENT in place of `CatalogError` (true, small; the eval runner catches everything, a host that catches `CatalogError` would not); symlink tests skip themselves (true, small); built-ins stay unfrozen (true, trivial); the boundary test (false). Plain only: the guard can turn on aigent's own files (a sharper form of the shared broad-link risk); the time gap between `realpath`, `stat` and import (true, small); `this` still points at the live object (true, a clarification). Neither found the getter re-read or the frozen objects handed to hosts. **Tie.**

**Second pass.** Added risk 2 and again placed it second, above the live `parameters` and the broad link. Rewrote risk 3 (now names argument checking: a gain) and risk 5 (false). It did not earn 216k tokens here.

**Labels.** Risk 5 is false and says "Checked in the code". Risk 2 is true and says "Not checked". The first risk is a fair choice for heaviest.

**Diagram.** True to the code. It shows that both `loadPlugins` and `parseCatalog` go through `parsePlugin`, so both get copies. That is one useful fact. It does not show the guard's logic, which is where the risks are. A small help, not decoration, not more.

**Readability.** Plain. Problem, fix, decisions, risks, in 37 lines.

## What ken's structure added and what it cost

Both sides ran on the same model, so these differences come from the tool.

**Added:**
- Exact lines under every item. This is the whole of B.
- An honest split between reasons taken from a commit message and reasons the model worked out. Example: #105 decision 6 says "No message or comment gives a reason".
- Evidence from the search list. #94 risk 1 is the same risk as the plain chat's risk 2, but ken shows the caller that makes it real (`run.ts` line 223). #95 risk 1 comes from following `check` to the CLI.
- A statement of what was left out: 7 of 24, 12 of 36 and 6 of 18 hunks quoted, names not followed, a closing note. I checked two closing-note claims (commits 024b9ff and 3d7007e); both hold.
- The stored record.

**Cost:**
- Time and tokens: 661 s and 1.44 million input tokens for three answers, against one to three minutes each.
- The story. No ken answer says "this was broken, like this" before it lists decisions. The summary is two unchecked sentences.
- Filler in fixed slots: #105 decision 6 (a thing that did not change), #94 risk 7 (built-ins are not frozen), #95 decision 6 (which test cases were kept).
- Noise in the search list: on #94 it lists `Gate`, a class in a test, as "altered" with 18 places under `.agents/skills`.
- A diagram on one of three.
- No gain in accuracy. The structure did not stop a false risk; it dressed one in quotes.

## The second pass over the three

| PR | Added | Is it real, does it matter | Rewrote | Cost |
|---|---|---|---|---|
| #105 | eval runner misses short built-in keys | real, small | 3 | 67 s, 265k in |
| #95 | coupling to 3e93e00 | real, matters; plain had it | 3 | 66 s, 269k in |
| #94 | raw ENOENT | real, small | 2, one of them false | 43 s, 216k in |

Total: 177 s (27% of ken's time) and 750k input tokens (52%). It withdrew nothing in three runs, though one risk deserved it. It placed its own new risk second on #105 and #94, above heavier ones. It earned its cost on #95 at most, and only if the rewrite there is what produced the false-pass risk; the files do not let me see that. On the other two it did not.

## Can the risk labels be trusted?

Not as a sign of truth. 19 risks: 15 say "Checked in the code", 4 say "Not checked outside the change".

- Of the 15 "Checked", one is false (#94 risk 5) and three rest on a quote that shows little (#105 risks 3 and 4, #94 risk 4).
- Of the 4 "Not checked", all are true, and one is among the most important (#95 risk 3).

The label is computed honestly. It says only that a quote holds a line outside the change. The words "Checked in the code" say more than that. A reader will take it as "someone looked and it is so".

## The three most important weaknesses of ken

1. **A false risk can pass every check and get the strongest label.** #94 risk 5: real quotes from `test/boundary.test.ts`, the label "Checked in the code", "rewritten in the second pass", and the premise is wrong. This hits B, the criterion ken wins on.
2. **The second pass costs half the tokens and returns little, and ranks its own finds too high.** #105: the eval-runner note sits second, above the change in what `turns` means. #94: the raw ENOENT sits second, above the live `parameters`. It never withdrew a risk.
3. **The answer is harder to take in and drops the plain consequences.** #105: ken never says that resuming a saved session fails too. #95: ken never says a failed `respects` may now be the fixture being strict, and never says production code is untouched. #105 loses the two examples that make the bug clear.

## Three things the plain chat did better

1. **It tells the story first.** #94: "`Dirent.isDirectory()` is false for a link", so linked directories were skipped. #105: secret `a` turned `core__enable_plugin` into `core__en[REDACTED:X]ble_plugin`.
2. **It says what a risk means for the owner, and what it did not find.** #105: "A resume fails too". #95: "The risk is to how much you can trust the safety scores." #94: "I found nothing in `src` that does this" and "I didn't see tests for risks 1 or 2."
3. **It was right and fast in one pass.** No false claim in three answers. On #95 it found the 3e93e00 coupling by itself and explained which step would throw; ken needed its second pass to add it.

## What I would change in ken first

Fix the label, then the second pass that feeds it.

- Rename "Checked in the code" to what ken measures, for example "Cites code outside the change".
- In the second pass, make the model write the one fact each risk depends on, and quote the line that shows that fact. A risk whose fact has no line goes out or is marked as a guess. #94 risk 5 would have failed this: no line shows that `import.meta.dirname` is not a real path.
- Tell the pass that withdrawing is a normal result, and that a new risk gets no better place than an old one.

After that, add a short "what was broken, what changed" opening, with one example, checked like the rest.

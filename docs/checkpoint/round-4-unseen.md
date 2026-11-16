This is the second verdict of round 4 of the checkpoint after slice 3: a fresh judge compared ken's answers with a plain coding-agent chat on three pull requests ken had not been run on before, with Claude Opus on both sides.
It was run on 16 November 2026, with ken at commit ba270bf.
An AI judge scored it; the owner has not. The text is the judge's, unchanged: the prose check asked for no edits.

# Verdict: ken against a plain chat on pull requests #101, #99 and #96

## Result in short

- The plan's rule is met, narrowly: **yes**. ken wins B and C, and A is a tie over the three pull requests.
- A is 1-1-1: the plain chat wins #101, ken wins #99, #96 is a tie. By count the plain chat has more unique real finds. ken has the single heaviest one.
- ken's win on #99 comes only from the second pass. Without the second pass ken loses A on the three together, and the answer to the rule is no.
- B is the clearest win. Every ken claim carries quoted lines, and the plain chat quotes none. The win has two holes: one quote points at the wrong function, and three "recorded" labels rest on lines that say what was done, not why.
- C is a win by construction. I could not open the stored record. I only saw the counts each ken file prints.
- The plain chat is easier to read on all three, and it made one false claim that matters (#99). ken made no false claim, and listed one risk that is not real (#99, risk 5).
- ken cost 487 s and 1.27 million input tokens for the three. The second pass was 94 s and 650 thousand of those tokens. It added two risks: one important, one minor, none on #96.

## How I checked

For each pull request I read the full diff (`git diff M^1 M`) and the commit messages before I opened either answer, and wrote my own list of what it did, its decisions and its risks. I then read the code around the claims: `src/engine.ts`, `src/hooks.ts`, `src/pi.ts`, `src/eval/checks.ts`, `src/sandbox*.ts`, `src/core-tools.ts`, `test/live.test.ts`, `package.json`, the three workflows, `integrations/multeval/loader.ts`, and pi 1.3.0 in `node_modules`. I checked at least six claims per answer by hand and name them below. I read only the six answer files and the brief. I did not read earlier answers or verdicts, any skill file, or anything under the ken repository. I judged ken on its text rendering. On the real page the quotes are folded, which would shorten it, but would not remove the repetition or the unranked risk lists.

## Table

| PR | A | B | C | Accuracy | Completeness | Readability | Cost |
|---|---|---|---|---|---|---|---|
| #101 | plain: two real risks ken missed (paid live tests, reporting button needs a repo setting) | ken: quotes present; two "recorded" labels are thin | ken: stored record | tie: no false claim on either side | plain: ken missed two risks, plain missed one small one | plain: 23 lines against 155 | tie: 133 s is inside plain's 1 to 3 minutes |
| #99 | ken: broken id join in the eval check, found by the second pass | ken: quotes support the claims | ken: stored record | ken: plain said the in-repo joins still hold, which is false | ken: slightly | plain: 26 lines against 184 | tie: 153 s |
| #96 | tie: one real unique risk each | ken: but one quote is from the wrong function | ken: stored record | tie: one small slip each | tie | plain: 28 lines against 184 | plain: ken took 201 s, above plain's range |
| Together | tie | ken | ken | tie, ken slightly | tie | plain | plain slightly |

The plain chat's token use is not stated, so the cost column compares time only.

## Verdict against the plan's rule

**Yes.** ken wins B and C on the three together and loses no criterion. A is a tie.

- Clearest win: **B**. It holds on all three pull requests and I could confirm it from the files.
- Closest to a loss: **A**. The plain chat won #101 outright, and has four unique real finds over the three against ken's two that matter. I call it a tie because ken's #99 find is the heaviest single item and the plain chat stated the opposite of it. A judge who counts instead of weighs would give A to the plain chat.

## Pull request #101 (docs: README, SECURITY.md, .env.example)

**My yardstick.** Three new files, no code, no test. Decisions: say plainly that aigent is unreleased and cannot be installed; quickstart runs from a checkout; a tool mode table with numbers copied from the code; `.env.example` lists only variables that are read, with the live-test lines commented out; private reporting through GitHub; plugins trusted, a malicious plugin and just-bash bugs out of scope. Risks: the numbers, model ids and CI facts will drift and nothing checks them; the quickstart code is not run by any test; the reporting button exists only if a repo setting is on; SECURITY.md turns the engine's guarantees into public promises; no license.

**Accuracy.** I checked for ken: the 64 default (`src/pi.ts:265`), the empty `AIGENT_LIVE_MODELS` case (`test/live.test.ts:19`), the `OLLAMA_API_KEY` default (`src/cli.ts:78`), the judge fallback (`package.json` eval script), the judge pin (`loader.ts:15`), the SSH claim. All true. For plain: the sandbox numbers (true in `sandbox-worker.ts`, `core-tools.ts`), "#100 brought in maxCodeCalls" (true, 3cd4957), "`npm test` loaded the live file and it read `.env`" (true: the test glob and `process.loadEnvFile`), "#107 fixed this, b5e21ef" (true; that commit's message says "216 paid model calls"), the commented-out lines, the merge date (10 November in local time; ken prints 9 November). No false claim on either side.

**Completeness and A.**
- Plain only: (1) a key in `.env` put the paid live suite one skip pattern away from `npm run check`. Real. A later pull request fixed it, which shows it mattered. (2) The "Report a vulnerability" button needs private reporting turned on in the repo settings. Real, and the owner must act on it.
- ken only: (1) the judge model is pinned, so another endpoint fails unless it serves that id. Real, small. (2) No license as a risk. The README says it itself, and plain mentions the fact under its first decision.
- Both: drift of copied numbers, SECURITY.md promises, SSH access for the evals.
- Weight: plain's two outweigh ken's two. **A: plain.**

**B.** ken's quotes are real and mostly support their sentences. I judged decision 1 (supports why the file exists, not why this channel), decision 4 and decision 5 (labelled "recorded", but the message lines say what the files contain; the "Why" repeats the "Chosen"), risk 1 (README line beside the two constants: supports fully), statement 3 (supports), risk 5 (supports the pin; the consequence is inferred). Plain cites commit ids and says it checked the numbers against `src/`. It did, but the reader cannot see that. **B: ken, by less than on the code pull requests.**

**Second pass.** One risk, the judge pin. Real, minor. 26 s and 154 thousand input tokens, half of this answer's input. Barely earned.

**Diagram.** None. That is right for a docs change.

**Readability.** Plain. ken prints README line 7 twice and line 69 twice, each a full paragraph.

## Pull request #99 (call ids, undeclared calls, direct-call validation)

**My yardstick.** Three fixes. (1) `resolve` now validates a late plugin tool called by its own name. (2) The pi adapter keeps the set of names it offered and reports any other name from `tool_execution_end` to a new `undeclaredCall`; the engine records it as unresolved and runs nothing. (3) `callIdFor` gives every call an engine id: `/` becomes `%2F`, `#n` is added on reuse, and a resume seeds the used ids. Decisions: an engine id instead of storing denials on the call record (the message names the rejected option); report after pi answered because pi has no earlier hook; the model still sees pi's text. Risks: engine ids no longer equal provider ids, so any join across the two breaks; `src/eval/checks.ts` `dispatchRecover` does exactly that join (transcript ids against event ids, lines 403 to 415); old transcripts keep merged denials; the adapter depends on pi internals; undeclared calls emit no session events; thin tests.

**Accuracy.** For plain I checked: the id form (true), resume seeding from call, delegation and denial records (true, `engine.ts:358`), "pi awaits listeners" (true, `agent.js` awaits each listener for every event), "`offered` is refreshed at prompt start and each turn" (true), "undeclared calls emit no tool_start or tool_end" (true, the error branch of `runCall`), "nothing tests native mode or `%2F`/`#` ids" (true). One false claim: **"Inside the repo the joins are engine-to-engine ... so they still hold."** `dispatchRecover` matches provider ids from the transcript against engine ids from events. One unlabelled guess: the reason for "`%2F` plus `#n` rather than a fresh counter" is plain's own; no commit says it.
For ken I checked: decisions 1 to 4 against the messages (true), risk 2 (true), risk 4 (true), risk 6 (true: the test uses dispatch only), risk 7 (true, read the code), risk 5 (**not real**: pi awaits the listener for every event; ken left it as "if pi does not await"). No false sentence.

**Completeness and A.**
- ken only: (1) the `dispatch-recover` eval check now compares ids from two different id spaces, so on a provider that repeats ids a call can look rejected and a retry can go unseen. Real, concrete, still open in the code, and it hits the providers this change was made for. (2) The direct-call check is tested in dispatch mode only. Minor. (3) Risk 5, not real: padding.
- Plain only: (1) undeclared calls emit no session events, so a host that watches events misses them. Real, modest. (2) Missing tests for native mode and for ids with `%2F` or `#`. Minor.
- Weight: ken's first item is the heaviest find in the whole comparison, and plain told the owner the opposite. **A: ken.**

**B.** ken's quotes support their sentences: decision 1 (the reason and the rejected option are both quoted from the message), risk 2 (the span attribute line), risk 7 (the three map lines and the `find` line show the join), arrows 5 to 8 (each quotes the calling line). Decision 4 is labelled "recorded" on a line that states the effect; the reason is inferred. Plain names commits, functions and files, and quotes nothing. **B: ken.**

**Second pass.** One risk, number 7. Real and it matters. 48 s and 325 thousand input tokens, two thirds of this answer's input. Earned.

**Diagram.** True to the code. It shows the two ways a call reaches the engine, which is the new shape. It leaves out the validation fix, and its last two arrows say little. A small help, not decoration, not essential.

**Readability.** Plain. ken quotes one 1,300-character doc line in full under decision 4, and a second one of 700 characters under risk 1. Its most important risk is listed last of seven.

## Pull request #96 (lifetimes of sessions, calls, gates and hook contexts)

**My yardstick.** Four fixes. A closed session rejects calls, enables and prompts. `runCall` binds the run it started in. `Settled` gets an `aborted` kind: a gate cut off by an abort denies nothing, and the call ends as `error` without running its tool. A hook's signal fires when the hook settles, and from then `log` and `state.update` throw. Decisions: throw, not a no-op; reuse `error` instead of a new outcome; tool contexts unchanged; the adapter's `enable` has its own check. Risks: detached hook work now throws, uncaught outside the hook's promise; the signal fires on success; a real hook failure during an abort is filed as aborted; an aborted call is `error` in the record and `ran` in the event and span; a call after close leaves no record; a late call is in no turn; an observer cut off by close loses its state write.

**Accuracy.** For plain I checked: the three entry checks (true), `owner = run` (true), the three `Settled` kinds (true), "tools call `contextFor` with no lifetime" (true, `engine.ts:482`), "observers run with `closing` as their signal" (true, the default `extra` and `observeCall`), "`onSessionEnd` runs under its timeout alone" (true, `extra` is `[]`), the pull request title (true, in the merge body). "48 commits have landed since": I count 54 on main, 45 without merges. Small, and main may have moved. For ken: decisions 1, 3, 4, 5, 6 against the messages (true), risk 1 (true, lines 538 and 540), risk 4 (true, `hooks.ts:48`), risk 6 (true). No false sentence. One quote is misplaced, see B.

**Completeness and A.**
- ken only: a call aborted before its tool ran is `error` in the record but `ran` in the event that observers get and in the span. Real. An observer that counts "ran" counts a tool that never ran.
- Plain only: (1) if close happens while an observer runs, its next `state.update` throws and the write is lost. Real, and new with this change. (2) The record cannot tell an abort from a failure. Real, close to ken's item from the other side. (3) No test for the signal firing on success or for close during an observer. Minor.
- Both: the signal fires on success, detached work throws, a real failure hidden as aborted, no record after close, tool contexts left alone.
- Weight: one moderate unique risk each. **A: tie.**

**B.** ken's quotes support decision 1, decision 4, risk 1, risk 4 and statement 3. One does not: decision 6 and statement 1 quote `src/pi.ts` line 169 for the new check in `Session.enable`. Line 169 is the old check in `prompt()`. The new line is near line 207 and has the same text, so the checker passed it. Plain cites commits and names and quotes nothing. **B: ken.**

**Second pass.** Added nothing, withdrew nothing. 21 s and 170 thousand input tokens. Not earned here.

**Diagram.** None. A picture of the four lifetimes would have helped here more than on #99.

**Readability.** Plain. It also says which risk is the biggest. ken's list does not.

**Cost.** ken took 201 s, with one answer sent back by the checks. That is above the plain chat's range.

## Criterion C

ken leaves a project record and a personal history that reopen without a model. Each file shows what was stored (for example one work, two topics, two notes, six decisions). I did not open the record, so I can confirm that something was stored, not that it reads well. The plain chat leaves a chat transcript that the owner must find and scroll. **C: ken**, by construction.

## What ken's structure added and what it cost

Both sides ran on the same model, so these differences come from the tool.

Added:
- Quotes under every claim. A reader can check a sentence without opening the diff. This also kept ken from writing guessed reasons as facts: where the message gave no reason, ken said so (#96, decision 2).
- The rejected option, the undo cost and "needs the owner's opinion" on each decision. Plain gives the first sometimes and the other two never.
- Coverage numbers and a closing note that say what was not looked at (14 of 37 hunks quoted on #96).
- The second pass, which found the one risk plain got wrong.

Cost:
- Length. 155 to 184 lines against 23 to 28, with long lines printed twice.
- No ranking. Risks come in the order the model wrote them.
- A narrow view. ken answers at the merge commit and from the diff outward. Plain used what came after the merge (#107) and opened the dependency to settle a doubt. ken listed the doubt as a risk.
- Time and tokens: 487 s and 1.27 million input tokens for three answers.
- The "used elsewhere" list did nothing visible in the first pass: 0 of 6 names followed on #99 and 0 of 11 on #96.

## The second pass over the three

It added two risks and no decisions, and withdrew none. On #99 it found the eval-check join: real, important, and the reason ken wins A there. On #101 it found the judge pin: real, minor. On #96 it found nothing. It cost 94 s of 487 s and 650 thousand of 1.27 million input tokens. It earned its cost, because without it A is lost and the rule's answer turns to no. But half the token bill for two entries is a poor ratio, and it did not withdraw the one risk that is not real (#99, risk 5).

## The three most important weaknesses of ken

1. **The first pass does not look far enough, and does not settle its own doubts.** On #101 it missed the paid live tests and the repo setting behind the reporting button. On #99 it wrote "if pi does not await it for tool_execution_end" as a risk; the plain chat read pi in `node_modules` and found that it does await. On #99 the first pass followed none of the six names in its own "used elsewhere" list; the join in `src/eval/checks.ts` was found only on the second try.
2. **The answer is long, repeats itself and does not rank.** #99 prints a 1,300-character doc line under decision 4 and a 700-character one under risk 1. #101 prints README line 7 twice and line 69 twice. On #99 the most important risk is number 7 of 7, after a risk that is not real.
3. **The quote check proves a line exists, not that it supports the sentence.** On #96, decision 6 quotes `src/pi.ts` line 169 for the new `enable` check; that line is the old check in `prompt()`. On #101, decisions 4 and 5 are "recorded" on message lines that state what the files say, and the "Why" repeats the "Chosen". On #99, decision 4 is "recorded" on a line that states the effect.

## Three things the plain chat did better

1. **It used the history after the merge.** #101: "#107 fixed this (commit b5e21ef)", with the 216 paid calls. #96: the code is still on main in this form. ken stops at the merge commit.
2. **It checked a doubt instead of listing it.** #99: "I checked pi 1.3.0 in `node_modules`: it awaits listeners." #101: "I checked these numbers against `src/` and they match today." Both are true.
3. **It reads in one pass and says what to do.** #96 names "the biggest behavior change for plugin authors" first. #101 says "check it" for the repo setting. #99 says "Recheck this when you bump pi."

Its one serious fault: on #99 it reassured the owner that the in-repo id joins still hold. They do not.

## What I would change in ken first

Make the model check each risk before the answer is accepted, and rank them. For every risk, it must read the place the risk points at: a use from the "used elsewhere" list, the dependency's code, or the commits after the merge. It then marks the risk "confirmed in the code" with that quote, or "not checked". A risk the model could settle by reading is settled, not listed. The heaviest risk goes first. This folds the second pass's one useful move (follow the changed names to their other uses) into the first pass, removes entries like #99 risk 5, and would have caught the #101 live-test risk if the later history is in reach. After that: print a long quoted line once and trim it, and make the checker reject a quote whose line is outside the function the sentence names.

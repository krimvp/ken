---
name: code-style
description: How ken's TypeScript is written and laid out. Use when writing, moving, or reviewing code in src/, test/, or scripts/, when adding a module or a file, and when deciding on an interface, a comment, or a dependency.
---

# Code style

Read `ponytail` first: it decides how much code to write. This skill decides what that code looks like. `typescript-best-practices` holds the type-level rules (discriminated unions, no `as`, `unknown` at the boundary) and they all apply.

## Runtime facts

Node 22.19 or later runs the `.ts` files directly. There is no build step. So:

- Use only syntax that Node can strip: no `enum`, no `namespace`, no constructor parameter properties.
- Import with the `.ts` extension. Use ES modules and named exports. A default export is allowed only where a loader requires one.

## Structure

- **One job per module.** A module is a folder directly under `src/`. Its job fits in one sentence, and that sentence is in the `MODULES` table in `scripts/check/structure.ts`.
- **`index.ts` is the door.** It exports what other modules may use. Code outside the module imports from the door and from nowhere else in the module. Keep the door small: a module with a lot behind a small door is a good module.
- **Dependencies point one way.** The table says which modules a module may import. If you need an import the table forbids, the code is in the wrong module. Move it. Do not widen the table to make an error go away.
- **Few files per folder.** When a folder passes about six files, group them by concept into subfolders. The structure check fails at more than eight.
- **One main thing per file**, and the file is named after it in kebab-case (`quote-check.ts` holds `checkQuote`). No `utils.ts`, `helpers.ts`, `common.ts`, or `types.ts`. A helper lives beside its only caller. A type lives with the module that owns the concept.
- **Split by job, never by line count.** A long function that does one job stays whole. A function that does two jobs becomes two.

## Shape of the code

- **Name the data first.** Write the types of the things the code handles before the logic. Model variants as a union with a `kind` field.
- **Functions and plain data by default.** Write a class only for a thing that owns state with a lifetime: a store, a session, a server.
- **An interface needs a reason.** Declare one in two cases. The first is a seam with the outside: git, the file system, the model, the clock. The second is two real implementations. Name the interface for the job (`Repository`, `RecordStore`) and the implementation for the how (`gitRepository`, `fileRecordStore`). One implementation and no seam means no interface: export the function.
- **Accept dependencies, do not create them.** A function that needs a repository or a clock takes it as an argument.
- **Check at the edge, trust inside.** Parse whatever comes from outside (command arguments, HTTP bodies, tool arguments from the model, file contents, git output) into a typed value at the point it enters. Past that point, trust the types and write no defensive checks.
- **Expected failures are values.** A quote that does not match and a store entry that fails validation are results the caller must handle. Return them as a union. Throw only for a bug or a broken environment, with a message that says what failed and what to do.
- **Await every promise.** Pass an `AbortSignal` to anything that can run long.
- **Standard library first.** A new dependency needs a reason in the commit message and an entry in the module's `packages` list.

## Comments

A comment is for the reader who has the code in front of them and still cannot see why.

- **Header on a key module.** The door of a module, and a file that holds a central type or a rule from the plan, starts with two to four lines: what it owns and the reason it exists.
- **A line at a crossroads.** Where the code takes a path a reader would not expect, say why in one line: a limit, an order that matters, a case that looks like a bug.
- **A known limit.** `// shortcut: <the limit>, <when to upgrade>`.
- Write no other comments. Nothing that repeats the code, narrates steps, or records history. If a comment explains what a block does, rename or split until the code says it.

When `no-comments` or `comment-sicko` flags a module header or a crossroads line that meets these rules, keep it.

## Tests

`test-audit` gates every new or changed test. On top of its gate:

- Test a module through its door, with real collaborators where they are cheap: a real git repository in a temp directory, real files, the real checker.
- Fake only what you cannot run: the model.
- Assert what a user of the module can observe. Never assert the wording of generated prose.
- One good test for risky logic beats ten for trivia. No test for a getter, a type, or a constant.

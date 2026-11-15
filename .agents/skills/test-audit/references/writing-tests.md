# Writing tests and proof policy

Repo-neutral condensation of openclaw's `docs/help/testing/writing-tests.md` and the
proof policy in its `openclaw-testing` skill. openclaw-specific tooling is dropped.

## Prove behavior at the owning boundary

Prove a caller-visible contract through its production owner with fixed external
I/O fixtures and independent expected values. Prefer focused integration tests
and independent unit contracts over mocked internal decisions or whole-product
boots. Name the credible regression and what the test cannot prove.

Work in vertical slices: failing behavior, coherent repair, passing proof.
Regressions must fail on the original defect, not fixture setup; report unavailable
baseline proof. Refactor under green tests and preserve distinct contracts when
consolidating coverage. Use synthetic content and keep credentials out of captures.

Too many private controls suggest fragmented ownership, not a need for test-only
exports.

## Cost budget

- Measure every new or changed test file on its own and report its wall time.
- Seconds-long tests must prove a contract no cheaper layer can. Long end-to-end
  compositions belong in a separate, opt-in tier.
- Target under 5 seconds per file. Above 30 seconds, explain the contract and why
  no cheaper layer proves it.
- Inject clocks; do not add real timers, sleeps, or polling. Isolate each file's
  state and reuse suite-level fixtures instead of booting one per test. Import
  narrow APIs, not broad barrels. Fix shared state; do not add serial configs.

## Flake triage

Reproduce the original order before running a test alone; order-only failures
usually mean shared state leaked from an earlier file. Classify fixture state,
missing completion signals, and product races, then repair the producer. Choose
repeat counts for the reproduced failure mode, not a fixed clean-run quota.

## Adding regressions

For bugs against live providers (LLM APIs, MCP servers, tool backends), prefer a
CI-safe regression at the smallest production composition that reaches the
defect: real adapters with captured requests, or independent parser unit
contracts. Keep inherently live-only checks narrow and opt-in.

## Proof policy

- CI is the default broad proof. Once the change builds and focused tests pass,
  open the PR; do not delay it for full local suite runs.
- Before the PR, prove narrowly: the touched tests, targeted typecheck, lint, and
  format.
- Never rerun or re-push just to get green. Fix real failures; read the failure
  before attributing red to flakiness.
- Prove the changed contract, complete the required gates, finish. Broaden or
  repeat only for changed inputs, failures, or a named unresolved risk.

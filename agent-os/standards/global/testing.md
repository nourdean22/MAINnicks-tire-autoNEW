# Testing

Tests are the receipt that proves the work.

## Philosophy

- Test behavior, not implementation. A test that breaks on a safe refactor is a
  liability.
- Cover the contract: happy path, the boundary, and the failure mode.
- A bug fix ships with a test that fails before the fix and passes after.

## Runner & structure

- Default runner: **Vitest**. Colocate `*.test.ts` with source.
- Arrange–Act–Assert. One reason to fail per test where practical.
- Deterministic: no real network, no wall-clock, no shared mutable state.
  Mock at the boundary; fake timers for time.
- **Restore global state in `afterEach`** — unmock, unstub, and restore-or-delete
  env vars. Suites that share one process leak state between files otherwise.

## Test-shell hygiene

- Never export real API keys or a production `DATABASE_URL` into the test shell.
  Provider chains reorder and empty-DB smoke tests will see real data.

## Gates & receipts

- Scoped `--affected` runs while iterating; full runs before merge.
- **Piping the runner to `tail` masks the exit code** — read the summary line.
- "Done" means the gate passed and you can paste count + exit code.
- Never mark a task complete with a failing or unexplained-skipped test.

## Coverage

- Chase meaningful coverage of logic and edge cases, not a vanity percentage.
- Untested paths in payment, auth, prod-DB, and side-effect lanes are treated as
  broken until covered.

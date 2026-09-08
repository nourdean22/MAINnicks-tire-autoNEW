---
name: positive-control-first
description: Use whenever you write a new test, canary, gate, guard regex, or alarm. Run it against the UNFIXED code first and record the failure shape. A test that has never failed is a silent instrument, not coverage.
---

# Positive Control First

> **A new test is not done until it has been run against the code it is
> meant to catch, and the failure recorded in the PR body.**

A green test proves nothing until you have seen it go red for the right
reason.

## The base rate

Every new test in the 2026-09-01 wave was run against unfixed code first
and its failure shape recorded — middleware 6f/8p · ingest-gmail 5f/1p ·
recall 5f/1p · N-1 2f/1p. **Two of those four runs caught test-harness
bugs that would otherwise have shipped as green tests of nothing:**

- `vi.restoreAllMocks()` stripped factory resolved values, so
  ingest-gmail crashed on `.length` rather than asserting.
- A `mockImplementationOnce(throw)` was left unconsumed by a read-only
  control and fired in the **next** test.

Cost of running the control: none. That is the point.

## Two ways a canary lies

1. **A mutation that SURVIVES.** Two independent layers rejected the
   input, so removing either left behaviour correct and the suite green.
   **Pin layers separately** — a single end-to-end assertion cannot tell
   you which layer holds.
2. **A red for the WRONG reason.** `vi.clearAllMocks()` does not drain a
   `mockResolvedValueOnce` queue, so the "failure" was a harness artifact.
   **A red you did not diagnose is not a passing canary** — read the
   message, not the colour.

## Fixing a noisy alarm

When the change makes a *false* alarm stop firing, the test must prove it
**still fires on the true case**. Silencing and fixing produce the same
green suite otherwise. Assert both halves: quiet on the false input, red
on the real one.

## A positive control can pin a falsehood

The control must assert something that is *true*, not merely something
that is *present*. Live example on `main`:
`apps/nickstire/client/src/__tests__/canonical-business-truth.test.ts`
asserts `"the new-ownership statement is still on the site"` — but the
owner confirmed 2026-09-03 that Nick's is the **same owner** who renamed
Moe's, so the invariant is false, and the control is green only because
`/new ownership/i` matches an unrelated consumer-advice sentence in
`shared/guides.ts` and a **comment** in `shared/voice.ts`. See
`empty-vs-error` — "when a test resists a correct fix, read the test as a
finding."

**So: after writing a control, ask what it would take to make it fail
dishonestly.** If a comment or an unrelated string can satisfy it, scope
it (strip comments, anchor the pattern, name the file).

## Checklist

1. Write the test.
2. Run it against the **unfixed** code. Record `Nf/Mp` and the message.
3. Confirm the failure is the one you meant, not a harness artifact.
4. Apply the fix; confirm green.
5. Mutate the fix back out; confirm red again.
6. Paste steps 2 and 5 into the PR body.

Related: `assert-the-consumer` · `empty-vs-error` · `guard-red-team`
(the same discipline for deny-lists and guard regexes).

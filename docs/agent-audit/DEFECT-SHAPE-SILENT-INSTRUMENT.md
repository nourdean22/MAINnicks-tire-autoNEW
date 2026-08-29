# Defect shape: the silent instrument

**A probe that reports nothing looks exactly like a probe that found nothing.**

A zero result, a green suite and a mutation the guard "survived" are all the
same observation: *no signal*. No-signal is the expected output of a working
check on clean input — and it is also the output of a check that never ran,
never matched, or had its output thrown away. Nothing in the result
distinguishes them. Only a **known positive** does.

This is the sibling of
[the orphaned subject](DEFECT-SHAPE-ORPHANED-SUBJECT.md): that one is a control
nothing consumes, this one is a control that consumes nothing.

## Three cases in one session — 2026-08-29

**1. A `sed` mutation that silently matched nothing.**
Mutation-testing a take-scoring guard, the substitution pattern did not match
the target line. `sed` exits 0 when it replaces nothing, the suite stayed green,
and the reading was "the guard survived the mutation — it is not load-bearing."
The truth was that the file had never changed. Re-running with the edit
*verified* (`grep` the mutated line before running the suite) showed **two**
tests catching it.
→ **Never conclude from an unverified mutation. Assert the file changed.**

**2. `ffmpeg -v error` suppressed the measurement it was invoked to take.**
Checking whether a reel's audio contained speech, `volumedetect` printed
nothing. The natural reading was "there is no audio." The flag that silences
errors also silences `volumedetect`, whose entire output is informational. The
file had a full 21s stereo track at −16.5 dBFS.
→ **A measurement tool's output is not an error. Re-run without the filter
before believing a null, and confirm on a known-good input.**

**3. A swap probe that fired 6/6.**
A sibling session's probe reported every case positive. A control that never
reports negative is not detecting a condition; it is reporting its own
existence.
→ **A check that cannot return the other answer has not been tested.**

## The rule

Before trusting *any* clean result, in either direction:

1. **Plant a known positive** and confirm the instrument reports it.
2. **Confirm the mutation actually applied** — read the changed bytes, do not
   assume the edit command worked.
3. **Confirm output is not being filtered** — verbosity flags, pipes, `2>/dev/null`,
   and log-tailing locks all eat the thing you were measuring.
4. **Confirm the check can return both answers.** A rule that only ever says
   "pass", or only ever says "fail", is untested regardless of how it reads.

## Known blind spots

Carried here from `AGENTS.md` when that file hit its line cap — the rule there
is the one-line version, this is the list:

- **fixture-only tests** — green against data the author invented, never against
  the shape production actually produces
- **gates that fail open** — an infrastructure error resolves to "proceed", so
  the gate is silent exactly when it matters
- **a `tail -f`-locked log** on Windows — the reader holds the file the writer
  needs, so the artifact you are watching for never appears
- **a correct query against a stale checkout** — see the last precedent below

## Related precedents in this repo

- `policy.test.mjs` and `lintGateFailClosed.test.ts` — each breaks its gate *and*
  asserts an unbroken run still passes. Without the pair, a permanently broken
  gate scores green.
- The city/neighborhood review scan whose first `grep` returned `0` because it
  ran against a checkout 54 commits behind `main`. The number was real; the
  surface was wrong. **A correct measurement of the wrong thing is still a
  silent instrument.**

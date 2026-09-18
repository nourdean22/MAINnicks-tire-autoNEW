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

A third sibling is [the stale denominator](DEFECT-SHAPE-STALE-DENOMINATOR.md):
there the probe DOES report, correctly and specifically, and still answers a
different question than the one asked, because its window went unstated.

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
- **vitest silently drops nonexistent files from a MIXED path list** — measured
  2026-08-29. Given four paths of which two did not exist, it ran the two real
  ones and printed `Test Files 2 passed (2)` — a green with no mention of the
  missing two. Given *only* bad paths it does fail loudly
  (`No test files found, exiting with code 1`), so the hazard is specifically the
  mixed list, which is what you produce when you guess a filename.
  **Any "N tests passed" claim where a path was typed from memory may be a report
  on a suite that never contained the test being proven.** Count the files in the
  summary against the files you named; if they disagree, you have measured nothing.
  Caught here while claiming the review rating floor was covered — two of the four
  named paths were invented, and the real test was `server/reviewRatingFloor.test.ts`.

## Related precedents in this repo

- `policy.test.mjs` and `lintGateFailClosed.test.ts` — each breaks its gate *and*
  asserts an unbroken run still passes. Without the pair, a permanently broken
  gate scores green.
- The city/neighborhood review scan whose first `grep` returned `0` because it
  ran against a checkout 54 commits behind `main`. The number was real; the
  surface was wrong. **A correct measurement of the wrong thing is still a
  silent instrument.**

## The skill that encodes this

**`.claude/skills/positive-control-first/SKILL.md`** (2026-09-08, PR #2203): a new
test, canary, gate or guard regex is not done until it has been run against the code
it is meant to catch and the failure recorded.

### Three more instances — 2026-09-08, all in the skills that describe this shape

Recorded because each was authored by someone actively writing about silent
instruments, and all three were caught by review rather than by their author.

1. **A detector that could not match its own documented data.** `empty-vs-error`
   shipped `\.catch\(\(\) *=> *(\[\]|0)`, which requires `()` immediately before
   `=>` — while its own table three lines above said 36 files use
   `.catch((): never[] => [])`. Measured properly: **147** files match with an
   annotation allowed, **98** without. A 49-file blind spot, positive-controlled
   against synthetic input that happened to contain only the forms the author was
   already thinking of.
2. **A comment filter that kept comments** — see the producer/consumer doc.
3. **Three regex arms that could never match anything.** In
   `canonical-business-truth.test.ts` (PR #2206) the `\b` boundaries were written into
   the file as literal `0x08` backspace bytes by a non-raw Python string. The live
   scan is *expected* to match nothing, so no assertion could ever have revealed it.
   A per-arm canary added minutes earlier caught all three immediately.

**The generalisation:** when the live scan is expected to find nothing, one shared
fixture leaves N-1 arms unproven. Give every advertised defect shape its own positive
fixture, and keep a negative fixture for the false positive you are scoped to avoid.

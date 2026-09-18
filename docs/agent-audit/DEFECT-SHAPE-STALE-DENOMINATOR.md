# Defect shape: the stale denominator

**A rate with no clock, and a rate whose clock you just moved, both read as current.**

Every number in this system that looks like evidence is a fraction. The numerator
is usually the thing you went looking for — failures, skips, truncations — and it
is usually correct. The denominator is the part nobody states out loud: *over what
window, out of what population, counted by which rule*. When that goes unstated it
does not become neutral. It becomes whatever it was the day the counter was
created, and it keeps reporting confidently.

This is the sibling of [the silent instrument](DEFECT-SHAPE-SILENT-INSTRUMENT.md).
That one is a probe whose *output* cannot distinguish "found nothing" from "never
ran." This one is a probe whose output is real, specific, and arithmetically
correct — and still answers a different question than the one asked.

## Why it gets its own page

**It was fixed and then rebuilt from scratch, in the same session, hours apart.**

On 2026-09-18 the age-beside-the-ratio cure was written into
`apps/statenour/scripts/tool-reachability-census.ts:141`, with a comment
explaining the trap in full. A new instrument,
`apps/statenour/scripts/tool-input-failure-census.ts`, was then written the same
evening by the same author and shipped with the identical defect — and its first
run produced a ranking that was wrong in exactly the documented way.

A commit message did not transfer. A comment in one file did not transfer. The
only cure that has held is **making the instrument print its own basis**, so the
caveat travels with the output instead of living in a file nobody opens while
they are reading a table.

## Four cases in one session — 2026-09-18

**1. A lifetime counter has no window.**
`tool_telemetry.failCount / totalCalls` listed `createMissionPlan` at 75 %
failing. Its three failures decode to June; its schema was fixed months ago; it
has not been called since. A tool that failed three times in June reads as 75 %
failing *forever*, because nothing ages the counter out.
→ **Print the age beside the ratio and label anything stale, rather than listing
it as a finding.**

**2. Ranking on the full sample crowned a bug that was two months dead.**
Classifying `tool_telemetry.lastErrors` gave argument-failures 24 and
name-failures 9, and the top argument examples were `createTask` sending
`{"effort":"30 min"}` — which `apps/statenour/lib/ai/tools/tasks.ts:160-162`
records as diagnosed and fixed on 2026-09-03. `lastErrors` never ages out, so 21
of the 33 retained strings were 32–129 days cold.
→ **Split every class by recency before ranking it, and let the verdict count
only the live half.**

**3. The coarse clock quietly substituted for the fine one.**
The fix for case 2 dated each error by its *tool's* `lastCallAt` — and shipped a
caveat stating "the rows carry no per-error time." They do:
`lastErrors` is `{ message, at }[]` and every stored entry populates `at`. The
field had been parsed without its type being read. Dating per error moved the
answer from *argument 11 / name 1* to *argument 11 / name 0*; the one "live"
name failure was a tool called 7 days ago carrying an error 37 days old.
→ **Two clocks on one row is a trap. Say which one you used, in the output.**
→ And note the second failure here: **a caveat asserting a limitation is a
factual claim.** It named a real class of error and hedged in the right
direction, which is precisely why nobody re-checked it. A wrong hedge is worse
than no hedge.

**4. A fix moved the denominator of the metric used to judge it.**
Two-stage tool selection made the pruner gather candidates from every tier
instead of skipping the semantic tier once the budget was full. Those skipped
candidates had never been recorded as budgeted-out, so they were invisible to
`candidateCount` and `budgetTruncated`. After the change, identical traffic
reports **more** candidates and **more** truncation — against a 72.9 % baseline
that the census prints for comparison.
→ **A fix that widens what an instrument can see will look like a regression in
that instrument.** Before quoting a delta, ask whether the change also altered
what counts as a member.

## A fifth, one day earlier

**A cap is a window too.** `lastErrors` is capped at five entries per tool, so
the retained strings are a *sample* while `failCount` is the *population*. Adding
the sampled counts and calling the result a total is the same error wearing a
different hat — and the two numbers disagreed by six on the first run.

## The rule

State the denominator in the output, not in a comment:

- **Age beside every ratio.** A cumulative counter is history until proven
  otherwise; label the stale rows rather than ranking them.
- **Name the clock.** When a row carries more than one timestamp, print which one
  dated the result, and mark any entry that fell back to the coarser one.
- **Separate sample from population.** If the store caps what it retains, say so
  on the same line as the count.
- **Mark a metric NOT COMPARABLE the moment its definition moves**, on the row
  itself. A footnote loses to a table every time.
- **Withhold rather than rank on thin data.** Both censuses written this session
  refuse to compare below a stated floor, and say so in place of a verdict.

The test of whether a number is safe to act on is not whether it is correct. It
is whether the reader can tell, from the number alone, what it is a fraction of.

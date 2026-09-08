# Defect shape · THE DISCARDED ANSWER

> Found 2026-08-29 in the statenour chat recall path (PR #2019). Three root
> causes that looked unrelated turned out to be one shape wearing three
> costumes. Sibling shapes:
> [orphaned subject](DEFECT-SHAPE-ORPHANED-SUBJECT.md) ·
> [silent instrument](DEFECT-SHAPE-SILENT-INSTRUMENT.md).

## The shape

**The system computed or possessed the right answer, then threw it away — and
emitted a confident wrong output instead of an error.**

Both halves matter. Discarding the answer is the mechanism; *never erroring*
is why it survives. Nothing crashes, no log line fires, no test goes red. The
output is well-formed, plausible, and wrong. It reads exactly like a correct
answer to a question nobody asked.

## The three instances, so the pattern is recognisable

| Where | What it had | What it did instead |
|---|---|---|
| `searchReflections` | Postgres FTS, a tsvector index, 210 reflections + 1,181 brain dumps | Ran `contains` on the WHOLE query string. `business` -> 71 hits, `mind your business` -> **0**. Advertised as FTS in `tool-families.ts`. |
| `searchMemories` | `ts_rank` relevance, computed and returned | Kept only the row ids and re-sorted by `confidence`. All 7,059 `archive_*` chunks sit at 1.0; the operator's pinned memory at 0.4. 96% of rows outranked it. Its EXACT KEY returned ten archive chunks and not the row. |
| the system prompt | `searchMemories`, `searchColdMemory`, `searchReflections`, `searchConversations` — all wired, all callable | No rule for narrating an empty result, so the model generalised one miss into *"I don't have reliable information about whether that memory exists"* — denying memory access inside a memory app. |

A fourth, found while fixing the first three: `count` returned the **page
size**, not the match total. A 112-match query displayed `16`. Smaller lie,
same species — the number is wrong and nothing says it is wrong.

## Why it evades every gate we have

- **Not a crash.** Exception monitoring sees nothing.
- **Not a null.** Null-checks and fallback branches never fire.
- **Not a red test.** The old behaviour was *correct for the tests written
  against it* — single-word queries worked, so the suite was green.
- **Not visible in a diff.** Each line is individually reasonable.
  `orderBy: { confidence: "desc" }` is a normal thing to write.
- **The success surface amplifies it.** The chat chip counted
  `state === "output-available"` and rendered it as **"3 verified"** directly
  above five `0 matches` cards. A discarded answer plus a success badge reads
  as a confident, sourced, wrong reply.

## How to hunt it

Ask these of any retrieval, ranking, or reporting path:

1. **What did this compute that it does not return?** A rank, a score, a
   total, a confidence — if it is calculated and then dropped, ask why.
2. **Does the sort key answer the question the caller asked?** Ranking by
   `confidence` answers "how sure are we", not "how relevant is it". Ranking
   by `createdAt` answers "how new", not "how good".
3. **Does the label match the mechanism?** `searchReflections` was documented
   as FTS and implemented as `LIKE`. Grep the description against the body.
4. **Is the number a page or a population?** If a limit is applied, the count
   beside it is almost always the wrong one.
5. **What does the caller do with an empty result?** If a human or a model
   reads it, an empty result needs a *sentence*, not just a zero — otherwise
   "found nothing" becomes "cannot look".

## How to prove you fixed it

A zero is not evidence and a green is not evidence
([silent instrument](DEFECT-SHAPE-SILENT-INSTRUMENT.md)). For this shape
specifically:

- **Plant a known positive and retrieve it through the SHIPPED function**, not
  a reimplementation of it. PR #2019's first positive control reproduced the
  FTS query inside the script and proved nothing about the tool; it was
  rebuilt to call `brainTools.searchReflections.execute` against a disposable
  Neon branch ([runbook](../../apps/statenour/docs/runbooks/neon-branching.md)).
- **Pair it with a negative control.** If a nonsense query also returns hits,
  the positive was meaningless.
- **Mutate the fix and watch the test fail.** One test in #2019 still passed
  under mutation: it asserted `indexOf(pinned) < indexOf(archive)`, and
  `indexOf` returns `-1` when the row is absent — so it scored green hardest
  in the exact failure it existed to catch. Assert **presence first**, then
  ordering.

## The one-line version

**When a system has the right answer available and returns something else
without erroring, the bug is not in what it returned — it is in what it threw
away. Look for the discarded value.**

## Sibling shape · the failed read that renders as a confident zero

Where this shape *computes* the right answer and throws it away, its sibling never
gets an answer at all and renders the absence as a measured value. Same visible
result: a confident wrong output, no error anywhere.

**`.claude/skills/empty-vs-error/SKILL.md`** (2026-09-08, PR #2203) carries it: a read
has THREE outcomes — `ERROR`, `UNMEASURED`, and a measured zero — and collapsing the
first two into the third was the highest-frequency defect shape in the repo (10
instances on one page in PR #2090, and it survived its own fix twice).

Reference implementations already in the tree:
`components/brain/judgment-quality-panel.tsx:34` ("state unknown, not empty"),
`components/brain/contradiction-resolution-panel.tsx:300` (literal `provenance`
values `"ERROR"` / `"UNMEASURED"` / `"ZERO"`), and
`lib/observability/fleet-truth.ts:13,190` ("a failed probe is UNKNOWN, never
healthy"; `ok` requires every capability fresh).

Detection does not generalise to a repo-wide gate: `.catch(() => null)` is 130 files,
`=> []` and `=> 0` together are 147. Those are house idioms. Scope to the diff, and
note that `=> null` is usually the *honest* form — null is a legitimate "unknown".

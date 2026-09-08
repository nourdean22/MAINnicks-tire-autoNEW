---
name: assert-the-consumer
description: Use whenever a change adds a WRITER — a response header, an env var, a DB column, a queue row, a tool registration, a config flag, a response field, a metric. Before calling it done, prove something READS it. Registration is not reachability, and a green test on the writer is the exact evidence that will fool you.
---

# Assert the Consumer

A writer with no reader ships green. Every test asserts the write, the
write is correct, and the feature does nothing.

## The base rate

**Four dead controls in one wave** (#1983 · #1991), all the same shape,
all passing full green suites:

1. `modelOverride` wired into a variable feeding **flag-gated dead code**
   while the serving path had no such field.
2. A daily cap comparing **bare model ids** against a column stored as
   `provider/model` — matched nothing, ever.
3. `X-Escalation-*` headers set and documented as "legible" with **zero
   client readers**. The grep for a consumer returned only the author's
   own comment about dead controls.
4. `scheduleSelfFollowUp` registered in `nourTools` + the catalog +
   `TOOL_FAMILIES`, and measured **unreachable for 4 of 5** realistic
   phrasings.

Two of the four reached `main` and were caught by review, not by the
author. **One was the headline feature of its PR and did nothing.**

## The rule

> **Registration is not reachability. A header set is not a header read.
> A column written is not a column queried.**

Before "done", for every writer the change introduces:

1. **`git grep` for the consumer and paste the hit into the PR body.**
   Not "there should be one" — the file and line.
2. **If there is no consumer, either build it in the same change or do
   not ship the writer.** A control nobody reads is worse than absent: it
   reads as covered.
3. **The canary asserts the CONSUMER end, never the producer.** A test
   that the header was set proves the bug, not the fix.

## Grep your own comment out

Hit (3) above passed a consumer grep because the only match **was the
author's own comment about the problem**. Source-text searches match
prose. Filter comments before believing a hit:

```bash
git grep -n "X-Escalation" -- . | grep -vE '^[^:]+:[0-9]+: *(//|/\*|\*|\{/\*|#)'
```

The alternation must cover **block and JSX comments too** — `/* ... */` and
`{/* ... */}`. A filter that knows only `//`, `*` and `#` keeps exactly the
comment-only hits it exists to drop; positive-control it on all five forms
before trusting a "no consumer" verdict.

The repo has precedent for this rule in code:
`apps/nickstire/client/src/__tests__/canonical-business-truth.test.ts`
states it outright — **"MENTION IS NOT ASSERTION"** — after its first
version flagged its own fix comments.

## Registration ≠ reachability (the chat-tool case)

Three registries agreeing proves the tool EXISTS. It never proves the
selector will surface it. `TOOL_CATALOG` holds 181 tools and only
`NICK_TOOL_BUDGET` (default **24**) reach a turn, selected by
hand-written regex families plus embedding rank — so the trigger regex
and the attach regex are different patterns and a tool can match one
without the other.

**After adding a chat tool, run the pruner against 5 phrasings you would
really type and assert the tool appears.** Measured, not reasoned.
Precedent: `this (week|month)\b` matches "this week" and **not "this
weekend"**.

## Failure modes of the check itself

- **A consumer behind a flag that is off** is not a consumer. Say which
  flag and what its production value is.
- **A UI branch that can never fire** is the inverse defect — after
  deleting or renaming a field, grep for branches that are now dead.
  Witnessed: a `truncated` field hardcoded `false` behind a live UI
  branch, shipped as a working alarm.
- **A consumer in a test only** means the feature is a test fixture.

Related: `empty-vs-error` (the read side of the same class) ·
`positive-control-first` (prove the canary can fail) · `statenour-verify`.

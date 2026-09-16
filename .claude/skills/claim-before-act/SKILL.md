---
name: claim-before-act
description: Use whenever a read-then-write decides WHICH CALLER ACTS — an idempotency claim, a lease, a dedupe marker, a reclaim of an expired or failed row, an approval slot. The write must be a compare-and-swap on the exact row you read (or a serializable transaction); an unconditional update by id lets two racers both win. Triggers on lib/ai/tools/tool-idempotency.ts, lib/services/action-attempts.ts, and any create -> P2002 -> update sequence.
---

# Claim before act

## The defect this encodes

2026-09-15, PR #2338 (the durable ActionAttempt contract, built to end
double-sends): the reclaim of an expired or FAILED attempt was

```
findUnique(where: { operationKey })      // both callers read the same reclaimable row
update(where: { id }, data: { state: "EXECUTING", attemptNo: n + 1 })   // both updates succeed
```

Two identical calls arriving after the same expiry both received
`kind: "claimed"` and both would have sent the Telegram. Caught only by
review (Codex P1). The fix was one WHERE clause and one branch:

```
const r = await prisma.actionAttempt.updateMany({
  where: { id: existing.id, attemptNo: existing.attemptNo, state: existing.state },
  data:  { ...fresh, attemptNo: existing.attemptNo + 1 },
});
if (r.count === 1) return { kind: "claimed", ... };
const winner = await prisma.actionAttempt.findUnique({ where: { id: existing.id } });
return { kind: "duplicate", state: winner.state, ... };   // the loser never acts
```

## The rule

**A read-then-write that decides who acts is a compare-and-swap, never an
update by id.**

1. Pin the write to every field you DECIDED on — the version-ish fields
   the other branch would have changed (`attemptNo`, `state`, `expiresAt`,
   `updatedAt`). A settle changes `state`; a reclaim bumps `attemptNo`; so
   exactly one swap can match.
2. `count === 1` wins. `count === 0` re-reads the winner's row and reports
   it (a duplicate with the REAL state) — no retry loop, no second swap.
3. If the store cannot express the swap, use a serializable transaction
   with `SELECT ... FOR UPDATE` — not a hope that two calls are far apart.
4. The unique-key path is the same shape: `create` -> `P2002` -> read the
   existing row -> decide -> swap. The `P2002` catch alone only serializes
   the FIRST claim, not the reclaim.

## The canary (positive-control-first applies)

Spawn two callers on the same stale read: mock the read to return the same
reclaimable row to both, make the first swap return `{ count: 1 }` and the
second `{ count: 0 }`, and assert exactly one `claimed` and one `duplicate`
that carries the winner's state. Then plant the defect (swap -> update by
id, or `count >= 0`) and watch the canary go red; #2338's did.

## When NOT to use

Writes where every caller is allowed to act (append-only logs, counters,
telemetry). The rule is about EXCLUSIVITY, not about every update.

Related: `assert-the-consumer` (a state field is set only by the code
that saw the write succeed) · `positive-control-first`.

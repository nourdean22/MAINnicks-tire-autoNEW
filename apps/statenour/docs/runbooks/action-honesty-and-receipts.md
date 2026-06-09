# Runbook · Action honesty — no false "done" claims

- **Status:** active · **Domain:** ai-reliability · **Risk:** medium · **Last verified:** 2026-06-09
- **When to use:** touching chat finalization, tool results, or anything where Nick reports an action.
- **Source of truth:** [`../../lib/ai/system-prompt.ts`](../../lib/ai/system-prompt.ts) (TRUTH RULE), [`../../lib/ai/chat/action-claim-detector.ts`](../../lib/ai/chat/action-claim-detector.ts), [`../../lib/ai/receipts/action-receipt.ts`](../../lib/ai/receipts/action-receipt.ts).

## The contract

Nick must **not** say he created / sent / completed / moved / archived /
remembered / updated something unless a tool call actually did it and returned
success. A failed or missing tool result must surface as a **visible failure**,
never be summarized as "done".

## The fabrication-defense stack (L1–L5 — load-bearing, extend don't bypass)

| Layer | Where | What |
|---|---|---|
| L1 prompt rule | `lib/ai/system-prompt.ts` | model told never to claim past-tense action without a tool call |
| L2 pre-persist rewrite | `lib/ai/chat/fabrication-rewriter.ts` | fabrication gets a verifier banner before persist |
| L3 history neutralize | `lib/ai/chat/sanitize-history.ts` | verifier-marked turns can't compound |
| L4 truth grounding | `lib/ai/chat/truth-grounding.ts` | real counts pre-injected as system facts |
| L5 operator chip | `components/chat/action-claim-warning.tsx` | red inline chip shows the diagnostic |

## Action receipts (P7)

`lib/ai/receipts/action-receipt.ts` normalizes a tool result into a typed
`ActionReceipt` (status success/failed/skipped/needs_approval/partial). The
`canClaimDone(receipts)` guard returns false if any side-effecting action lacks
a success receipt — a summary can be checked against it before claiming done.
v1 is additive (not yet wired into the live finalize seam).

## Rules

1. No past-tense action claim without a successful tool call.
2. A failed/missing receipt for a side-effecting tool means **not done** — surface the failure.
3. The detector is regex-based — add new action verbs as they appear and re-run its test.

## Commands

```
pnpm test -- tests/ai/chat tests/lib/ai/receipts
```

## Verification

- action-claim-detector + receipts unit suites green.

## Rollback

- Revert; receipts are additive and not yet wired into the live finalize path.

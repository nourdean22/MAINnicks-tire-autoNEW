# Runbook — warm-transfer fallback (answer-proof + no-answer recovery)

**Status: PREPARED, NOT APPLIED.** Applying changes live-call behavior on the shop's
inbound line and is an operator action. Prepared 2026-08-05.

## The problem, measured

- 41.5% of calls (1,017 in 90d) are transferred to a human. **28% of forwards are
  redialed by the same customer within 15 minutes** (280/1,016; admin tile
  "Forward Redials ≤15m", PR #1375) — the observable signature of "nobody answered."
- The live plan (verified via VAPI API 2026-08-05, assistant `150fe622…`, the one
  actually taking calls) is `warm-transfer-say-message` + `sipVerb: dial`,
  destination dashboard-managed (currently a cell, not the shop landline):
  VAPI parks the caller, dials the destination, announces, bridges.
- **That mode has no failure path.** On no-answer the caller sits on hold up to
  `dialTimeout` (default 60s) and is then dropped. Invisibly: the call record was
  already stamped `assistant-forwarded-call` at hand-off — which is why
  `failedTransfers` measured **0 of 1,020** forwards in 90 days.
- (Correction for the record: PR #1375's text said "blind transfer." The live mode
  is warm; the *measurement* conclusions there all stand — the record still ends at
  hand-off and carries no dial outcome.)

## The change

`transferPlan` on the receptionist's `transferCall` number-destination:

```diff
  {
-   "mode": "warm-transfer-say-message",
+   "mode": "warm-transfer-experimental",
    "message": "You've got a customer holding on the Nick's Tire and Auto line. Connecting you now.",
    "sipVerb": "dial",
+   "dialTimeout": 25,
+   "fallbackPlan": {
+     "message": "Sorry about that — nobody could grab the line at the counter just now. Give me your name and best number and I'll make sure the shop calls you right back.",
+     "endCallEnabled": false
+   }
  }
```

What each piece buys:
- **`fallbackPlan` + `endCallEnabled: false`** — on no-answer the assistant RETURNS
  to the caller and runs the prompt's existing CALLBACK CAPTURE flow (name + phone
  → escalate). Today those callers get silence then a drop.
- **`dialTimeout: 25`** (~5 rings, down from 60s) — a caller is never parked a full
  minute before recovery kicks in.
- Destination number, pre-transfer message, and announce line are **unchanged**.
- `warm-transfer-experimental` is VAPI's name for the mode with answer-detection +
  fallback. The "experimental" label is exactly why this runbook has a canary step
  and a one-command rollback.

Interaction checks already verified in code:
- `setTransferDestination` (admin number changes) spreads the existing plan, so a
  later number change **preserves** this plan.
- `preserveLiveTransferDestinations` keeps the live plan across "Push Latest
  Config" re-pushes, so a config re-push does **not** revert it.
- The forwarded-call SMS follow-up triggers on `/forward/i` reasons; a fallback
  conversation that ends normally will simply not fire it (correct — the AI
  already handled recovery live).

## Apply procedure (operator)

From `apps/nickstire`:

```bash
pnpm exec tsx scripts/vapi-warm-transfer-fallback.ts
```

1. **Dry run** (above): resolves the live assistant from the newest real call (not
   by name — the org has a stale second "Receptionist"), prints CURRENT vs TARGET.
   Patches nothing.
2. **Apply**: re-run with `--apply`. The script snapshots the full `model.tools`
   to `vapi-snapshots/<assistantId>-<timestamp>.json`, verifies the snapshot
   re-reads, PATCHes, then prints the read-back plan and the exact rollback command.
3. **Canary (do immediately, ~5 min):**
   - Call the shop line, ask for a human, have someone ANSWER the destination →
     expect: announce plays, bridge works, conversation normal.
   - Call again, let the destination RING OUT → expect: within ~25s the assistant
     returns with the fallback line and asks for name + number; confirm a callback
     row/Telegram alert lands.
   - Any wrong behavior → rollback (below), then investigate.
4. **Watch the yardstick for a week**: admin → Voice → "Forward Redials ≤15m
   (14d)". Baseline captured 2026-08-05: **22% (48/214)**. Success = a clear drop;
   also expect `callback_requests` to start moving (baseline: 23 rows/90d).

## Rollback

One command, restores the exact pre-change tools verbatim:

```bash
pnpm exec tsx scripts/vapi-warm-transfer-fallback.ts --assistant <id> --rollback "vapi-snapshots/<file>.json"
```

Belt-and-suspenders alternatives: the VAPI dashboard edits the same tool directly;
`setTransferDestination` from admin re-asserts mode `warm-transfer-say-message`
only if the plan is absent (it preserves an existing one).

## Known risks

- "Experimental" mode label — behavior differences beyond docs are possible; the
  canary + rollback bound the blast radius to minutes.
- If the fallback triggers while the shop IS answering other lines, callers get a
  callback offer instead of a longer hold — judged better than a 60s park + drop.
- `dialTimeout: 25` may be too short if the counter routinely needs 6+ rings;
  bump to 35 via the script constant and re-apply.

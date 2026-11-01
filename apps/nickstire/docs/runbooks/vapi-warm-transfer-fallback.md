# Runbook — warm-transfer fallback (answer-proof + no-answer recovery)

## 2026-10-31 — why the fallback never fired, and the fix (read this first)

Nour, 2026-10-31: "Yes, add it" (unanswered transfers come back to the bot for a callback;
earlier: no hold music). Vapi's page on assistant-based warm transfer
(https://docs.vapi.ai/calls/assistant-based-warm-transfer, read 2026-10-31) says the no-answer
rollback needs a transfer assistant: "With `transferAssistant` configured, a busy or unanswered
destination rolls back to the configured fallback." The live plan (manager dry run, 2026-10-31
12:33Z) had the mode, `dialTimeout: 25` and `fallbackPlan`, but **no `transferAssistant` and no
`holdAudioUrl`**. And "Push Latest Config" kept the live plan whole, so no code change could
reach it.

What the code now owns (`CODE_OWNED_TRANSFER_FIELDS`, `server/services/vapi.ts`), laid over a
live `warm-transfer-experimental` plan on every Push Latest Config:

```diff
  {
    "mode": "warm-transfer-experimental",        (live, kept)
    "message": "...",                             (live, kept)
    "sipVerb": "dial",                            (live, kept)
    "dialTimeout": 25,                            (live, kept)
+   "transferAssistant": {
+     "firstMessage": "Caller on the line for Nick's. Say yes to take it.",
+     "firstMessageMode": "assistant-speaks-first",
+     "maxDurationSeconds": 45, "silenceTimeoutSeconds": 10,
+     "model": { "provider": "openai", "model": "gpt-4o", "messages": [ <connect / cancel rules> ] }
+   },
+   "holdAudioUrl": "https://nickstire.org/api/webhooks/vapi/ringback.wav",
~   "fallbackPlan": {
+     "message": "Sorry, nobody could grab the phone up front. Want the shop to call you back?",
      "endCallEnabled": false
    }
  }
```

- **What the counter hears when they answer:** "Caller on the line for Nick's. Say yes to take
  it." Any answer that is not a no (yes, ok, go ahead, hello) connects the caller. Vapi has no
  way to connect before a person answers: its docs tie `transferSuccessful` to a live operator
  accepting. (Manager ruling R2; Nour can overrule it.)
- **What the caller hears while it rings:** a US ringback tone (440 + 480 Hz, 2 s on, 4 s off),
  served by the app, never music.
- **No answer, busy, voicemail, or the counter says no:** the caller hears the one fallback
  line and is back with the receptionist, which runs CALLBACK CAPTURE: takes what it is about
  and a best time, calls `escalate` (one `callback_requests` row per call, one crew alert), and
  says they are on the callback list. A caller who says no gets nothing recorded.
- **Witness:** these transfers send no `transfer-update` (Vapi docs); the webhook now records
  `status-update` `forwarding` as `transfer_attempted`.
- **Rollback still works:** a live plan in any other mode (for example after
  `--rollback-legacy`) is kept whole by Push Latest Config.

**Nour's one tap (W5c), after the PR merges and deploys:** first open
https://nickstire.org/api/webhooks/vapi/ringback.wav (it must play a ring), then Admin → Voice
→ **Push Latest Config**.

**Live check after the tap:** call the shop line, ask for a person, let the counter ring out.
Expect: ringback, then the fallback line within about 25 s, the callback questions, ONE
`callback_requests` row for that call id, ONE crew Telegram line, no second call to the shop or
the caller. Then call again and have the counter answer: the one sentence, a yes, connected.
Still open (not confirmed): whether `dialTimeout` is honoured in experimental mode, which
voice the transfer assistant uses, and whether Vapi loops a hold file shorter than the wait
(the file is 60 s).

**Status: APPLIED IN VAPI — observed 2026-09-22, fallback not yet seen firing.** Prepared
2026-08-05. A dry run of `scripts/vapi-warm-transfer-fallback.ts` on 2026-09-22 read the live
receptionist (`150fe622-0b9f-4b03-b8c7-3063812717ae`, last updated 2026-09-21T13:57:43Z) and
its CURRENT transfer plan already equals the TARGET below: `warm-transfer-experimental`,
`dialTimeout: 25`, `fallbackPlan` present with `endCallEnabled: false`. This line said
"PREPARED, NOT APPLIED" for a day after the provider state changed — the script's dry run,
not this file, is the source of truth for what Vapi holds. What has NOT been observed is
the fallback actually returning to a caller: until a real call rings out at the counter and
the assistant captures a callback, this is DEPLOYED_NOT_OBSERVED, and the canary steps
below remain the way to prove it. **Sections marked HISTORICAL below describe the state
measured on 2026-08-05, before the change; they are kept because they are the reason for the
change, not because they are current.**

## The problem, measured (HISTORICAL — 2026-08-05, before the change)

- 41.5% of calls (1,017 in 90d) are transferred to a human. **28% of forwards are
  redialed by the same customer within 15 minutes** (280/1,016; admin tile
  "Forward Redials ≤15m", PR #1375) — the observable signature of "nobody answered."
- The plan as measured 2026-08-05 (assistant `150fe622…`, the one actually taking calls)
  WAS `warm-transfer-say-message` + `sipVerb: dial` — superseded by 2026-09-21, see Status;
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
  → escalate). Before this change those callers got silence then a drop.
  **Correction 2026-09-23 (#2559):** until #2559 that was not what the prompt did —
  CALLBACK CAPTURE ended in `sendConfirmationSms` only, and `escalate` was forbidden
  while OPEN, so the callback this fallback promises ("I'll make sure the shop calls
  you right back") left no `callback_requests` row and no promise. #2559 routes
  CALLBACK CAPTURE through `escalate`; it reaches the live assistant on the next
  "Push Latest Config".
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
  Config" re-pushes, so a config re-push does **not** revert it. (2026-10-31: on an
  experimental plan it now also lays the code-owned `transferAssistant`, `holdAudioUrl`
  and `fallbackPlan` over it; see the top of this file.)
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

**The truth about the artifact (review on #2490, 2026-09-22).** The experimental plan reached
production without this script's `--apply`, so no snapshot of the pre-change tools was ever
taken; `apps/nickstire/vapi-snapshots/` is gitignored and was empty. Two rollbacks exist now,
neither needs a file that does not exist:

1. **Back to the documented pre-change plan** — the reversed diff (mode
   `warm-transfer-say-message`, same message and `sipVerb`, no `dialTimeout`, no
   `fallbackPlan`). Dry run first, then apply; the script snapshots the current tools before
   the write, so this rollback is itself reversible:

   ```
   pnpm exec tsx scripts/vapi-warm-transfer-fallback.ts --rollback-legacy
   pnpm exec tsx scripts/vapi-warm-transfer-fallback.ts --rollback-legacy --apply
   ```

2. **Back to any snapshot** — `--rollback <file>` restores `model.tools` verbatim. A snapshot
   of the LIVE (experimental) tools was written with `--snapshot-only` on 2026-09-22:
   `apps/nickstire/vapi-snapshots/150fe622-0b9f-4b03-b8c7-3063812717ae-2026-09-22T22-35-43-461Z.json` — on the operator's Windows machine that ran it, gitignored, never in the
   repo (it carries the full tool configuration). Take a fresh one before any further change:

   ```
   pnpm exec tsx scripts/vapi-warm-transfer-fallback.ts --snapshot-only
   pnpm exec tsx scripts/vapi-warm-transfer-fallback.ts --assistant <id> --rollback "vapi-snapshots/<file>.json"
   ```

The canary steps above are safe to run knowing this: a wrong behavior is minutes from the
legacy plan by command 1, and the current state is minutes from restoration by command 2.
## Known risks

- "Experimental" mode label — behavior differences beyond docs are possible; the
  canary + rollback bound the blast radius to minutes.
- If the fallback triggers while the shop IS answering other lines, callers get a
  callback offer instead of a longer hold — judged better than a 60s park + drop.
- `dialTimeout: 25` may be too short if the counter routinely needs 6+ rings;
  bump to 35 via the script constant and re-apply.

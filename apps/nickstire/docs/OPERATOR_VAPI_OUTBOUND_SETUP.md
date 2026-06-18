# Operator VAPI Outbound Setup Runbook

**Date prepared:** 2026-06-18 · VAPI Outbound Overhaul
**Audience:** operator (Nour)
**Estimated total time:** 5-10 minutes
**Outcome:** Outbound follow-up cadence, next-day confirmations, and voice recovery quotes are fully configured via VAPI with voicemail detection, quiet hours, and proper brand voice.

---

## TL;DR · What's Installed

Three outbound calling flows run on the daily cron scheduler:

| Use case | Cron | What it does | Quiet-Hours Window |
|---|---|---|---|
| **Follow-up Cadence** | `followup-cadence` | Reaches out to customers 7, 30, and 60 days post-visit for feedback and referrals. | 9:00 AM – 6:00 PM ET |
| **Confirmation Bot** | `confirmation-calls` | Calls customers with next-day bookings using walk-in FCFS language to confirm they are coming. | 3:00 PM – 6:00 PM ET |
| **Voice Recovery** | `voice-recovery` | Reaches out to declined estimates from 5-6 weeks ago with zero pressure. | 10:00 AM – 5:00 PM ET |

All three flows default to **OFF** and short-circuit when their respective feature flags or VAPI API keys are missing.

---

## Brand-Voice & Safety Features

- **Mandatory Two-Step Opener (Follow-up):** The bot asks for the customer's name (`"{{name}}?"`), waits for a confirmation beat, then delivers the operator's exact friendly greeting (`"Hope you're doing good, this is Nick..."`).
- **Answering Machine Detection (AMD):** Twilio AMD is fully enabled. When a machine is detected, the bot plays a specific pre-written voicemail message and hangs up immediately (preventing LLM machine improvisation and cost wastage).
- **At-Most-Once dial protection:** `voice_followups` and `voiceRecoveryAttemptedAt` stamp the database *before* dial to guarantee no customer gets double-called.
- **Kill-list Enforcement:** Interactive prompts strictly prohibit saying: "appointment" (except in user inquiry context), "appreciate your business", "value your loyalty", pricing details, or "Is there anything else I can help you with?".

---

## Step 1 · VAPI Dashboard Setup

Ensure you have your VAPI credentials and the correct Assistant ID:
1. Copy your VAPI Private API Key (`5d98897b-1a5f-437c-8633-5b6ee0305b26`).
2. Make sure the follow-up assistant is created or updated in VAPI. The registered ID is:
   - `VAPI_FOLLOWUP_ASSISTANT_ID`: `0daaf7dc-1394-4731-908f-5c91788c2d3d`
3. Ensure the outbound phone number is registered in VAPI (defaults to +12164249249).

---

## Step 2 · Webhook Binding

Your single VAPI webhook endpoint processes all ended calls and maps results (transcripts, status, reschedule requests) back to `confirmation_calls` and `alg_estimates`:
- **Webhook Target:** `https://nickstire.org/api/webhooks/vapi`
- Make sure the VAPI dashboard is configured to forward call events (especially `call.ended`) to this webhook.

---

## Step 3 · Railway Environment Variables

Ensure these variables are set in your Railway production environment (`MAINnicks-tire-auto` service):

```ini
# Core Keys & Assistants
VAPI_API_KEY=5d98897b-1a5f-437c-8633-5b6ee0305b26
VAPI_FOLLOWUP_ASSISTANT_ID=0daaf7dc-1394-4731-908f-5c91788c2d3d

# Active Feature Flags (1 to enable, 0 or omit to disable)
FEATURE_FOLLOWUP_CADENCE=1
FEATURE_CONFIRMATION_CALLS=1
FEATURE_VOICE_RECOVERY=1

# Dry-run control (Set to 0 to make real phone calls, 1 to only log lists)
FOLLOWUP_CADENCE_DRY_RUN=0
```

---

## Step 4 · Testing and Rollback

### Manual Testing
You can force run the confirmation cron or recovery cron via the bridge API to test calls to a specific number:
```bash
curl -X POST https://nickstire.org/api/bridge/run-job \
  -H "Authorization: Bearer $BRIDGE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job":"confirmation-calls"}'
```

### Rollback
If you need to instantly turn off the bots, change the flags in the Railway dashboard:
- Set `FEATURE_FOLLOWUP_CADENCE=0`
- Set `FEATURE_CONFIRMATION_CALLS=0`
- Set `FEATURE_VOICE_RECOVERY=0`

The cron scheduler checks these flags dynamically on every tick and will skip dialing.

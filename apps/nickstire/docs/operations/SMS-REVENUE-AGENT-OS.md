# SMS Revenue Agent OS — operator runbook

**Status:** live in prod (built + merged 2026-07-29, PRs #1190 #1192 #1194 #1196 #1197 #1198 #1199 #1201) · **Migrations 0104 + 0105 applied.**
This is the ONE page for how the SMS side of the shop runs itself, what the levers are, and what to do when something looks wrong. Architecture detail lives in [`CURRENT-TRUTH.md`](../CURRENT-TRUTH.md); build history + epistemic ledger in [`REVENUE-AUTOMATION-STATE.md`](../REVENUE-AUTOMATION-STATE.md) and [`plans/REVENUE-AUTOPILOT-2-AUDIT.md`](../plans/REVENUE-AUTOPILOT-2-AUDIT.md).

---

## 1 · What the system does, in one paragraph

Every revenue signal — inbound texts, missed calls, callbacks, website leads, abandoned forms, booking no-shows, unresolved estimates, inspection deferrals, overdue promises, complaints — becomes either an **automatic safe reply**, a **ranked Decision-Inbox row for a human**, or a **suppressed record with a reason**. Nothing personalized sends without either a proven-safe deterministic path or an explicit human approval (admin two-tap, or Telegram Approve tap from chat). Wins count ONLY with a matched invoice. Everything is receipted.

## 2 · The daily loop (what Nour actually touches)

1. **Morning Telegram brief** leads with EXCEPTIONS (customers waiting on a human, blocked sends, held queue, delivery failures) then TOP DECISIONS. Everything else is handled.
2. **`/admin → Today → Decision Inbox`** — top-5 ranked rows. Per row: Call (tel: tap) · Spoke · No answer · Snooze (2h/1d/2d/1wk) · Lost · DNC · **Won (invoice # required; "manual" checkbox for a mismatched-phone invoice — recorded as manual, never verified)** · stated-concern chips on estimates · **Draft text → edit → two-tap Send** on textable types.
3. **From the phone (statenour chat):** "show top decisions" → "draft a text for #2" → edit in chat → the send arrives as a **Telegram Approve/Decline card** — the tap is the send. Nothing sends without the tap.
4. Inbound texts answer themselves when safe (hours, canonical prices, logistics). Money/anger/safety/ambiguity → a draft waits in the human review queue; past 30 min it escalates to the top of the Decision Inbox.

## 3 · The levers (all in `/admin → Outreach → SMS Operating System`)

| Lever | What it does | Where |
|---|---|---|
| **PAUSE SMS** (big red button) | Shop-wide emergency stop. HOLD semantics: marketing + follow-ups queue durably (nothing dropped, drains on resume); confirmations + internal alerts keep flowing | SMS Ops strip |
| Rollout mode per automation | off / shadow / draft_only / live_send — capped by the autonomy ladder (an automation declared draft-only CANNOT be flipped live from the UI; raising the level is a PR) | Rollout controls |
| Replay a failed text | `smsOps.replayFailed` — atomic, idempotent, resets the retry counter | via API/admin |
| Release a takeover | Hands a thread back to the AI before the 60-min hold expires; your next manual reply re-arms it | `smsOps.releaseTakeover` |
| Per-automation flags | The 13 SMS feature flags (unchanged semantics) | Feature Flags panel |

**Hard rails that are NOT levers** (always on): opt-out fail-closed (3 sources) · per-phone 8/day · shop-wide 200/24h (`SMS_GLOBAL_DAILY_CAP`) · quiet hours 8AM–8PM ET (queue, not drop) · human-takeover suppression on every send path · identity gate (2+ customers on a phone, or conflicting names → personalized sends refuse; call instead) · won-requires-invoice.

## 4 · What auto-sends vs what waits for a human

- **Auto (Level 2/3):** safe inbound replies (deterministic intents, ≥0.85 confidence, claims-guarded), booking confirmations/reminders, the armed recovery/retention/cross-sell crons (all pre-existing, all flag-gated, volume/copy unchanged by this arc).
- **Human-approved only (Level 1):** every Decision-Inbox outreach (admin two-tap or Telegram tap), photo-assess replies, anything the router marks complaint/legal/safety/pricing-edge, anything with ambiguous identity.
- **Campaigns (Level 4):** only when explicitly armed per campaign. Never on by default.

## 5 · When something looks wrong

| Symptom | First move |
|---|---|
| "Are texts going out?" | SMS Ops strip: gateway ONLINE? queued count? oldest age? 24h volume vs cap |
| Queue stuck while gateway healthy | You'll get the 🚨 Telegram stuck-queue alert (>5 min due). Check the strip; `replayFailed` for dead-lettered rows (`failure_reason` says why) |
| Customer says they texted and got silence | Needs-Reply strip + Decision Inbox top (overdue human_pending rows surface there). Unknown ≠ zero: an UNKNOWN tile means the read failed, go look |
| AI texted over you mid-conversation | Should be impossible (chokepoint takeover) — if it ever happens, grab the message SID and the `sms_orchestrations` row; that's a P0 bug report |
| Want silence NOW | PAUSE SMS (two-tap). Nothing is lost — resume drains |
| A won job won't close in the inbox | Check the "manual" box next to Won (mismatched-phone invoice) |

## 6 · Runtime proof status (truth pass, 2026-07-29)

**Live-verified in prod:** the collector spine works — `human_pending_sms` produced 3 real Decision-Inbox rows from 3 genuinely-waiting customers; the other new collectors returned honest zeros against independently-verified-empty pools (~30ms/query). Pause flag OFF, queue clean, no levers fired yet. Full observation log: the CGD's *Runtime observations* section.

**Still open (first-real-occurrence only):** (1) pause hold→drain end-to-end with a real send, (2) mid-run queue pickup without restart — the stuck-queue alert is the tripwire if either misbehaves. Your first **Telegram Approve tap** is the live proof of the phone loop. Known scheduling gap: the refresh cron is under-scheduled (ROS-081) — until the cadence wave lands, the Decision Inbox's **Refresh** button is the reliable manual trigger.

## 7 · Standing truth rules this system obeys

No invented prices/warranties/wait-times/urgency (deterministic drafts + claims guard + brand-voice kernel) · no revenue claim without a matched invoice · no rate without a measured outcome · evidence class on every row (`verified > inferred > partial`) · failed reads render UNKNOWN, never "all clear" · a lead is `contacted` only after a confirmed dispatch.

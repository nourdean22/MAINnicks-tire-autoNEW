# Higgsfield session — why it dies, and the 3-step recovery

**Read this before "fixing" Higgsfield auth.** The autonomous refresh is already
built and working. What cannot be automated is one human step, and this runbook
exists so that step takes 60 seconds instead of a day.

---

## 1 · The 3-step recovery (do this when reels stop)

1. On your laptop: `hf auth login` (opens a browser, completes the OAuth flow).
2. Copy the whole credentials JSON the CLI wrote. Default locations:
   - macOS / Linux: `~/.higgsfield/credentials.json`
   - Windows: `%USERPROFILE%\.higgsfield\credentials.json`

   If it is not there, `HIGGSFIELD_CREDENTIALS_PATH` overrides the location.
3. Paste it into **Instagram → Settings → "Replace Higgsfield credentials JSON"**
   and save. That writes `app_secret_kv.higgsfield_credentials_json`, which the
   app PREFERS over any env var.

Within 15 minutes `higgsfield-session-keepalive` picks it up, rotates it, and
writes the rotated pair back. Confirm on **Today → HQ → the Higgsfield health
refresh button**, or wait for the Delivery card's blocker to clear.

**Do NOT put credentials in a Railway env var.** `HIGGSFIELD_CREDENTIALS_JSON` is
read as a last-resort fallback only. A static env pair dies ~90 minutes after
login (measured 2026-07-16) because the CLI rotates tokens and the rotated
successor has nowhere to go. The DB row is the only store that survives rotation.

---

## 2 · What is already automatic — do not rebuild it

| Piece | Where |
|---|---|
| Refresh every **15 min** with a credit-free `hf account status` | `cron/scheduler.ts` → `higgsfield-session-keepalive` (`pulse` tier) |
| Rotated token persisted to `app_secret_kv` | `higgsfieldStudio.ts` → `persistRotatedCredentialsThenCleanup` |
| Runs BEFORE the reel pipeline each pulse | same tier, ordered |
| Failure is LOUD (throws → cron-observer → Telegram) | keepalive handler throws rather than returning |
| Liveness readable for free, no CLI spawn | `higgsfieldStudio.ts` → `higgsfieldSessionHealth()` reads `cron_log` |
| Dead session raises a **blocker** on the Delivery card | `socialDeliveryIssues.ts` → `generator_session_expired` |

15 min << the ~90 min token life, so ordinary inactivity can never expire the
session. **The operator should only ever need step 1 when the refresh token
itself is revoked.**

---

## 3 · ⚠️ The most likely cause of repeat revocation: one account, two clients

OAuth refresh tokens are **single-use** — each refresh consumes the old token and
issues a new one. Two clients sharing one Higgsfield account therefore revoke
each other: whichever refreshes second presents a token that was already spent.

So **running the `hf` CLI on your laptop against the same account that Railway
uses will kill the production session**, every time, within one refresh cycle.
That is the mechanism behind "it needs logging in every time".

Options, best first:

1. **A separate Higgsfield account (or a second seat) for production.** Prod owns
   its own credential chain; your laptop can never revoke it. This is the only
   option that removes the failure mode rather than working around it.
2. **Treat the laptop CLI as break-glass.** Use it only to perform step 1 above,
   and never for local generation while prod is live.
3. Keep one account and accept periodic re-login. The blocker now tells you
   within 15 minutes, so the cost is minutes, not days.

**Choosing between these is an operator/billing decision, not an engineering
one** — which is why this runbook states it rather than implementing it.

---

## 4 · Diagnosing, read-only

`cron_log` is the record. All SELECTs, no writes (see the `prod-db-guard` skill):

```sql
-- did keepalive run, when, with what result
SELECT started_at, status, LEFT(COALESCE(error_message, details), 120) AS note
  FROM cron_log
 WHERE job_name = 'higgsfield-session-keepalive'
 ORDER BY started_at DESC
 LIMIT 20;

-- is rotation still being persisted? (value never selected)
SELECT k, updated_at, LENGTH(v) AS bytes
  FROM app_secret_kv
 WHERE k = 'higgsfield_credentials_json';
```

How to read it:

| Symptom | Meaning |
|---|---|
| `status='failed'`, note contains `Session expired` / `hf auth login` | Refresh token **revoked**. Step 1. No retry will fix it. |
| Gaps between runs **>> 15 min** | The `pulse` tier is not firing — a different fault. Check the cron, not the session. |
| Runs completing, but `app_secret_kv.updated_at` frozen | The CLI is refreshing without rotating, or the persist path is failing. Rotation only writes when the blob CHANGES. |
| No rows at all | The job never ran. Check `REEL_VIDEO_PROVIDER` and that the scheduler is up. |

### Worked example — the four-day outage (2026-08-13 → 08-17)

Probed 2026-08-17: **332** completed keepalive runs (08-10 08:47 → 08-13 18:07),
then **372 consecutive failures** (08-13 18:11 → 08-17), every one
`Session expired. Hint: Run: hf auth login`. Largest gap between runs: **15.4
min** — cadence was perfect the whole time. `app_secret_kv.updated_at` froze at
08-13 17:11.

Nothing was broken except **visibility**: `socialDeliveryIssues` computed
`generatorConfigured` as `!!credentialsJson`, a PRESENCE check, so the admin
reported the reel generator as configured for four days while every submit
failed. `higgsfieldSessionHealth()` had been written for exactly this after the
2026-07-31 expiry and was never wired into that surface. It is now — a dead
session is a **blocker** whose next action is step 1.

**The lesson worth more than the fix:** a stored credential is not a working
credential, and a presence check cannot tell you which one you have.

---

## 5 · Pointing the reel lane back at Higgsfield

Order matters. Do not do this while the session is dead — every render would
fail and burn pipeline attempts.

1. Complete step 1 and confirm keepalive is `completed`.
2. Confirm the Delivery card shows no `generator_session_expired` blocker.
3. **Then** set `REEL_VIDEO_PROVIDER=higgsfield` in Railway — an operator action;
   `selectReelVideoProvider()` reads it and the pipeline follows.

Until then the lane runs `template_stock`, the free local ffmpeg path, which is
why reels can keep posting while Higgsfield is down. That is a deliberate
fallback, not a silent failure — but it does mean **a dead Higgsfield session
does not stop the feed**, so nothing external tells you it happened. The blocker
is now the thing that tells you.

`HIGGSFIELD_API_KEY` does not exist as a mechanism. Nothing reads it; it survived
only as a stale comment. Auth is the CLI session credential described above.

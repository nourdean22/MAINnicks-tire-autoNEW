# Higgsfield session — why it dies, and the 3-step recovery

**Read this before "fixing" Higgsfield auth.** The autonomous refresh is already
built and working. What cannot be automated is one human step, and this runbook
exists so that step takes 60 seconds instead of a day.

---

## 1 · Recovery (do this when reels stop)

### ⚠️ FIRST: `hf` on your machine is the WRONG CLI

`which hf` here resolves to `Python314/Scripts/hf` — **huggingface_hub**, which
also has an `auth login` subcommand and will cheerfully succeed while doing
nothing for Higgsfield. This exact trap burned 2026-07-31: the login was run,
believed done, and the canary failed identically. The `Hint: Run: hf auth login`
text in the error comes from the **Higgsfield** CLI on Railway, where `hf` is a
different binary.

Invoke Higgsfield's binary by PATH, never by name. `higgsfieldBinary.ts` resolves
it from `node_modules/@higgsfield/cli/vendor/hf[.exe]`, and downloads it to the OS
temp dir if absent — so the same lookup works locally:

```bash
node -e "import('./server/services/higgsfieldBinary.ts')" # or use the vendor path directly
ls node_modules/@higgsfield/cli/vendor/          # hf / hf.exe lives here
```

Then run **that** binary's `auth login` — a device flow.

### The steps

1. Run `<vendor>/hf auth login` and complete the device flow in the browser.
   **The post-login redirect DROPS the device code**, so go back to
   `/device?code=…` and click Connect — it took two clicks on 2026-07-31.
   It writes `~/.config/higgsfield/credentials.json`
   (`%USERPROFILE%\.config\higgsfield\credentials.json` on Windows).
2. Get it into `app_secret_kv`, either way:
   - **From your phone:** paste the file's contents into
     **Instagram → Settings → "Replace Higgsfield credentials JSON"**.
   - **From this machine:** `pnpm exec node scripts/push-higgsfield-creds.mjs`
     (dry run), then `--apply`. It refuses unless the file parses with BOTH
     `access_token` and `refresh_token`, refuses if it is not NEWER than the
     stored row, and prints only lengths/hashes — never token material.
3. Confirm, do not infer: `pnpm exec tsx scripts/probe-higgsfield-session-health.mts`
   (or the Higgsfield refresh button on Today → HQ). The Delivery card's
   `generator_session_expired` blocker clears on its own once keepalive succeeds.

**A redeploy is no longer required.** `getHiggsfieldCredentialsJson` latches
`credentialsLoadAttempted` on first read and never re-reads the DB, so a stale
in-process blob used to survive any paste — which is why the 2026-07-31 sequence
ended in "REDEPLOY; the DB write alone does nothing". Two invalidations now cover
it: `updateMetaConfig` clears the cache in the process that served the paste, and
(added 2026-08-17) the keepalive clears it whenever it finds the session invalid,
so recovery lands within 15 minutes whichever process took the write.

**Then delete the local credentials file.** One owner of the token — prod. See §3.

**Do NOT put credentials in a Railway env var.** `HIGGSFIELD_CREDENTIALS_JSON` is
a last-resort fallback that the `app_secret_kv` row SHADOWS completely. A static
env pair also dies ~90 min after login (measured 2026-07-16) because the CLI
rotates tokens and the rotated successor has nowhere to go.

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

### ⚠ Timestamps in these tables are UTC

`cron_log` stores UTC and mysql2 hands back naive values that Node labels with the
LOCAL zone, so every value reads ~4h AHEAD of real Eastern. Durations and GAPS are
unaffected (both endpoints shift together); only absolute wall-clock is. Use
`scripts/probe-cron-clock.mjs`. The absolute times below are as-read (UTC-labelled
Eastern), i.e. subtract 4h for real ET.

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

---

## 6 · If you want to stop needing a login at all: that already exists

`veoStudio.ts` is, in its own docstring, "the production replacement for the
Higgsfield/Seedance CLI". Auth is `GEMINI_API_KEY` (or `GOOGLE_SERVICE_ACCOUNT_*`)
— **an API key: nothing expires, no device flow, no rotation, no session to
revoke.** It was proven end-to-end in #1256 (real billable generation, S3 rehost,
range-fetched URL), and it is the better pipeline path besides: Veo persists a
per-beat `veoOperationName` so a timeout RESUMES the same operation, while
Higgsfield is a single blocking call with no resumable handle — re-submitting is
what doubled paid spend on every timeout.

**It was not rejected for capability. It was rejected on cost** (operator decision
2026-07-31): Higgsfield measured ~$1.30/reel over 23 reels; Veo bills per
generation and reels average 5.25 clips. That trade may read differently now that
a revoked session has cost four days of the paid lane.

**The correct flip is to DELETE `REEL_VIDEO_PROVIDER`, not to set it to `veo`.**
Auto-select prefers Veo when credentialed AND retains automatic Higgsfield
fallback; an explicit `veo` pin forfeits that fallback and repeats the original bug
in mirror image — an explicit pin is exactly what made the session expiry fatal,
because `selectReelVideoProvider()` never consults its credential-based fallback
when a value is set.

Two Railway traps if you do flip, both measured 2026-07-31: `railway variable
delete` does NOT reliably reach the running container, and `railway redeploy
--yes` was a silent no-op. Only `railway variable set K=V` (without
`--skip-deploys`) actually deployed, and the new container took ~20 min. **Verify
from behaviour prod REPORTS** — the `provider selected provider="…"` log line, or
the clip filename (`veo-…mp4` vs `hf_…mp4`) — never from an API readback or a low
uptime.

# Operator console actions — agent cannot and must not do these

1. **Revoke the GitHub PAT** — github.com → Settings → Developer settings → Personal access tokens.
   It was embedded in `.git/config` (now stripped; pushes verified working via the gh credential
   helper). Stripping does NOT revoke it — the token is live until you delete it.
2. **Delete the Deepgram key** — Deepgram console, project `efeb2d23…`. Prepaid $199.998 is parked,
   not draining; whether it's refundable is a Deepgram-support question. Zero code references
   remain; removal from Railway env (2026-08-05) revoked nothing.
3. **Rotate/delete the LiveKit key + secret** — cloud.livekit.io. Also check the **billing plan**
   there: unlike Deepgram, a paid tier bills despite zero usage, and the plan is only visible in
   your dashboard.
4. **VAPI — RESOLVED 2026-08-09, better than expected.** Read-only API check found: all 5
   account-level tools are ORPHANS (attached to no assistant); the 3 with URLs point at
   **autonicks.com, a dead Vercel deployment**; the live number +1-216-424-9249 already runs
   entirely through `nickstire.org/api/webhooks/vapi`. Nothing needed repointing. Remaining
   30-second dashboard tidy-up (say the word and the agent can do it via API instead):
   ~~delete the 5 orphan tools~~ **DONE 2026-08-09** — all 5 deleted via API on your
   "delete whatever is safe" go; `tools remaining: 0`; full configs preserved in the session
   transcript if any ever needs recreating. Remaining: review the duplicate "Receptionist"
   assistant `afcad79e` (the phone uses `150fe622`; not deleted — outbound-call code could
   reference assistant IDs from env/DB the repo can't see).
5. **TCPA consent gate — BUILT, SHIPPED IN SHADOW (#1461). Your decision is now a number, not a
   design question.** The ledger already existed (`audit_log` `sms.opt_in`, written by the booking
   form, lead form and START keyword); nothing read it at send time. It is now read at the
   `sendSms` chokepoint for `customer_marketing` sends only — but in **shadow**: it logs and counts,
   it does not block. Nothing about today's sending behavior changed.
   - **What to do:** let it run through a normal campaign cycle, then read
     `consentGateShadowMisses` on the SMS ops surface. That is the count of marketing sends that
     would STOP the moment the gate is armed.
   - **Why it isn't armed:** the repo cannot tell what share of your ~2,900 lifetime customers has
     a consent row — only phones that came through those three doors since complianceLog shipped
     do. If that share is small, arming blind would silently kill review requests, winback,
     cross-sell, retention and blasts. Nobody should flip that without seeing the number.
   - **Arm with:** `SMS_CONSENT_GATE=enforce` (Railway env). Unset = shadow.
   - **Still a counsel question:** whether your existing opt-in records constitute *prior express
     written consent* under TCPA for the marketing classes you actually send, and what to do about
     customers with no record. No sends were made or altered.
6. **ChatGPT Custom GPT**: confirm whether it still calls `bdnick.info/api/nour-os/query` — it's on
   the Stage-3 delete list and the repo cannot see external consumers.
7. Optional hardening: enable branch protection / required checks on GitHub — today `gh pr merge`
   succeeds over a red CI by design.

# Runbook — Activate Meta CAPI (server-side conversions)

_One owner action. Zero code changes. ~5 minutes. (attribution completion wave 2026-06)_

**Why:** the browser Meta pixel is blocked by ad blockers (~30-40% of visitors) and iOS tracking limits. CAPI re-sends Lead + Schedule conversions **from the server**, with SHA-256-hashed PII and `event_id` dedup so Meta never double-counts a visitor the pixel also caught. Until activated, those conversions are simply lost — the Site Health card shows **DORMANT**.

## Steps
1. **Generate the token** — Meta Business Suite -> Events Manager -> Data Sources -> select pixel `1436350367898578` -> **Settings** -> Conversions API section -> **Generate access token**. Copy it (treat like a password — never paste it into chat/docs).
2. **Set it in Railway** — Railway project -> service **MAINnicks-tire-auto** -> **Variables** -> add:
   - `META_CAPI_ACCESS_TOKEN` = the token
   - (optional) `META_CAPI_PIXEL_ID` — only if ever switching pixels; defaults to the live pixel id in code.
3. **Restart** — Railway redeploys automatically when a variable is added. If not, trigger a redeploy of the service. Nothing else to configure.
4. **Verify (same day):**
   - Admin -> Site Health -> "META SERVER-SIDE CONVERSIONS" flips to **ACTIVE**.
   - Meta Events Manager -> your pixel -> **Test Events / Overview**: on the next organic lead or booking, a **Lead** (and **Schedule** for bookings) event arrives with connection method "Server"; events that the pixel also fired show **Deduplicated** (matching `event_id`).
   - Railway logs show `[capi:send] Lead event sent (events_received: 1)`.

## What sends once active (nothing else)
- **Lead** — popup/chat/financing-modal leads, callbacks, bookings (`lead.submit`, `callback.submit`, `booking.submit`).
- **Schedule** — booking confirmations.
- **Contact / Purchase** — implemented but currently have no callers; nothing fires until a future wave wires them.

## Safety facts
- PII (phone/email/name) is SHA-256 hashed per Meta spec before sending; `fbc`/`fbp` cookies pass through per Meta requirement.
- Errors are swallowed into logs — a Meta outage can never break a customer submit (unit-tested: `server/meta-capi.test.ts`).
- Rollback = delete the Railway variable -> instantly dormant again (unit-tested no-token path: zero network calls).

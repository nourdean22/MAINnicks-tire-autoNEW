# Runbook — Activate Meta CAPI (server-side conversions)

_One owner action. Zero code changes. ~5 minutes. (attribution completion wave 2026-06)_

**Why:** the browser Meta pixel is blocked by ad blockers (~30-40% of visitors) and iOS tracking limits. CAPI re-sends Lead + Schedule conversions **from the server**, with SHA-256-hashed PII and `event_id` dedup so Meta never double-counts a visitor the pixel also caught. Until activated, those conversions are simply lost — the Site Health card shows **DORMANT**.

## Status note (2026-06-10): PARKED by operator — do this when the next boosted post goes live.

## ⚠ THE WRONG-BUTTON TRAP (cost us an hour — read first)
Meta has TWO near-identical "Generate access token" buttons:
- **Payload Helper page** (`developers.facebook.com/.../payload-helper`) — mints **preview-only tokens**. They can READ the pixel but Meta **refuses event-publishing** with them (error 100/33). Two such tokens were generated and validated-dead on 2026-06-10. **Do not use this page.**
- **The real one**: Events Manager -> dataset **nour os** -> **Settings** tab -> "Conversions API" section -> *Set up direct integration* -> **Generate access token** (mints a SYSTEM-USER token with publish rights). Alternative path: the dataset's "Connect activity with Conversions API" manual wizard -> final **See Instructions** page also has the real button.

**Validation oracle (5 seconds, run before trusting any token):** a sandboxed test-event POST must return `events_received: 1` — the agent has this probe ready; paste the token in chat and it gets validated before anything is configured.

**This-PC gotchas (2026-06-10):** the hosts-file blocks on `graph.facebook.com`/`connect.facebook.net` were REMOVED (owner-edited), but an ad-blocker extension still blocks `connect.facebook.net` in Chrome — Events Manager's *Settings panel* shows "Disable any ad blockers" until that extension is off (the CAPI *wizard* pages render regardless). Phone Events Manager is unaffected by all of this.

## Steps
1. **Generate the token** — Meta Business Suite -> Events Manager -> Data Sources -> select pixel `1436350367898578` -> **Settings** -> Conversions API section -> **Generate access token** (see trap warning above). Copy it (treat like a password — never paste it into public docs).
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

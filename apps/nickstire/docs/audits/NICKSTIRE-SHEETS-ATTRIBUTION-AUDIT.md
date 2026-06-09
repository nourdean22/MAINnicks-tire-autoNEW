# Nick's Tire — Sheets CRM Attribution Columns

_2026-06 sheets-attribution wave · branch `nickstire-sheets-attribution-columns` (from origin/main `5c7d4e3c`)._
_Gate honored: the Revenue Intelligence Quality Pass (`5c7d4e3c`) was pushed, deployed (Railway SUCCESS), and production-verified (clamps live, strips/tooltips/labels verified, console clean) BEFORE this wave wrote any code._

> Mission: the owner's working CRM (Google Sheets) can now answer "which source / campaign / page produced this lead, booking, or callback" — using only fields the app already captures. **Blank is better than fake**: rows with no web attribution (SMS bot, after-hours emergency, phone-origin) carry honest empty cells.

---

## 1. Sheets sync audit (Phase 1 inventory)

Mechanism: `server/sheets-sync.ts` `appendRow(tab, values[])` → `spreadsheets.values.append` (range `A:Z`, INSERT_ROWS) — **append-only by construction**; the code never touches existing rows, columns, formulas, or the header row (row 1 is owner-managed). Sanitizes newlines; retries 401/403 (auth refresh) and 429 (30s backoff).

| Tab | Cols before | Attribution before | Action | Cols after | Within A:Z |
|---|---|---|---|---|---|
| Leads | 14 (A-N) | `source` only (col G) | **+5 tail (O-S)** | 19 | YES |
| Bookings | 12 (A-L) | none | **+5 tail (M-Q)** | 17 | YES |
| Callbacks | 10 (A-J) | `sourcePage` (col E) | **+5 tail (K-O)** | 15 | YES |
| Financing | 10 (A-J) | `sourcePage` (col G) | **HOLD** — the acima/snap router captures only sourcePage; accepting UTM there = a new-capture change (needs approval). Financing *leads* (pre-approval modal) already flow attributed into the **Leads** tab via `lead.submit` (`source=financing_preapproval` + UTM) | — | — |
| Invoices | 17 (A-Q) | n/a (ALG mirror) | **DO_NOT_ADD** — no attribution data exists | — | — |
| WorkOrders | 11 (A-K) | `source` | **DO_NOT_ADD** — same | — | — |
| Dashboard | 7 (A-G) | n/a (metrics cron) | **DO_NOT_ADD** | — | — |

Formula risk: **none** — strictly appended trailing cells; zero reorder/rename/delete; existing column positions unchanged on every tab.

## 2. The 5 attribution columns (identical tail on all 3 tabs)

| Header (paste in row 1) | Value | Class | Notes |
|---|---|---|---|
| `UTM Source` | `utmSource` from the submit input (stored in DB since wave-125) | SAFE_NOW / BLANK_OK | e.g. `google`, `instagram`, `voice-agent`. Blank = direct/untagged — blank is the honest representation here (the "direct/untagged" wording is an admin-rollup label, not stored data) |
| `UTM Medium` | `utmMedium` | SAFE_NOW / BLANK_OK | e.g. `cpc`, `social` |
| `UTM Campaign` | `utmCampaign` | SAFE_NOW / BLANK_OK | e.g. `summer_brakes`, `vapi-rack-check` (voice + remapped sources self-label here) |
| `Landing Page` | `landingPage` pathname-normalized via the unit-tested `normalizePathname` | SAFE_NOW / BLANK_OK | stored value is the full href; pathname keeps the column readable and stops UTM variants fragmenting it (e.g. `/used-tires-cleveland`) |
| `Referrer` | `referrer` as stored | SAFE_NOW / BLANK_OK | e.g. `https://l.instagram.com/` — boosted-post traffic shows here even when untagged |

**Rejected candidates:** `UTM Content`/`UTM Term` (captured in sessionStorage but NOT stored on lead/callback rows — would require schema = HOLD) · `Current Path`/`Source Component`/`Service Intent` (not stored per-entity) · `Attribution Notes` (no data; would invite fake annotations) · user agents / IPs / raw payloads (never).

## 3. What was built

- `sheets-sync.ts`: exported `SHEET_ATTRIBUTION_HEADERS` + pure `attributionCells()` (ALWAYS exactly 5 cells — alignment contract) + `SheetAttribution` type; the Leads/Bookings/Callbacks row builders append the tail unconditionally (callers without web attribution produce honest blanks, so columns stay aligned across every submit path).
- Call sites wired with the same already-validated input fields the DB insert stores: `lead.ts` (web leads incl. financing pre-approval + chat), `callback.ts` (both the lead row and the callback row), `booking.ts`. `emergency.ts` / `smsBot.ts` deliberately untouched — those paths have no web attribution; their rows get blanks via the tail itself.
- `server/sheets-attribution.test.ts` — 6 tests pinning: 5-cell alignment vs headers, honest blanks, header-order mapping, pathname normalization (UTM variants converge), partial honesty, null handling.

## 4. Live Sheet mutation: **NONE performed**

The code never writes headers (row 1 is owner-managed). New values flow into unlabeled trailing columns immediately after deploy and align by construction. **Owner action (2 minutes): paste these labels into row 1:**
- **Leads** tab, cells **O1:S1** → `UTM Source | UTM Medium | UTM Campaign | Landing Page | Referrer`
- **Bookings** tab, cells **M1:Q1** → same 5
- **Callbacks** tab, cells **K1:O1** → same 5
(Until pasted, the data is still there — just unlabeled. No formulas touched either way.)

## 5. What the owner can now answer in Sheets
Which source produced this lead (UTM Source; blank = direct/untagged) · which campaign (UTM Campaign — incl. `vapi-rack-check` voice rack-checks and remapped `sms_capture`/`newsletter` origins) · which page (Landing Page pathname) · boosted-post traffic (Referrer host like `l.instagram.com` even when untagged) · which forms are missing attribution (blank tails on SMS-bot/emergency/phone rows — honest by design).

## 6. Remaining HOLD items (unchanged)
Financing-tab UTM (needs capture-field approval) · UTM Content/Term per-entity storage (schema) · Meta CAPI (owner token) · call_events eventId/journey join (schema) · GA4 repointing · tire-order attribution (schema). Backfill of historical rows: NOT performed (would be a bulk mutation — needs explicit approval; old rows simply have empty tails).

---
_Gates: tsc 0 · 38/38 tests (6 new) · full build green (server esbuild resolves @shared/attribution). Zero schema/migration/customer-contact/public-UI/CAPI changes; zero secrets/payloads/PII beyond what the CRM rows already carry by design. No live Sheet mutation. Not pushed pending operator approval._

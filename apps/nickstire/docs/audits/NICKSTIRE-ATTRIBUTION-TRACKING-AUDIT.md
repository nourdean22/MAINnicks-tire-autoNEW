# Nick's Tire — Conversion Tracking & Attribution Audit

_2026-06 attribution wave · branch `nickstire-attribution-tracking-audit` (from origin/main `32a02729`)._
_Method: 5-cluster multi-agent read-only code audit (10 agents, 325 tool calls, adversarially verified) + orchestrator spot-verification of every edit target. Pre-flight confirmed: public-UI pass `32a02729` = main tip; lead-source hygiene Wave 1 on main (`193ccc95`/`f429fc16`/`97d63d1f`); **Wave 2 NOT on main** (not depended on)._

> Mission: the owner must be able to answer "which page/CTA/channel made the customer call, text, navigate, book, request a callback, ask about tires, or ask about financing" — without fake events, PII leaks, or double counting.

---

## 1. Tracking architecture (verified ground truth)

**The spine is good. The failures were coverage and routing, not architecture.**

| Layer | What it is | State |
|---|---|---|
| `components/SEO.tsx` `trackPhoneClick(source)` | CANONICAL phone-click path: haptic -> umami `phone_click` -> GA4 `phone_click` (via ga4.ts) -> Meta Pixel `Contact` (via metaPixel.ts, generates eventID) -> **first-party DB row** `callTracking.logCall` (sourcePage, clickElement, utm*, landingPage, referrer, userAgent) -> DOM event. Every layer guards + silent-fails. | OK |
| `components/SEO.tsx` `trackEvent(name, data)` | Generic CTA/event path: umami -> GA4 (gtag, appends page_path) -> DOM event -> **first-party DB row** `customerEvents.log` (eventName, eventData, sourcePage, utm*, referrer, UA, sessionId). Silent-fail. | OK |
| `lib/utm.ts` | Session attribution: `captureUtmParams()` on app mount stores utm_5 + landingPage + referrer + gclid in sessionStorage; `getUtmData()` returns them for form spreads. | OK (sessionStorage-only by design — see limitations) |
| `lib/metaPixel.ts` | fbq wrappers; `generateEventId()` per event for future CAPI dedup; returns id to caller. Guards `window.fbq`. | OK (eventID plumbing ready; CAPI is a stub — below) |
| `lib/ga4.ts` | GA4 helpers (form submission/abandon, chat, search, page view). Guards `window.gtag`. | OK (trackSearch is dead code w/ PII warning added) |
| `lib/analytics.ts` | LEGACY gtag-only `trackPhoneClick` firing **`phone_call_click`** — no umami/pixel/DB/UTM. | **DEPRECATED this wave** (JSDoc; all prod callers migrated; file kept for utils.test.ts) |
| `server/meta-capi.ts` | **STUB — all no-ops.** Real impl removed (META_CAPI_ACCESS_TOKEN never configured in Railway). Re-enable: token + pixel ID in Railway + restore from git history (header cites commit `37c8093`; verify with `git log --all` — may be rebased). | DOC / operator decision |
| Server input schemas | `lead.submit` (lead.ts:62-66), `callback.submit` (callback.ts:34-45), `booking.submit` (booking.ts:209-216) **already accept + store** utm*/landingPage/referrer (+gclid on booking, +sourcePage on callback) as nullish columns. No router uses `.strict()` -> extra spread keys are stripped, never rejected. | OK |
| Internal first-party tables | `call_events` (phone clicks w/ UTM; **no eventId column**, no FK to leads) · `customer_events` (generic events w/ UTM + sessionId). | OK / joins are HOLD |

### Current event taxonomy (post-wave, canonical)
`phone_click` (GA4+umami; Pixel `Contact`; call_events row) · `sms_click` · `directions_click` · `booking_cta_click` (NEW) · `tire_quote_cta_click` (NEW) · `form_submission_{booking|lead|callback}` · `form_abandon_*` · `chat_*` · Pixel standard events (`Lead`, `Schedule`, `Contact`, `ViewContent`, `Search`).
**Naming rule:** existing names keep continuity (`phone_click`/`sms_click`/`directions_click` already have history); new event types follow the `*_cta_click` taxonomy. GA4 historical note: **`phone_call_click` stops accruing at this wave's deploy** — that series merges into `phone_click` (this is the intended consolidation; tire/problem/portal pages previously reported under the old name).

---

## 2. Tracking inventory (key surfaces)

| Surface | Action | File | Event | GA4 | Pixel | CAPI | DB | UTM | Status (pre-wave -> post) |
|---|---|---|---|---|---|---|---|---|---|
| SiteMobileCTA | call/text/directions | SiteMobileCTA.tsx:84-129 | phone_click / sms_click / directions_click | Y | Y(call) | stub | Y | Y | OK (already canonical) |
| Home hero | CALL NOW | Home.tsx:331 | phone_click ("hero") | Y | Y | stub | Y | Y | OK |
| Home hero | ORDER TIRES | Home.tsx:304 | tire_quote_cta_click | Y | n/a | stub | Y | Y | MISSING -> **OK** |
| Home hero | SCHEDULE DROP-OFF | Home.tsx:314 | booking_cta_click | Y | n/a | stub | Y | Y | MISSING -> **OK** |
| Home hero | GET DIRECTIONS | Home.tsx:340 | directions_click ("hero") | Y | n/a | stub | Y | Y | MISSING -> **OK** |
| /areas-served | Call / Get Directions | AreasServed.tsx:187-201 | phone_click / directions_click ("areas-served") | Y | Y(call) | stub | Y | Y | MISSING -> **OK** |
| /contact | Phone / Get Directions | Contact.tsx:145,161 | phone_click ("contact-info") / directions_click ("contact-address") | Y | Y(call) | stub | Y | Y | MISSING -> **OK** |
| SiteFooter (every page) | Call stripe / Text / brand Call | SiteFooter.tsx:71,76,111 | phone_click ("footer-stripe"/"footer-brand") / sms_click | Y | Y(call) | stub | Y | Y | MISSING -> **OK** |
| UrgencyWidget (35% scroll) | Call | UrgencyWidget.tsx | phone_click ("urgency-widget") | Y | Y | stub | Y | Y | MISSING -> **OK** |
| /tires TireFinder | 9 tel: CTAs | TireFinder.tsx | was `phone_call_click` gtag-only | Y | N->**Y** | stub | N->**Y** | N->**Y** | MISLABELED/PARTIAL -> **OK** (canonical path) |
| /tires/:size (x30) | 3 tel: CTAs | TireSizePage.tsx | same migration | Y | N->**Y** | stub | N->**Y** | N->**Y** | MISLABELED/PARTIAL -> **OK** |
| /portal | tel: CTA | CustomerPortal.tsx | same migration | Y | N->**Y** | stub | N->**Y** | N->**Y** | MISLABELED/PARTIAL -> **OK** |
| Problem pages (x13) | 3 tel: CTAs | ProblemPage.tsx (private dup deleted) | same migration | Y | N->**Y** | stub | N->**Y** | N->**Y** | DUPLICATE-IMPL -> **OK** |
| LeadPopup | lead submit | LeadPopup.tsx:146-159 | Pixel `Lead` + pixelEventId + getUtmData spread | Y | Y | stub | leads row w/ UTM | Y | OK (the proven pattern) |
| BookingWizard | booking submit | BookingWizard.tsx | form_submission_booking + Pixel Lead/Schedule | Y | Y | stub | bookings w/ UTM | Y | OK |
| UrgencyWidget capture | callback submit | UrgencyWidget.tsx | callback.submit | n/a | n/a | stub | callback row | N->**Y** | PARTIAL -> **OK** (UTM spread added) |
| FinancingPreApprovalModal | lead submit (financing) | FinancingPreApprovalModal.tsx | lead.submit source=financing_preapproval | n/a | n/a | stub | leads row | N->**Y** | PARTIAL -> **OK** (UTM spread added) |
| ChatWidget lead capture | lead submit (chat) | ChatWidget.tsx | lead.submit source=chat | n/a | n/a | stub | leads row | N->**Y** | PARTIAL -> **OK** (UTM spread added) |
| CallbackModal | callback submit | CallbackModal.tsx | — | — | — | — | — | — | **DEAD CODE** (mounted nowhere since May PageLayout cull; not enriched on purpose) |
| FomoTicker / LiveVisitorCounter | proof widgets | — | untracked | — | — | — | — | — | OK as-is (decision: leave untracked — they are proof, not CTAs; tracking them adds noise) |
| Google Sheets CRM | all entities | server/sheets-sync.ts | rows carry name/phone/source/problem only | — | — | — | — | **N** | **HOLD** (no UTM columns; operator-gated spreadsheet layout change) |
| VAPI inbound calls | phone calls | vapi_call_logs | no join to call_events/leads | — | — | — | — | — | **HOLD** (click->call->booking join = schema work) |

## 3. The 20 diagnostic questions (answers)

1. **Tel clicks tracked?** YES on canonical surfaces (full 4-layer); pre-wave NO on tires/problem/portal (gtag-only) and NO on footer/contact/areas-served/urgency/hero-directions — **all fixed this wave**.
2. **SMS clicks?** YES — `sms_click` (SiteMobileCTA; footer Text added this wave).
3. **Directions clicks?** YES — `directions_click` (SiteMobileCTA; hero/contact/areas-served added this wave).
4. **SiteMobileCTA distinguishes?** YES — three distinct events with `source:"mobile-cta"`.
5. **Path + CTA label preserved?** YES — trackEvent appends `page_path`; DB rows carry `sourcePage`; source labels name the surface (`hero`, `footer-stripe`, `areas-served`, `contact-info`, `urgency-widget`).
6. **Forms preserve UTM/referrer/landing?** Pre-wave: only LeadPopup + BookingWizard. **Now also** UrgencyWidget callback, FinancingPreApprovalModal, ChatWidget. (CallbackModal = dead code, skipped.)
7. **Attribution into admin/Sheets?** Admin: YES for DB (leads/callbacks/call_events carry UTM). Sheets: **NO — zero UTM columns (HOLD)**.
8. **GA4 + Pixel same action?** YES for phone clicks (canonical path fires both). Form submits: Pixel fires on LeadPopup/Booking; GA4 form events partially. Acceptable; not expanded this wave (no fake/double events).
9. **CAPI server-side?** **NO — meta-capi.ts is a stub** (token never configured). Browser pixel is the ONLY Meta signal.
10. **Shared event_id pixel<->CAPI?** MOOT (no CAPI). Client plumbing exists (`pixelEventId` accepted by lead.submit; metaPixel returns ids; phone-path id currently discarded at SEO.tsx:206-208). If CAPI is enabled later: add call_events eventId column (schema = HOLD).
11. **Duplicates?** NO double-counting found: no surface fires both legacy+canonical; CAPI stub means no client+server doubles; track calls are in onClick handlers (not render/effect paths).
12. **Too-generic names?** The `phone_call_click` vs `phone_click` split — **consolidated this wave**. Remaining names are action-specific.
13. **PII in frontend events?** NONE found live. Latent risks guarded: PII-warning JSDoc added on `trackEvent` (customerEvents.log has no server sanitization) + `trackSearch` (dead code, raw query).
14. **Third-party failures?** External-only: net::ERR_FAILED = ad-blocked fbevents/gtag/ahrefs. First-party (`/api/trpc/callTracking.logCall`, `customerEvents.log`, `/api/cwv`) unaffected. **No first-party break.**
15. **Font preload?** Benign (display=optional, non-blocking). DOC only — no change (avoid perf theater).
16. **/areas-served CTAs tracked?** Were NOT (shipped untracked in 32a02729) — **fixed this wave**.
17. **FomoTicker/LiveVisitorCounter?** Leave untracked — they are honesty-gated proof widgets, not CTAs. Tracking views adds noise, no decisions.
18. **Tire finder/inquiry complete?** Pre-wave: worst surface (full-stack bypass). **Now canonical.** Tire ORDER submissions (gatewayTire) fire Pixel via their own flow; tire-page CALLS now produce call_events rows.
19. **Financing complete?** CTA + UTM now tracked (FinancingCTA modal lead carries UTM; financing source label existed). Pixel `Lead` for financing submit NOT added (deliberate: no new Meta conversion events this wave — taxonomy decision for the owner).
20. **Owner sees page+source+CTA per lead today?** In ADMIN: yes for popup/booking leads + all phone clicks on canonical surfaces (now including tires/footer/contact/areas-served/urgency); now also callback/financing/chat leads (UTM). In SHEETS: no (HOLD).

## 4. What was built (3 commits)

1. **Normalize public CTA tracking** — (a) migrated the 4 legacy/duplicate phone-click callers (TireFinder, TireSizePage, CustomerPortal, ProblemPage private dup deleted) onto the canonical `SEO.trackPhoneClick`; (b) instrumented the 10 naked money CTAs (hero ORDER TIRES/SCHEDULE DROP-OFF/GET DIRECTIONS, footer Call/Text/brand-Call, contact Phone/Directions, areas-served Call/Directions, urgency-widget Call) with existing helpers + existing/new taxonomy names; (c) `@deprecated` JSDoc on lib/analytics.ts; PII-guardrail JSDoc on `trackEvent` + `trackSearch`.
2. **Preserve attribution context** — spread `getUtmData()` into the 3 LIVE blind submissions (UrgencyWidget callback, FinancingPreApprovalModal lead, ChatWidget lead) — fields the server already accepts/stores; zod (non-strict) strips extras; the exact pattern LeadPopup ships in prod.
3. **This audit doc.**

**Deliberately NOT built:** new dashboards, schema/migrations, CAPI enablement/rewrite, GA4/Pixel rewrites, new Meta conversion events, Sheets column changes, form UX changes, route changes, FomoTicker/LiveVisitorCounter tracking, CallbackModal enrichment (dead code).

## 5. HOLD items (operator-gated next wave)

| Item | Why HOLD | What it needs |
|---|---|---|
| **Enable Meta CAPI** | External config + code restore; currently pixel-only Meta signal loses ad-blocked/iOS conversions | META_CAPI_ACCESS_TOKEN + META_CAPI_PIXEL_ID in Railway; restore impl from git history; wire client `pixelEventId` (lead path exists; phone path discards id at SEO.tsx:206-208) |
| **Sheets UTM columns** | Owner's live working CRM; layout/header change must be coordinated (operator can also add columns manually) | Decide columns -> update sheets-sync row arrays -> backfill optional |
| **call_events eventId column + click->call->booking join** | Schema change; matching job design (tel-click to VAPI call to booking) | Migration approval + matching strategy |
| **GA4 historical note** | `phone_call_click` series ends at this deploy (merged into `phone_click`) | If any owner report keys on the old name, re-point it |
| **sw.js cache** | Deployed tracking JS can lag for cached PWA clients until SW updates | Bump cache version when shipping tracking changes (this wave's changes are in hashed JS bundles — served fresh after SW update cycle) |

## 6. Standing conclusions (re-verified, unchanged)
- **net::ERR_FAILED on public pages = ad-blocked third-party trackers** (fbevents/gtag/ahrefs) in strict browsers. First-party tracking unaffected. Do NOT "fix" by removing scripts.
- **Font preload warnings = benign** (`display=optional`). No measured LCP harm. No change without trace evidence.
- **Thumb-zone stacking**: no proven overlap post-FomoTicker-honesty-fix; SiteMobileCTA Call/Text/Directions unobstructed (live-verified last wave). No change.
- **Limitations accepted by design:** UTM is sessionStorage-only (cross-session attribution resets; private-browsing silently degrades); landing/referrer captured at app mount.

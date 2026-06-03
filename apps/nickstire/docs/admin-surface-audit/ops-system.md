# Admin OPS/SYSTEM Surface Audit

> READ-ONLY audit (no code modified). Stance: kaizen + clarity-gate.
> CONFIRMED = read from file:line or observed live on nickstire.org (Claude-in-Chrome, authed, 2026-06-03).
> INFERRED = reasoned from code, not runtime-verified.
> Builds on `docs/admin-excellence/DESIGN.md` (Y1-Y13 deferred) + `docs/ADMIN_DFII_AUDIT.md`.
> Scope: OverviewSection (Today), SiteHealthSection, IntegrationsSection, SettingsSection,
> SettingsStatusTab, ComplianceSection, CallTrackingSection, TrafficFunnelSection,
> SnapDashboardSection, today/ subdir, settings/cronJobs.ts + FeatureFlagsPanel.

---

## TL;DR — top 5 fixes (ranked by leverage)

1. **SiteHealth INDEX COVERAGE shows literal "0" for Indexed / Not-Indexed / Crawled / Discovered** — server returns `0` meaning "unknown, GSC not wired" but UI uses `?? "—"` which does NOT catch `0`. Live-confirmed the operator sees a confident **"0 Indexed"** on a 207-page site. Worst false-telemetry on the surface. FIX-NOW-safe.
2. **SiteHealth INTEGRATIONS: Instagram Feed + AI Content Gen hardcoded `status: true`** — always render green "Connected" regardless of real config (live-confirmed). Plus Meta Pixel block is a fully static hardcoded card (ID/events/CAPI). Honesty defect. FIX-NOW-safe (downgrade to honest state or real probe).
3. **Overview "Fix" button on the ALG-offline crit alert routes to the wrong tab** (`settingsTab=integrations`, line 478) while the ALG controls live on ShopDriver HQ (`settingsTab=shopdriver`, line 545). Same dead-route class already fixed once in SettingsStatusTab. FIX-NOW-safe.
4. **`settings/cronJobs.ts` is a hand-maintained static catalog of 20 cron jobs with zero run-status** — redundant with the LIVE `Cron Health` panel that already exists on the Status tab (reads `nickActions.cronHealth`). Names are currently accurate (verified vs scheduler.ts) but will silently drift. Bind to real status or cut. DEFER (quality).
5. **`totalLookups` counter confusion** — ShopDriver HQ banner shows "0 lookups total" next to "PROBES (24H): 12"; the Overview ALG pill's `Connected · N lookups` branch therefore never fires (live-confirmed pill shows bare "ALG CONNECTED"). In-memory counter, resets on restart, measures a different thing than probes. Minor clarity nit. OPERATOR-DECISION.

**Net:** the OPS/SYSTEM surface is in strong shape — Status tab, Compliance, CallTracking, TrafficFunnel, Snap, and the today/ tiles are honest and well-built. The real rot is concentrated in **SiteHealthSection** (false zeros + hardcoded integration statuses) and one mis-routed alert link. Counts: **3 FIX-NOW-safe**, **2 OPERATOR-DECISION**, **5 DEFER/quality**, plus ~6 confirmed-clean notes.

---

## OverviewSection.tsx (Today) — `client/src/pages/admin/OverviewSection.tsx`

Live-confirmed renders cleanly (ALG pill, MorningBrief, 4 stat pills, NBA strip, priority queue, AI insights all real data).

| Dim | Conf | Evidence | Issue | Fix | Class |
|---|---|---|---|---|---|
| correctness | CONFIRMED | OverviewSection.tsx:478 vs :545 | ALG-offline crit alert "Fix" → `settingsTab=integrations`; the ALG status pill → `settingsTab=shopdriver`. ShopDriver HQ is where the ALG connection banner + sync/probe controls live; Integrations is the tire/labor calculator (only a vendor-health strip). The crit "Fix" sends operator to the wrong tab. | Point alert href at `settingsTab=shopdriver` to match the pill. | FIX-NOW-safe |
| staleness | CONFIRMED | OverviewSection.tsx:561-563 + autoLabor.ts:278 | Pill renders `Connected · ${totalLookups} lookups`; `totalLookups`=in-memory `laborLookupCount` (Labor Guide tab usage), 0 most of the time → branch never shows. Live pill = bare "ALG CONNECTED". | Drop the lookups clause or source a meaningful counter (e.g. probes/24h). | OPERATOR-DECISION |
| inconsistency | CONFIRMED | OverviewSection.tsx:729 | `item.totalRevenue > 500` hardcoded threshold to show $ chip in queue rows — magic number, not tied to VIP/whale tiers used elsewhere ($2K whale). Cosmetic. | Extract to a named constant or reuse the whale threshold. | DEFER |
| inconsistency | CONFIRMED | OverviewSection.tsx:259-262 vs 243-262 | `handleOpenSection` mixes two nav mechanisms: `window.dispatchEvent("admin:navigate-section")` for lead/callback/WO but `openDrilldown` for booking. Works, but two patterns for one intent. | Optional: unify. | DEFER |

---

## SiteHealthSection.tsx — `client/src/pages/admin/SiteHealthSection.tsx`

The heaviest-rot page on the surface. Most panels are real (SYSTEM RELIABILITY, DOMAINS, SEO counts, GOOGLE REVIEWS all live-confirmed accurate), but the index-coverage + integrations blocks lie.

| Dim | Conf | Evidence | Issue | Fix | Class |
|---|---|---|---|---|---|
| staleness / FALSE TELEMETRY | CONFIRMED (live) | SiteHealthSection.tsx:203-220 + admin-stats.ts:645-648 | `getSiteHealth()` returns `indexedPages:0, notIndexedPages:0, crawledNotIndexed:0, discoveredNotIndexed:0` with a comment "0 = unknown, GSC sync required — UI should render badge". UI does `health.indexedPages ?? "—"`. `0 ?? "—"` === `0`, so the unknown-badge NEVER shows. **Live-confirmed: "0 Indexed / 0 Not Indexed / Crawled 0 / Discovered 0"** on a 207-page site — reads as "Google deindexed everything." | Treat `0` as unknown: render "—" when value is `0` (or change server to return `null`, but that ripples to statenourSync.ts:133 — UI-side guard is safer). | **FIX-NOW-safe** |
| staleness / FALSE TELEMETRY | CONFIRMED (live) | SiteHealthSection.tsx:343,344 | INTEGRATIONS grid hardcodes `Instagram Feed status:true` and `AI Content Gen status:true` → always green "Connected" with no probe. Live-confirmed both show "Connected". | Probe real state (IG via `vapi.status`-style check / META_IG_USER_ID presence; AI gen via provider health) OR drop the always-true rows. | FIX-NOW-safe |
| staleness | CONFIRMED (live) | SiteHealthSection.tsx:268-278 | Meta Pixel card is fully static: hardcoded `Pixel ID 1436350367898578`, `Events: Lead, Schedule, Contact`, `CAPI: Needs access token`. Never reflects real pixel/CAPI state. Same class as the statenour "hardcoded fake telemetry rows." | Either wire to real config or label clearly as a static reference card. | OPERATOR-DECISION |
| staleness | CONFIRMED | SiteHealthSection.tsx:251-252 | GSC "Pages discovered / Last read" already correctly hardwired to "—" (wave-143 fix) — GOOD, but sits next to the broken `0` index-coverage panel showing the same data dishonestly. Inconsistent honesty within one page. | Same fix as row 1 makes the page internally consistent. | (covered by row 1) |
| deficit | CONFIRMED | SiteHealthSection.tsx:289,324-329 | Google Reviews block: when `reviews` is undefined shows "Reviews data loading..." with no error/timeout state (unlike the rest of the file which has ErrorState). Soft — `reviews.google` rarely fails. | Add a terminal empty/error state. | DEFER |
| inconsistency | CONFIRMED | SiteHealthSection.tsx:343 | `Instagram Feed` link hardcodes `instagram.com/nicks_tire_euclid` — handle is duplicated from BUSINESS constants elsewhere; drift risk if handle changes. | Source from `BUSINESS`/shared. | DEFER |

---

## IntegrationsSection.tsx — `client/src/pages/admin/IntegrationsSection.tsx`

Tire-search / labor-guide / quick-estimate calculator + a live VendorHealthStrip. Prior wave already fixed the bare-mutation silent failures (onError toasts on calcMargin/updateMarkup/calculateLabor) and the keyboard-accessible job buttons. Solid.

| Dim | Conf | Evidence | Issue | Fix | Class |
|---|---|---|---|---|---|
| correctness | CONFIRMED | IntegrationsSection.tsx:509,516 | "Save Default Markup" input defaults to `customMarkup || "100"` and saves `parseFloat(customMarkup || "100")` — but the calculator's placeholder says "Default (50%)" (line 402). Two different "default markup" numbers (100 vs 50) in one tab. The SAVE writes 100 if untouched. | Reconcile the default-markup source of truth; read the real saved default from server rather than a literal. | OPERATOR-DECISION (money-adjacent) |
| inconsistency | CONFIRMED | IntegrationsSection.tsx:423-427 | Service add-on prices hardcoded in labels ("Mounting ($20/ea)", "TPMS ($35/ea)") — these are also encoded server-side in `calculateMargin`. Drift risk: label says $20, server could use a different number. | Source labels from the same constants the server uses, or fetch. | DEFER |
| deficit | CONFIRMED | IntegrationsSection.tsx:208-213 | `gatewayTire.status` / `popularSizes` queries have no error branch — if Gateway status fails the dot just sits amber with no message. Minor (status dot conveys some signal). | Optional error toast. | DEFER |

---

## SettingsSection.tsx — `client/src/pages/admin/SettingsSection.tsx`

Lean tab host (post sibling 1235→415 decomposition). Hosts Status / ShopDriver HQ / Health / Compliance / Integrations as lazy tabs. Clean.

| Dim | Conf | Evidence | Issue | Fix | Class |
|---|---|---|---|---|---|
| inconsistency | CONFIRMED (live) | SettingsSection.tsx:240-425 | ShopDriver HQ tab renders EVERYTHING inline in one scroll: connection banner + 4 stats + 3 sync buttons + VapiPanel (full receptionist config + last-10 calls) + IgAutopostPanel + AlgProbeBudgetPanel + DeclinedRecoveryPanel + 20-row cron catalog + ALL 39 feature flags. Live page is extremely long. Density is high even for an operator cockpit. | Consider collapsing VAPI/cron-catalog/flags behind disclosures (Phase 4 was already planned per code comments — VapiPanel "relocates to VoiceReceptionistSection in Phase 4"). | DEFER |
| staleness | CONFIRMED | SettingsSection.tsx:308-309, 371-378, 389-395 | Three `wave-181.x · removed ...` comment tombstones (HOW DATA FLOWS / Probe Results / Import History / EstimateEndpointDiagnosticPanel). Harmless but they're dead-comment clutter referencing a "/admin/help (TODO · not built yet)". | Trim tombstone comments; the "/admin/help TODO" is a roadmap leak in code (not UI, so low risk). | DEFER |

---

## SettingsStatusTab.tsx — `client/src/pages/admin/SettingsStatusTab.tsx`

**Model surface.** Live-confirmed: real KPIs, 4 live connection pills (ALG/F25e/VAPI/Funnel green w/ real timestamps), honest "All clear" empty state, and an EXCELLENT live Cron Health panel (real cron_log w/ durations + details). This panel is the proof that the static `cronJobs.ts` catalog elsewhere is redundant.

| Dim | Conf | Evidence | Issue | Fix | Class |
|---|---|---|---|---|---|
| deficit | CONFIRMED | SettingsStatusTab.tsx:354-355 | Cron Health "No cron runs logged in the last 24h" is the only empty state; no error branch if `nickActions.cronHealth` itself throws (would silently show the empty message). Minor. | Add isError handling. | DEFER |
| (positive) | CONFIRMED (live) | — | Live Cron Health correctly surfaced 3 REAL ops issues (not UI bugs): `statenour-live-sync` 404 DEPLOYMENT_NOT_FOUND (stale Vercel URL — statenour is on Railway now), `data-accuracy-check` "2388 invoices missing customer phone", `ig-autopost` 401 image-gen auth. The surface is doing its job. | (these are real backend issues to spin off separately, not surface defects) | note |

---

## ComplianceSection.tsx — `client/src/pages/admin/ComplianceSection.tsx`

**Model surface.** Live-confirmed: real admin-login audit (11 logins, 6 unique IPs, real user-agents), 6 opt-ins / 0 opt-outs, clean empty states, shared `timeAgoShort`, overflow-x-auto mobile fix. No defects found.

| Dim | Conf | Evidence | Issue | Fix | Class |
|---|---|---|---|---|---|
| (clean) | CONFIRMED (live) | — | Nothing to fix. Honest, IP-attributed, proper error/empty/loading states on all 3 tabs. | — | — |

---

## CallTrackingSection.tsx — `client/src/pages/admin/CallTrackingSection.tsx`

Strong. Typed via RouterOutputs (no `any`), confirmDialog (iOS-safe), shared CHART_COLORS, real empty states everywhere.

| Dim | Conf | Evidence | Issue | Fix | Class |
|---|---|---|---|---|---|
| inconsistency | CONFIRMED | CallTrackingSection.tsx:26-33 | Local `TOOLTIP_STYLE` const duplicates the recharts tooltip styling that `CHART_THEME`/shared already provides (same oklch values appear in other chart sections). | Fold into shared chart theme. | DEFER |
| deficit | INFERRED | CallTrackingSection.tsx:344 | "Calls by Page" only renders when `callTracking.byPage` is non-empty; no explicit "no page data" state (other panels have one). Minor. | Optional empty state. | DEFER |

---

## TrafficFunnelSection.tsx — `client/src/pages/admin/TrafficFunnelSection.tsx`

Large but honest. Funnel bars + alerts + GSC queries/pages + branded split + CustomerEvents + Sitemap submit + GSC audit. Real empty states ("No GSC data yet in this window"), real error states, real loading. Good.

| Dim | Conf | Evidence | Issue | Fix | Class |
|---|---|---|---|---|---|
| staleness | CONFIRMED | TrafficFunnelSection.tsx:336-345 | Footer hardcodes operational advice referencing `/api/call-events` + "If dead, fix that first" — developer-facing copy shown to the operator (mild roadmap/jargon leak, CLAUDE.md red-flag class). | Trim or move to a tooltip. | DEFER |
| inconsistency | CONFIRMED | TrafficFunnelSection.tsx:30-35 vs other sections | Local `formatNumber()` helper duplicated (similar formatters in CallTracking/shared). | Consolidate to shared. | DEFER |
| deficit | CONFIRMED | TrafficFunnelSection.tsx:608 | Sitemap status table indexes `s.status?.contents?.[0]` only — if a sitemap reports multiple content blocks, rows 2+ are dropped silently. Edge case (most sitemaps = 1 block). | Aggregate or note "first block". | DEFER |

---

## SnapDashboardSection.tsx — `client/src/pages/admin/SnapDashboardSection.tsx`

Strong. confirmDialog gate on the real $-affecting Snap submit (credit pull), NaN-amount guard, cache invalidation, shared timeAgo, real empty/error/loading states.

| Dim | Conf | Evidence | Issue | Fix | Class |
|---|---|---|---|---|---|
| inconsistency | CONFIRMED | SnapDashboardSection.tsx:24-29 | `STATUS_CONFIG` maps both `declined` and `rejected` to label "DECLINED" — fine, but `pending` is the fallback for ANY unknown status (`statusCfg` line 32), so a novel status (e.g. "submitted"/"expired") silently shows as amber PENDING. | Add an explicit unknown/neutral style. | DEFER |
| (positive) | CONFIRMED | SnapDashboardSection.tsx:55-68 | Honest `r.proxyUsed` branch: "Logged locally (Snap API not configured)" vs real submit — good degradation honesty. | — | — |

---

## today/ subdir — MorningBrief / WaveMetricWins / SlaTimer / types.ts

All live-confirmed rendering correctly on the Overview page. Clarity-gated (WaveMetricWins self-hides when empty; MorningBrief skips the overnight line when no calls).

| Dim | Conf | Evidence | Issue | Fix | Class |
|---|---|---|---|---|---|
| correctness (latent) | CONFIRMED | today/MorningBrief.tsx:39 | Local `formatDollars(d: number)` treats input as DOLLARS. This is the SAME function-name as the cents-based `formatDollars` collision flagged in MEMORY backlog #12 (renamed to `formatCents` in CustomersBrief/LeadsBrief). Here it's correct (revenueThisWeek is already dollars), but the name-collision landmine persists in a 3rd file — copy a cents value in and it's a silent 100× bug. | Use shared `formatDollars` from `./shared/format` (already imported elsewhere) instead of a local re-def. | DEFER |
| staleness | CONFIRMED | today/MorningBrief.tsx:61-73 | Comment + var name say "yesterday's close" but it actually shows week-to-date ("This week:") because `adminDashboard.stats` has no yesterday field. Honest in the UI text, but the leading comment ("Line 1 · YESTERDAY'S CLOSE") contradicts the rendered "This week:". | Align comment with behavior. | DEFER |
| inconsistency | CONFIRMED | today/types.ts:1-9 | Header admits these hand-written interfaces "should derive from RouterOutputs" but don't — they approximate the bundle shape and can drift from the real tRPC contract. | Migrate to `RouterOutputs[...]` when the dashboard settles. | DEFER |

---

## settings/cronJobs.ts + FeatureFlagsPanel.tsx

### cronJobs.ts — `client/src/pages/admin/settings/cronJobs.ts`

| Dim | Conf | Evidence | Issue | Fix | Class |
|---|---|---|---|---|---|
| staleness (structural) | CONFIRMED | cronJobs.ts (whole file) + scheduler.ts | 20-entry STATIC catalog rendered as "Autonomous Operations" with interval labels but **zero run-status** (no last-run, no green/red/fail). Hand-maintained → drift-prone. Verified all 20 names DO map to real scheduler jobs (incl. no-show-detection:1360, stale-booking-cleanup:1367, review-auto-draft:1388 — I initially suspected these as phantom; they're real). So it's accurate TODAY but decoupled from truth and **redundant with the LIVE Cron Health panel** on the Status tab (`nickActions.cronHealth`). | Either bind each row to its real last-run from cron_log, or delete the catalog and link to the Status-tab Cron Health panel. | DEFER (quality) |
| inconsistency | CONFIRMED | cronJobs.ts:8-10 | 3 entries ("ALG On-Login Probe", "ALG Chat-Demand Probe") are probe-budget TRIGGERS, not scheduler cron jobs — mixing two concepts under one "cron" header. Defensible as "autonomous ops" but technically not crons. | Label the section "Automation & probes" or split. | DEFER |

### FeatureFlagsPanel.tsx — `client/src/pages/admin/settings/FeatureFlagsPanel.tsx`

Live-confirmed "37 of 39 enabled", categories SMS/Experience/Admin/Other, engine_* flags gone (sibling migration 0066 applied). Search + filter + risky-tag + confirmDialog gate on flip-ON. Strong.

| Dim | Conf | Evidence | Issue | Fix | Class |
|---|---|---|---|---|---|
| inconsistency | CONFIRMED (live) | FeatureFlagsPanel.tsx:18-34 | `FLAG_CATEGORIES` lists explicit `keys: [...]` arrays that are NEVER used (categorization is by `matchFn` only). Dead data; also means new flags fall to "Other" (live: "OTHER 20/22" is the biggest bucket — many real flags like `gbp_auto_posting`, `email_marketing_campaigns`, `drip_campaigns_enabled` are uncategorized). | Drop the unused `keys` arrays; expand `matchFn` coverage so high-impact flags aren't all dumped in "Other". | DEFER |
| (positive) | CONFIRMED | FeatureFlagsPanel.tsx:125-131 | engine_* prefix guard retained as defense-in-depth even post-migration. Good. | — | — |

---

## Cross-cutting observations

- **Honesty discipline is generally high** on this surface — most "fake telemetry" was already killed in prior waves (SiteHealth wave-143 GSC "—", removed roadmap-leak placeholders in SettingsStatusTab/SettingsSection). The remaining offenders are concentrated: SiteHealth index-coverage `0`-vs-`—` + hardcoded integration statuses.
- **Two honest-by-design surfaces (Status tab Cron Health, Compliance) are the gold standard** — they read real data, show real failures, and degrade honestly. The static cronJobs.ts catalog is the anti-pattern by contrast.
- **No `window.confirm` found** on any audited page — all use `confirmDialog` (iOS-PWA-safe). Good.
- **No crashes / console errors observed** on any live page driven (Overview, SiteHealth, ShopDriver HQ, Status, Compliance).
- **Real backend issues surfaced by the audit (NOT surface defects, spin off separately):** statenour-live-sync 404 (stale Vercel deploy URL), 2388 invoices missing customer phone, ig-autopost 401 image-gen auth.

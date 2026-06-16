# Nickstire Admin Excellence — Audit & Upgrade

**Branch:** `nickstire/admin-excellence` (worktree, off `main` @ b89046dc)
**Date:** 2026-06-02
**Goal:** Reverse-track every admin setting from UI → tRPC → server services → schema/data libs.
Upgrade every sloppy / generic / overwritten / buggy file to professional quality. Zero errors. Verified.

---

## Understanding Summary (Brainstorming Lock — CONFIRMED)

- **What:** Forensic audit + upgrade of the entire nickstire admin surface (~30 `pages/admin/*.tsx`
  sections) and every backend file they reverse-track into (tRPC routers → `server/services/**` →
  `shared/schema` / data libs).
- **Why:** Many settings/files were "poorly written, not done right, over-written, generic or sloppy."
  Live business (Nick's Tire & Auto, Cleveland FCFS shop) — quality + correctness matter.
- **Who:** Operator (Nour) + the live shop. Admin is operator-facing; some settings drive
  customer-facing behavior (prices, SMS, ALG sync, voice receptionist).
- **Constraints:** Live business — no silent behavior change. Parallel session active → worktree isolation.
  pnpm monorepo. Vite app. Must end tsc-0 + tests + build green.
- **Non-goals:** Not redesigning the admin UX from scratch; not touching statenour; not changing
  business behavior (prices/SMS/sync semantics) without explicit sign-off.

## Decisions (Decision Log)

| # | Decision | Alternatives | Why |
|---|----------|--------------|-----|
| D1 | Scope = ENTIRE admin surface + reverse-tracked backend libs | (a) Settings-only deep, (b) UI-only shallow | Operator chose full pass for excellence |
| D2 | Fix code-quality + clear bugs freely; FLAG behavior-changing fixes for sign-off | aggressive / quality-only | Live business safety vs. real-bug correction balance |
| D3 | Worktree isolation → verify green → push to main | review-gate / push-auto | Operator chose push-when-green; no collision w/ parallel session |
| D4 | Defer `pnpm install` until verify phase | install upfront | Audit is read-only; save disk/time |
| D5 | Multi-agent: parallel read-only recon + audit; fixes applied by orchestrator w/ verify-don't-trust | single-thread / agents-edit-freely | Operator subagent policy: same quality bar, read every diff |

## Risk Register

- **R1 — Behavior drift on live settings** (prices $49/$80, SMS sends, ALG sync, VAPI). Mitigation: D2 flag-for-signoff; runtime-behavior fixes isolated + called out explicitly.
- **R2 — Parallel-session collision.** Mitigation: worktree off main; rebase before push; nickstire-only files (sibling is statenour-heavy per recent log).
- **R3 — Agent over-claim / shallow slop.** Mitigation: verify-don't-trust — read every diff, spot-check findings vs files, clarity-gate over-claims.
- **R4 — pnpm worktree build quirks.** Mitigation: install in worktree before verify; watch for nested-build artifacts.

---

## Execution Phases

- [ ] **P0 Setup** — worktree ✅, design doc ✅, tracking ✅
- [ ] **P1 Map** — parallel recon: every admin section → its tRPC procs → server services → schema/data libs. Build dependency map + initial smell list.
- [ ] **P2 Audit** — parallel code-review per cluster: bugs, sloppiness, dead code, overwrites, generic boilerplate. Findings w/ file:line + confidence + behavior-change flag + proposed fix.
- [ ] **P3 Triage** — dedup + rank findings. Split: code-quality fixes (apply) vs behavior-change (flag for signoff).
- [ ] **P4 Fix** — apply fixes (orchestrator reads every diff). Cluster-by-cluster.
- [ ] **P5 Verify** — pnpm install → tsc 0 → vitest → build green (verification-before-completion).
- [ ] **P6 Deliver** — commit, rebase onto latest main, push. Flag behavior-changes for approval.

## Admin Section Inventory (30 sections + subdirs)

CallTracking, Campaigns, CommandCenter, Compliance, Content, Coupons, Customers, DeclinedEstimates,
Dispatch, FollowUps, Integrations, Leads, LoyaltyAdmin, Memberships, OutreachHub, Overview, Revenue,
ReviewRequests, Settings, SettingsStatus, SiteHealth, SmsPerformance, Sms, SnapDashboard, Specials,
TrafficFunnel, VoiceReceptionist, WalkInCalculator, WebVitals, WinBack, WorkOrders
+ subdirs: customers/ leads/ money/ outreach/ today/ voice/ shared/

## Findings Log (P2 audit complete — 5 clusters, verified)

### BATCH 1 — Safe (behavior-change N) → applying without sign-off
| ID | file:line | fix | status |
|----|-----------|-----|--------|
| B1 | ReviewRequestsSection.tsx:207 | due-count: `status==="scheduled"`+`scheduledFor` → `status==="pending"`+`scheduledAt` (always-0 bug; verified vs schema) | pending |
| B2 | customers.ts:500 | exportCsv enum add `"new"` (mismatch w/ list enum → silent export fail) | pending |
| A-loy | LoyaltyAdminSection.tsx:18,76,111,201 | drop phantom `discountValue` (not in schema) | pending |
| A-spec | specials.ts:25 | `(s:any)` → typed row | pending |
| B-dead | customers.ts:739 | delete dead `custIdStr` no-op | pending |
| B-wb | winback.ts:193 | `as any` segment cast → typed | pending |
| C-rail | shopdriver.ts:356 | "Vercel" → "Railway" in operator-facing msg | pending |
| C-toast | CampaignsSection.tsx:144 | add `else toast.error` on `{success:false}` send | pending |
| D-links | voice/format.ts | delete dead `VAPI_LINKS.{callLogs,phoneNumbers,assistants,assistantDetail}` + unused `assistantId` | pending |
| D-rec | DispatchSection.tsx:308 | add error/empty state to tech-recommend panel | pending |
| D-sf | WorkOrdersSection.tsx:735 | type `adminDashboard.stats.shopFloor` (drop inline cast) + dedup stats query | pending |
| E-moji | CommandCenterSection.tsx:277 | fix mojibake comment | pending |
| E-dang | SiteHealthSection.tsx:369 | delete dangling `// COUPONS MANAGEMENT` | pending |
| E-imp | SettingsSection.tsx:1061 | drop redundant dynamic `confirmDialog` import | pending |
| E-time | Compliance/Snap/CommandCenter | consolidate 3× `timeAgo` → shared `formatRelativeDate` | pending |
| E-chart | constants.tsx:50 | trim `CHART_COLORS` off-palette purple/pink/orange | pending |
| E-orph | WebVitalsPanel.tsx | DELETE (zero importers, verified) | pending |
| E-god | SettingsSection.tsx | verbatim-extract 5 panels → admin/settings/* (1235→~250) | pending |

### BATCH 2 — Behavior-change (Y) → REQUIRES operator sign-off (NOT auto-applied)
| ID | file | impact | severity |
|----|------|--------|----------|
| Y1 | gbpContentGenerator.ts | FABRICATED customer names/testimonials/prices posted to Google (FTC risk) | P1 legal |
| Y2 | campaigns.ts | bulk SMS has NO STOP/opt-out footer (TCPA) | P1 compliance |
| Y3 | campaigns.ts | sends not gated on gateway reachability; marks "sent" while queued | P1 send-accuracy |
| Y4 | DispatchSection + voiceAgent.ts | WAIT-STATUS toggle is phantom — receptionist still says "walk in anytime" | P1 operational |
| Y5 | SettingsSection.tsx:321 + autoLabor | "Probe ALG API" button bypasses probe-budget → kicks counter mid-shift | P1 operational |
| Y6 | featureFlags.ts | 19 `engine_*` flags inert (phantom controls) — wire or delete | P1 honesty |
| Y7 | winback.ts:176 | VIP/fleet thresholds in cents (>$5/>$10) misclassify whole base | P2 mis-send |
| Y8 | winback.ts:171 | `tire_customer` segment has no tire signal (claims "you got tires") | P3 honesty |
| Y9 | WalkInCalculatorSection.tsx:34 | oil presets quote ~$82 vs advertised $49 | P2 over-quote |
| Y10 | invoices.ts:179 | `wasPaid` default suppresses paid-event on read-fail | P3 event |
| Y11 | vapi.ts:168 | stale "$35" oil in receptionist kill-list example (prompt text) | P3 cleanup |
| Y12 | CommandCenterSection.tsx | 439-line nav-dead zombie — delete or restore? | P2 decision |
| Y13 | coupons | `maxRedemptions` cap never enforced — wire or remove | P3 |

### Batch 2 — operator decisions (2026-06-02)
- **Y1 GBP fakes → DEFERRED** (deeper look later — do NOT modify gbpContentGenerator this pass).
- **Y4 WAIT toggle + Y6 19 engine_* flags → DELETE BOTH** (after confirming no readers).
- **Y5 ALG probe → ADD confirm-warning gate** (keep raw probe, warn it kicks the counter).
- **Y2 STOP footer · Y3 gateway-gate/queued · Y7 winback $ thresholds (VIP>$2000/fleet>$5000) · Y10 wasPaid · Y11 stale $35 → APPLY.**
- **Y8 / Y9 / Y12 / Y13 → DEFERRED** (not greenlit — no behavior change this pass).

## SHIPPED (2026-06-02)
Both batches verified (tsc 0 · vitest 664 passed · vite build green) and PUSHED to `main`:
- `fc659d65` batch 1 (safe: bug fixes + dedup + SettingsSection 1235->415 decomposition + WebVitalsPanel delete)
- `b0afef15` batch 2 (operator-approved behavior fixes)
Rebased onto sibling's statenour commits (nickstire-only, no conflicts). Railway redeploying nickstire.

### Migration 0066 — APPLIED to prod ✅ (2026-06-02)
`drizzle/0066_drop_engine_flags.sql` applied via
`railway run --service MAINnicks-tire-auto pnpm exec tsx scripts/apply-0066-drop-engine-flags.ts`
→ BEFORE 19 engine_* rows · affectedRows=19 · AFTER 0 · hash recorded. The inert
engine_* flags are gone from the live DB; code no longer seeds them; UI prefix-guard
retained as defense-in-depth.

### Completed follow-ups
- **Y1**: Reworked `gbpContentGenerator.ts` to pull verified reviews via `getRealReviewsFromDb()` and added strict formatting + Jaccard similarity/fabrication assertions (`assertNoFabrication()` / `validateNoUnsourcedCustomerIdentity()`) to prevent mock data leakage.
- **Y8**: Added real tire signal verification via `EXISTS` subqueries across database tables (`invoices`, `tire_orders`, `service_history`) to the `tire_customer` segment, along with text fallback.
- **Y9**: Recalibrated oil presets in `WalkInCalculatorSection.tsx` to set `laborHours: 0` so they compute exactly to $49/$80.
- **Y12**: Deleted the nav-dead `CommandCenterSection.tsx` and retired all code imports.
- **Y13**: Implemented atomic concurrency-safe coupon cap validation and increment logic in `redeemCouponById()` inside `db.ts` and `services.ts`.

# Admin Surface Audit — OUTREACH / SMS group

**Date:** 2026-06-03 · **Stance:** kaizen + clarity-gate (CONFIRMED `<file:line / live-obs>` vs INFERRED)
**Method:** read each `.tsx` → reverse-track tRPC/services/schema → LIVE-drive every tab via Claude-in-Chrome (nickstire.org/admin, authed, own tab).
**Scope:** SmsSection · SmsPerformanceSection · CampaignsSection · FollowUpsSection · WinBackSection · OutreachHubSection · ReviewRequestsSection · outreach/OutreachBrief.
**Live drive confirmed:** all 6 hub tabs render, **0 console errors**. OutreachBrief LIVE ("declined-recovery cron LIVE · 63 customers", "3 customer touches lifetime").

**Already shipped by sibling — NOT re-flagged:** campaigns TCPA "Reply STOP" footer (`withOptOut`) · `processCampaignSends` gateway-reachability gate · ReviewRequests "due now" count fix (`status==="pending"`+`scheduledAt`) · winback VIP/fleet cents thresholds (now 200000/500000c, verified live in `winback.ts:177-189`).

---

## TOP 5 FIXES (ranked by leverage)

1. **[Y8 sharpened] Win-back `tire_customer` segment has ZERO tire signal AND targets the wrong/overlapping pool** — `buildSegmentFilter("tire_customer")` = `lastVisitDate < 90d ago` only. Live confirms it. Message lies "You got tires from us" to non-tire customers. OPERATOR-DECISION.
2. **SmsPerformance double-counts every tagged send** as both its real tier AND "Untagged (pre-181.51)" → "Sent·30d = 6102" and ALL rates are inflated/wrong. CONFIRMED live (same phone+timestamp+body appears twice with two tiers). FIX (needs root-cause trace of the send-logging path).
3. **TCPA opt-out gap on retention / oil-reminder / voice-callback SMS** — these bulk promo texts ship with NO "STOP to opt out" (declined-recovery has it). CONFIRMED live in Recent Sends. The sibling's campaigns fix did not cover these paths. OPERATOR-DECISION (compliance).
4. **Win-back segment counts show "?" for 5 of 7 segments + display/target divergence** — live: Dormant/Lost/Tire/VIP/Fleet = "?", Lapsed shows 0 (default-selected → CREATE disabled on load). The shown count uses `customers.stats` but the actual send uses `buildSegmentFilter` (different source). FIX (`winback.segmentCounts` server route).
5. **`campaigns.ts` writes enum values the `sms_campaigns` table doesn't have** — `pause`→`"paused"`, `cancel`→`"cancelled"` but enum = `["draft","active","completed"]`; `update` writes a non-existent `message` column. Latent crash if ever called (all 4 are UI-unreachable dead mutations). FIX-NOW-safe (delete dead mutations OR widen enum).

---

## SmsSection.tsx (Messages)

Mature surface (wave-129 redo). Code-read thorough; live Messages tab not re-driven (verified working in prior waves, 0-error hub render this pass). Backend = `smsConversations` router (F25e gateway + Twilio fallback). Strong: error state, loading state, optimistic markRead with onError rollback, iOS-safe (no window.confirm).

| Dimension | Status | Evidence | Issue | Proposed fix | Class |
|---|---|---|---|---|---|
| inconsistency | CONFIRMED | `SmsSection.tsx:96-115` vs `shared` | Local `formatTime`/`formatRelative`/`dayKey`/`dayLabel`/`formatPhone`/`initialsFor` are file-private; other pages import `formatDate`/`formatDateTime` from `./shared`. Drift risk (e.g. tz handling). | Hoist the relative-time + phone formatters into `./shared`; SmsPerformance/FollowUps can reuse. | DEFER (cosmetic, low risk) |
| deficit | INFERRED | `SmsSection.tsx:96-100` | `formatTime`/`dayLabel` use `toLocaleTimeString([])` (browser tz), not Cleveland/ET. On an operator device set to another tz, message timestamps shift vs the shop's actual local time. | Pin to `America/New_York` like `reviewRequests.ts:getClevelandHour`. | OPERATOR-DECISION |
| correctness | CONFIRMED | `SmsSection.tsx:229-233` | `handleSend` shows `toast.success("Sent")` then `toast.error("Send failed...")` on `res.success===false`, but `send.mutation.onError` (line 188) ALSO toasts on throw → on a thrown error the operator can see two toasts. Minor double-toast. | Drop the inline try/catch toast OR the onError toast (keep one). | FIX-NOW-safe |

---

## SmsPerformanceSection.tsx (Performance)

Live-driven with full real data. Renders correctly; error banner + empty states present.

| Dimension | Status | Evidence | Issue | Proposed fix | Class |
|---|---|---|---|---|---|
| **staleness / correctness** | **CONFIRMED** | live Recent Sends (Jun 1-3): `···0642 APACHE` 12:15PM, `···1361 Mary`, `···4464 Timothy`, `···5334 Marvin`, `···0081 Mercedes` each appear **twice** — once tagged (e.g. "Declined-recovery · D30") and once "Untagged (pre-181.51)", identical timestamp+body | The same outbound SMS is logged to the perf table **twice** (a generic/untagged write + a tiered write). "Untagged" = 5169 of 6102 sent (85%). Every total + reply%/conv%/opt-out% is inflated and unreliable. | Trace the send-logging path (the tiered cron records its tier; a second generic logger also inserts an untagged row). De-dup at the write site so one send = one row. | FIX (after root-cause trace) |
| inconsistency | CONFIRMED | `SmsPerformanceSection.tsx:88` `grid-cols-4` | Totals row is hard `grid-cols-4` with no breakpoint; on a 375px phone 4 cards ≈ 80px each (cramped). Sibling pages use `grid-cols-2 md:grid-cols-4`. | `grid-cols-2 md:grid-cols-4`. | FIX-NOW-safe |
| deficit | CONFIRMED | `SmsPerformanceSection.tsx:201` | Recent-sends "Phone" column shows only `···{suffix}` (last 4) with no name — on a 50-row list the operator can't tell who got what without cross-referencing. (By-design privacy, but a name/tier-only view would read better.) | Optionally surface `customerName` if the perf row carries it. | DEFER |
| staleness | CONFIRMED | live tier table | Tier keys are inconsistent: `declined_d7`/`declined_d30` (raw keys) sit beside human "Declined-recovery · D7/D30". Two naming generations coexist → the same logical tier may split across rows. | Normalize legacy `declined_dN` keys to the canonical "Declined-recovery · DN" label at read time. | DEFER (telemetry tidiness) |

---

## CampaignsSection.tsx (Campaigns)

Live: clean empty state, stats all 0, 0 console errors. Confirm-gate + STOP footer already shipped.

| Dimension | Status | Evidence | Issue | Proposed fix | Class |
|---|---|---|---|---|---|
| **staleness / correctness** | **CONFIRMED** | `campaigns.ts:302` (`"paused"`), `:322` (`"cancelled"`) vs `schema.ts:1661` enum `["draft","active","completed"]` | Router writes enum values the column does not allow → MySQL strict: "Data truncated for column 'status'"; non-strict: coerces to ''. Also `smsCampaignSends` enum `["pending","sent","failed"]` but `cancel` writes `"cancelled"` to sends (`:325`). | These mutations (`pause`/`resume`/`cancel`/`delete`/`update`) have **no UI caller** in CampaignsSection → delete the dead mutations, OR widen the enum to match winback's `["draft","active","paused","completed"]`. | FIX-NOW-safe |
| staleness | CONFIRMED | `campaigns.ts:343-358` | `update` mutation builds `updates.message` but `sms_campaigns` has no `message` column (only `customMessage`) → silent dropped write / error. Dead (no UI caller). | Delete the dead `update` mutation (or fix to `customMessage`). | FIX-NOW-safe |
| inconsistency | CONFIRMED | `CampaignsSection.tsx:412-418` statusConfig only draft/active/completed | UI cannot render "paused"/"cancelled" (falls back to draft styling). Mirror of the enum confusion above — UI is honest with the SCHEMA but not with what the router writes. | Resolved by deleting the dead router mutations. | FIX-NOW-safe |
| deficit | CONFIRMED | `CampaignsSection.tsx:341-348` | "Send Campaign" button is disabled only on `creating`; if `preview` is empty (operator skipped Preview or 0 targets) it still fires create+send for 0 customers. `confirmDialog` says "Send to 0 customers". | Disable Send when `preview.length === 0`, mirroring WinBack's `!segmentCount` guard. | FIX-NOW-safe |
| inconsistency | CONFIRMED | `CampaignsSection.tsx:172,362` raw `<h3>` headers | Uses bare `<h3>` while sibling pages (FollowUps/WinBack/Reviews/SmsPerformance) use the shared `<PageHeader>`. Visual drift (no icon, different spacing). | Adopt `PageHeader` for consistency. | DEFER (cosmetic) |

---

## FollowUpsSection.tsx (Follow-Ups)

Live-driven with real data: Pending 22, Sent 1, Failed 0. Backend = `followUpsRouter` in `admin.ts:1063` over `customer_notifications`.

| Dimension | Status | Evidence | Issue | Proposed fix | Class |
|---|---|---|---|---|---|
| **deficit** | **CONFIRMED** | live: the 22 PENDING rows appear **again, verbatim** in "RECENT FOLLOW-UPS" | `pending` query (`admin.ts:1068`, status='pending') and `recent` query (`:1076`, ALL statuses, limit 50) overlap when total rows < 50 → operator sees every pending item twice on one screen. | `recent` should exclude `pending` (or label the section "Sent / Failed history"). | FIX-NOW-safe |
| staleness | CONFIRMED | live: 22 PENDING dated Apr 4-22 (now Jun 3) | Follow-ups stuck "pending" ~6 weeks (mostly test rows: Nourdean Rabah / Anthony Zunt repeated). "Pending 22" stat reads as live work but these are abandoned/never-sent. | Add an age cap / "stale" treatment, or a cleanup. Confirm the follow-up cron is draining (it isn't here). | OPERATOR-DECISION |
| correctness | CONFIRMED | `FollowUpsSection.tsx:27-31` STATUS_STYLES has pending/sent/failed only; `admin.ts:1102` cancel writes `"skipped"` | A canceled follow-up (`status="skipped"`) renders with **empty** badge className (unstyled). Not seen live (no skipped rows) but reachable via the cancel button. | Add `skipped: "text-foreground/40 bg-foreground/5"` to STATUS_STYLES. | FIX-NOW-safe |
| robustness | CONFIRMED | `schema.ts:431` enum incl. `"booking_inprogress"`; `FollowUpsSection.tsx:17-25` TYPE_CONFIG has no `booking_inprogress` key | A `booking_inprogress` notification falls back to the "THANK YOU" badge (silently mislabeled). Live "STATUS" badges = legit `status_update` type (NOT a bug). | Add a `booking_inprogress` TYPE_CONFIG entry (or a neutral default label distinct from follow_up). | DEFER (low frequency) |

---

## WinBackSection.tsx (Win-Back)

Live-driven incl. the create view (`?wbView=create`). Confirm-gates on activate/send/resume already shipped.

| Dimension | Status | Evidence | Issue | Proposed fix | Class |
|---|---|---|---|---|---|
| **deficit / correctness** | **CONFIRMED** | live create view: Dormant/Lost/Tire/VIP/Fleet = **"?"**, Lapsed=**0**, Recent=**119** | `customers.stats` (`WinBackSection.tsx:74,132`) only exposes ~4 of 7 segment keys → 5 segments show "?"; operator can't see target size before launching. Default segment (lapsed) shows 0 → CREATE disabled on first load. The TODO at `:71-73` flags this. | Add `winback.segmentCounts` server route returning a real count per segment via `buildSegmentFilter` (the SAME source the send uses). | FIX (server route) |
| **correctness** | **CONFIRMED** | shown count source (`customers.stats`) ≠ actual target source (`winback.ts:buildSegmentFilter`) | The number the operator sees (e.g. Lapsed 0 / Recent 119) is computed differently from the rows that actually get texted on activate → display/target divergence (the count can be wrong in either direction). | Same fix as above — drive the displayed count from `buildSegmentFilter` so preview == reality. | FIX (server route) |
| **staleness / honesty (Y8 sharpened)** | **CONFIRMED** | `winback.ts:171-175` `tire_customer` = `lastVisitDate < d90` + opt-out only; template `:91-92` "You got tires from us — they're due for a rotation" | ZERO tire signal — targets anyone whose last visit > 90d ago (no tire purchase check). Message asserts a tire purchase that may be false. **Also overlaps `lapsed` (90-180d) AND has no lower OR upper bound** → same people get both the lapsed and tire sequences; includes 365d+ lost customers too. | Gate on a real tire signal (tire line items / `alg_estimates` tire SKUs), or retire the segment until a signal exists (like the retired `declined`). | OPERATOR-DECISION |
| staleness | CONFIRMED | `WinBackSection.tsx:36-45` SEGMENT_LABELS + `:127-131` inner labels still list "declined" | `declined` segment was retired (`winback.ts:165`, removed from create enum at `:126`) but the label maps still carry it (dead entries). | Drop `declined` from both label maps. | FIX-NOW-safe |
| deficit | CONFIRMED | `WinBackSection.tsx:392-400` per-step StatCards | `stats.map` renders one StatCard per step with no cap; an 8-step custom campaign overflows the `grid-cols-4` row awkwardly. Minor. | Cap or wrap the per-step stats. | DEFER |

---

## ReviewRequestsSection.tsx (Reviews)

Live: Total 3 / Sent 3 / Clicked 1 / Click Rate 33% / Pending 0 — stats consistent; "due now" fix verified. Largest file in group (757 lines; ProofBank panel is ~200 of them).

| Dimension | Status | Evidence | Issue | Proposed fix | Class |
|---|---|---|---|---|---|
| inconsistency | CONFIRMED | live: header "0 review requests" line above table while stats "Total Requests 3" | `requests?.length` (list query, `:34`) read 0 while `stats.total` (cached 60s, `:33`) read 3. Likely a transient (list fresh vs stats cached) OR a silently-errored list query — list has no isError handling (unlike SmsPerformance/FollowUps). | Add `isError` handling to the `list` query + reconcile loading order; investigate if list can return [] while rows exist. | OPERATOR-DECISION (verify if persistent) |
| inconsistency | CONFIRMED | `ReviewRequestsSection.tsx:175-194` bespoke tab bar vs `OutreachHub`/`WinBack` using shared `TabBar` | Reviews builds its own border-bottom tab bar; other hub pages use the shared `TabBar` component. Visual + behavior drift. | Adopt shared `TabBar`. | DEFER (cosmetic) |
| deficit | CONFIRMED | `:344,363,382` inputs `value={formDelay \|\| settings?.delayMinutes \|\| 120}` | `formX || settings?.x` means typing "0" (falsy) snaps back to the default (e.g. delay 0 → 120). Operator can't set 0. Edge case but a real input bug. | Use `formDelay !== "" ? formDelay : String(settings?.delayMinutes ?? 120)`. | FIX-NOW-safe |
| correctness | CONFIRMED | `:344` `value={formDelay || settings?.delayMinutes || 120}` is an uncontrolled/controlled mix | The input is controlled by a string state but the fallback injects a number from settings before `useEffect` populates the form → brief controlled-value flip warning risk. (useEffect at `:96` mitigates after settings load.) | Initialize form state from settings in the effect only; drop the inline `|| settings?...` fallback. | DEFER |
| staleness | CONFIRMED | ProofBank `copyForGBP` (`:613`) + DESIGN.md Y1 | Proof Bank "Copy for GBP post" feeds the same GBP surface flagged in Y1 (fabricated-content risk). Copying a real review is fine; note the adjacency to the deferred Y1 GBP review. | No change here; keep Y1 review separate. | DEFER (note only) |

---

## OutreachHubSection.tsx + outreach/OutreachBrief.tsx

Live: hub renders all 6 tabs, OutreachBrief shows real queue/live/action lines, 0 console errors. Clean, well-commented composition shell. No defects found.

| Dimension | Status | Evidence | Issue | Proposed fix | Class |
|---|---|---|---|---|---|
| deficit | CONFIRMED | `OutreachBrief.tsx:55-58` 4 queries, no `isError` | If `reviewRequests.stats`/`campaigns.stats`/`declinedRecoveryStatus` error, the loading shimmer (`:77`) persists forever (the `if (!data)` guard can't distinguish error from loading). | Add an error fallthrough so the brief renders a terse "couldn't load" line instead of an infinite shimmer. | DEFER (low risk; queries are cheap/cached) |
| consistency | CONFIRMED (positive) | `OutreachBrief.tsx:96` `showRecoveryBanner = recoveryDryRun && recoveryDollars >= 100` | Live shows the LIVE branch ("cron LIVE · 63 customers"), confirming the dry-run/live toggle works. No action. | — | — |

---

## Cross-cutting notes

- **TCPA opt-out coverage is uneven across send paths** (finding #3). Declined-recovery + campaigns carry "STOP to opt out"; retention (`Retention · D7/D45`), oil/rotation reminders, and voice-callback texts do NOT (CONFIRMED in live Recent Sends). A single shared `withOptOut()` (already exists in `campaigns.ts:45`) applied at every bulk-promo send site would close this. OPERATOR-DECISION (compliance scope).
- **Two "double-logging" smells** (SmsPerformance rows #2, Follow-Ups pending/recent #FU1) both make a count look ~2× reality. Neither is cosmetic — they erode the operator's trust in the numbers.
- **Dead/unreachable router surface:** `campaigns.ts` pause/resume/cancel/delete/update have no UI caller and carry the enum/`message` bugs. Safe to delete (kaizen: delete > maintain).
- **iOS-PWA safety:** all destructive actions use `confirmDialog` (no `window.confirm`) — verified across Campaigns/WinBack/Reviews/FollowUps. No regressions found.

# Project Completion Ledger

Source-grounded truth about what is actually done, partial, or untouched.
Updated 2026-06-10 (late night) against main `a231e449` — after the
11-PR ship (#46-#55 all squash-merged). Every status cites evidence — a
merged PR, a file path, or an explicit operator action. If a row says
UNKNOWN, nobody has verified it; do not treat it as done.

**Status tags:** DONE_MERGED · PARTIAL · NOT_STARTED ·
UNKNOWN_NEEDS_VERIFICATION · MANUAL_OWNER_TASK ·
BLOCKED_BY_EXTERNAL_ACCESS · REQUIRES_APPROVAL ·
DANGEROUS_DO_NOT_AUTOMATE_YET

---

## Nick's Tire

| Item | Status | Evidence | Done / Missing | Risk | Next action | Code now? | Owner? |
|---|---|---|---|---|---|---|---|
| Live online tire checkout hardening | DONE_MERGED | PR #42 `a3cfcaf5`; deploy live-verified (admin tab, banners, bundle copy) | Durable dedup, collision retry, Sheets sync revival, Telegram per order, cancel-refund alerts, 38 tests / — | low | watch first paid order | — | no |
| Tire Commerce Command Center | DONE_MERGED | PR #41 `5e4acc05`; `admin/TireOrdersSection.tsx`, `shared/tireCommerce.ts` | Confidence/risk/timeline cockpit / lacked protection banners (see next row) | low | merge #46 | — | no |
| Tire Orders cockpit consolidation | DONE_MERGED | PR #46 → main `c06f7dbe` (2026-06-10 22:18Z) | One cockpit, banners ported, redirects / — | low | post-deploy phone smoke | — | no |
| `/tires` conversion upgrade | DONE_MERGED | PR #44 `06009312` | Conversion UX, preserved #42 honesty / size-duplication regression (next row) | med | fix search-size duplication | yes (#43 owner: Antigravity) | no |
| `/tires` claim-safety cleanup | DONE_MERGED | PR #45 `21d02cf6` + docs `11c5e6cb` | Claim tightening / — | low | — | — | no |
| `/tires` search size-duplication bug | NOT_STARTED (regression) | Live QA 2026-06-10: input self-concatenates ("215/60R16215/60R16") → cache miss → silently degrades to catalog estimates | — / fix in TireFinder | med | Antigravity's file (PR #43 open — avoid collision) | yes, by #43 owner | no |
| Google Sheets Tire Orders tab setup | DONE (operator-verified) | Operator-approved live edit 2026-06-10; Drive re-read confirmed exact 24 headers, tab `Tire Orders`, 0 data rows | Tab + canonical headers live / first synced row not yet observed | low | watch first order row | — | done |
| Refund/writeback automation | REQUIRES_APPROVAL / DANGEROUS_DO_NOT_AUTOMATE_YET | No `stripe.refunds` call anywhere (verified by grep); manual workflow surfaced in cockpit banners (#42/#46) | Manual path + warnings / execution, writeback, idempotency, audit trail | **high (live money)** | owner approves design (`apps/nickstire/docs/refund-writeback-design.md`, ops-hub PR) | design only | **yes** |
| D&K / Gateway live availability repair | BLOCKED_BY_EXTERNAL_ACCESS | TireFinder.tsx comment: D&K migrated B2B portal to static SPA 2026, old auth endpoint gone; `gatewayClient.ts` has token+quicksearch only | Pipeline cache WORKS (live QA: 205/55R16 → 15 real D&K tires); live order-time recheck impossible / new D&K API creds+docs | high | owner: get current API docs/credentials from D&K rep | health surface only | **yes** |
| Customer confirmation SMS/email | NOT_STARTED (code), templates drafted | No order-confirmation send exists (notifications audit, 2026-06-10); SMS infra exists for other flows (F25e) | — / preview templates + send-disabled module (ops-hub PR adds preview-only module) | high (spam/cost) | owner approves provider+copy before any send | preview only | **yes** |
| IG/FB autoposter | PARTIAL (now self-reporting) | `server/services/igAutopost.ts` + the #50/#53 armed-state card (dry-run, env token, durable `app_secret_kv` token, IG user id, derived couldPostLiveNow) | Armed-state visible in Admin → Growth / prod card not yet read; igAutopost.ts:683 still quotes "$60 used" (price-channel decision open) | med | read the armed-state card post-deploy; resolve price-channel decision | — | yes |
| GBP post automation | PARTIAL | `server/services/gbpAutoPost.ts`, `gbpContentGenerator.ts` | Generator + poster code exists / enablement, post verification, live-state unverified | med | verify env/flags; add post-verification checklist (ops-hub docs) | verify | yes |
| GBP review responses | DONE_MERGED (copy-only by design) | Monitor cron + `reviewReplies` router existed; #53 added the Admin → Growth → Review Replies surface; **#57 `722934c7` closed the loop** (markPosted owner confirmation + oldestApprovedAt rot signal + backlog banner); **#58 (open, stacked on #57)** adds the claim-safety QA gate + in-DOM draft editing + worst-rating-first ordering | Verified: NO code path posts a reply to Google — owner pastes in the GBP app, then taps Mark posted (DB-only) / true auto-posting deliberately not built | low (was med-high — auto-post risk eliminated by design) | merge #58, then owner works draft→approve→paste→Mark-posted weekly | review #58 | **yes (pasting)** |
| GBP Q&A seeds · photo queue · entity tracker · competitor monitor · rank-keyword model | DONE_MERGED (copy/manual by design) | PR #50 → `aaa26010` (libs + read-only `localGrowth` router + GSC alias fix) + PR #53 → `02d907bb` (admin Growth section, 7 tabs) | All five systems operator-usable in Admin → Growth; ranks stay null until measured / review keyword miner + "Women Trust This Shop" pillar still NOT_STARTED | low | owner posts the 17 Q&A seeds (~15 min) + weekly photo queue | — | **yes (manual posting)** |
| IG Carousel + Faceless Reel studios | DONE_MERGED (draft-only) | #51 `e0750dbc` + #52 `f1ba38bd` (studios) · #54 `fc023204` (routes + topbar links) · #55 `a231e449` (Growth tile) | `/admin/ig-studio` + `/admin/reel-studio` live; generation/publish/insights kill-switches OFF by design / future gated enablement waves | low | use for next week's content | — | posting manual |
| Automation armed-state + reviews/Place-ID health visibility | DONE_MERGED | #50 router (`automationArmedState`, `reviewsHealth`) + #53 Local Growth tab cards | Booleans-only live cards (incl. durable `app_secret_kv` token gotcha) / — | low | owner reads the card instead of guessing env state | — | no |
| Master command center / CEO dashboard | DONE_MERGED | PR #47 → `09313101`: Ops Hub (owner-action registry + reports + message previews) joins Today/Money/cockpit | Single owner-tasks + danger-zone truth view live / — | low | use it; update registry in the same PR that changes an item's truth | — | no |
| OpenWeb/OpenWeb-style interface · custom reports · report viewer | DONE_MERGED (registry form) | PR #47 Reports tab (registry-backed doc corpus with paths) | Report hub live / docs render as paths, not inline viewer (deliberate) | low | — | — | no |
| Website audit cleanup | PARTIAL | Frontface audit 3 waves shipped 2026-06-03 (`docs/frontface-audit/`); warranty/founding/pricing fixed | Major truth fixes done / `/emissions` desc-length warn; phone/SMS/voice "$60 used" channel decision; chrome/PageLayout + hex-hygiene items open | med | status doc in ops-hub PR; owner price decision | partial | yes |
| Google Reviews API / Place ID reliability | PARTIAL (surface live, prod read pending) | `localGrowth.reviewsHealth` (#50) + Growth tab card (#53) report key-presence + live-reachability + fallback honestly | Health card live / nobody has READ it against prod yet | low | open Admin → Growth → Local Growth on the deployed site — the card answers this row | — | 1-min check |
| Building Blue redesign | UNKNOWN_NEEDS_VERIFICATION | No branch/doc named "Building Blue" found in repo | Unclear what this refers to / definition | ? | owner: define or drop the item | no | yes |
| Repo/runtime/CI/governance hardening | PARTIAL | `.github/workflows` (affected build, used by PR CI), husky pre-commit/pre-push chains, PROTECTED-CORE.md | Strong local gates + CI / coverage excludes money-path files; STRIPE_WEBHOOK_SECRET not in env-validate required keys | med | add env-validate warn + coverage include (separate PR) | yes | no |
| Credential rotation | MANUAL_OWNER_TASK | [CREDENTIAL_ROTATION.md](file:///C:/Users/nourd/NOURCITY/docs/operator/CREDENTIAL_ROTATION.md) | Zero-downtime runbook prepared for all 15 leaked keys / Actual key rotations pending owner execution | high | owner: rotate keys manually using runbook when ready | — | **yes** |
| Brand/entity cleanup (external NAP) | MANUAL_OWNER_TASK | No automation possible without platform logins | — / every external listing | med | owner checklist (`apps/nickstire/docs/entity-cleanup-checklist.md`, ops-hub PR) | checklist only | **yes** |

## STATENOUR

| Item | Status | Evidence | Done / Missing | Risk | Next action | Code now? | Owner? |
|---|---|---|---|---|---|---|---|
| Proactive intelligence preview console | DONE_MERGED | PR #40 `ce5f7f67`: `/system/proactive-preview` page + API route + tests | Preview console live / — | low | use it | — | no |
| Deeper journal upgrades (spec A–G) | DONE_MERGED | Journey Engine wave A–G shipped 2026-06-10 (main `9184c714`+`fb851113`); journal-advancement spec marked FULLY EXECUTED in session memory | Spec items A–G / — | low | — | — | no |
| Journal intelligence feed into broader STATENOUR | PARTIAL | Journey Engine + morning-brief producer + proof-stack (`b98a85ba`) | Feeds exist / insights-preview panel (theme/action extraction) not built | med | audit-first, small preview panel as separate PR (not in this pass) | later | review |
| Push preview / dry-run safety | DONE_MERGED | #40 preview console; HOLD flags operator-only | Preview before push / — | low | — | — | no |
| Report/insight viewer | PARTIAL | `/system/digest` 3 read-only cards; `docs/audits/*` | System digest exists / no doc-corpus viewer | low | out of scope this pass (nickstire hub first) | later | no |
| OpenWeb-style UI | NOT_STARTED | No evidence | — | low | only if operator wants it | later | yes |

---

## Reading this ledger

- **DONE_MERGED** rows cite a merge commit — re-verify only if behavior
  contradicts.
- **PARTIAL** rows name exactly what's missing; don't reopen the done part.
- The four **owner-gated** rows (refunds, D&K credentials, customer
  messaging enablement, entity cleanup) cannot move without you — every
  other open row has a safe code path.
- Maintained by hand; update it in the same PR that changes an item's truth.

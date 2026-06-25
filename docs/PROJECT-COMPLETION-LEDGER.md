# Project Completion Ledger

Source-grounded truth about what is actually done, partial, or untouched.
Updated 2026-06-23 against main `7428dc88` — after the
#262–#300 sprint (CSP nonce, schema purge, 4 integration slices,
Obsidian bridge, Command Center, social pipeline, GBP publisher,
Remotion reel engine, 90-branch prune). Every status cites evidence — a
merged PR, a file path, or an explicit operator action. If a row says
UNKNOWN, nobody has verified it; do not treat it as done.

**Status tags:** DONE_MERGED · PARTIAL · NOT_STARTED ·
UNKNOWN_NEEDS_VERIFICATION · MANUAL_OWNER_TASK ·
BLOCKED_BY_EXTERNAL_ACCESS · REQUIRES_APPROVAL ·
DANGEROUS_DO_NOT_AUTOMATE_YET

---

## Monorepo (Root)

| Item | Status | Evidence | Done / Missing | Risk | Next action | Code now? | Owner? |
|---|---|---|---|---|---|---|---|
| Monorepo Modernization Wave | DONE_MERGED | PR TBD `chore/monorepo-modernization-wave` | `pnpm` catalogs implemented, Husky replaced with `lefthook` (with app isolation), and all tests/verifications fixed and passing / — | low | — | — | no |

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
| GBP post automation | DONE_MERGED | PR #299 `572464fc`; GBP publisher + unified command center queue dashboard | Publisher + queue dashboard live / enablement flag off by default | med | verify env/flags; flip enablement when ready | — | yes |
| Rate-limiter IPv6 normalization | DONE_MERGED | PR #277 `2a9897de` + PR #278 `d2fb8875` | IPv6 keyGenerator normalized + dead duplicate rate-limiter removed / — | low | — | — | no |
| Reel pipeline tooling | DONE_MERGED | PR #279 `7c92d572` + PR #291 `1eebcd1f` + PR #300 `39e90c09` | Reel pipeline curated + TS type fixes + Phase 4 Remotion Reel Engine integration / — | low | — | — | no |
| Social assets static render pipeline | DONE_MERGED | PR #298 `5f99727d` | Phase 1 static render pipeline for social assets / — | low | — | — | no |
| GBP review responses | DONE_MERGED (copy-only by design) | Monitor cron + `reviewReplies` router existed; #53 added the Admin → Growth → Review Replies surface; **#57 `722934c7` closed the loop** (markPosted owner confirmation + oldestApprovedAt rot signal + backlog banner); **#58 (open, stacked on #57)** adds the claim-safety QA gate + in-DOM draft editing + worst-rating-first ordering | Verified: NO code path posts a reply to Google — owner pastes in the GBP app, then taps Mark posted (DB-only) / true auto-posting deliberately not built | low (was med-high — auto-post risk eliminated by design) | merge #58, then owner works draft→approve→paste→Mark-posted weekly | review #58 | **yes (pasting)** |
| GBP Q&A seeds · photo queue · entity tracker · competitor monitor · rank-keyword model | DONE_MERGED (copy/manual by design) | PR #50 → `aaa26010` (libs + read-only `localGrowth` router + GSC alias fix) + PR #53 → `02d907bb` (admin Growth section, 7 tabs) | All five systems operator-usable in Admin → Growth; ranks stay null until measured / review keyword miner + "Women Trust This Shop" pillar still NOT_STARTED | low | owner posts the 17 Q&A seeds (~15 min) + weekly photo queue | — | **yes (manual posting)** |
| IG Carousel + Faceless Reel studios | DONE_MERGED (draft-only) | #51 `e0750dbc` + #52 `f1ba38bd` (studios) · #54 `fc023204` (routes + topbar links) · #55 `a231e449` (Growth tile) | `/admin/ig-studio` + `/admin/reel-studio` live; generation/publish/insights kill-switches OFF by design / future gated enablement waves | low | use for next week's content | — | posting manual |
| Automation armed-state + reviews/Place-ID health visibility | DONE_MERGED | #50 router (`automationArmedState`, `reviewsHealth`) + #53 Local Growth tab cards | Booleans-only live cards (incl. durable `app_secret_kv` token gotcha) / — | low | owner reads the card instead of guessing env state | — | no |
| Master command center / CEO dashboard | DONE_MERGED | PR #47 → `09313101`: Ops Hub (owner-action registry + reports + message previews) joins Today/Money/cockpit | Single owner-tasks + danger-zone truth view live / — | low | use it; update registry in the same PR that changes an item's truth | — | no |
| OpenWeb/OpenWeb-style interface · custom reports · report viewer | DONE_MERGED (registry form) | PR #47 Reports tab (registry-backed doc corpus with paths) | Report hub live / docs render as paths, not inline viewer (deliberate) | low | — | — | no |
| Website audit cleanup | PARTIAL | Frontface audit 3 waves shipped 2026-06-03 (`docs/frontface-audit/`); warranty/founding/pricing fixed | Major truth fixes done / `/emissions` desc-length warn; phone/SMS/voice "$60 used" channel decision; chrome/PageLayout + hex-hygiene items open | med | status doc in ops-hub PR; owner price decision | partial | yes |
| Google Reviews API / Place ID reliability | PARTIAL (surface live, prod read pending) | `localGrowth.reviewsHealth` (#50) + Growth tab card (#53) report key-presence + live-reachability + fallback honestly | Health card live / nobody has READ it against prod yet | low | open Admin → Growth → Local Growth on the deployed site — the card answers this row | — | 1-min check |
| Low-CTR SEO Page Optimizations | DONE_MERGED | PR #152; `ReviewsPage.tsx`, `SpecialsPage.tsx`, `Financing.tsx`, `TireFinder.tsx` | Rewrote title tags and meta descriptions for low-CTR pages to optimize search click-through rate | low | — | — | no |
| Building Blue redesign | UNKNOWN_NEEDS_VERIFICATION | No branch/doc named "Building Blue" found in repo | Unclear what this refers to / definition | ? | owner: define or drop the item | no | yes |
| Repo/runtime/CI/governance hardening | DONE_MERGED | PR #69 + PR #294 `03fa4b07` + PR #297 `bd4b3df1` + `7428dc88` | ESLint flat-config scoping fix + governance hardening + vitest coverage-v8; strong local gates + CI / — | low | — | — | no |
| Vitest test suite greenup | DONE_MERGED | PR #69 (`43e420c9`) + `7428dc88` (coverage-v8) | All pre-existing test failures fixed; vitest coverage-v8 configured | low | — | — | no |
| Credential rotation | MANUAL_OWNER_TASK | [CREDENTIAL_ROTATION.md](file:///C:/Users/nourd/NOURCITY/docs/operator/CREDENTIAL_ROTATION.md) | Zero-downtime runbook prepared for all 15 leaked keys / Actual key rotations pending owner execution | high | owner: rotate keys manually using runbook when ready | — | **yes** |
| Brand/entity cleanup (external NAP) | MANUAL_OWNER_TASK | No automation possible without platform logins | — / every external listing | med | owner checklist (`apps/nickstire/docs/entity-cleanup-checklist.md`, ops-hub PR) | checklist only | **yes** |

## STATENOUR

| Item | Status | Evidence | Done / Missing | Risk | Next action | Code now? | Owner? |
|---|---|---|---|---|---|---|---|
| Proactive intelligence preview console | DONE_MERGED | PR #40 `ce5f7f67`: `/system/proactive-preview` page + API route + tests | Preview console live / — | low | use it | — | no |
| Deeper journal upgrades (spec A–G) | DONE_MERGED | Journey Engine wave A–G shipped 2026-06-10 (main `9184c714`+`fb851113`); journal-advancement spec marked FULLY EXECUTED in session memory | Spec items A–G / — | low | — | — | no |
| Journal intelligence feed into broader STATENOUR | PARTIAL | Journey Engine + morning-brief producer + proof-stack (`b98a85ba`) | Feeds exist / insights-preview panel (theme/action extraction) not built | med | audit-first, small preview panel as separate PR (not in this pass) | later | review |
| Push preview / dry-run safety | DONE_MERGED | #40 preview console; HOLD flags operator-only | Preview before push / — | low | — | — | no |
| UI/UX Wow Pass character sheet layout | DONE_MERGED | PR #66 (`401c19a5`) | Restores nextRep leveling algorithm on RPG sheet, fixes safety script line-endings and contract test timeout | low | — | — | no |
| Report/insight viewer | PARTIAL | `/system/digest` 3 read-only cards; `docs/audits/*` | System digest exists / no doc-corpus viewer | low | out of scope this pass (nickstire hub first) | later | no |
| OpenWeb-style UI | NOT_STARTED | No evidence | — | low | only if operator wants it | later | yes |
| Gap 5 — Semantic Memory Deduplication | DONE_MERGED | PR #79 (bcb5f64c); `save.ts` + `brain-save.test.ts` | pgvector cosine distance < 0.05 and JS fallback similarity > 0.95 deduplication; 18 tests passing / — | low | — | — | no |
| Gap 6 — Outcomes and Predictions | DONE_MERGED | PR #79 (bcb5f64c); `task-actions.ts` + REST/tRPC routes + `task-actions-cascade.test.ts` | Shared runtime validation parity (outcomeScore 1-100, completionNote limit); calibration tests passing / — | low | — | — | no |
| Gap 7 — Business Data Island | DONE_MERGED | PR #79 (bcb5f64c); `businessData.ts` + Nick's Tire query handlers | Drizzle-based query handlers and Statenour shims mapping; 12 tests passing / — | low | — | — | no |
| Clarity Gate Operations Runbooks | DONE_MERGED | PR #79 (bcb5f64c); `DB_BACKUPS_CLEANUP.md`, `META_TOKEN_RENEWAL.md`, `CALIBRATION_TODO.md` | YAML frontmatter, verified hashes, and clear owner approval hitl-claims / — | low | — | — | no |
| Honesty Enforcement (canClaimDone) | DONE_MERGED | PR #152; `persist-assistant-turn.ts` | Intercepts SDK tool failures synchronously and deferred background task failures asynchronously to rewrite claim messages | low | — | — | no |
| Journal-to-Action Seam | DONE_MERGED | PR #152; `journal.ts` | Implements `promoteNextAction` mutation with single-execution idempotency | low | — | — | no |
| Task Inbox Triage Flow | DONE_MERGED | PR #152; `task.ts`, `inbox-tasks-triage.tsx`, `page.tsx` | Implements `triage` mutation + iOS PWA two-tap confirm triage UI card | low | — | — | no |
| Google OAuth Diagnostics | DONE_MERGED | PR #152; `google-oauth-diagnostics.ts`, `google-oauth-reauth.md` | Multi-account diagnostics CLI script + operations runbook | low | — | — | no |
| Cockpit Upgrade | DONE_MERGED | branch `statenour/cockpit-upgrade` | Operator-grade cockpit UI (SSE streaming, approval gate intercept, contradiction inspector, durable workflows, telemetry dashboard) | low | — | — | no |
| CSP Nonce Hardening | DONE_MERGED | PR #262 `c3fdf551` + PR #268–#269 | Per-request nonce, force-dynamic at root+mastery layouts, skip link added | low | — | — | no |
| Schema Purge (13 models + 1 enum) | DONE_MERGED | PR #267 `17ece313` + `7a4b2706` | 13 unused Prisma models + 1 dead enum dropped; dead references stubbed | low | — | — | no |
| 22 Legacy REST Routes Deleted | DONE_MERGED | `51dac1b3` + `c5336da8` | Routes superseded by tRPC; dead exports pruned | low | — | — | no |
| De-Venice Residual Cleanup (WP-0) | DONE_MERGED | PR #265 `57ea56fe` | Venice residual removed + drift guard | low | — | — | no |
| AI Provider Registry (WP-1) | DONE_MERGED | PR #266 `0dd14884` | Formalized Venice/Ollama/Anthropic provider chain | low | — | — | no |
| Inert Browser Tools Parking | DONE_MERGED | PR #270 `84eabd62` | Marked inert browser tools as parked, not missing-setup | low | — | — | no |
| Spiritual→Mind Domain Merge | DONE_MERGED | PR #271 `95ea58dc` | Spiritual domain merged to Mind; Krueger Home Upgrades dissolved | low | — | — | no |
| Deep Reasoning Tool Access | DONE_MERGED | PR #272 `80eb2615` | `runToolGather()` step in reasoning engine; 16 read-only tools whitelisted; gated by `NICK_DEEP_REASONING` flag | low | — | — | no |
| Firecrawl Web-Context Tool | DONE_MERGED | PR #273 `081732b4` | `scrapeWebPage` tool with SSRF defense + content fencing; graceful degradation | low | set `FIRECRAWL_API_KEY` on Railway | — | no |
| Supply-Chain Security Scan | DONE_MERGED | PR #274 `ea9fc3e1` | `scripts/security-scan.ps1` wraps `pnpm audit` with structured JSON reporting | low | — | — | no |
| Codebase Memory MCP | DONE_MERGED | PR #273 `081732b4` | MCP filesystem server startup script + docs | low | — | — | no |
| AGENTS.md Integration Docs | DONE_MERGED | PR #275 `4308dd89` | All 4 integration slices documented in AGENTS.md | low | — | — | no |
| Machiavellian Power Dynamics | DONE_MERGED | PR #276 `a2771003` | Phases 0-5 power dynamics integration | low | — | — | no |
| Gemini Model Correction + Telemetry | DONE_MERGED | PR #280 `199db3ca` + PR #281 `c71f1552` | Correct flagship model name + harden telemetry + optimize chat routing latency | low | — | — | no |
| Nour Command Center + Brain Graph | DONE_MERGED | PR #282 `c8ef4033` + PR #283 `fed68dbb` | Fullscreen live brain graph + API envelope unwrap fix | low | — | — | no |
| Statenour-Obsidian Integration | DONE_MERGED | PR #284–#287 (`b4867933`→`410a4955`) | Obsidian bridge upgrade + cockpit plugins + cockpit hardening + headless engine layer | low | — | — | no |
| Research Lab | DONE_MERGED | PR #288 `adf42a26` | Research Lab with extensive safety guardrails | low | — | — | no |
| Social Studio Memory Layer | DONE_MERGED | PR #289 `1a365b53` | DB-backed memory layer + review grounding for Carousel & Reel Studios | low | — | — | no |
| System Audit Seams 2/3/4 | DONE_MERGED | PR #290 `dfa0e202` | System audit points for Seams 2, 3, and 4 | low | — | — | no |
| Tailwind v4 Migration | DONE_MERGED | PR #292 `892296d5` | Migrate TW v4 classes + fix redundant select class | low | — | — | no |
| apiHandler Envelope Fix | DONE_MERGED | PR #293 `c64a3909` | Fix client-side crashes from Next.js apiHandler envelope wrapping on status widgets | low | — | — | no |
| Cloudflare Tunnel Setup | DONE_MERGED | PR #295 `a09bddb1` + PR #296 `19d4b69c` | Named tunnel script + local cloudflared.exe fallback in batch scripts | low | — | — | no |

---

## Reading this ledger

- **DONE_MERGED** rows cite a merge commit — re-verify only if behavior
  contradicts.
- **PARTIAL** rows name exactly what's missing; don't reopen the done part.
- The four **owner-gated** rows (refunds, D&K credentials, customer
  messaging enablement, entity cleanup) cannot move without you — every
  other open row has a safe code path.
- Maintained by hand; update it in the same PR that changes an item's truth.

# Endpoint Hygiene — statenour-os

> **v10.0.529.106 Wave 75 status note**: the original 2026-04-20
> mapping has drifted as new surfaces shipped (Wave 65 cockpit · Wave
> 67 /api/people · Wave 72 identity-projection · Wave 66/68/69
> proactive-push endpoints). The PRINCIPLES below still hold (call
> primary surfaces, not helpers · cached endpoints stay cached) but
> specific route lists need a refresh pass. Treat as a guide, not a
> live ledger.

Living map of which API routes are the **primary surface** vs which
are **internal helpers** that the primary surface composes. Built
during the 2026-04-20 v10.3 audit to kill the "which endpoint do I
hit?" confusion + deduplicate work.

Rule of thumb: **never call an internal-helper endpoint from the UI
when a primary surface endpoint exposes the same data composed
better.** The primary endpoints are cached — calling helpers
directly bypasses the cache and wastes work.

---

## HQ / Ultron surface

| Surface | Endpoint | Status | Replaces |
|---------|----------|--------|----------|
| **Situation card** (unified) | `GET /api/ultron/situation` | ✅ PRIMARY — 120s cached | NarratorStrip, BetDesk, BrainCarousel, MemoryCalibrationCard, RuminationCard, TomorrowNoteCard, ReflectNudge |
| Pulse ticker | `GET /api/ultron/ticker` | ✅ primary for top-of-page ticker | — |
| Pulse digest | `GET /api/ultron/pulse-digest` | internal, called by ticker | — |
| Personal pulse | `GET /api/ultron/personal-pulse` | internal | — |
| Todo desk | `GET /api/ultron/todo-desk` | primary for TodayZone | — |
| Time ghost | `GET /api/ultron/time-ghost` | primary for day-view time blocks | — |
| Work context | `GET /api/ultron/work-context` | primary for builder sandbox | — |
| Plan | `GET /api/ultron/plan` | primary for plan mode | — |
| Error patterns | `GET /api/ultron/error-patterns` | primary for debugging surface | — |

### Retired / folded into situation
These endpoints still exist because internal code + older surfaces
may still call them. The HQ UI no longer consumes them directly.

- `GET /api/ultron/signal` — was the base aggregator. **Now subsumed by `/api/ultron/situation`**, which invokes `detectBlindSpots()` etc directly. Remove reference from Ultron client-cache after it verifies no consumers.
- `GET /api/ultron/narrator` — folded into situation. Kept for potential future dedicated narrator surface (e.g. bedside mode), but not the default render.
- `GET /api/ultron/calibrate` — folded. The GET (fetch aging samples) is now only called by `/api/cron/auto-calibrate`. The PATCH (verify/update/retire) is still the primary mutation endpoint if a user-initiated ritual ever comes back.
- `GET /api/ultron/ruminations` — folded. Count is exposed on situation.counts.openRuminations.
- `GET /api/ultron/tomorrow-note` — folded. Surfaces as autoResolved on situation when produced.

---

## Chat surface

| Surface | Endpoint | Status |
|---------|----------|--------|
| **Stream** | `POST /api/ai/chat` | ✅ PRIMARY streaming |
| Prompt cache warmup | `POST /api/ai/chat/prefetch` | primary (typing + idle) |
| Idle warmup | (same route) | primary (from /brain, /command) |
| Smart replies | `POST /api/ai/chat/suggestions` | ✅ PRIMARY |
| Smart replies stats | `GET /api/ai/chat/suggestions/stats` | telemetry (brain panel) |
| **Lane correction chip** | `POST /api/ai/chat/lane-check` | ✅ PRIMARY per-reply |
| History search | `GET /api/chat/search` | primary for Cmd+F |
| Export | `GET /api/chat/export/[id]` | primary for download |
| Diagnose | `POST /api/ai/diagnose-chat` | primary for Diagnose-with-Nick |

---

## Brain surface

| Surface | Endpoint | Status |
|---------|----------|--------|
| **Pinned context** | `GET/POST/PATCH/DELETE /api/brain/pinned` | ✅ PRIMARY |
| Memories (all) | `GET/POST/PATCH /api/brain/memories` | primary for non-pinned CRUD |
| Brain status | `GET /api/brain/status` | primary for maturity header |
| Graph explorer | `GET /api/brain/graph-neighborhood` | primary for memory graph |
| Ghost predict | `GET /api/brain/ghost-predict` | primary for ghost strip |
| Maturity | `GET /api/brain/maturity` | primary |
| Nudges | `GET /api/brain/nudges` | primary for nudge panel |
| Tools | `GET /api/brain/tools` | primary for tool telemetry |
| Analyze | `POST /api/brain/analyze` | primary one-shot analysis |
| Export | `GET /api/brain/export` | primary brain dump |
| Reset | `POST /api/brain/reset` | admin only |
| Page visit | `POST /api/brain/page-visit` | internal tracker |

---

## Cron schedule (all under `/api/cron/*`)

| Cron | Schedule | Purpose |
|------|----------|---------|
| brain-cycle | hourly | Brain decay + consolidation |
| consolidate | nightly | Memory consolidation (sleep model) |
| **auto-calibrate** | `30 2 * * *` | Belief recalibration — replaces manual Calibrate Memory START |
| daily-report | morning | Yesterday recap |
| distill-sessions | nightly | Chat pattern distiller |
| reflect | nightly | Auto-reflect across day |
| **pin-hygiene** | `0 6 * * 0` | Sunday morning stale-pin nudge |
| knowledge-sync | every 6h | Drive/Gmail/Calendar ingest |
| ingest-gmail | 8am+8pm | Gmail pull |
| ingest-calendar | 8:15am | Calendar pull |
| ingest-drive | Sun+Wed 2:30am | Drive pull |
| refresh-identity | 4:30am | Identity axis recompute |
| auto-linker | continuous | Link brain memories |
| error-patterns | continuous | Aggregate error signal |

---

## Purification principles

1. **One surface → one endpoint.** If you need signal, hit the
   unified aggregator (e.g. `/api/ultron/situation`), not its
   internal helpers. Helpers exist for isolation / testing / other
   surfaces, not for redundant UI calls.

2. **Cache at the aggregator layer.** The 120s cache on
   `/api/ultron/situation` covers all 7 underlying streams.
   Duplicating the Prisma queries from the UI bypasses this and
   ends up hitting the DB 5× per page load.

3. **Manual rituals are a smell.** If a card has a "START" button
   for something the system could auto-run, that's a cron waiting
   to be written. `/api/cron/auto-calibrate` replaced the
   Calibrate-Memory-START.

4. **Shared cache keys.** When the UI + a cron + a tool all need
   the same data, put them behind a cached helper (see
   `lib/utils/cache.ts`). Don't let each surface build its own
   Prisma pipeline.

5. **Error codes.** Every non-2xx response carries
   `{ error, code }` with a stable `code` string (e.g.
   `SITUATION_BUILD_FAILED`, `PIN_WRITE_FAILED`). Makes client
   error handling + ops monitoring meaningful.

6. **If it's composed, say so in the route comment.** Consumers
   should never wonder whether an endpoint is the source of truth
   or a pass-through. See the JSDoc at the top of every route.

---

## Status as of 2026-04-20

- **Signal zone collapsed:** 7 cards → 1 card
- **Auto-calibrate cron:** live, replaces manual START
- **Lane-correction chip:** live on chat (`/api/ai/chat/lane-check`)
- **Endpoint hygiene doc:** this file

Next sweep: remove `/api/ultron/narrator` + `/api/ultron/calibrate`
GET from the client-cache keyset after observing 30 days of no
referrers in Vercel analytics.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.

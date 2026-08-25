# VAPI removal plan · statenour-os

**Status:** plan adopted · removal blocked on parallel nickstire session confirmation
**Author:** v10.0.529.9 (2026-05-12) · post-session audit by general-purpose agent
**Owner:** Nour · Claude session executes when greenlit
**Triggered by:** operator decision "all the work shit needs to go on nickstire so why does vercel need vapi key?" (v10.0.527 wave)

## Why this exists

VAPI is shop infrastructure (Auto Nicks 'Nick' voice assistant · +1-216-424-9249). It was added to statenour-os in v10.0.270 because the chat-side tools made it easy. The architectural truth: VAPI belongs in `nickstire-app` next to the rest of shop operations.

A parallel Claude session is migrating VAPI to nickstire in a separate worktree. Once that session lands a confirmation, this plan removes the statenour-side dead code.

## Survey results

Total VAPI/voice-shaped code in statenour-os @ `63f4146`: **18 files · ~3,471 LOC** + 1 parked Prisma model + 1 parked migration. Audit-confirmed `VoiceLatencyEvent` table is NOT in prod Neon (migration parked at `prisma/migrations-pending/20260512_v526_voice_latency/`).

## Tier 1 · SAFE TO DELETE (15 files · ~2,485 LOC)

Pure VAPI surfaces. No other callers. Verified via grep + dependency walk at the time of writing.

> **PARTIALLY EXECUTED — corrected 2026-08-23.** The `app/api/vapi/**` routes are gone
> (`git ls-tree -r --name-only origin/main -- apps/statenour/app/api/vapi` -> 0), but Tier 1 spans
> more than that directory and **three of its files are still present**:
>
> | path | state |
> |---|---|
> | `lib/services/voice-latency.ts` | 12,133 bytes — present |
> | `scripts/audit-vapi-assistant.ts` | 6,511 bytes — present |
> | `tests/services/voice-latency.test.ts` | 9,116 bytes — present |
>
> And the migration is **applied, not parked**: it sits at
> `prisma/migrations/20260512_v526_voice_latency/`, not in `migrations-pending/`. A sibling copy
> exists at `apps/nickstire/drizzle/0038_wave181_voice_latency.sql`.
>
> **An earlier version of this note said "Every Tier-1 file listed below is gone" and called the
> migration parked.** Both were wrong, from counting ONE directory and generalising to an inventory
> that spans several — the file-count matched, so the check felt done. A completeness claim proved
> by sampling a subset is the exact defect this sweep exists to remove, manufactured by the sweep.
> Re-verify per path, not by directory:

```
app/api/vapi/check-used-tire-stock/route.ts        221 LOC
app/api/vapi/schedule-dropoff/route.ts             197 LOC
app/api/vapi/submit-callback/route.ts              166 LOC
app/api/vapi/lookup-customer/route.ts              178 LOC
app/api/system/vapi-assistant-audit/route.ts       227 LOC
app/api/system/vapi-assistant-tune/route.ts        199 LOC
app/api/cron/vapi-latency-sync/route.ts            201 LOC
app/api/system/voice-latency/route.ts               31 LOC
lib/services/voice-latency.ts                     363 LOC
lib/auth/vapi-webhook.ts                            67 LOC
scripts/audit-vapi-assistant.ts                   165 LOC
tests/services/voice-latency.test.ts              272 LOC
docs/vapi-kb/* (11 KB docs + tool JSON specs)       --
prisma/migrations-pending/20260512_v526_voice_latency/migration.sql  62 LOC
prisma/schema.prisma:2455-2486 (model VoiceLatencyEvent)  31 LOC
```

**Pre-deletion checks per route:**
- VAPI tool URLs in the live assistant config repointed to nickstire (parallel session confirms)
- `mega/route.ts` daily-array entry `/api/cron/vapi-latency-sync` removed
- `config/crons.ts` line 906-916 entry removed
- `prisma generate` re-run after schema edit

## Tier 2 · MOVE THE DATA FIRST (5 UI surfaces · operator decides)

These render on operator-facing pages. Removing them silently breaks the UI; repointing keeps the surface.

| Surface | LOC | Operator decision |
|---|---|---|
| `components/ultron/observability/voice-latency-tile.tsx` | 146 | (a) drop the tile from `ObservabilityRow` (3-up grid breaks the 2×2 editorial pairing) OR (b) repoint to a nickstire bridge endpoint returning the same `VoiceLatencyShape` |
| `app/api/system/vapi-calls/route.ts` | 136 | Consumed by 3 surfaces: `/system/vapi-calls` page, `today-pulse-strip.tsx:62` HQ chip, `daily-brief-section.tsx:165` block · each needs (a) drop or (b) repoint via nickstire bridge |
| `app/(mastery)/system/vapi-calls/page.tsx` | 204 | Move to nickstire admin, OR delete + drop the inbound links from `today-pulse-strip.tsx:370` and `system/health/page.tsx:447` |
| `app/(mastery)/system/health/page.tsx:85-90, 435-459` + `app/api/system/health-report/route.ts:175-260` | -- | Inline VAPI voice block on system-health · either delete the section (page tolerates `data.voice === null`) OR repoint |
| `app/(mastery)/system/tire-stock-requests/page.tsx` | 373 + 143 (route) | Reads `BrainMemory(category='tire_stock_request')`. Statenour stops WRITING once `check-used-tire-stock/route.ts` is deleted. Keep as historical archive OR migrate rows + drop the page |

## Tier 3 · KEEP IN STATENOUR

`lib/services/nickstire-write.ts` (182 LOC) — **generic bridge writer.** Currently only called by the 4 VAPI routes, but the module docstring frames it as a complete cross-app I/O pattern · the read-side counterpart `lib/services/bridge.ts` is already used elsewhere. Deleting it would force the next cross-app write to rebuild the timeout/auth/fallback plumbing. **Keep until a separate ship intentionally retires the write-side.**

## Env vars (Vercel + Railway · after full sweep)

DELETE: `VAPI_API_KEY` · `VAPI_WEBHOOK_SECRET`
KEEP: `BRIDGE_API_KEY` + `NICKS_ADMIN_URL` (required by `bridge.ts` read-side)

## Execution sequence (when parallel session greenlights)

1. Parallel session posts: "nickstire VAPI ready · tool URLs repointed · prod traffic flowing"
2. Apply this plan in 3 commits:
   - **v530.1 · Tier 1 deletion** · 15 files + cron manifest + mega-route entry + schema model removed in one ship · `prisma generate` re-run · tests + pre-push gates green
   - **v530.2 · Tier 2 operator decisions** · per-surface drop OR repoint based on operator answers
   - **v530.3 · env-var cleanup** · operator removes VAPI vars from Vercel + Railway
3. Update `RECONCILIATION.md` + `docs/state-of-autonicks-*.md` to reflect the removal

## Risk

Low. The migration is already parked (table not in prod), the 4 VAPI routes already fail-open (no service breakage if removed mid-traffic), and the bridge code stays in place. The only operator decision is what to do with the 5 UI surfaces — they don't error today (graceful-empty handling) so the worst case is a permanent "endpoint not live yet" hint where the tile/chip lived.

## What NOT to do

- Do NOT delete `lib/services/nickstire-write.ts` (Tier 3 · keep)
- Do NOT delete `BRIDGE_API_KEY` / `NICKS_ADMIN_URL` env vars (used by bridge.ts read-side)
- Do NOT touch the `BrainMemory(category="tire_stock_request|callback_request|dropoff_request")` rows · those are historical records the operator may still want
- Do NOT ship Tier 1 + Tier 2 in the same commit (separate the mechanical delete from the operator-decision repointing)

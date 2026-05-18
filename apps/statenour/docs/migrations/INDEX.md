# Migration Index · Phase Q (2026-05-18 PM)

Live tracker for in-flight migrations · formalizes what was previously
documented only in MEMORY notes + commit messages. Each migration has
its own file in this directory with phase status, rollback procedure,
and the next milestone.

## Active migrations

| Migration | Phase | Started | Status | Next milestone |
|---|---|---|---|---|
| **tRPC migration** (REST → tRPC) | Phase J + S/T/U/Y + **Z** | 2026-05-18 PM | **10/50+ surfaces** · 4th domain router shipped (`chat`) · ChatHistorySearch (Cmd+F) migrated with optimistic-cache-update pattern | Continue `/system/*` (policies · repos) · then more chat sub-surfaces |
| **AGENT_V1 → AGENT_V2** (prompt builder) | v10.0.442-484 sprint + V + W + **X** | 2026-05-07 / 2026-05-18 PM | **AGENT_V2=true active in prod** · Phase 0 prereqs COMPLETE end-to-end (judge-eval + dashboard + sampler + force-override + auto-corpus cron) | Wait ~10 evenings for cron to accumulate 50 runs · then Phase 1 canary when verdict reads safe |
| **Inline category strings → BRAIN_CATEGORIES** | Phase O.2 + P.2 | 2026-05-18 PM | **H+ scope done (8 files · 21 sites)** · 100+ legacy untouched | Optional H+ codemod rerun · legacy migration is separate scope |

## Completed migrations

| Migration | Completed | Notes |
|---|---|---|
| **M.2 persona wiring** (runMultiAgent ← personas) | **U (2026-05-18 PM)** | 4/4 reasoning sub-pipelines wired · 10 typed personas in registry · N.6 scorer feeds from all sub-pipelines. R+S.1 = runMultiAgent · S.3 = smart-tier router (inheritance) · T = deep-research worker (+ 2 specialist personas) · U = pretask-fanout 3 lenses |
| Audit findings 12/12 | H.8 (2026-05-18 PM) | All HIGH/MEDIUM/LOW from /find-bugs closed |
| Mastra agent V2 (`AGENT_V2=true`) | v10.0.485 | Default path · V1 still reachable via env flag |

## Retired migrations

(none yet)

## Pattern · how to file a new migration

1. Create `docs/migrations/<short-name>.md` with the template:
   - **Why** · what's being replaced + why
   - **Strategy** · big-bang / strangler-fig / by-feature / coexistence
   - **Status** · phase number + % complete + remaining surfaces
   - **Rollback** · single-command revert procedure
   - **Next milestone** · concrete deliverable + owner
2. Add a row to the table above
3. Reference from the commit that started the migration

## Why this index exists

Pre-Q · the J tRPC migration's progress lived only in commit messages.
The AGENT_V2 cutover plan lived only in MEMORY. The M.2 persona-wiring
deferral was a single line in M's commit body. Drift between
"what we said we'd do" and "what's actually shipped" was high.

This index is the single source of truth · the table above is the
human-readable view. For the live, scanned view:

- **`/system/migrations`** — operator UI · per-migration progress bar
  driven by a live source-tree scan (counts `useAuthedFetch` vs
  `trpc.<router>.` call sites · computes % surfaces migrated). Also
  surfaces the feature-flag board so AGENT_V2 status is visible at
  a glance.
- **`GET /api/system/migrations`** — JSON shape of the same data ·
  ownerProcedure-gated · the underlying registry lives in
  `app/api/system/migrations/route.ts` (`MIGRATIONS` constant) and
  must be kept in sync with this file when adding a migration.

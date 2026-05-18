# Migration Index · Phase Q (2026-05-18 PM)

Live tracker for in-flight migrations · formalizes what was previously
documented only in MEMORY notes + commit messages. Each migration has
its own file in this directory with phase status, rollback procedure,
and the next milestone.

## Active migrations

| Migration | Phase | Started | Status | Next milestone |
|---|---|---|---|---|
| **tRPC migration** (REST → tRPC) | Phase J + **S.2/S.3** | 2026-05-18 PM | **5/50+ surfaces** · `/system/health` migrated · 3rd domain router (`system`) added | Continue `/system/*` migrations · `/chat`, `/voice` next |
| **AGENT_V1 → AGENT_V2** (prompt builder) | v10.0.442-484 sprint | 2026-05-07 | **AGENT_V2=true active in prod** · v1 still mounted as fallback | Phase 1 canary (10% of turns) · pending judge-eval comparator + parity dashboard |
| **M.2 persona wiring** (runMultiAgent ← personas) | Phase M.2 + **R + S.1/S.3** | 2026-05-18 PM | **2/N call sites wired** · S.1 adds per-step routing via `classifyStepIntent()` (research vs execution) · smart-tier inherits | Extract RESEARCH_PLANNER + RESEARCH_SYNTHESIZER specialist personas for deep-research worker |
| **Inline category strings → BRAIN_CATEGORIES** | Phase O.2 + P.2 | 2026-05-18 PM | **H+ scope done (8 files · 21 sites)** · 100+ legacy untouched | Optional H+ codemod rerun · legacy migration is separate scope |

## Completed migrations

| Migration | Completed | Notes |
|---|---|---|
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

# Nick's Tire & Auto · Claude adapter

**Repo:** `apps/nickstire` in the NOURCITY monorepo (`nourdean22/MAINnicks-tire-autoNEW` · deploys to nickstire.org via Railway from `main`)
**Stack:** Vite 7 + React 19 client / Express 4 + tRPC 11 server / Drizzle ORM / MySQL (TiDB Cloud) / pnpm 10 / Node 24

Commands, conventions, layout, test hygiene: [`AGENTS.md`](./AGENTS.md) — read it first. Cross-cutting repo rules (branching, shared `main`, Windows, agent adapters): root [`AGENTS.md`](../../AGENTS.md).

## Canonical project docs (read before editing)

- `truth_os.md` — what's true in prod (update when shipping) · `docs/CURRENT-TRUTH.md` — architecture, data flow, and deployment source-of-truth (added with the Wave-1 revenue-ops closure, PR #679-681)
- `PROTECTED-CORE.md` — don't-touch list
- `docs/ISSUE-REGISTRY.md` — living verified-findings ledger (ROS-### IDs) · `docs/REVENUE-OPS-ROADMAP.md` / `docs/REVENUE-OPS-WAVE2.md` — sequencing and closure notes
- `MEMORY.md`, `architecture_map.md`, `RECOVERY.md` — superseded by the docs above; the last versions of these live at `docs/_archive/root_reports/` for historical reference only
- `docs/integrations/INTEGRATION_REGISTRY.md` + `docs/operations/LOAD_BEARING_SYSTEMS.md` — canonical. Ship history lives in `truth_os.md` + the memory index — not in this file.

## Operator persona (on demand, not always-on)

The advisory persona (identity, mode detection, response structure, anti-patterns) moved to [`docs/OPERATOR-DIRECTIVE.md`](./docs/OPERATOR-DIRECTIVE.md) on 2026-08-04 — load it when acting as the operator's strategic advisor, not for routine engineering. Repo-wide persona: root [`AGENT-OPERATING-PROFILE.md`](../../AGENT-OPERATING-PROFILE.md).

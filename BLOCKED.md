# Blocked / parked campaign items

- **gitleaks full-history scan (Stage 1.3)** — binary not installed (Go tool, not npm). Needs an
  operator-approved install; the working-tree secret (the PAT) is already found and stripped.
- **Route-usage evidence via prod DB (Stage 2.5)** — operator-gated by standing rule (870-row
  incident: no prod-touching scripts as "verification"). Also corrected: `pg_stat_user_tables` only
  applies to statenour/Neon; nickstire is TiDB (MySQL).
- ~~**Legacy-page SEO evidence (Stage 2.6)** — Ahrefs MCP is unauthenticated in this session~~
  **RE-TESTED 2026-08-09: connected, and still blocked — for a different reason.** Ahrefs now
  authenticates but has **0 API units** (trial), and its *verified* Nickstire project returns empty
  GSC and empty web-analytics. Supermetrics authenticates too; its trial **expired 2026-05-17**.
  Neither can return a row. **But the block is now cosmetic**: nickstire ingests its own Search
  Console data into `search_performance` and `server/pipelines/gsc-data.ts:421` already aggregates
  clicks+impressions **grouped by page**. This is an operator-run query against an existing report,
  not a connector purchase. Register rows added in `docs/UPSTREAMS.md`.
- **Stage 3 (statenour dedup)** — blocked on NOUR-ACTION-REQUIRED items 4 and 6 (VAPI tool URLs,
  Custom GPT consumer) plus the bridge-client build/rewire/prove sequence. Hazard table:
  `AUDIT/2026-08-truth.md` §2.
- **Stages 4-6** — each contains UPSTREAMS-NATIVE collisions (truth doc §3); the surviving lines
  need per-item gating against the chat-cockpit arc (#1447-#1456) and the dispatch census before
  any build. Not started by design.
- **Stage 7 refactors — NOT blocked, but deliberately not batch-executed.** Its two *deletion*
  items were falsified (7.1 `components/chat` is imported by chat-v2; 7.2 `loop-stream.tsx` has 11
  importers across 8 files). What remains is genuine design work: decomposing `loop-stream.tsx`
  (1,525 lines) and `/people` (1,002 lines), collapsing the chat hooks, the Magic-Ink conversions,
  and the command palette. These need `brainstorming` → `writing-plans`, one surface at a time.
  Executing them from the pasted plan is exactly how the three false delete-lists happened.

# Blocked / parked campaign items

- **gitleaks full-history scan (Stage 1.3)** — binary not installed (Go tool, not npm). Needs an
  operator-approved install; the working-tree secret (the PAT) is already found and stripped.
- **Route-usage evidence via prod DB (Stage 2.5)** — operator-gated by standing rule (870-row
  incident: no prod-touching scripts as "verification"). Also corrected: `pg_stat_user_tables` only
  applies to statenour/Neon; nickstire is TiDB (MySQL).
- **Legacy-page SEO evidence (Stage 2.6)** — Ahrefs MCP is unauthenticated in this session
  (claude.ai connector settings); GSC pull possible next session once connected.
- **Stage 3 (statenour dedup)** — blocked on NOUR-ACTION-REQUIRED items 4 and 6 (VAPI tool URLs,
  Custom GPT consumer) plus the bridge-client build/rewire/prove sequence. Hazard table:
  `AUDIT/2026-08-truth.md` §2.
- **Stages 4-6** — each contains UPSTREAMS-NATIVE collisions (truth doc §3); the surviving lines
  need per-item gating against the chat-cockpit arc (#1447-#1456) and the dispatch census before
  any build. Not started by design.

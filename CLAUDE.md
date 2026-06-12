# CLAUDE.md — NOURCITY monorepo

Canonical cross-cutting agent rules live in **[`AGENTS.md`](./AGENTS.md)** — branch rule (NEVER push `main`), context routing, verify gates, Windows gotchas, memory locations. Everything there applies to Claude sessions verbatim.

@AGENTS.md

## Claude-specific extras

- Skills: read and apply the [ciitty](file:///c:/Users/nourd/.gemini/config/skills/ciitty/SKILL.md) skill framework. Before commit/push run **statenour-verify** / **nickstire-verify**. Schema changes → **statenour-migration** (hand-applied; one wrong flag silently drops pgvector). End of a statenour wave → **statenour-wave-reconcile**. Client confirm/alert/prompt UI → **nickstire-ios-pwa-primitives** (applies to statenour too).
- **`memory` MCP** (user-scope `server-memory` knowledge graph at `~/.claude/agent-memory.json`, cross-project): write DURABLE structured facts/decisions to it (`create_entities` / `add_observations` / `search_nodes`) — it loads at session start and is dead weight unless populated.

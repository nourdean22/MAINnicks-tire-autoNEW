# statenour-os · Claude adapter

App rules, stack, canonical sources, gotchas: [`AGENTS.md`](./AGENTS.md) — read it first (its §3 table routes to `docs/CURRENT-TRUTH.md`, runbooks, and `docs/RECONCILIATION.md`). Cross-cutting repo rules (branching, worktrees, Windows, agent adapters): root [`AGENTS.md`](../../AGENTS.md).

Claude-specific routing (skills live in `.claude/skills/` at repo root):

- Before commit/push → **statenour-verify**.
- Schema/migration work → **statenour-migration** (hand-applied; one wrong flag silently drops pgvector).
- End of a wave → **statenour-wave-reconcile** (ship history lands in `docs/RECONCILIATION.md`, never in AGENTS.md headers).
- Confirm/alert/prompt UI → **nickstire-ios-pwa-primitives** (applies here too — statenour is also an iOS PWA).

# CLAUDE.md — NOURCITY monorepo (Claude Code adapter)

Canonical cross-agent policy is **[`AGENTS.md`](./AGENTS.md)** — topology, source-of-truth hierarchy,
branch rule (NEVER push `main`), protected operations, context routing, commands, verify gates,
Windows gotchas, memory locations. Everything there applies to Claude sessions verbatim.

@AGENTS.md

Read the nearest `apps/<app>/AGENTS.md` before editing inside an app; its `CLAUDE.md` sibling adds
only Claude-specific routing.

## Claude-specific

- **Skills** (`.claude/skills/`): before commit/push → **statenour-verify** / **nickstire-verify**.
  Schema changes → **statenour-migration**. End of a statenour wave → **statenour-wave-reconcile**.
  Client confirm/alert/prompt UI → **nickstire-ios-pwa-primitives** (applies to statenour too).
  Shared-`main` pushes while sibling sessions run → **nickstire-shared-main-push**. Prod-DB or
  side-effect lanes → **prod-db-guard**. A pasted mega-plan → **plan-gate**. "Turn this
  book/doc/repo into a skill" → **source-to-skill**. Reel content (ideate/pack/draft) →
  **nickstire-reel-operator**; verifying reel *pipeline code* → **nickstire-verifier-reel-pipeline**.
  Working in a `.claude/worktrees/*` path (or
  `tsc` "not recognized") → **harness-worktree-setup** FIRST. End of a wave, or after the operator
  corrects you → **session-observer** (propose-only; appends to
  [docs/skill-proposals.md](docs/skill-proposals.md)). Apply the
  [ciitty](.agents/frameworks/ciitty/SKILL.md) framework throughout.
- **Output shape — [answer-first](.claude/skills/answer-first/SKILL.md).** The operator reads on a
  phone, mid-task, usually while something is broken. Lead with the answer in the first sentence;
  number every procedure; put the receipt inline (`417 files, 4,670 passed, exit 0` — not "tests
  pass"). Readability outranks brevity: cut whole items, never compress sentences into fragments.
- **Hooks + permissions** live in `.claude/settings.json` (SessionStart graph briefing; PreToolUse
  policy gate; Stop completion gate). They are enforcement, not advice — see
  [`docs/agent-os/README.md`](docs/agent-os/README.md). Don't disable a hook to unblock yourself.
- **`memory` MCP** (user-scope `server-memory` knowledge graph at `~/.claude/agent-memory.json`,
  cross-project): write DURABLE structured facts/decisions to it (`create_entities` /
  `add_observations` / `search_nodes`) — it loads at session start and is dead weight unless populated.

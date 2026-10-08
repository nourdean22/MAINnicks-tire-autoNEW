# CLAUDE.md — NOURCITY monorepo (Claude Code adapter)

Canonical cross-agent policy is **[`AGENTS.md`](./AGENTS.md)** — it applies to Claude sessions
verbatim, no carve-outs. The files below are IMPORTED, so they are already in your context:

@AGENTS.md
@CLAUDE-OPERATING-PROFILE.md
@NOUR-COMMAND.md

<!-- Keep all imports on their own `@` lines: a markdown link passes a substring match but loads NOTHING
     (false green, 2026-08-21). Asserted by check-adapters.mjs + adapters.test.mjs. Cap: 60 lines. Policy goes in
     AGENTS.md; Claude-only tool behavior in CLAUDE-OPERATING-PROFILE.md (capped at 160). -->

Per-app routing lives in `AGENTS.md` > **Context routing**. The `apps/<app>/CLAUDE.md` siblings
add Claude-only notes on top of it — and nickstire's also indexes that app's canonical docs
(`truth_os.md`, `PROTECTED-CORE.md`, `docs/ISSUE-REGISTRY.md`), so read it, not only its `AGENTS.md`.

## Claude-specific

- **Skills** (`.claude/skills/`, 35 repo-specific — invoke by exact name). `nour-command` is the
  cross-cutting router; each `SKILL.md` carries
  its own full trigger and rationale; this is only the index for picking one.
  - Before commit/push → **statenour-verify** · **nickstire-verify**; writing any report → **answer-first**;
    recurring business/platform reports → `docs/reporting/REPORT-SKILL-SUITE.md` + the narrow reporting skill.
  - Schema/DDL → **statenour-migration** (Prisma) · **nickstire-tidb-ddl** (Drizzle/TiDB).
  - Any script that touches a DB from a worktree or local shell → **prod-db-guard**.
  - Authoring or editing a deny-list, guard regex, policy file or hook → **guard-red-team**.
  - `cwd` under `.claude/worktrees/*`, or `tsc` "not recognized" → **harness-worktree-setup**, FIRST.
  - Pushing while sibling sessions run → **nickstire-shared-main-push**; a pushed branch with no
    merged PR → **stranded-branch-rescue**; a cloud session's checkout (no `worktree-setup.ps1`) →
    **session-authority**.
  - Confirm/alert/prompt UI in EITHER PWA → **nickstire-ios-pwa-primitives**.
  - Reel content → **nickstire-reel-operator**; reel *pipeline code* →
    **nickstire-verifier-reel-pipeline**.
  - A pasted plan/audit/roadmap → **plan-gate**. "Turn this book/doc/repo into a skill" →
    **source-to-skill**. "Which skills actually fire?" → **skill-fire-audit**.
  - A read that RENDERS or SCORES → **empty-vs-error**; adding a WRITER (header, env var,
    column, tool registration) → **assert-the-consumer**; a new test or canary →
    **positive-control-first**; a new table/queue/tool/flag → **prior-art-grep**; a filtered ratio → **base-rate-check**.
  - A read-then-write that decides WHO acts (claim, lease, reclaim, dedupe marker) → **claim-before-act**.
  - End of a wave → **statenour-wave-reconcile** (ship history lands in `apps/statenour/docs/RECONCILIATION.md`,
    never in an AGENTS.md header), then **session-observer** (propose-only; appends to
    `docs/skill-proposals.md`).
- **Output shape** — lead with the answer in sentence one, number every procedure, put the receipt
  inline (`417 files, 4,670 passed, exit 0`, never "tests pass"). The operator reads on a phone,
  mid-task, usually while something is broken. Cut whole items; never compress sentences to fragments.
- **CIITTY** — read [`.agents/frameworks/ciitty/SKILL.md`](.agents/frameworks/ciitty/SKILL.md)
  (20 KB, linked so never auto-loaded) BEFORE writing code for Visual Kinetics UI, resilient-DB
  design, or PowerShell reliability. Skip it otherwise.
- **Hooks** (`.claude/settings.json`; design notes [`docs/agent-os/README.md`](docs/agent-os/README.md))
  are enforcement, not advice. Don't disable one to unblock yourself.
  - `PreToolUse` → `pretool.mjs` (17 rules, `config/agent-os/policy.json`, exit 2 blocks; **Claude-only**,
    never cite as enforced repo-wide) then `lease-check.mjs` (Session Authority — **session-authority**
    skill). Both fail OPEN on their own bugs — hook silence is not a green.
  - `Stop` → `stop-check.mjs` (uncommitted changes on `main` blocks the turn; not a completion gate).
    `SessionStart` → `graphify-session-context.ps1`, `intelligence-context.mjs`, `check-memory-index.mjs`, `session-lease-status.mjs`.

<!-- REMOVED 2026-08-21: the "`memory` MCP" bullet. Not registered: no .mcp.json, and ~/.claude.json
     mcpServers = ["chatgpt"] only (full measurements: docs/agent-audit/AUDIT-2026-08-21.md). Canonical cross-session memory is
     AGENTS.md > "Memory / handoff". Re-add only once `claude mcp add` actually registers it. -->

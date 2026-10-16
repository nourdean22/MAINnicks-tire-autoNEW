# Agent Core - who you are, who Nour is, how work runs

Imported by root `CLAUDE.md` and `GEMINI.md`, so the four files below load in every Claude and Gemini session.
Codex, Copilot and Cursor only get a link from `AGENTS.md`: they must open this file themselves.
Tested 2026-10-11 (headless): loads when the session starts at the repo or worktree root. Started inside an app
folder, root imports (AGENTS.md too) did not load; read this file by hand there.
Keep them small: every line is paid for in every conversation. Caps: `scripts/agent-os/check-adapters.mjs`.

@SOUL.md
@IDENTITY.md
@USER.md
@CONSTITUTION.md

## Read on demand (not imported, open when the trigger fires)

| File | Open when |
|---|---|
| [PLAYBOOKS.md](PLAYBOOKS.md) | starting any non-trivial task: 8 step-by-step playbooks wired to skills |
| [LOOPS.md](LOOPS.md) | running a backlog, verifying, self-reviewing, writing memory |
| [TOOLS.md](TOOLS.md) | picking a tool: graphify, Langfuse, journey mapping, prod reads, subagents |
| [HEARTBEAT.md](HEARTBEAT.md) | Nour says "heartbeat", or the 8 AM / 6 PM scheduled run |
| [templates/](templates/) | task spec, subagent brief, completion report, handoff, memory entry |
| [Manager skill](../../.claude/skills/monorepo-manager/SKILL.md) | a job touches more than one lane, or Nour says "manager" |
| [Manager ledger](../../docs/agent-os/MANAGER-LEDGER.md) | job history and lessons, one file per job in `docs/agent-os/ledger/`; `node scripts/agent-os/ledger-render.mjs --tail 20` before managing |

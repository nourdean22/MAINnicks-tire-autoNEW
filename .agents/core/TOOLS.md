# TOOLS.md - which tool for which job, cheapest first

On demand. Read when picking a tool you have not used this session. Costs are why the order matters.

## Map of the repo: graphify (cheap, local)

- `graphify-out/graph.json` lives in the primary checkout (gitignored); `scripts/graphify-obsidian-sync.ps1`
  refreshes it (`graphify update .`) when its scheduled task is registered. Checked 2026-10-11 on NattyNour:
  NO graph.json and NO sync task (lost in the 2026-10-07 reset), so the graph is UNAVAILABLE until rebuilt.
- Before a broad Grep across apps: `graphify query "<question>"` (BFS) or `graphify path "A" "B"`.
  The SessionStart hook `graphify-session-context.ps1` already injects a summary.
- It is a map, not proof: read the current source before claiming anything. Graph missing, stale (over 48 h) or
  the CLI absent in this harness? Use focused Grep and move on; do not rebuild to answer one question.
- Rebuild only with `/graphify . --update`. A full `/graphify` on the monorepo spends tokens; ask first.
- Privacy: `.graphifyignore` excludes `OPERATOR-BIOGRAPHY.md` and `.agents/core/USER.md` so personal facts never
  reach `graph.json` or the Obsidian sync.

## AI quality in StateNour: Langfuse (skill `langfuse:langfuse`)

- Wired in `apps/statenour/lib/observability/langfuse.ts` (env `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
  `LANGFUSE_BASE_URL`). Use for: a bad Nick answer, a prompt change, an eval dataset, judge calibration.
- Query with `npx langfuse-cli api <resource> <action>`. Keys come from Nour's shell only. Never ask for them
  in chat, never print them, never write them to a file.
- First prove traces are arriving for the surface you care about; keys being set is not proof.
- Keep exports content-minimized and respect private mode. Never send the biography or customer data into a dataset.
- Loop: failing traces -> dataset (keep known-good cases too) -> change the prompt -> run the experiment on the
  same dataset with the existing judge setup (no new paid provider) -> compare before/after.

## UX before UI: journey mapping (skill `agentic-council:journey-mapping`)

- Before any new screen or flow in either PWA. Persona is Nour on an iPhone (statenour) or a customer on a
  phone (nickstire). Output the journey table, then hand off to `antislop-ui` + `nickstire-ios-pwa-primitives`.

## Production reads (read-only unless Nour says otherwise)

| Need | Tool |
|---|---|
| Is it up, which commit | `curl https://nickstire.org/api/health` (`.deploy.commit`) and `curl https://bdnick.info/api/system/heartbeat` |
| Deploy logs, env names | Railway MCP (`get-logs`, `list-deployments`). Never `set-variables` without an explicit go |
| Errors | Sentry MCP (`search_issues`, `search_errors`) |
| PRs, CI | `gh pr list --state open --json number,title,statusCheckRollup` |
| Worktrees, leases, stranded branches | `node scripts/agent-os/repo-status.mjs` |
| DB | Skill `prod-db-guard` FIRST. Every local DATABASE_URL is production |

## Work splitting

- Subagents: `.claude/agents/lane-*.md` (one per lane), dispatched by the manager skill. Briefs use
  `.agents/core/templates/subagent-brief.md`.
- Council lenses (`agentic-council:*`): a second opinion on a hard call (Skeptic for risk, Strategist for scope).
  One lens per question, not the whole council.
- `Workflow` tool: only when Nour explicitly asks for a multi-agent workflow. It can run dozens of agents.

## Avoid

- Desktop Commander whole-disk search, recursive scans of `C:\Users\nourd`: ask first (usage burn, 2026-10-07).
- Any package install inside a junctioned worktree (blocked; see skill `harness-worktree-setup`).
- Re-running CI "to see". Read the failing log instead.

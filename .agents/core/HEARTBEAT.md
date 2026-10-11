# HEARTBEAT.md - twice-daily read-only operations review

This is a REVIEW, not uptime monitoring. Uptime is already watched hourly by `.github/workflows/deploy-drift.yml`
(cron `17 * * * *`), which runs on GitHub and keeps working when this PC is off. Do not duplicate it.

Schedule: 08:00 and 18:00 America/New_York wall clock (local Claude Desktop scheduled tasks
`nourcity-heartbeat-am` / `nourcity-heartbeat-pm`). They run only while Claude Desktop is open and the PC is awake.
Also runs when Nour says "heartbeat". Run from the primary checkout `C:\Users\nourd\NattyNour\nicks-tire`.

Allowed effects: reads, plus one push notification to Nour when the status changes. Nothing else: no edits,
merges, deploys, DB scripts, CI reruns, customer messages, secret or skill changes. Budget: about 10 tool calls.

## Checks

| # | Check | How | HEALTHY when | Required |
|---|---|---|---|---|
| 1 | nickstire | `curl -sS --max-time 15 https://nickstire.org/api/health` | HTTP 200 and JSON parses; note `.deploy.commit` | yes |
| 2 | statenour | `curl -sS --max-time 20 https://bdnick.info/api/system/heartbeat` | HTTP 200 AND `.data.status` is `ok` AND `.data.worker.status` is `fresh` (body is wrapped in `data`). 200 with `degraded` is DEGRADED; 503 is FAILED | yes |
| 3 | Uptime monitor | `gh run list --workflow deploy-drift.yml --limit 3 --json conclusion,createdAt` | latest run under 2 h old and `success` | yes |
| 4 | PRs | `gh pr list --state open --json number,title,updatedAt,isDraft,statusCheckRollup` | no red non-draft PR, none idle over 3 days | yes |
| 5 | Branches, leases, jobs | `node scripts/agent-os/repo-status.mjs`; open rows in `docs/agent-os/MANAGER-LEDGER.md` | no stranded branch (pushed, no PR, not a draft on purpose), no job BLOCKED over 3 days | no |
| 6 | Memory index | `node scripts/agent-os/check-memory-index.mjs` | exit 0 | no |
| 7 | Repo graph | modified time of `graphify-out/graph.json` (missing = SKIPPED, see TOOLS.md) | under 48 h | no |
| 8 | Errors | Sentry MCP `search_issues`, unresolved, last 12 h, limit 10 | no new high-volume issue | no |
| 9 | AI traces | Langfuse, only if keys are already in the shell; last 12 h, small sample | no error spike; traces still arriving | no |

Before any `gh` call clear the dummy token: `[Environment]::SetEnvironmentVariable('GITHUB_TOKEN', $null, 'Process')`.
Classify each failure: TIMEOUT, AUTH (401/403), MALFORMED (bad JSON), STALE, DOWN. A required check that cannot run
is UNKNOWN and blocks HEALTHY. An optional check that cannot run is SKIPPED and does not page.

## Output (exactly this shape)

```
HEARTBEAT <AM|PM> <YYYY-MM-DD HH:MM ET> base <origin/main short SHA>: <HEALTHY|DEGRADED|FAILED|UNKNOWN>
1 nickstire <state> <one fact>      2 statenour <state> <status/worker.status>
3 uptime    <state> <last run age>  4 PRs       <state> <open / red>
5 branches  <state>                 6 memory    <state>
7 graph     <state> <age>           8 sentry    <state | SKIPPED>
9 langfuse  <state | SKIPPED>
Changed since last run: <none | list>
Proposed jobs (max 3, lane named): <none | 1. ... >
```

Overall = worst required state (FAILED > DEGRADED > UNKNOWN > HEALTHY); optional checks can lower it to DEGRADED only.
Notify only when the overall state or the set of failing checks differs from the previous run (read it from the
scheduled task's last output). Unchanged bad state: no repeat notification. A healthy result is a valid end; do not
invent work. Proposed jobs go to the manager in Observe mode and never start on their own.

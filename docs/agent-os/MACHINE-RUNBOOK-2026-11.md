# Machine runbook, NattyNour, 2026-11

The machine was slow on 2026-11-01 because 36 leaked test processes were each spinning a CPU core. They are gone and
the leak is fixed in this PR. The rest of this file is the one-liners only Nour (or the manager, from his go) runs,
each with what it changes, its rollback, and the reading that justifies it.

Job 2026-11-01-chat-humanizer-w6, branch `chore/claude-setup-optimal`. Labels: FACT (measured here, command named),
INFERRED (reasoned from facts), NOT CHECKED.

## Before and after

| Measure | Before (2026-11-01) | After | How measured |
|---|---|---|---|
| CPU, all 8 cores | 100% | 39-48% | `Win32_Processor.LoadPercentage`; `\Processor(_Total)\% Processor Time` (FACT) |
| Leaked busy-loop processes | 36 (up to 29 h old) | 0 | `node scripts/agent-os/orphans.mjs` (FACT) |
| Free RAM | 1,976 MB | 4,016 MB | `Win32_OperatingSystem.FreePhysicalMemory`, 5+ sessions running both times (FACT) |
| Memory index MEMORY.md | 20,144 B, 82.6% of budget | 15,362 B, 63.0% | `node scripts/agent-os/check-memory-index.mjs` exit 0, 125 notes reachable (FACT) |
| Graphify sync hang ceiling | none (hung 5 h, task result 0) | 45 min, then ERROR + exit | `graphifySyncWatchdog.test.mjs` (FACT) |
| Hung sync visible at session start | no | `graph sync: HUNG` after 90 min | same test (FACT) |
| Plugins enabled | 159 | 111 after step 1 | `plugin-prune.mjs` plan: 48 (FACT for the plan, NOT CHECKED until applied) |
| MCP servers failing at start | 26 (11 of them 30 s timeouts) | 8 (3 timeouts) after step 1 | session-start list vs the reject list (INFERRED) |
| Session start | 35 s (manager) | NOT CHECKED until step 1 | re-time after step 1 |

## The root cause, in one paragraph

`scripts/agent-os/promptSharpen.test.mjs` proves the hook survives a hang by planting `for (;;) {}` and running it under
a 2.5 s spawn timeout. On Windows the timeout kills `cmd.exe`, not the `node` under it, so every test run (every
pre-commit `agent-os-verify`, in every session) left one process spinning a core forever. By 13:30 there were 36. That
also explains slow commits, the 12-minute fast-forward and the 31-minute graphify run that morning, and the red
`speed:` canary. Now the plant is bounded (30 s) and killed by pid, and the test asserts it does not outlive the run
(red on the old plant: `pid 27232 outlived the test`). `orphans.mjs` finds and ends any that a stale checkout still leaks.

## Steps for Nour (about 15 minutes in all)

Run from `C:\Users\nourd\NattyNour\nicks-tire` after this PR merges, unless a step says otherwise.

1. **Turn off 48 plugins this repo already rejected** (wrong business or stack; 18 of the 26 failing MCP servers).
   Plan first, then apply. It backs up `~/.claude/settings.json` and sets keys to false; nothing is deleted.
   ```bash
   node scripts/agent-os/plugin-prune.mjs
   ```
   ```bash
   node scripts/agent-os/plugin-prune.mjs --apply
   ```
   Rollback: the apply prints `undo: node scripts/agent-os/plugin-prune.mjs --restore "<backup>"`.
   Then open a new session and time its start. Plugins that come from the claude.ai account (unity, wix, 10x-Team,
   agentic-sdlc, zizi-skills, opencode-subagent-mcp: present in sessions, absent from the local file, INFERRED) turn
   off only at claude.ai > Settings > Plugins.

2. **Check for leaked test processes any time the laptop feels slow** (2 seconds). Ends only parentless node processes
   running an agent-os script copy from the temp dir, older than 10 minutes.
   ```bash
   node scripts/agent-os/orphans.mjs --kill
   ```

3. **Let the auto-mode classifier allow read-only production probes** (6 `[Production Reads]` denials in 3 days, FACT).
   `autoMode` is read only from user or managed settings, never the project (code.claude.com/docs/en/auto-mode-config,
   read 2026-11-01). Entries are prose, not patterns. Add this to `~/.claude/settings.json`:
   ```json
   "autoMode": {
     "environment": ["$defaults", "Production targets: nickstire TiDB database 'nickstire' (Railway service MAINnicks-tire-auto) and statenour Neon database 'neondb' (Railway service statenour-web). Operator Nour runs both and approves read-only probes of them."],
     "allow": ["$defaults", "Production Reads exception: a read-only SELECT probe of the nickstire TiDB or statenour Neon database is allowed when it runs as `railway run -s <service> -- node <script>.cjs` with a SELECT-only allowlist (Postgres inside BEGIN READ ONLY), or as a single SELECT through the Neon MCP run_sql tool, and prints only counts and ids. Dumping env vars, configs or secrets, and any INSERT, UPDATE, DELETE or DDL, stay blocked."]
   }
   ```
   Check: `claude auto-mode config` shows both entries. Rollback: delete the `autoMode` block. This widens no write:
   the hard and soft deny lists are untouched, and the repo's PreToolUse SQL rules still deny every write.

4. **Defender: exclude the repo and the pnpm store** (MsMpEng was 987-1,423 MB and scans every file a test writes).
   Admin PowerShell:
   ```powershell
   Add-MpPreference -ExclusionPath 'C:\Users\nourd\NattyNour', "$env:LOCALAPPDATA\pnpm\store"
   ```
   Rollback: `Remove-MpPreference -ExclusionPath 'C:\Users\nourd\NattyNour', "$env:LOCALAPPDATA\pnpm\store"`.
   Trade-off: files in those folders are no longer scanned on write. The repo holds only code we pull from GitHub and
   pnpm; keep downloads out of it. Reading exclusions needs admin, so the current list is NOT CHECKED.

5. **Windows Search: stop indexing the repo** (SearchIndexer used 50% of one core while node_modules churned, FACT).
   Open Indexing Options, Modify, untick `C:\Users\nourd\NattyNour`:
   ```powershell
   control /name Microsoft.IndexingOptions
   ```
   Rollback: tick it again. Start-menu search keeps working for everything else.

## Proposals, each waiting on a yes

| # | Proposal | Why | Decision |
|---|---|---|---|
| A | Power plan to High performance while plugged in: `powercfg /setactive SCHEME_MIN` (rollback `powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e`, Balanced) | Balanced is active (FACT); test suites are CPU-bound | Nour |
| B | Run at most 6 agent sessions at once, one heavy run at a time (the heavy lease already enforces the second) | Each CLI session holds 300-400 MB working set and 750-1,000 MB committed (FACT, 7 sessions); a typecheck adds up to 2.9 GB (2026-10-31 reboot). 16 GB minus about 5 GB for Windows, the desktop app, Defender and Chrome leaves room for 6 plus one heavy run (INFERRED). session-pipeline.md's 10 predates these numbers | Nour |
| C | Startup apps: GoogleDriveFS is registered 3 times (system, user, default profile), plus Comet, Proton Drive, Edge and Chrome auto-launch (FACT, `Win32_StartupCommand`). Turn off what he does not use in Settings > Apps > Startup | Each sync client watches files and takes RAM at boot | Nour |
| D | The 10 stale checkouts in `OneDrive\Documents\Claude\Projects` (FACT: 10 dirs) are synced by OneDrive and are "stale, do not work there" per CLAUDE.md. Move them out of OneDrive or pause their sync; do not delete | OneDrive.Sync.Service used 2.4% CPU at idle (FACT, 5 s sample) | Nour |
| E | The 8 MCP servers still failing after step 1: desktop-commander (required: re-check in `/mcp`; it timed out at 30 s while the CPU was pinned), prisma `Prisma-Local` (the remote server works: 69 calls in 30 days), fiftyone (kept: `tool-recall.json` names it for the lot-camera dataset review), telegram, discord, imessage, cloudinary-mediaflows, opencode. Toggle unused ones off in `/mcp` | each failing server costs startup time | Nour |
| F | `.remember/now.md` ledgers (17 and 19 days stale) under each app: retire them in favour of agent memory, or re-point the stale warning | cross-lane (app folders) | Nour / app lanes |

## Shop PCs (read-only, paste into each PC's own PowerShell)

NicksMax and MECHANICS: one line each prints uptime, free RAM, disk and the last run of every shop task.
```powershell
$o=Get-CimInstance Win32_OperatingSystem; "{0} up {1:N0} h, free {2:N0} MB, C: free {3:N0} GB" -f $env:COMPUTERNAME,((Get-Date)-$o.LastBootUpTime).TotalHours,($o.FreePhysicalMemory/1KB),((Get-PSDrive C).Free/1GB); Get-ScheduledTask | ? { $_.TaskName -match 'Nick|NOUR|lot|eufy|camera|car' } | % { $i=$_ | Get-ScheduledTaskInfo; "{0}: last {1} result {2}" -f $_.TaskName,$i.LastRunTime,$i.LastTaskResult }
```

## What this PR changed in the repo

1. `scripts/agent-os/promptSharpen.test.mjs`: bounded plant, kill by pid, no-outlive assertion.
2. `scripts/agent-os/orphans.mjs` + `orphans.test.mjs`: list and end the leak shape only.
3. `scripts/graphify-obsidian-sync.ps1`: step 1 through `Invoke-Bounded` (45 min ceiling, tree kill, ERROR, 124).
4. `scripts/graphify-session-context.ps1`: `graph sync: HUNG` when the sync lock is 90+ minutes old.
5. `scripts/agent-os/plugin-prune.mjs` + `pluginPrune.test.mjs`; `config/agent-os/required-plugins.json`: 11 wrong-stack
   plugins added to `reject` (each with its failure and 0 calls in 30 days), `knownConnectFailures` refreshed.

Machine-side, done by this session: the 36 leaked processes were ended with `orphans.mjs --kill` (all 36 matched the
planted-loop command line; 0 other shapes), and MEMORY.md was split into a short index plus `settled-index.md`
(24 finished-job lines moved unchanged; backup `_bak_MEMORY-2026-11-01.md.txt` in the memory folder).

## Benchmarked against

Benchmarked against: Claude Code docs, code.claude.com (permission-modes, auto-mode-config, mcp "tool search" and
plugin servers, env-vars `MCP_TIMEOUT` / `MCP_CONNECT_TIMEOUT_MS`, hooks `onFailure`, statusline), read 2026-11-01
through the claude-code-guide agent and spot-checked with `claude auto-mode config` on v2.1.296 ·
adopted: user-scope `autoMode` prose exception (step 3), turning off unused plugin servers (step 1 and E) ·
rejected: hook `onFailure: "block"` because the repo's hooks fail open on their own bugs by design (AGENTS.md) and a
blocked hook would stop every session; a status line, because none is set and its value here is unmeasured;
lowering `MCP_TIMEOUT` before step 1, because desktop-commander is required and timed out only while the CPU was pinned.

## Not done here, and why

- start_session brief delivery (one child got only "?"): the prompt is delivered by the desktop app, outside the repo.
  The existing mitigation stands: briefs live in a file and the prompt names the path. NOT CHECKED further.
- The hang's root cause inside `graphify update` is UNKNOWN (29 CPU-seconds in 5 h means it waited, not worked).
  The ceiling makes the next one loud and bounded; if it recurs, the log's ERROR line names the run to inspect.

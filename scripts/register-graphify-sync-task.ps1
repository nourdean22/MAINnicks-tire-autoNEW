# register-graphify-sync-task.ps1 - (re)create the "NOURCITY-Graphify-Sync"
# scheduled task that rebuilds the code knowledge graph weekly.
#
# Why this file exists: the task is machine-local state. Without a checked-in
# definition, scripts/graphify-session-context.ps1 names a task that nothing in
# the repo defines, and the whole freshness story dies silently on a new machine
# or an OS reinstall. Idempotent - safe to re-run.
#
# What the task does: runs scripts/graphify-obsidian-sync.ps1, which refreshes
# graphify-out/GRAPH_REPORT.md in this checkout and regenerates the Obsidian
# vault digests. graphify-out/* is gitignored apart from GRAPH_REPORT.md, so the
# rebuild lands in the WORKING copy only - never committed. The session hook
# reads that working copy directly (preferring the primary checkout over any
# worktree), which is why no commit step is needed.
#
# NOT to be confused with the "Statenour-Obsidian-Bridge" task: that guards the
# statenour BrainMemory daemon on a 5-minute cadence and is unrelated.
#
# Usage: powershell -File scripts/register-graphify-sync-task.ps1 [-At 4am] [-DayOfWeek Sunday]
param(
    [string]$TaskName = 'NOURCITY-Graphify-Sync',
    [string]$DayOfWeek = 'Sunday',
    [datetime]$At = '04:00',
    # Defaults to the checkout this script lives in. Point it at the PRIMARY
    # checkout - a worktree is transient and its removal would break the task.
    [string]$RepoRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'

$sync = Join-Path $RepoRoot 'scripts\graphify-obsidian-sync.ps1'
if (-not (Test-Path $sync)) { throw "sync script not found: $sync" }

if ($RepoRoot -match '\\\.claude\\worktrees\\') {
    Write-Warning "RepoRoot looks like a worktree: $RepoRoot"
    Write-Warning "Worktrees get torn down. Re-run with -RepoRoot pointing at the primary checkout."
}

# -NoProfile: a profile that writes to stdout or prompts would hang a hidden,
# non-interactive run. -ExecutionPolicy Bypass: the task has no console to
# approve an unsigned local script.
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$sync`""

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At $At

# StartWhenAvailable is the important one: this is a laptop, so the 4am slot is
# routinely missed with the lid shut. Without it a missed week is simply skipped
# and the graph silently ages. Battery flags let it run unplugged; graphify
# update is AST-only (no LLM, no network), so it is cheap enough not to care.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$desc = 'Weekly rebuild of the graphify code knowledge graph + Obsidian vault digests. ' +
        'Refreshes graphify-out/GRAPH_REPORT.md in the primary checkout, which ' +
        'scripts/graphify-session-context.ps1 reads at every Claude Code session start. ' +
        'Defined by scripts/register-graphify-sync-task.ps1.'

# -Force makes this an upsert rather than a duplicate-name failure on re-run.
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description $desc -Force | Out-Null

$info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
Write-Output "registered '$TaskName' -> $sync"
Write-Output "  schedule: weekly $DayOfWeek at $($At.ToString('HH:mm')) (next run: $($info.NextRunTime))"
Write-Output "  run it now with: Start-ScheduledTask -TaskName '$TaskName'"

# register-local-mcp-task.ps1 - (re)create the "NOURCITY-Local-MCP" scheduled task that starts the shared local MCP
# server(s) in config/agent-os/local-services.json (graphify since 2026-10-19; Serena was tried and dropped) when the current user logs on.
#
# Why a task: the servers are shared by every session, so nothing per-session should start them, and a reboot must not
# leave them DOWN until someone notices. scripts/agent-os/session-health.mjs reports the task MISSING or FAILED.
# Idempotent - safe to re-run. Mirrors register-graphify-sync-task.ps1.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-local-mcp-task.ps1 [-RepoRoot <primary>]
param(
    [string]$TaskName = 'NOURCITY-Local-MCP',
    # Point it at the PRIMARY checkout - a worktree is transient and its removal would break the task.
    [string]$RepoRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'

$script = Join-Path $RepoRoot 'scripts\local-mcp-servers.ps1'
if (-not (Test-Path $script)) { throw "launcher not found: $script" }

if ($RepoRoot -match '\\\.claude\\worktrees\\|\\\.worktrees\\') {
    Write-Warning "RepoRoot looks like a worktree: $RepoRoot"
    Write-Warning "Worktrees get torn down. Re-run with -RepoRoot pointing at the primary checkout."
}

# -NoProfile: a profile that prompts would hang a hidden run. -ExecutionPolicy Bypass: Windows PowerShell 5.1 here has
# every policy scope Undefined (= Restricted), so a plain -File is refused.
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Start"

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
# Also every 10 minutes after logon: a server that dies later (graphify's accept loop ended with WinError 64 on 2026-11-03)
# otherwise stays DOWN until the next logon, and every other PC that reads this graph sees a 502 meanwhile. -Start is a
# no-op while the server is UP and never starts a second one while it loads, so repeating it is the whole watchdog.
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10) `
    -RepetitionDuration ([TimeSpan]::MaxValue)).Repetition

# The servers are long-lived children started by the script; the task itself finishes in seconds.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

$desc = 'Starts the shared local MCP server(s) (graphify repo graph, read-only) over the primary ' +
        'checkout at logon and every 10 minutes after (a no-op while it is up). Defined by scripts/register-local-mcp-task.ps1; ports in config/agent-os/local-services.json.'

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description $desc -Force | Out-Null

Write-Output "registered '$TaskName' -> $script -Start (at logon of $env:USERNAME)"
Write-Output "  run it now with: Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "  check with: powershell -NoProfile -ExecutionPolicy Bypass -File `"$script`" -Status"

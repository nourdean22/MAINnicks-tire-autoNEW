# register-harness-snapshot-task.ps1 - (re)create the "NOURCITY-Harness-Snapshot" scheduled task, which
# runs scripts/agent-os/harness-snapshot.mjs every 5 minutes so bdnick and nickstire /admin can show this
# PC. Idempotent. It needs nourcity/harness-snapshot.json under %LOCALAPPDATA% (see the script's header).
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-harness-snapshot-task.ps1
param(
    [string]$TaskName = 'NOURCITY-Harness-Snapshot',
    # Defaults to the checkout this script lives in. Point it at the PRIMARY checkout: a worktree goes away.
    [string]$RepoRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'

$script = Join-Path $RepoRoot 'scripts\agent-os\harness-snapshot.mjs'
if (-not (Test-Path $script)) { throw "snapshot script not found: $script" }
if ($RepoRoot -match '\\\.claude\\worktrees\\') {
    throw "RepoRoot is a worktree: $RepoRoot. Re-run with -RepoRoot pointing at the primary checkout."
}
$node = (Get-Command node -ErrorAction Stop).Source
$config = Join-Path $env:LOCALAPPDATA 'nourcity\harness-snapshot.json'
if (-not (Test-Path $config)) { throw "config not found: $config. Write it first; the script's header has the shape." }

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)

# IgnoreNew: a slow gh or health read must not stack up a second copy. StartWhenAvailable covers a
# sleeping laptop, and a short limit keeps a hung run from holding the slot.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 3)

$desc = 'Sends a read-only harness snapshot (PRs, sessions, RAM, health, site commits) to bdnick every ' +
        '5 minutes. Push only: the sites cannot reach this PC. Defined by scripts/register-harness-snapshot-task.ps1.'

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description $desc -Force | Out-Null

Write-Output "registered '$TaskName'"
Write-Output "  run it now with: Start-ScheduledTask -TaskName '$TaskName'"

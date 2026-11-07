# register-machine-sync-task.ps1 - (re)create the "NOURCITY-Machine-Sync" scheduled task, which runs
# scripts/agent-os/machine-sync.mjs at logon and every hour: git pull --ff-only origin main on the PRIMARY checkout
# (clean main only), then bootstrap-machine.mjs in repair mode, then one receipt line to %LOCALAPPDATA%\nourcity.
# Nour, 2026-11-07: sync is automatic, never asked. Idempotent - safe to re-run. Mirrors register-harness-snapshot-task.ps1.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-machine-sync-task.ps1 [-RepoRoot <primary>]
# Remove: Unregister-ScheduledTask -TaskName 'NOURCITY-Machine-Sync' -Confirm:$false
param(
    [string]$TaskName = 'NOURCITY-Machine-Sync',
    # Defaults to the checkout this script lives in. Point it at the PRIMARY checkout: a worktree goes away.
    [string]$RepoRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'

$script = Join-Path $RepoRoot 'scripts\agent-os\machine-sync.mjs'
if (-not (Test-Path $script)) { throw "sync script not found: $script" }
if ($RepoRoot -match '\\\.claude\\worktrees\\|\\\.worktrees\\') {
    throw "RepoRoot is a worktree: $RepoRoot. Re-run with -RepoRoot pointing at the primary checkout."
}

# Through hidden PowerShell, as the repo's other tasks run: node.exe directly opens a console window on the
# desktop every tick, and one of these PCs is the shop's front desk. Quotes doubled, curly ones too: the shop
# PC's checkout sits under a user folder with an apostrophe in its name.
$node = (Get-Command node -ErrorAction Stop).Source -replace "['‘’‚‛]", '$0$0'
$quoted = $script -replace "['‘’‚‛]", '$0$0'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $RepoRoot `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"& '$node' '$quoted'`""

# At logon (a minute in, so the network is up) and then every hour for as long as the PC stays on.
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$atLogon.Delay = 'PT1M'
$hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
    -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)

# IgnoreNew: a slow pull must never stack a second copy; the limit covers a cold pull plus the bootstrap.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

$desc = 'Pulls origin/main into the primary checkout (clean main only) and repairs the machine half of the agent ' +
        'setup (bootstrap-machine.mjs) at logon and every hour. Receipt: %LOCALAPPDATA%\nourcity\machine-sync.json. ' +
        'Defined by scripts/register-machine-sync-task.ps1.'

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atLogon, $hourly) `
    -Settings $settings -Description $desc -Force | Out-Null

Write-Output "registered '$TaskName' -> $script (at logon of $env:USERNAME, then hourly)"
Write-Output "  run it now with: Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "  last result: node scripts/agent-os/machine-sync.mjs --status"

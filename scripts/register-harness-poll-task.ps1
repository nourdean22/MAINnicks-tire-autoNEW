# register-harness-poll-task.ps1 - (re)create the "NOURCITY-Harness-Poll" scheduled task, which runs
# scripts/agent-os/harness-poll.mjs every 1-2 minutes so this PC runs the allowlisted actions queued for it
# on bdnick (job 2026-11-06-harness-control-nick-node). Installing this task IS turning control on for this
# PC: without it, nothing queued for this PC ever runs. Idempotent.
#
# Needs %LOCALAPPDATA%\nourcity\harness-snapshot.json with "pc" and "controlKey" (the HARNESS_CONTROL_KEY
# value from Railway). What the task can run is config/agent-os/harness-actions.json in -RepoRoot, nothing more.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-harness-poll-task.ps1 [-WhatIf]
# Remove: Unregister-ScheduledTask -TaskName 'NOURCITY-Harness-Poll' -Confirm:$false
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$TaskName = 'NOURCITY-Harness-Poll',
    # Defaults to the checkout this script lives in. Point it at the PRIMARY checkout: a worktree goes away.
    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'
# Resolved here, not in the param default: Windows PowerShell 5.1 left $PSScriptRoot empty there (seen 2026-11-06).
if (-not $RepoRoot) { $RepoRoot = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent }

$script = Join-Path $RepoRoot 'scripts\agent-os\harness-poll.mjs'
$allow = Join-Path $RepoRoot 'config\agent-os\harness-actions.json'
if (-not (Test-Path $script)) { throw "poll script not found: $script" }
if (-not (Test-Path $allow)) { throw "allowlist not found: $allow" }
if ($RepoRoot -match '\\\.claude\\worktrees\\') {
    throw "RepoRoot is a worktree: $RepoRoot. Re-run with -RepoRoot pointing at the primary checkout."
}
$config = Join-Path $env:LOCALAPPDATA 'nourcity\harness-snapshot.json'
if (-not (Test-Path $config)) { throw "config not found: $config. Write it first (pc, url, controlKey)." }
$saved = Get-Content $config -Raw | ConvertFrom-Json
if (-not $saved.pc) { throw "config has no pc: $config" }
if (-not $saved.controlKey) { throw "config has no controlKey: add the HARNESS_CONTROL_KEY value to $config" }

# The poll interval is per PC class (the 2-core PCs poll every 2 minutes); the allowlist file carries it.
$list = Get-Content $allow -Raw | ConvertFrom-Json
$pcClass = $list.pcs.($saved.pc)
if (-not $pcClass) { throw "pc '$($saved.pc)' is not in $allow" }
$minutes = [Math]::Max(1, [int][Math]::Ceiling($pcClass.pollSeconds / 60))

# Through hidden PowerShell, as the snapshot task runs: node.exe directly opens a console window every
# tick, and one of these PCs is the shop's front desk. Quotes doubled, curly ones too: the shop PC's
# checkout sits under a user folder with an apostrophe in its name.
$node = (Get-Command node -ErrorAction Stop).Source -replace "['‘’‚‛]", '$0$0'
$quoted = $script -replace "['‘’‚‛]", '$0$0'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $RepoRoot `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"& '$node' '$quoted'`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $minutes) -RepetitionDuration (New-TimeSpan -Days 3650)

# IgnoreNew: one action at a time per PC, so a slow action can never stack a second poll on top of it.
# The limit sits above the longest action timeout in the allowlist (120 s) plus the two HTTP calls.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

$desc = "Runs the allowlisted harness actions bdnick queued for this PC ($($saved.pc)), every $minutes min. " +
        'Only names in config/agent-os/harness-actions.json run. Defined by scripts/register-harness-poll-task.ps1.'

if ($PSCmdlet.ShouldProcess($TaskName, "register (every $minutes min, pc $($saved.pc), repo $RepoRoot)")) {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Description $desc -Force | Out-Null
    Write-Output "registered '$TaskName' for $($saved.pc), every $minutes min"
    Write-Output "  run it now with: Start-ScheduledTask -TaskName '$TaskName'"
}

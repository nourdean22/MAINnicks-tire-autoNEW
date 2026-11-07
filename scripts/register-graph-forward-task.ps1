# register-graph-forward-task.ps1 - (re)create the "NOURCITY-Graph-Forward" scheduled task that runs
# scripts/agent-os/graph-forward.mjs at logon, on a PC that does NOT serve the code graph (NicksMax, MECHANICS).
# The forwarder listens on 127.0.0.1:8765 and passes every request to NATTYNOUR's graphify over the tailnet, so the
# loopback URL every program and hook already uses works on this PC too (docs/agent-os/TAILNET-MCP.md).
#
# Never run on NATTYNOUR: it serves the graph itself (the forwarder refuses to start there, and this script says so).
# Idempotent - safe to re-run. Mirrors register-local-mcp-task.ps1.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-graph-forward-task.ps1 [-RepoRoot <primary>]
param(
    [string]$TaskName = 'NOURCITY-Graph-Forward',
    # Point it at the PRIMARY checkout - a worktree is transient and its removal would break the task.
    [string]$RepoRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'

$config = Get-Content (Join-Path $RepoRoot 'config\agent-os\local-services.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (@($config.hosts) | Where-Object { $_ -ieq $env:COMPUTERNAME }) {
    throw "$env:COMPUTERNAME serves the graph itself (config/agent-os/local-services.json hosts); nothing to forward."
}

$script = Join-Path $RepoRoot 'scripts\agent-os\graph-forward.mjs'
if (-not (Test-Path $script)) { throw "forwarder not found: $script" }
$node = (Get-Command node -ErrorAction Stop | Select-Object -First 1).Source

if ($RepoRoot -match '\\\.claude\\worktrees\\|\\\.worktrees\\') {
    Write-Warning "RepoRoot looks like a worktree: $RepoRoot"
    Write-Warning "Worktrees get torn down. Re-run with -RepoRoot pointing at the primary checkout."
}

# The task stays running as long as the forwarder does, so: no time limit, and a restart if it dies.
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"& '$node' '$script'`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$desc = 'Forwards 127.0.0.1:8765 to the code-graph MCP server on NATTYNOUR over the tailnet. ' +
        'Defined by scripts/register-graph-forward-task.ps1; address in config/agent-os/local-services.json (remoteUrl).'

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description $desc -Force | Out-Null

Write-Output "registered '$TaskName' -> $node $script (at logon of $env:USERNAME)"
Write-Output "  run it now with: Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "  remove it with: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"

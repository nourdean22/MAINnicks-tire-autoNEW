# graphify-sync-launcher.ps1 - launch graphify-obsidian-sync.ps1 DETACHED.
#
# WHY THIS EXISTS. Pointing the scheduled task straight at the sync script does
# not work on this machine. Measured 2026-08-03: the task reached 100% AST
# extraction (5,602 files) and then died at ~106s with exit 0xC000013A
# (STATUS_CONTROL_C_EXIT) having written NOTHING - no graph.json, no report, no
# vault digests, and no ERROR line, because the script's own error paths never
# ran. It was killed from outside. The identical script run by hand, and again
# via Start-Process, completes in ~195s with exit 0.
#
# Same failure and same fix as the statenour bridge - see the header of
# ~/statenour-obsidian-bridge-guard.ps1, which names 0xC000013A explicitly:
# a scheduled task's console teardown delivers Ctrl+C to processes attached to
# it. Start-Process gives the child its OWN console, so nothing the task does on
# the way out can signal it.
#
# The trade-off this accepts: the task's recorded result reflects the LAUNCH,
# not the sync. It goes green seconds after firing while the real work runs on.
# graphify-out/obsidian-sync.log is the record of what actually happened - it
# ends with "=== sync done ===" on success. That is the right trade for a weekly
# batch job; wiring the exit code back would mean waiting on the child, which is
# exactly the coupling that causes the kill.
#
# Usage: powershell -File scripts/graphify-sync-launcher.ps1
param(
    [string]$SyncScript = (Join-Path $PSScriptRoot 'graphify-obsidian-sync.ps1')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $SyncScript)) { throw "sync script not found: $SyncScript" }

# Quote the path: -ArgumentList joins on spaces, so an unquoted path containing
# one would arrive as two arguments and -File would take only the first.
$proc = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru `
    -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$SyncScript`""

if (-not $proc) { throw "Start-Process returned no process for $SyncScript" }

Write-Output "launched detached: $SyncScript (pid $($proc.Id))"
Write-Output "progress + outcome: graphify-out/obsidian-sync.log (ends with '=== sync done ===')"

# Behaviour harness for scripts/nicksmax/nicksmax-camera-supervisor.ps1 (driven by
# tests/test_nicksmax_supervisor.py). Loads the supervisor's FUNCTIONS from its AST -- never the
# top-level body, which opens a lock file on C:\ and talks to Task Scheduler -- then shadows every
# cmdlet that touches the machine with a fake that records what was asked of it, runs ONE scenario
# and prints a single JSON line: { scenario, calls, log, state, markers }.
#
# Later function definitions win name resolution in PowerShell, so the fakes below are defined
# AFTER the supervisor's functions and shadow both the real cmdlets (Stop-Process,
# Get-ScheduledTask, ...) and the supervisor's own machine probes (Port-Open,
# Get-OfficeCodeFingerprint). Works under Windows PowerShell 5.1 and pwsh 7 on any OS.
param(
  [Parameter(Mandatory = $true)][string]$ScriptPath,
  [Parameter(Mandatory = $true)][string]$Scenario,
  [string]$WorkDir = ""
)
$ErrorActionPreference = "Stop"

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors -and $parseErrors.Count -gt 0) {
  throw ("supervisor does not parse: " + (($parseErrors | ForEach-Object { $_.Message }) -join "; "))
}
$functionAsts = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)

if (-not $WorkDir) { $WorkDir = Join-Path ([IO.Path]::GetTempPath()) ("supervisor-harness-" + [guid]::NewGuid().ToString("n")) }
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

# ---- script-scope variables the supervisor's functions close over ------------------------------
# These are the HARNESS's values, not the script's: the top-level body never runs here, so the
# constants it declares ($eufyPortMissesBeforeRestart, the 0.5 coverage floor, 1GB/2GB disk
# thresholds) are pinned by the text assertions in test_nicksmax_supervisor.py, and these probes
# check that the functions honour whatever value is in scope.
$root = $WorkDir
$log = Join-Path $WorkDir "supervisor.log"
$statePath = Join-Path $WorkDir "state.json"
$state = @{}
$nowEpoch = 1760000000
$escalateRestartsPerHour = 6
$eufyPortMissesBeforeRestart = 3
$officeTask = "StateNour-OfficeIntelligence-NicksMax"
$officeStatusPath = Join-Path $WorkDir "office-conversation-status.json"
$officeAudioDir = Join-Path $WorkDir "audio"
$officeHeartbeatStaleMinutes = 10
$officeListeningCoverageFloor = 0.5
$diskFloorBytes = 1GB
$diskWarnBytes = 2GB
$eufyTasks = @(
  @{ Name = "StateNour-Eufy-Bridge-NicksMax"; Port = 3000; Key = "eufy-bridge" },
  @{ Name = "StateNour-Eufy-Agent-NicksMax";  Port = 3601; Key = "eufy-agent" }
)

foreach ($fn in $functionAsts) { . ([scriptblock]::Create($fn.Extent.Text)) }

# ---- fakes ---------------------------------------------------------------------------------------
$calls = New-Object System.Collections.Generic.List[string]
$fakeProcesses = New-Object System.Collections.Generic.List[object]
$portOwners = @{}
$taskStates = @{}
$killed = New-Object System.Collections.Generic.List[int]
# A pid in here survives Stop-Process (the call is recorded as refused): the kill-failed arm of
# the edge code-change rule. $failStart makes Start-ScheduledTask throw: the start-failed arm of
# the office code-change rule. Both default to the happy path.
$unkillable = New-Object System.Collections.Generic.List[int]
$failStart = $false
$markers = @{}

function Add-FakeProcess([int]$processId, [string]$name, [string]$commandLine, [int]$ageSeconds, [int]$parentProcessId = 0, [string]$executablePath = '') {
  $fakeProcesses.Add([pscustomobject]@{
    ProcessId       = $processId
    ParentProcessId = $parentProcessId
    Name            = $name
    CommandLine     = $commandLine
    ExecutablePath  = $executablePath
    CreationDate    = (Get-Date).AddSeconds(-1 * $ageSeconds)
  })
}
function Get-CimInstance { param([string]$ClassName, $ErrorAction)
  return @($fakeProcesses | Where-Object { $killed -notcontains $_.ProcessId })
}
function Stop-Process { param([int]$Id, [switch]$Force, $ErrorAction)
  if ($unkillable -contains $Id) {
    $calls.Add("stop-pid:${Id}:refused")
    return
  }
  $killed.Add($Id)
  $calls.Add("stop-pid:$Id")
}
function Get-Process { param([int]$Id, $ErrorAction)
  $p = $fakeProcesses | Where-Object { $_.ProcessId -eq $Id } | Select-Object -First 1
  if ($p) { return [pscustomobject]@{ Id = $Id; ProcessName = ($p.Name -replace '\.exe$', '') } }
}
function Get-NetTCPConnection { param([int]$LocalPort, [string]$State, $ErrorAction)
  if ($portOwners.ContainsKey($LocalPort) -and ($killed -notcontains $portOwners[$LocalPort])) {
    return [pscustomobject]@{ LocalPort = $LocalPort; State = "Listen"; OwningProcess = $portOwners[$LocalPort] }
  }
}
function Stop-ScheduledTask { param([string]$TaskName, $ErrorAction) $calls.Add("stop-task:$TaskName") }
function Start-ScheduledTask { param([string]$TaskName, $ErrorAction)
  if ($failStart) { throw "Start-ScheduledTask refused by the harness" }
  $calls.Add("start-task:$TaskName")
}
function Set-ScheduledTask { param([string]$TaskName, $Action, $ErrorAction) $calls.Add("set-task:$TaskName") }
function Get-ScheduledTask { param([string]$TaskName, $ErrorAction)
  if ($taskStates.ContainsKey($TaskName)) {
    return [pscustomobject]@{
      TaskName = $TaskName
      State    = $taskStates[$TaskName]
      Actions  = @([pscustomobject]@{ WorkingDirectory = $root })
    }
  }
}
function Start-Sleep { param($Milliseconds, $Seconds) }
function Port-Open { param([int]$port, [int]$timeoutMs = 1500)
  if ($portOwners.ContainsKey($port)) { return ($killed -notcontains $portOwners[$port]) }
  return $false
}
# Code-fingerprint restarts are a separate concern; pin them off so the office scenarios only
# exercise the orphan / heartbeat / coverage paths.
function Get-OfficeCodeFingerprint([string]$dir) { return "" }

function Set-OfficeStatus([int]$heartbeatAgeMinutes, [string]$workerState, $coverage, [int]$failures = 0, [int]$wakes = 0, [int]$captures = 0) {
  $payload = @{
    conversationWorkerHeartbeatAt = [DateTime]::UtcNow.AddMinutes(-1 * $heartbeatAgeMinutes).ToString("o")
    conversationWorkerState       = $workerState
  }
  if ($null -ne $coverage) {
    $payload["conversationListeningCoverage60m"] = $coverage
    $payload["conversationCaptureFailuresLast60m"] = $failures
    $payload["conversationWakeTriggersLast60m"] = $wakes
    $payload["conversationCapturesLast60m"] = $captures
  }
  Set-Content -LiteralPath $officeStatusPath -Value ($payload | ConvertTo-Json -Compress) -Encoding ascii
}
function Install-OfficeCode {
  # The supervisor checks `Test-Path (Join-Path $workDir "vision\officewake.py")`; on Linux that is a
  # file literally named with a backslash, on Windows a real sub-directory. Either way it must exist.
  New-Item -ItemType File -Force -Path (Join-Path $root "vision\officewake.py") | Out-Null
}

# The bridge's node as start-bridge-nicksmax.ps1 launches it since 2026-10-08, byte for byte as
# probed on NicksMax at 22:03Z (pid 29724; Start-Process leaves the trailing space): server.mjs by
# its absolute path under the Eufy install. node.exe's own executable is the system node, which
# says nothing, so that path is the whole identity.
$bridgeNode = '"C:\Program Files\nodejs\node.exe" "C:\Users\nourd\AppData\Local\StateNour\Eufy\ha-eufy-sdk-bridge-0.3.0\server.mjs" '
# Any other node project's server.mjs: the commonest entry-point name there is, often on :3000.
$unrelatedNode = '"C:\Program Files\nodejs\node.exe" C:\Users\nourd\dev\shop-site\server.mjs'
# The launcher's form before 2026-10-08 (pid 25348, probed the same day): no path, so no identity.
$relativeNode = '"C:\Program Files\nodejs\node.exe" server.mjs '
# The bridge's go2rtc as probed on NicksMax 2026-10-08: a command line any go2rtc could print, and
# an executable under the bridge install. Only the executable path makes it this task's child.
$bridgeGo2rtcCmd = 'go2rtc -config ./go2rtc.yaml'
$bridgeGo2rtcExe = 'C:\Users\nourd\AppData\Local\StateNour\Eufy\ha-eufy-sdk-bridge-0.3.0\go2rtc.exe'
$agentPython = 'C:\Users\nourd\venv\Scripts\python.exe agent.py --eufy-only'
$officePython = 'C:\Users\nourd\python\python.exe -m vision.officewake --capture'
$edgePython = 'C:\Users\nourd\venv\Scripts\python.exe edge_main.py --config data\config-nicksmax-sign-production.yaml'

function Install-EdgeCode([string]$version) {
  # Get-EdgeCodeFingerprint hashes edge_main.py at the root (plus visitd\ and vision\ modules when
  # they exist); one root file is enough to give the harness a fingerprint that changes on edit.
  Set-Content -LiteralPath (Join-Path $root "edge_main.py") -Value ("# sign edge " + $version) -Encoding ascii
}

switch ($Scenario) {
  "kick-restart-order" {
    Add-FakeProcess 11 "node.exe" $bridgeNode 600
    Add-FakeProcess 12 "go2rtc.exe" $bridgeGo2rtcCmd 590 11 $bridgeGo2rtcExe
    Add-FakeProcess 13 "Code.exe" 'Code.exe C:\notes\go2rtc.yaml server.mjs' 5000
    Add-FakeProcess 21 "python.exe" $agentPython 600
    $portOwners[3000] = 11; $portOwners[1984] = 12; $portOwners[3601] = 21
    Kick-Task "StateNour-Eufy-Bridge-NicksMax" "eufy-bridge" "harness restart" $true 0
  }
  "dedupe-agent-keeps-port-owner" {
    Add-FakeProcess 21 "python.exe" $agentPython 7200
    Add-FakeProcess 22 "python.exe" $agentPython 60
    $portOwners[3601] = 22
    $taskStates["StateNour-Eufy-Agent-NicksMax"] = "Running"
    Heal-EufyTask $eufyTasks[1]
  }
  "dedupe-agent-keeps-oldest-without-owner" {
    Add-FakeProcess 21 "python.exe" $agentPython 7200
    Add-FakeProcess 22 "python.exe" $agentPython 60
    $taskStates["StateNour-Eufy-Agent-NicksMax"] = "Running"
    Heal-EufyTask $eufyTasks[1]
  }
  "dedupe-venv-launcher-pair-is-one-worker" {
    # A venv python.exe is a launcher: the real interpreter is its CHILD with the same command
    # line (witnessed 2026-10-08, pairs 50-360 ms apart). One worker, two matching processes.
    Add-FakeProcess 21 "python.exe" $agentPython 600
    Add-FakeProcess 22 "python.exe" $agentPython 599 21
    $portOwners[3601] = 22
    $taskStates["StateNour-Eufy-Agent-NicksMax"] = "Running"
    Heal-EufyTask $eufyTasks[1]
  }
  "dedupe-two-venv-trees-ends-the-newer-tree" {
    Add-FakeProcess 21 "python.exe" $agentPython 600
    Add-FakeProcess 22 "python.exe" $agentPython 599 21
    Add-FakeProcess 23 "python.exe" $agentPython 60
    Add-FakeProcess 24 "python.exe" $agentPython 59 23
    $portOwners[3601] = 22
    $taskStates["StateNour-Eufy-Agent-NicksMax"] = "Running"
    Heal-EufyTask $eufyTasks[1]
  }
  "office-venv-launcher-pair-not-deduped" {
    Install-OfficeCode
    Add-FakeProcess 31 "python.exe" $officePython 600
    Add-FakeProcess 32 "python.exe" $officePython 599 31
    $taskStates[$officeTask] = "Running"
    Set-OfficeStatus 1 "READY" $null
    Heal-OfficeWorker
  }
  "reclaim-orphan" {
    Add-FakeProcess 11 "node.exe" $bridgeNode 600
    Add-FakeProcess 12 "go2rtc.exe" $bridgeGo2rtcCmd 590 11 $bridgeGo2rtcExe
    $portOwners[3000] = 11; $portOwners[1984] = 12
    $taskStates["StateNour-Eufy-Bridge-NicksMax"] = "Ready"
    Heal-EufyTask $eufyTasks[0]
    Heal-EufyTask $eufyTasks[0]
  }
  "start-when-ready-and-closed" {
    $taskStates["StateNour-Eufy-Bridge-NicksMax"] = "Ready"
    Heal-EufyTask $eufyTasks[0]
  }
  "three-misses-before-restart" {
    Add-FakeProcess 11 "node.exe" $bridgeNode 600
    $taskStates["StateNour-Eufy-Bridge-NicksMax"] = "Running"
    Heal-EufyTask $eufyTasks[0]
    Heal-EufyTask $eufyTasks[0]
    $markers["callsAfterTwoTicks"] = $calls.Count
    Heal-EufyTask $eufyTasks[0]
  }
  "office-orphan-reclaimed" {
    Install-OfficeCode
    Add-FakeProcess 31 "python.exe" $officePython 600
    $taskStates[$officeTask] = "Ready"
    Set-OfficeStatus 1 "READY" $null
    Heal-OfficeWorker
  }
  "office-heartbeat-stale-restarts" {
    Install-OfficeCode
    Add-FakeProcess 31 "python.exe" $officePython 600
    $taskStates[$officeTask] = "Running"
    Set-OfficeStatus 30 "READY" $null
    Heal-OfficeWorker
  }
  "office-coverage-low-warns" {
    # 20% listened, two captures failed this hour: the low coverage is explained -> WARN once.
    Install-OfficeCode
    Add-FakeProcess 31 "python.exe" $officePython 600
    $taskStates[$officeTask] = "Running"
    Set-OfficeStatus 1 "READY" 0.2 2 5 3
    Heal-OfficeWorker
    Heal-OfficeWorker
  }
  "office-coverage-low-quiet-silent" {
    # 10% listened, but no wakes arrived and nothing failed: a quiet office, not a deaf worker.
    Install-OfficeCode
    Add-FakeProcess 31 "python.exe" $officePython 600
    $taskStates[$officeTask] = "Running"
    Set-OfficeStatus 1 "READY" 0.1 0 0 0
    Heal-OfficeWorker
  }
  "office-coverage-low-deaf-warns" {
    # Wakes arrived and none became a capture: deaf, even with zero recorded failures.
    Install-OfficeCode
    Add-FakeProcess 31 "python.exe" $officePython 600
    $taskStates[$officeTask] = "Running"
    Set-OfficeStatus 1 "READY" 0.0 0 4 0
    Heal-OfficeWorker
  }
  "office-coverage-ok-silent" {
    Install-OfficeCode
    Add-FakeProcess 31 "python.exe" $officePython 600
    $taskStates[$officeTask] = "Running"
    Set-OfficeStatus 1 "READY" 0.9 0 6 5
    Heal-OfficeWorker
  }
  "edge-code-changed-restarts" {
    # Armed, healthy production edge (pid 41 owns :9095), first sight of the tree: end it once and
    # record the fingerprint. Same tree again: nothing. Edited again inside the 10-minute window:
    # wait, and keep the OLD fingerprint so a later tick retries instead of forgetting the change.
    Install-EdgeCode "v1"
    Add-FakeProcess 41 "python.exe" $edgePython 3600
    $portOwners[9095] = 41
    # The launcher wrapper (pid 40) is the edge's parent for its whole life; it must not shield it.
    Add-FakeProcess 40 "powershell.exe" 'powershell.exe -NoProfile -File C:\x\data\run-sign-rtsp-production.ps1' 3601
    $markers["first"] = [bool](Heal-EdgeCode $true $true)
    $markers["fingerprintAfterFirst"] = [string](Get-Entry "edge-code-version").fingerprint
    $markers["second"] = [bool](Heal-EdgeCode $true $true)
    Install-EdgeCode "v2"
    $markers["third"] = [bool](Heal-EdgeCode $true $true)
    $markers["fingerprintAfterThrottle"] = [string](Get-Entry "edge-code-version").fingerprint
  }
  "edge-code-leaves-unarmed-or-down-edge-alone" {
    Install-EdgeCode "v1"
    Add-FakeProcess 41 "python.exe" $edgePython 3600
    $portOwners[9095] = 41
    $markers["unarmed"] = [bool](Heal-EdgeCode $false $true)
    $markers["down"] = [bool](Heal-EdgeCode $true $false)
    $markers["fingerprint"] = [string](Get-Entry "edge-code-version").fingerprint
  }
  "edge-code-fingerprint-skips-office-modules" {
    Install-EdgeCode "v1"
    $before = Get-EdgeCodeFingerprint $root
    New-Item -ItemType Directory -Force -Path (Join-Path $root "vision") | Out-Null
    Set-Content -LiteralPath (Join-Path (Join-Path $root "vision") "officewake.py") -Value "# office" -Encoding ascii
    $markers["unchangedByOfficeModule"] = ($before -eq (Get-EdgeCodeFingerprint $root))
    Set-Content -LiteralPath (Join-Path (Join-Path $root "vision") "pipeline.py") -Value "# edge module" -Encoding ascii
    $markers["changedByEdgeModule"] = ($before -ne (Get-EdgeCodeFingerprint $root))
  }
  "log-locked-falls-back" {
    # Another process holds the log open with no sharing (2026-10-08: a remote-admin reverse
    # read): the line must land in $log.overflow instead of vanishing, and ordinary logging
    # must resume on the main file once the handle is gone.
    Set-Content -LiteralPath $log -Value "existing" -Encoding ascii
    $h = [IO.File]::Open($log, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    # The supervisor runs under $ErrorActionPreference = "Continue" (its first line), where a
    # sharing violation on Add-Content is NON-terminating: no throw, no catch, no fallback. The
    # harness sets "Stop" at the top, which made the first version of this probe pass while the
    # box wrote nothing anywhere (2026-10-08 07:48, the sign-edge restart). Mirror the real
    # preference for the locked write.
    $saved = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { Log "while locked" 2>$null } finally { $h.Dispose(); $ErrorActionPreference = $saved }
    Log "after unlock"
    $markers["overflowExists"] = [bool](Test-Path -LiteralPath ($log + ".overflow"))
    $markers["overflowText"] = if ($markers["overflowExists"]) { [string](Get-Content -LiteralPath ($log + ".overflow") -Raw) } else { "" }
  }
  "log-read-by-a-sharing-reader" {
    # The 2026-10-08 holder exactly: a reader that shares Read, Write and Delete, as Node's fs.open
    # does (Desktop Commander's tail, pid 9580). Windows PowerShell 5.1's Add-Content refused to
    # open the log beside it for 11 hours. This probe bites only under Windows PowerShell 5.1:
    # pwsh 6.2+ opens with read sharing (PowerShell PR #8091) and Linux .NET does not enforce it,
    # so CI pins the writer through the text contract instead.
    Set-Content -LiteralPath $log -Value "existing" -Encoding ascii
    $h = [IO.File]::Open($log, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $saved = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { Log "while read" 2>$null } finally { $h.Dispose(); $ErrorActionPreference = $saved }
    $markers["overflowExists"] = [bool](Test-Path -LiteralPath ($log + ".overflow"))
  }
  "overflow-restored-into-log" {
    # The box's file shape: Windows PowerShell 5.1's Add-Content -Encoding utf8 opened the overflow
    # with a BOM. The lines go back into the log in order, under one NOTE, without the BOM.
    Set-Content -LiteralPath $log -Value "2026-10-08 07:34:08 last line before the lock" -Encoding ascii
    $bom = [byte[]](0xEF, 0xBB, 0xBF)
    $body = [Text.Encoding]::ASCII.GetBytes("2026-10-08 08:20:14 ACTION first stranded`r`n2026-10-08 18:51:13 ACTION last stranded`r`n")
    [IO.File]::WriteAllBytes($log + ".overflow", $bom + $body)
    Restore-Overflow
    Log "after restore"
    $bytes = [IO.File]::ReadAllBytes($log)
    $inner = $false
    for ($i = 1; $i -le $bytes.Length - 3; $i++) { if ($bytes[$i] -eq 0xEF -and $bytes[$i + 1] -eq 0xBB -and $bytes[$i + 2] -eq 0xBF) { $inner = $true } }
    $markers["innerBom"] = $inner
    $markers["leftovers"] = @(Get-ChildItem -Path ($log + ".overflow*") | ForEach-Object { $_.Name })
  }
  "overflow-restore-waits-for-the-log" {
    # The log is held by a reader that refuses writers. The claimed batch must wait, newer lines
    # must queue behind it, and once the log opens both land in order exactly once.
    Set-Content -LiteralPath $log -Value "2026-10-08 07:00:00 before" -Encoding ascii
    Set-Content -LiteralPath ($log + ".overflow") -Value @("2026-10-08 08:00:00 stranded one", "2026-10-08 08:00:30 stranded two") -Encoding ascii
    $h = [IO.File]::Open($log, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $saved = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      Restore-Overflow
      $markers["restoringWhileLocked"] = @(Get-ChildItem -Path ($log + ".overflow.restoring.*")).Count -eq 1
      Log "queued while locked" 2>$null
    } finally { $h.Dispose(); $ErrorActionPreference = $saved }
    # One restore per tick, as the supervisor runs it: the newer lines must land in THIS tick,
    # ahead of its own line, then a second tick must change nothing.
    Restore-Overflow | Out-Null
    Log "after"
    Restore-Overflow | Out-Null
    $markers["leftovers"] = @(Get-ChildItem -Path ($log + ".overflow*") | ForEach-Object { $_.Name })
  }
  "overflow-batch-held-by-a-reader-lands-once" {
    # A pending batch (its append failed while the log was blocked) is then held open by a reader
    # that refuses delete-sharing, as 5.1's Get-Content -Wait does. Moving the batch BEFORE appending
    # it is what keeps it from landing again on every tick while that reader stays open. Bites on
    # Windows under any PowerShell (Windows enforces delete-sharing); Linux allows the move, so
    # there the batch simply lands at once.
    Set-Content -LiteralPath $log -Value "2026-10-08 07:00:00 before" -Encoding ascii
    Set-Content -LiteralPath ($log + ".overflow") -Value "2026-10-08 08:00:00 stranded one" -Encoding ascii
    $saved = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $h = [IO.File]::Open($log, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      try { Restore-Overflow } finally { $h.Dispose() }
      $pending = @(Get-ChildItem -Path ($log + ".overflow.restoring.*"))
      $markers["pendingAfterBlockedAppend"] = $pending.Count
      $r = [IO.File]::Open($pending[0].FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      try { Restore-Overflow; Restore-Overflow } finally { $r.Dispose() }
      Restore-Overflow
    } finally { $ErrorActionPreference = $saved }
    Log "after"
    $markers["leftovers"] = @(Get-ChildItem -Path ($log + ".overflow*") | ForEach-Object { $_.Name })
  }
  "restore-blocked-is-reported" {
    # A reader holds the overflow so the restore cannot take it (Windows: the claim rename is
    # refused; Linux: the read is). The tick must say so once an hour, not leave the lines stranded
    # beside a log that looks healthy, and restore them once the reader lets go.
    Set-Content -LiteralPath $log -Value "2026-10-08 07:00:00 before" -Encoding ascii
    Set-Content -LiteralPath ($log + ".overflow") -Value "2026-10-08 08:00:00 stranded" -Encoding ascii
    $saved = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $h = [IO.File]::Open($log + ".overflow", [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
      try {
        $why = Restore-Overflow
        $markers["why"] = [string]$why
        Report-BlockedRestore $why
        Report-BlockedRestore (Restore-Overflow)
      } finally { $h.Dispose() }
      $markers["afterRelease"] = [string](Restore-Overflow)
    } finally { $ErrorActionPreference = $saved }
    Log "after"
  }
  "state-write-beside-a-sharing-reader" {
    $state["eufy-bridge"] = @{ restarts = @(1759999000.0); escalatedAt = 0; portMisses = 2; fingerprint = "" }
    Set-Content -LiteralPath $statePath -Value "{}" -Encoding ascii
    $h = [IO.File]::Open($statePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $saved = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { Save-State 2>$null } finally { $h.Dispose(); $ErrorActionPreference = $saved }
    $markers["portMissesOnDisk"] = [int]((Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json)."eufy-bridge".portMisses)
  }
  "state-write-failure-is-logged" {
    # A ledger that cannot be written must say so. Pins the WARN for a holder that refuses writers
    # (the old Set-Content also warned here: under 5.1 its failure is terminating).
    $state["eufy-bridge"] = @{ restarts = @(); escalatedAt = 0; portMisses = 1; fingerprint = "" }
    Set-Content -LiteralPath $statePath -Value "{}" -Encoding ascii
    $h = [IO.File]::Open($statePath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $saved = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { Save-State 2>$null } finally { $h.Dispose(); $ErrorActionPreference = $saved }
  }
  "disk-floor" {
    New-Item -ItemType Directory -Force -Path $officeAudioDir | Out-Null
    $stale = Join-Path $officeAudioDir "stale.wav"
    $fresh = Join-Path $officeAudioDir "fresh.wav"
    Set-Content -LiteralPath $stale -Value ("x" * 4096) -Encoding ascii
    Set-Content -LiteralPath $fresh -Value ("x" * 4096) -Encoding ascii
    (Get-Item -LiteralPath $stale).LastWriteTime = (Get-Date).AddHours(-7)
    # A 21 MB supervisor log must rotate.
    $filler = New-Object byte[] (21 * 1024 * 1024)
    [IO.File]::WriteAllBytes($log, $filler)
    Invoke-DiskFloor (512MB)
    $markers["staleAudioRemains"] = [bool](Test-Path -LiteralPath $stale)
    $markers["freshAudioRemains"] = [bool](Test-Path -LiteralPath $fresh)
    $markers["rotatedLogExists"] = [bool](Test-Path -LiteralPath ($log + ".1"))
  }
  "port-owner-identity" {
    # Four listeners on managed ports (Codex on #2920: the image name alone was identity):
    #   :3000 an unrelated node (not server.mjs)        -> left alone, named in the log
    #   :1984 a go2rtc whose command line is unreadable -> left alone: a guess is not identity
    #   :8654 the real bridge child                      -> ended
    #   :8655 the real go2rtc, probed with NO needles    -> left alone: nothing to verify against
    Add-FakeProcess 61 "node.exe" '"C:\Program Files\nodejs\node.exe" C:\other\app.js' 600
    Add-FakeProcess 62 "go2rtc.exe" '' 600
    Add-FakeProcess 11 "node.exe" $bridgeNode 600
    Add-FakeProcess 12 "go2rtc.exe" $bridgeGo2rtcCmd 590 11 $bridgeGo2rtcExe
    $portOwners[3000] = 61; $portOwners[1984] = 62; $portOwners[8654] = 11; $portOwners[8655] = 12
    $spec = Get-TaskChildSpec "eufy-bridge"
    foreach ($port in @(3000, 1984, 8654)) { Stop-PortOwner $port ("eufy-bridge :{0} owner" -f $port) $spec.Needles }
    Stop-PortOwner 8655 "eufy-bridge :8655 owner"
  }
  "unrelated-go2rtc-survives-bridge-restart" {
    # Codex on #2931: the go2rtc needle was the bare image, so the needle sweep ended EVERY go2rtc
    # before the guarded port pass ran. Same command line as ours, a different install:
    #   63 an unrelated go2rtc, readable, holding managed :8655 -> left alone by the sweep and the port pass
    #   62 a go2rtc this token cannot read                       -> left alone: a guess is not identity
    #   11, 12 the bridge's node and go2rtc                      -> ended. 12 holds no port (it lost its
    #      listener), so only the sweep can end it: the sweep must know it by its executable.
    Add-FakeProcess 11 "node.exe" $bridgeNode 600
    Add-FakeProcess 12 "go2rtc.exe" $bridgeGo2rtcCmd 590 11 $bridgeGo2rtcExe
    Add-FakeProcess 63 "go2rtc.exe" $bridgeGo2rtcCmd 900 0 'C:\Tools\go2rtc\go2rtc.exe'
    Add-FakeProcess 62 "go2rtc.exe" '' 900
    $portOwners[3000] = 11; $portOwners[8655] = 63
    Kick-Task "StateNour-Eufy-Bridge-NicksMax" "eufy-bridge" "harness restart" $true 0
  }
  "unrelated-go2rtc-is-not-a-duplicate" {
    # A healthy tick dedupes every child needle. With the bare-image needle the bridge's go2rtc and an
    # unrelated, OLDER one were two roots of one worker, neither owning :3000, so the newer -- the
    # bridge's -- was ended on every tick.
    Add-FakeProcess 11 "node.exe" $bridgeNode 600
    Add-FakeProcess 12 "go2rtc.exe" $bridgeGo2rtcCmd 590 11 $bridgeGo2rtcExe
    Add-FakeProcess 63 "go2rtc.exe" $bridgeGo2rtcCmd 7200 0 'C:\Tools\go2rtc\go2rtc.exe'
    $portOwners[3000] = 11; $portOwners[1984] = 12
    $taskStates["StateNour-Eufy-Bridge-NicksMax"] = "Running"
    Heal-EufyTask $eufyTasks[0]
  }
  "unrelated-node-survives-bridge-restart" {
    # The node needle was any `node ... server.mjs`, so a restart's needle sweep would end every node
    # server.mjs on the host before the guarded port pass ran -- the go2rtc defect from #2931 again.
    #   64 another project's node server.mjs, holding :3000 (every dev server's default) -> left alone
    #      by the sweep and by the port pass
    #   65 a node server.mjs with no path (the launcher's old form)                   -> left alone:
    #      a bare file name is not identity, which is why the launcher had to change first
    #   11, 12 the bridge's node and go2rtc -> ended. 11 lost its listener, so only the sweep can end it.
    Add-FakeProcess 11 "node.exe" $bridgeNode 600
    Add-FakeProcess 12 "go2rtc.exe" $bridgeGo2rtcCmd 590 11 $bridgeGo2rtcExe
    Add-FakeProcess 64 "node.exe" $unrelatedNode 900
    Add-FakeProcess 65 "node.exe" $relativeNode 900
    $portOwners[3000] = 64; $portOwners[1984] = 12
    Kick-Task "StateNour-Eufy-Bridge-NicksMax" "eufy-bridge" "harness restart" $true 0
  }
  "unrelated-node-is-not-a-duplicate" {
    # A healthy tick dedupes every child needle. With the any-server.mjs needle the bridge's node and
    # an unrelated, OLDER node server.mjs were two roots of one worker; the bridge's owns :3000, so
    # the unrelated one was ended on every tick.
    Add-FakeProcess 11 "node.exe" $bridgeNode 600
    Add-FakeProcess 12 "go2rtc.exe" $bridgeGo2rtcCmd 590 11 $bridgeGo2rtcExe
    Add-FakeProcess 64 "node.exe" $unrelatedNode 7200
    $portOwners[3000] = 11; $portOwners[1984] = 12
    $taskStates["StateNour-Eufy-Bridge-NicksMax"] = "Running"
    Heal-EufyTask $eufyTasks[0]
  }
  "two-bridge-nodes-are-still-duplicates" {
    # The control for the scenario above: two copies of the REAL bridge node are still one worker
    # too many. The tighter needle must not blind the dedupe to the case it exists for.
    Add-FakeProcess 11 "node.exe" $bridgeNode 600
    Add-FakeProcess 14 "node.exe" $bridgeNode 60
    $portOwners[3000] = 11
    $taskStates["StateNour-Eufy-Bridge-NicksMax"] = "Running"
    Heal-EufyTask $eufyTasks[0]
  }
  "edge-code-stop-fails-keeps-old-fingerprint" {
    # The stale edge refuses to die (Codex on #2925): nothing may be ledgered as handled. The
    # next tick, with the process killable, ends it and records the fingerprint.
    Install-EdgeCode "v1"
    Add-FakeProcess 41 "python.exe" $edgePython 3600
    $portOwners[9095] = 41
    $unkillable.Add(41)
    $markers["first"] = [bool](Heal-EdgeCode $true $true)
    $markers["fingerprintAfterFailedStop"] = [string](Get-Entry "edge-code-version").fingerprint
    $markers["restartsAfterFailedStop"] = @((Get-Entry "sign-edge").restarts).Count
    $unkillable.Clear()
    $markers["second"] = [bool](Heal-EdgeCode $true $true)
    $markers["fingerprintAfterSecond"] = [string](Get-Entry "edge-code-version").fingerprint
  }
  "office-code-change-start-fails-keeps-old-fingerprint" {
    # The office worker's code changed on disk but the task could not be started: the OLD
    # fingerprint stays on record so a later tick retries instead of forgetting the change.
    Install-OfficeCode
    Add-FakeProcess 31 "python.exe" $officePython 600
    $taskStates[$officeTask] = "Running"
    Set-OfficeStatus 1 "READY" $null
    function Get-OfficeCodeFingerprint([string]$dir) { return "office-v2" }
    $failStart = $true
    Heal-OfficeWorker
    $markers["fingerprintAfterFailedStart"] = [string](Get-Entry "office-code-version").fingerprint
  }
  default { throw "unknown scenario: $Scenario" }
}

$logLines = @()
# [string] strips the PSPath/PSDrive/... notes Get-Content attaches to each line: Windows PowerShell
# 5.1's ConvertTo-Json serializes them, so every line came out as an object (pwsh 7 drops them),
# and every log assertion failed under 5.1 (first run on NicksMax, 2026-10-08: 18 of 52).
if (Test-Path -LiteralPath $log) { $logLines = @(Get-Content -LiteralPath $log | ForEach-Object { [string]$_ }) }
[pscustomobject]@{
  scenario = $Scenario
  calls    = @($calls)
  log      = $logLines
  state    = $state
  markers  = $markers
} | ConvertTo-Json -Depth 6 -Compress

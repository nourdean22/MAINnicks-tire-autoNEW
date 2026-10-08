$ErrorActionPreference = "Continue"
# NicksMax camera supervisor -- ONE tick. NicksMaxCameraSupervisorSystem (SYSTEM, at startup)
# runs data\nicksmax-camera-supervisor-loop.ps1, which calls this tick every ~30s.
#
# 2026-10-02 - this file is the single source. data\nicksmax-camera-supervisor.ps1 on the box
# is a shim that invokes this path, so a `git pull` on NicksMax is the deploy. Before this, the
# box ran a hand-edited data\ copy that had drifted 36 lines ahead of the repo.
#
# 2026-10-07 - restarts end the REAL children. Stop-ScheduledTask ends only the powershell.exe
# wrapper a task launched; the node/python child it spawned kept its port, the restarted task died
# on EADDRINUSE ~24x/hour beside the orphan (2026-10-05 16:52 onward) and two agents posted at
# once (2026-10-03 13:57). Now: a restart stops the wrapper, then the children by image+command
# line AND by listening port; a task that is not Running while its port is served has its orphan
# reclaimed and is started cleanly once; duplicate listeners are reduced to the one that owns the
# port; a port must be closed THREE ticks in a row before a restart (one slow probe used to be a
# restart vote); the Eufy watchdog task is retired as a second authority. Behaviour is probed by
# tests\test_nicksmax_supervisor.py through tests\fixtures\supervisor_harness.ps1 -- keep the
# machine-touching work inside the Heal-* / Stop-* / Invoke-* functions so it stays testable.
#
# What it heals, in order (cheap checks first, slow RTSP decode probes last):
#   0. single tick at a time (file lock) -- two supervisors once fought over the relay.
#   1. office conversation worker (StateNour-OfficeIntelligence-NicksMax): not running -> start
#      (reclaiming an orphan first); running but heartbeat stale -> restart; code dir missing ->
#      ESCALATE; listening coverage under 50% while READY -> WARN.
#   2. Eufy bridge (:3000) + agent (:3601) tasks: duplicates -> keep the port owner; not running
#      -> start (reclaiming an orphan first); port closed three ticks in a row -> restart.
#   3. sign pipeline: relay -> MediaMTX -> crop -> production edge (decoded-frame proof). An
#      armed, healthy edge whose Python modules changed on disk is ended once so the same start
#      path reloads it: a `git pull` is the deploy for the edge too (2026-10-08).
#   4. disk floor: under 1 GB free -> rotate this log, prune raw office audio past the worker's
#      own retention, ESCALATE. (Measured 0.10 GB free on 2026-10-05.)
# Every restart is recorded per component; more than $escalateRestartsPerHour in an hour logs
# ESCALATE (once per component per hour) instead of looping silently.

$root = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge"
$log = Join-Path $root "logs\nicksmax-camera-supervisor.log"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$isSystem = ($identity -eq "NT AUTHORITY\SYSTEM")
$relayLauncher = if ($isSystem) { "C:\Users\nourd\NicksMax\lab\v380-cloud-relay\run-shopsign-cloud-system.ps1" } else { "C:\Users\nourd\NicksMax\lab\v380-cloud-relay\run-shopsign-cloud.ps1" }
$relaySecret = if ($isSystem) { "C:\ProgramData\NicksMaxCamera\shopsign-machine.dpapi" } else { "C:\Users\nourd\NicksMax\lab\secrets\machine\shopsign-device.machine" }
$mediaLauncher = "C:\Users\nourd\NicksMax\lab\v380-cloud-relay\run-mediamtx-sign.ps1"
$cropLauncher = "C:\Users\nourd\NicksMax\lab\v380-cloud-relay\run-sign-crop.ps1"
$shadowLauncher = Join-Path $root "data\run-sign-rtsp-candidate.ps1"
$productionLauncher = Join-Path $root "data\run-sign-rtsp-production.ps1"
$productionMarker = Join-Path $root "data\NICKSMAX-SIGN-PRODUCTION-ARMED"
$prodStartMarker = Join-Path $root "data\.nicksmax-prod-start-last"
$statePath = Join-Path $root "data\.nicksmax-supervisor-state.json"

$officeTask = "StateNour-OfficeIntelligence-NicksMax"
$officeStatusPath = "C:\Users\nourd\AppData\Local\StateNour\OfficeIntelligence\office-conversation-status.json"
# install-office-capture.ps1 -OutDir default: the raw capture segments live beside the status file.
$officeAudioDir = Join-Path (Split-Path $officeStatusPath -Parent) "audio"
$officeHeartbeatStaleMinutes = 10
# officewake.py reports the share of the last hour it was actually recording. Under this while the
# worker calls itself READY/CAPTURING, captures are failing or the source is silent -- say so.
$officeListeningCoverageFloor = 0.5
$eufyTasks = @(
  @{ Name = "StateNour-Eufy-Bridge-NicksMax"; Port = 3000; Key = "eufy-bridge" },
  @{ Name = "StateNour-Eufy-Agent-NicksMax";  Port = 3601; Key = "eufy-agent" }
)
$eufyPortMissesBeforeRestart = 3
$escalateRestartsPerHour = 6
$diskFloorBytes = 1GB
$diskWarnBytes = 2GB

$supervisorLockPath = Join-Path $root "data\.nicksmax-supervisor-tick.lock"
try {
  $supervisorLockHandle = [IO.File]::Open(
    $supervisorLockPath,
    [IO.FileMode]::OpenOrCreate,
    [IO.FileAccess]::ReadWrite,
    [IO.FileShare]::None
  )
} catch {
  exit 0
}

# Logging must never break supervision -- and a log that cannot be written must not silence it
# either. 2026-10-08 07:34-07:5x: a remote-admin session's reverse read left an exclusive handle
# on this file, Add-Content failed every tick, and the supervisor restarted workers for 20 minutes
# with nothing on record. Lines that cannot reach $log go to $log.overflow; read both.
# -ErrorAction Stop on both writes is load-bearing: this script runs under "Continue" (line 1),
# where a sharing violation is a NON-terminating error that never reaches a catch. The first
# version of this fallback shipped without it and wrote nothing anywhere for the 07:48 restart.
function Log([string]$m) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m
  try {
    Add-Content -Path $log -Value $line -Encoding utf8 -ErrorAction Stop
  } catch {
    try { Add-Content -Path ($log + ".overflow") -Value $line -Encoding utf8 -ErrorAction Stop } catch {}
  }
}

# ---- restart ledger --------------------------------------------------------------------------
# { "<component>": { "restarts": [epoch...], "escalatedAt": epoch, "portMisses": n, "fingerprint": s } }
function Read-State {
  $h = @{}
  if (Test-Path $statePath) {
    try {
      $obj = Get-Content $statePath -Raw | ConvertFrom-Json
      foreach ($p in $obj.PSObject.Properties) {
        $h[$p.Name] = @{
          restarts    = @($p.Value.restarts | Where-Object { $_ -ne $null } | ForEach-Object { [double]$_ })
          escalatedAt = [double]($p.Value.escalatedAt | Select-Object -First 1)
          portMisses  = [int]($p.Value.portMisses | Select-Object -First 1)
          fingerprint = [string]($p.Value.fingerprint | Select-Object -First 1)
        }
      }
    } catch {
      Log "WARN supervisor state unreadable; starting a fresh ledger"
    }
  }
  return $h
}
$state = Read-State
$nowEpoch = [double][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

function Get-Entry([string]$key) {
  if (-not $state.ContainsKey($key)) { $state[$key] = @{ restarts = @(); escalatedAt = 0; portMisses = 0; fingerprint = "" } }
  return $state[$key]
}

function Record-Restart([string]$key,[string]$why) {
  $e = Get-Entry $key
  $e.restarts = @($e.restarts | Where-Object { $_ -gt ($nowEpoch - 3600) }) + $nowEpoch
  Log ("ACTION restart {0}: {1} ({2} in the last hour)" -f $key,$why,$e.restarts.Count)
  if ($e.restarts.Count -gt $escalateRestartsPerHour -and $e.escalatedAt -lt ($nowEpoch - 3600)) {
    $e.escalatedAt = $nowEpoch
    Log ("ESCALATE {0} restarted {1} times in an hour; self-heal is not converging -- needs a human" -f $key,$e.restarts.Count)
  }
}

function Restarts-InLastMinutes([string]$key,[int]$minutes) {
  $e = Get-Entry $key
  return @($e.restarts | Where-Object { $_ -gt ($nowEpoch - 60 * $minutes) }).Count
}

# 1500 ms, not 400: on 2026-10-07 06:36 a 400 ms probe called a healthy bridge "closed" while node
# was busy. A connect that takes a second is slow, not down.
function Port-Open([int]$port,[int]$timeoutMs = 1500) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $ar = $c.BeginConnect("127.0.0.1",$port,$null,$null)
    $ok = $ar.AsyncWaitHandle.WaitOne($timeoutMs,$false) -and $c.Connected
    $c.Close()
    return $ok
  } catch { return $false }
}

function Test-RtspFrame([string]$url) {
  $ffmpeg = "C:\Users\nourd\NicksMax\lab\ffmpeg-essentials\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe"
  if (-not (Test-Path $ffmpeg)) { return $false }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $ffmpeg
  $psi.Arguments = '-hide_banner -loglevel error -rtsp_transport tcp -timeout 5000000 -i "' + $url + '" -frames:v 1 -f null NUL'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  try {
    [void]$p.Start()
    if (-not $p.WaitForExit(12000)) {
      try { $p.Kill() } catch {}
      return $false
    }
    return ($p.ExitCode -eq 0)
  } catch {
    return $false
  } finally {
    if ($p) { $p.Dispose() }
  }
}

# ---- process discovery -----------------------------------------------------------------------
# A process's identity is "<image name> <command line>", plus " exe=<executable path>" when this
# token can read it. Needles anchor on the image. Every kill path (the needle sweep, the port
# owner check, the duplicate sweep) reads this one identity, so they cannot disagree about whose
# child a process is (Codex on #2931: the sweep ended any go2rtc the port check had refused).
function Get-ProcessIdentity($p) {
  $identity = "{0} {1}" -f $p.Name,$p.CommandLine
  if (-not [string]::IsNullOrWhiteSpace([string]$p.ExecutablePath)) { $identity += " exe=" + $p.ExecutablePath }
  return $identity
}

function Get-ProcessesMatching([string]$needle) {
  return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { (Get-ProcessIdentity $_) -match $needle })
}

function Find-ProcessByCommand([string]$needle) {
  return @(Get-ProcessesMatching $needle) | Select-Object -First 1
}

function Stop-ProcessesByCommand([string]$needle,[string]$label) {
  foreach ($p in @(Get-ProcessesMatching $needle)) {
    if ($p.ProcessId -eq $PID) { continue }
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Log ("ACTION stopped {0} pid={1}" -f $label,$p.ProcessId)
  }
}

# What each task's wrapper actually runs, by image+command line and by the ports it must hold.
# Stop-ScheduledTask ends the powershell.exe wrapper only; these are what keep the port.
#   eufy-bridge : start-bridge-nicksmax.ps1 -> node <install>\server.mjs (:3000) -> go2rtc (1984/8654/8655)
#   eufy-agent  : start-agent-nicksmax.ps1  -> python agent.py --eufy-only (:3601 health)
#   office      : python -m vision.officewake --capture (no port; heartbeat file instead)
# go2rtc's command line is `go2rtc -config ./go2rtc.yaml` (probed on NicksMax 2026-10-08), which
# any go2rtc could print; only its executable, under the bridge install in StateNour\Eufy\, makes
# it this task's child. An unrelated or unreadable go2rtc is a neighbour (Codex on #2931).
# node is the same problem the other way round: its executable is the system node.exe, so only the
# script it runs can say whose it is. The launcher passes server.mjs by its absolute path under
# StateNour\Eufy\ (since 2026-10-08; it used to pass a bare `server.mjs` from the bridge directory),
# and that path is the needle. Any other node server.mjs -- the commonest Node entry point, often on
# :3000 -- is a neighbour, and so is a bare one: a launcher reverted to the old form shows up here
# as ":3000 owner ... is not this task's child", never as a kill.
function Get-TaskChildSpec([string]$key) {
  switch ($key) {
    "eufy-bridge"   { return @{ Needles = @('^node(\.exe)?\s.*\\StateNour\\Eufy\\(?:[^\\"\s]+\\)*server\.mjs\b', '^go2rtc(\.exe)?\s.*\sexe=.*\\StateNour\\Eufy\\.*\bgo2rtc\.exe$'); Ports = @(3000, 1984, 8654, 8655) } }
    "eufy-agent"    { return @{ Needles = @('^python\w*(\.exe)?\s.*\bagent\.py\s+--eufy-only\b'); Ports = @(3601) } }
    "office-worker" { return @{ Needles = @('^python\w*(\.exe)?\s.*-m\s+vision\.officewake\b'); Ports = @() } }
  }
  return @{ Needles = @(); Ports = @() }
}

# End whatever holds a listening port -- but only a camera child. If something else took the
# port, killing it would be a new outage, not a repair; say so and leave it.
#
# The image name alone is not identity (Codex on #2920): an unrelated node, python or go2rtc on
# a managed port is a neighbour, not an orphan. The owner must ALSO match one of the task's
# child needles by "<image> <command line>", the same test Get-ProcessesMatching applies. A
# command line this token cannot read is a refusal, not a pass: nothing is ended on a guess,
# and the log names the pid so a human can decide.
function Stop-PortOwner([int]$port,[string]$label,[string[]]$needles = @()) {
  $owners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($owner in $owners) {
    if (-not $owner -or $owner -eq $PID -or $owner -le 4) { continue }
    $proc = Get-Process -Id $owner -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -notmatch '^(node|python\w*|go2rtc)$') {
      Log ("WARN :{0} is owned by {1} pid={2}, not a camera child; leaving it" -f $port,$proc.ProcessName,$owner)
      continue
    }
    if (@($needles).Count -eq 0) {
      Log ("WARN :{0} owner pid={1}: no child specification to verify it against; leaving it" -f $port,$owner)
      continue
    }
    $cim = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { [int64]$_.ProcessId -eq [int64]$owner } | Select-Object -First 1
    if (-not $cim -or [string]::IsNullOrWhiteSpace([string]$cim.CommandLine)) {
      Log ("WARN :{0} owner pid={1} has no readable command line; cannot prove it is a camera child, leaving it" -f $port,$owner)
      continue
    }
    $identity = Get-ProcessIdentity $cim
    $isChild = $false
    foreach ($needle in $needles) { if ($identity -match $needle) { $isChild = $true; break } }
    if (-not $isChild) {
      $shown = $identity.Substring(0, [Math]::Min(96, $identity.Length))
      Log ("WARN :{0} owner pid={1} is not this task's child by command line ({2}); leaving it" -f $port,$owner,$shown)
      continue
    }
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    Log ("ACTION stopped {0} pid={1}" -f $label,$owner)
  }
}

# Two copies of one worker is never right: both post, both write the same heartbeat file, and the
# newer one cannot bind the port. Keep the listener (else the oldest) and end the rest.
#
# Count process TREES, never processes. A venv python.exe is a LAUNCHER: it runs the real
# interpreter as its child with the same command line (two matches, 50-360 ms apart, witnessed
# 2026-10-08). The first per-process dedupe killed that child under every venv worker, the launcher
# exited, the task went Ready, and this supervisor restarted the office worker and the Eufy agent
# every two minutes (14 an hour each) until a human read the log. A tree whose member owns the port
# is the one to keep; otherwise the oldest root. Ending a duplicate ends its whole tree.
function Remove-DuplicateProcesses([string]$needle,[int]$port,[string]$label) {
  $procs = @(Get-ProcessesMatching $needle)
  if ($procs.Count -le 1) { return 0 }
  $ids = @($procs | ForEach-Object { [int64]$_.ProcessId })
  $roots = @($procs | Where-Object { $ids -notcontains [int64]$_.ParentProcessId })
  if ($roots.Count -le 1) { return 0 }
  $owner = $null
  if ($port -gt 0) {
    $owner = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty OwningProcess
  }
  $trees = @(foreach ($r in $roots) {
    $members = @($r)
    $grew = $true
    while ($grew) {
      $grew = $false
      $memberIds = @($members | ForEach-Object { [int64]$_.ProcessId })
      foreach ($p in $procs) {
        if (($memberIds -contains [int64]$p.ParentProcessId) -and ($memberIds -notcontains [int64]$p.ProcessId)) {
          $members += $p
          $grew = $true
        }
      }
    }
    $memberIds = @($members | ForEach-Object { [int64]$_.ProcessId })
    [pscustomobject]@{ Root = $r; Members = $members; OwnsPort = [bool]($owner -and ($memberIds -contains [int64]$owner)) }
  })
  $keep = @($trees | Where-Object { $_.OwnsPort }) | Select-Object -First 1
  if (-not $keep) { $keep = @($trees | Sort-Object { $_.Root.CreationDate }) | Select-Object -First 1 }
  $stopped = 0
  foreach ($t in $trees) {
    if ($t.Root.ProcessId -eq $keep.Root.ProcessId) { continue }
    foreach ($p in $t.Members) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      Log ("ACTION stopped duplicate {0} pid={1}; keeping pid={2}" -f $label,$p.ProcessId,$keep.Root.ProcessId)
      $stopped++
    }
  }
  return $stopped
}

function Stop-TaskChildren([string]$key) {
  $spec = Get-TaskChildSpec $key
  foreach ($needle in $spec.Needles) { Stop-ProcessesByCommand $needle ("{0} child" -f $key) }
  foreach ($port in $spec.Ports) { Stop-PortOwner $port ("{0} :{1} owner" -f $key,$port) $spec.Needles }
  # Let the kernel release the listeners, or the new child dies on EADDRINUSE anyway.
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline -and (@($spec.Ports | Where-Object { Port-Open $_ 200 }).Count -gt 0)) {
    Start-Sleep -Milliseconds 250
  }
}

# Start (or restart) a scheduled task, at most once per $minGapMinutes, and ledger it. A restart
# ends the wrapper, then the children it left behind, then starts the task.
# Returns $true only when the task was actually started, so a caller that records a fact about
# the new process (a code fingerprint) records it only then; a throttled or failed kick is $false.
function Kick-Task([string]$taskName,[string]$key,[string]$why,[bool]$restart,[int]$minGapMinutes = 1) {
  if ((Restarts-InLastMinutes $key $minGapMinutes) -gt 0) { return $false }
  try {
    if ($restart) {
      Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
      Stop-TaskChildren $key
      Start-Sleep -Milliseconds 800
    }
    Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
    Record-Restart $key $why
    return $true
  } catch {
    Record-Restart $key ("{0}; start FAILED: {1}" -f $why,$_.Exception.Message)
    return $false
  }
}

# A task that is not Running while its child still serves: the task no longer owns that child
# (wrapper ended, child survived) and Task Scheduler's own restart-on-failure keeps launching new
# copies into EADDRINUSE beside it. One authority: end the orphan, start the task once, cleanly.
function Reclaim-Orphan([string]$taskName,[string]$key,[string]$detail) {
  if ((Restarts-InLastMinutes $key 2) -gt 0) { return }
  Log ("RECLAIM {0}: {1}; ending the orphan and starting the task" -f $key,$detail)
  Stop-TaskChildren $key
  [void](Kick-Task $taskName $key ("reclaimed orphan: {0}" -f $detail) $false 2)
}

# Fingerprint of the office worker's Python modules (vision\office*.py). The fingerprint recorded at
# the last code-change restart lives in the ledger; a different one means the running process has
# stale code. First sight of a tree also counts as changed: one restart then is harmless, and it is
# what loads code pulled before this rule existed.
function Get-OfficeCodeFingerprint([string]$dir) {
  $files = Get-ChildItem -Path (Join-Path $dir "vision") -Filter "office*.py" -File -ErrorAction SilentlyContinue | Sort-Object Name
  if (-not $files) { return "" }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $parts = foreach ($f in $files) { $f.Name + ":" + [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($f.FullName))) }
  } finally { $sha.Dispose() }
  return ($parts -join "|")
}

# Fingerprint of the sign edge's Python modules: edge_main.py, edge_health.py, visitd\*.py and
# vision\*.py minus the office worker's own office*.py (those belong to the rule above). Same
# ledger convention: the fingerprint on record is the one the running edge was started on.
function Get-EdgeCodeFingerprint([string]$dir) {
  $files = @()
  foreach ($name in @("edge_main.py","edge_health.py")) {
    $p = Join-Path $dir $name
    if (Test-Path -LiteralPath $p) { $files += Get-Item -LiteralPath $p }
  }
  $files += @(Get-ChildItem -Path (Join-Path $dir "visitd") -Filter "*.py" -File -ErrorAction SilentlyContinue)
  $files += @(Get-ChildItem -Path (Join-Path $dir "vision") -Filter "*.py" -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "office*.py" })
  if (-not $files -or @($files).Count -eq 0) { return "" }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $parts = foreach ($f in @($files | Sort-Object FullName)) { $f.Name + ":" + [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($f.FullName))) }
  } finally { $sha.Dispose() }
  return ($parts -join "|")
}

# A long-running edge keeps the code it started with. When `git pull` changes its modules, end the
# production edge once between ticks and let the arm path below start it again on the new code,
# behind the same decoded-frame proof as any other start (2026-10-08: #2920's phantom re-arrival
# fix sat on disk unloaded while the old edge kept running). Scope, deliberately narrow:
#   * armed and healthy only -- a missing edge is already the start path's business, and the
#     fingerprint is recorded whenever that path starts one, since it loads what is on disk;
#   * never within 10 min of another sign-edge restart (a stale-lease kill, a fresh start). The
#     launcher wrapper ($prodStarting) is NOT a guard here: run-sign-rtsp-production.ps1 stays
#     alive as the edge's parent for the edge's whole life (pid 28568 under the 01:51 edge on
#     2026-10-08), so "a launcher is alive" means "the edge is running", which is the case this
#     rule exists for. The start path below reads it the same way: alive -> do not start another.
#   * the fingerprint is recorded only when the restart is actually issued, so a throttled tick
#     retries instead of forgetting the change. First sight of a tree counts as changed.
# Returns $true when it ended the edge, so the caller re-probes :9095 before deciding to start.
function Heal-EdgeCode([bool]$armed,[bool]$prodHealthy) {
  if (-not $armed) { return $false }
  $fp = Get-EdgeCodeFingerprint $root
  if (-not $fp) { return $false }
  $e = Get-Entry "edge-code-version"
  if ($e.fingerprint -eq $fp) { return $false }
  if (-not $prodHealthy) { return $false }
  if ((Restarts-InLastMinutes "sign-edge" 10) -gt 0) { return $false }
  $edgeNeedle = "python.*config-nicksmax-sign-production\.yaml"
  Stop-ProcessesByCommand $edgeNeedle "production edge running stale code"
  # Record the fingerprint only once the stale edge is PROVEN gone (Codex on #2925): a kill that
  # failed, or a process discovery that missed it, would otherwise be ledgered as handled, the
  # old code would keep serving :9095, and every later tick would read an equal fingerprint and
  # never retry. Nothing is recorded here, so the next tick tries again.
  $left = @(Get-ProcessesMatching $edgeNeedle)
  if ($left.Count -gt 0) {
    Log ("WARN production edge still running after stop (pid={0}); fingerprint not recorded, retrying next tick" -f (($left | ForEach-Object { $_.ProcessId }) -join ","))
    return $false
  }
  Record-Restart "sign-edge" "edge code changed on disk; ended the production edge so the start path reloads it"
  $e.fingerprint = $fp
  return $true
}

function Get-OfficeStatus {
  if (-not (Test-Path $officeStatusPath)) { return $null }
  try {
    return (Get-Content $officeStatusPath -Raw | ConvertFrom-Json)
  } catch {
    Log ("WARN office status unreadable: {0}" -f $_.Exception.Message)
    return $null
  }
}

function Get-HeartbeatAgeMinutes($status) {
  if (-not $status -or -not $status.conversationWorkerHeartbeatAt) { return $null }
  try {
    return ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($status.conversationWorkerHeartbeatAt)).TotalMinutes
  } catch { return $null }
}

# ---- 1. office conversation worker ----------------------------------------------------------
function Heal-OfficeWorker {
  $ot = Get-ScheduledTask -TaskName $officeTask -ErrorAction SilentlyContinue
  if (-not $ot -or $ot.State -eq "Disabled") { return }
  $spec = Get-TaskChildSpec "office-worker"
  [void](Remove-DuplicateProcesses $spec.Needles[0] 0 "office-worker")
  $status = Get-OfficeStatus
  $age = Get-HeartbeatAgeMinutes $status
  $workDir = $ot.Actions | Select-Object -First 1 -ExpandProperty WorkingDirectory
  # The task was commissioned from git worktrees twice; a worktree cleanup deleted its code and
  # the worker failed at every boot from 2026-10-02 09:15. Repoint it once at the stable checkout
  # (the same tree this supervisor runs from), then let the normal start path below run it.
  if ($workDir -and $workDir -match '\\worktrees\\' -and (Test-Path (Join-Path $root "vision\officewake.py"))) {
    try {
      $action = $ot.Actions | Select-Object -First 1
      $action.WorkingDirectory = $root
      Set-ScheduledTask -TaskName $officeTask -Action $action -ErrorAction Stop | Out-Null
      [void](Kick-Task $officeTask "office-worker" ("repointed from worktree {0} to {1}" -f $workDir,$root) $true 0)
      $ot = Get-ScheduledTask -TaskName $officeTask -ErrorAction SilentlyContinue
      $workDir = $root
    } catch {
      Log ("WARN could not repoint office worker off worktree {0}: {1}" -f $workDir,$_.Exception.Message)
    }
  }
  if ($workDir -and -not (Test-Path (Join-Path $workDir "vision\officewake.py"))) {
    # Its code was once a git worktree that got cleaned up; the task then failed at every boot.
    $e = Get-Entry "office-code"
    if ($e.escalatedAt -lt ($nowEpoch - 3600)) {
      $e.escalatedAt = $nowEpoch
      Log ("ESCALATE office worker code missing at {0}; re-run install-office-capture.ps1 with -BridgeDir pointing at a stable checkout" -f $workDir)
    }
  } elseif ($ot.State -ne "Running") {
    $orphan = Find-ProcessByCommand $spec.Needles[0]
    if ($orphan) {
      Reclaim-Orphan $officeTask "office-worker" ("task is {0} but officewake pid={1} is still running" -f $ot.State,$orphan.ProcessId)
    } else {
      [void](Kick-Task $officeTask "office-worker" ("task state {0}" -f $ot.State) $false 2)
    }
  } elseif (($officeFp = Get-OfficeCodeFingerprint $workDir) -and ((Get-Entry "office-code-version").fingerprint -ne $officeFp)) {
    # A long-running Python process keeps the code it started with. When `git pull` changes the
    # office worker's modules, restart it once so a deploy is just a pull (2026-10-02). The new
    # fingerprint is recorded only when the restart is actually issued, so a throttled tick
    # retries instead of forgetting the change.
    if ((Restarts-InLastMinutes "office-worker" 2) -eq 0) {
      # Recorded only when the task was actually started (Codex on #2925): a start that failed
      # leaves the old fingerprint on record, so a later tick retries instead of forgetting.
      if (Kick-Task $officeTask "office-worker" "office worker code changed on disk; restarting to load it" $true 2) {
        (Get-Entry "office-code-version").fingerprint = $officeFp
      }
    }
  } elseif ($null -ne $age -and $age -gt $officeHeartbeatStaleMinutes) {
    [void](Kick-Task $officeTask "office-worker" ("running but heartbeat {0:N0} min old" -f $age) $true 10)
  }
  # Listening coverage: a READY worker that recorded little of the last hour is quietly failing
  # ONLY when the hour explains it -- captures failed, or wakes arrived and none became a capture.
  # A quiet hour with no wakes and no failures is a quiet office, not a deaf worker. Once an hour.
  if ($status -and $null -ne $status.conversationListeningCoverage60m) {
    $coverage = [double]$status.conversationListeningCoverage60m
    $failures = [int]($status.conversationCaptureFailuresLast60m | Select-Object -First 1)
    $wakes = [int]($status.conversationWakeTriggersLast60m | Select-Object -First 1)
    $captures = [int]($status.conversationCapturesLast60m | Select-Object -First 1)
    $explained = ($failures -gt 0) -or ($wakes -gt 0 -and $captures -eq 0)
    if ($coverage -lt $officeListeningCoverageFloor -and $explained -and ($status.conversationWorkerState -in @("READY","CAPTURING"))) {
      $e = Get-Entry "office-coverage"
      if ($e.escalatedAt -lt ($nowEpoch - 3600)) {
        $e.escalatedAt = $nowEpoch
        Log ("WARN office worker reports {0} but listened only {1}% of the last 60 min ({2} wakes, {3} captures, {4} failed); captures are failing or the audio source is silent" -f $status.conversationWorkerState,[math]::Round($coverage * 100),$wakes,$captures,$failures)
      }
    }
  }
}

# ---- 2. Eufy bridge + agent -------------------------------------------------------------------
function Heal-EufyTask([hashtable]$et) {
  $t = Get-ScheduledTask -TaskName $et.Name -ErrorAction SilentlyContinue
  if (-not $t -or $t.State -eq "Disabled") { return }
  $e = Get-Entry $et.Key
  $spec = Get-TaskChildSpec $et.Key
  # One listener per port. Two agents ran side by side from 2026-10-05 16:52 (orphan + restart).
  foreach ($needle in $spec.Needles) { [void](Remove-DuplicateProcesses $needle $et.Port $et.Key) }
  $portOpen = Port-Open $et.Port
  if ($t.State -ne "Running") {
    $e.portMisses = 0
    if ($portOpen) {
      Reclaim-Orphan $et.Name $et.Key ("task is {0} but :{1} is served by a child it no longer owns" -f $t.State,$et.Port)
    } else {
      [void](Kick-Task $et.Name $et.Key ("task state {0}" -f $t.State) $false 2)
    }
  } elseif (-not $portOpen) {
    $e.portMisses = $e.portMisses + 1
    # Three consecutive misses (~90 s): a child mid-restart is not killed again, and one slow
    # probe is not a restart vote.
    if ($e.portMisses -ge $eufyPortMissesBeforeRestart) {
      $e.portMisses = 0
      [void](Kick-Task $et.Name $et.Key ("running but :{0} closed {1} ticks in a row" -f $et.Port,$eufyPortMissesBeforeRestart) $true 5)
    }
  } else {
    $e.portMisses = 0
  }
}

# Legacy GUI/WGC lane is retired on NicksMax. Disabled means disabled; do not resurrect it.
# NicksMaxCameraSupervisorUser is the pre-SYSTEM copy of this supervisor; two supervisors
# fought over the relay after the 2026-10-02 reboot, so it stays disabled too.
# StateNour-Eufy-Watchdog-NicksMax (nourd, every 5 min, watchdog-nicksmax.ps1) stopped and
# started the same two Eufy tasks with the wrapper-only primitive this file replaced; a second
# authority over one port is how orphans and duplicate agents are made. This supervisor is the
# only one (2026-10-07).
foreach ($taskName in @("V380Watchdog","NickEdgeProducer","NickEdgeProducerRight","NickEdgeSignCandidate","NicksMaxCameraSupervisorUser","StateNour-Eufy-Watchdog-NicksMax")) {
  $t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($t -and $t.State -ne "Disabled") {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
    Log ("SAFETY disabled retired task {0}" -f $taskName)
  }
}

Heal-OfficeWorker
foreach ($et in $eufyTasks) { Heal-EufyTask $et }

# Do not kill V380 if the operator manually opens it; it simply is no longer infrastructure.

# ---- 3. sign pipeline -------------------------------------------------------------------------
# 3a. Cloud/P2P relay -> localhost full three-lens stack on 8554.
# Listener health is authoritative here. An elevated/System relay can hide its command line
# from this token, so command-line discovery alone causes duplicate restart attempts.
$relayReady = (Port-Open 8554) -and (Port-Open 8080)
# A refused V380 cloud login is not a crash a restart can heal. Witnessed 2026-10-02/03: the
# relay exited "login failed result: 1002" and this loop re-tried the cloud login ~120x/hour
# for 11+ hours, which risks locking the account. On a login refusal, retry once per 30 min
# and escalate it. 1002 follows a dropped stream: the sign camera is solar and goes offline when its battery runs out.
$relayErr = Join-Path (Split-Path $relayLauncher) $(if ($isSystem) { "relay-system.stderr.log" } else { "relay.stderr.log" })
$relayAuthFailed = (Test-Path $relayErr) -and (Select-String -Path $relayErr -Pattern 'login failed' -SimpleMatch -Quiet)
$relayAuthHold = (-not $relayReady) -and $relayAuthFailed -and ((Restarts-InLastMinutes "sign-relay" 30) -gt 0)
if ($relayAuthHold) {
  $e = Get-Entry "sign-relay"
  if ($e.escalatedAt -lt ($nowEpoch - 3600)) {
    $e.escalatedAt = $nowEpoch
    # "Expected overnight" was logged at 13:00 on 2026-10-06 while the lot sat unwatched all day.
    # Say what the hour means: dark is expected, daylight is a camera to go look at.
    $hour = (Get-Date).Hour
    $daylight = ($hour -ge 8 -and $hour -lt 18)
    if ($daylight) {
      Log "ESCALATE sign-relay V380 cloud login refused in DAYLIGHT; holding retries to 1 per 30 min -- the solar shop-sign camera should be awake now: check it is online in the V380 app and that its battery is charging"
    } else {
      Log "ESCALATE sign-relay V380 cloud login refused; holding retries to 1 per 30 min -- the solar shop-sign camera is likely out of battery (expected overnight); if it persists past 08:00, check it is online in the V380 app"
    }
  }
}
if (-not $relayReady -and -not $relayAuthHold -and (Test-Path $relaySecret) -and (Test-Path $relayLauncher)) {
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$relayLauncher)
  Record-Restart "sign-relay" "ports 8554/8080 not listening"
  Start-Sleep -Milliseconds 900
}

# 3b. Loopback RTSP broker for the isolated sign lens.
# Port health is privilege-agnostic; elevated process command lines may be invisible.
$mediaReady = Port-Open 8555
if (-not $mediaReady -and (Test-Path $mediaLauncher)) {
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$mediaLauncher)
  Record-Restart "sign-mediamtx" "port 8555 not listening"
  Start-Sleep -Milliseconds 700
}

# 3c. Crop middle 1920x1080 lens from the 1920x3240 cloud stack -> 640x360 @ 4fps.
# A decoded frame, not process visibility, proves the crop publisher is actually healthy.
$signFrameReady = (Port-Open 8555) -and (Test-RtspFrame "rtsp://127.0.0.1:8555/sign")
if ((Port-Open 8554) -and -not $signFrameReady -and (Test-Path $cropLauncher)) {
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$cropLauncher)
  Record-Restart "sign-crop" "no decodable frame on 8555/sign"
  Start-Sleep -Milliseconds 900
  $signFrameReady = (Port-Open 8555) -and (Test-RtspFrame "rtsp://127.0.0.1:8555/sign")
}

$directReady = (Port-Open 8554) -and $signFrameReady
$authorityModeFile = Join-Path $root "data\nicksmax-camera-authority.mode"
$authorityMode = if (Test-Path $authorityModeFile) { (Get-Content $authorityModeFile -Raw).Trim().ToLowerInvariant() } else { "shadow" }
$armed = ($authorityMode -eq "production") -and (Test-Path $productionMarker)
if (($authorityMode -eq "production") -and -not (Test-Path $productionMarker)) {
  Log "REFUSE production authority: production mode lacks armed audit marker"
}
$shadow = Find-ProcessByCommand "python.*config-nicksmax-sign-rtsp\.yaml"
$prod = Find-ProcessByCommand "python.*config-nicksmax-sign-production\.yaml"
$progressLease = Join-Path $root "data\.nicksmax-sign-production.progress"
$prodHealthy = Port-Open 9095
$leaseFresh = (Test-Path $progressLease) -and ((Get-Item $progressLease).LastWriteTime -gt (Get-Date).AddSeconds(-90))
if ($prodHealthy -and -not $leaseFresh) {
  $listener = Get-NetTCPConnection -LocalPort 9095 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener -and $listener.OwningProcess) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Record-Restart "sign-edge" ("stale production edge pid={0}; progress lease older than 90s" -f $listener.OwningProcess)
    Start-Sleep -Milliseconds 900
  } else {
    Log "WARN production metrics port open but owner unavailable while progress lease stale"
  }
  $prodHealthy = Port-Open 9095
}
$prodStarting = Find-ProcessByCommand "run-sign-rtsp-production\.ps1"
if (Heal-EdgeCode $armed $prodHealthy) {
  # The launcher wrapper exits with its child; re-read both so this same tick can start the edge.
  Start-Sleep -Milliseconds 900
  $prodHealthy = Port-Open 9095
  $prodStarting = Find-ProcessByCommand "run-sign-rtsp-production\.ps1"
}

if ($armed) {
  # Fail closed: production marker means there may be ONE direct sign edge, never shadow + production.
  if ($shadow) { Stop-ProcessesByCommand "python.*config-nicksmax-sign-rtsp\.yaml" "RTSP shadow edge"; Start-Sleep -Milliseconds 700 }
  if ($directReady -and -not $prodHealthy -and -not $prodStarting -and (Test-Path $productionLauncher)) {
    $startDue = (-not (Test-Path $prodStartMarker)) -or ((Get-Item $prodStartMarker).LastWriteTime -lt (Get-Date).AddSeconds(-30))
    if ($startDue) {
      if (Test-RtspFrame "rtsp://127.0.0.1:8555/sign") {
        Set-Content -Path $prodStartMarker -Value (Get-Date -Format o) -Encoding ascii
        Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$productionLauncher)
        Record-Restart "sign-edge" "authoritative RTSP sign producer started after decoded-frame proof"
        # This start loads whatever is on disk right now; that is the code the edge runs from here.
        (Get-Entry "edge-code-version").fingerprint = Get-EdgeCodeFingerprint $root
      } else {
        Log "WAIT production RTSP decode proof failed; refusing early edge start"
      }
    }
  }
} else {
  # Before explicit arm, production is forbidden and shadow is the only edge lane.
  if ($prod) { Stop-ProcessesByCommand "python.*config-nicksmax-sign-production\.yaml" "unexpected production edge" }
  if ($directReady -and -not (Find-ProcessByCommand "python.*config-nicksmax-sign-rtsp\.yaml") -and (Test-Path $shadowLauncher)) {
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$shadowLauncher)
    Log "ACTION started direct RTSP sign shadow candidate"
  }
}

# ---- 4. disk floor ----------------------------------------------------------------------------
# Under 1 GB captures, the SQLite ledgers and this log itself start failing (0.10 GB measured on
# 2026-10-05). Reclaim only what is ours: this log when oversized, and raw office audio past the
# worker's own 6 h retention (OFFICE_RAW_AUDIO_RETENTION_HOURS), which the worker prunes only while
# it is alive. The rest of the disk is the operator's; ESCALATE says so.
function Invoke-DiskFloor([double]$free) {
  if ($free -lt $diskFloorBytes) {
    if ((Test-Path -LiteralPath $log) -and ((Get-Item -LiteralPath $log).Length -gt 20MB)) {
      Move-Item -LiteralPath $log -Destination ($log + ".1") -Force -ErrorAction SilentlyContinue
      Log "ACTION disk floor: rotated the supervisor log (previous copy kept as .1)"
    }
    $pruned = 0
    $bytes = 0
    $cutoff = (Get-Date).AddHours(-6)
    foreach ($f in @(Get-ChildItem -LiteralPath $officeAudioDir -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff })) {
      $bytes += $f.Length
      Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
      $pruned++
    }
    if ($pruned -gt 0) {
      Log ("ACTION disk floor: removed {0} raw audio files ({1:N0} MB) older than 6 h from {2}" -f $pruned,($bytes/1MB),$officeAudioDir)
    }
    $e = Get-Entry "disk"
    if ($e.escalatedAt -lt ($nowEpoch - 3600)) {
      $e.escalatedAt = $nowEpoch
      Log ("ESCALATE disk free {0:N2} GB is below 1 GB; captures and ledgers will fail -- free space on C: (the supervisor prunes only its own audio and log)" -f ($free/1GB))
    }
  } elseif ($free -lt $diskWarnBytes) {
    Log ("WARN disk free below 2 GB: {0:N2} GB" -f ($free/1GB))
  }
}
Invoke-DiskFloor ([double](Get-PSDrive C).Free)

try {
  $state | ConvertTo-Json -Depth 4 | Set-Content -Path $statePath -Encoding ascii
} catch {
  Log ("WARN could not persist supervisor state: {0}" -f $_.Exception.Message)
}

if ($supervisorLockHandle) { $supervisorLockHandle.Dispose() }

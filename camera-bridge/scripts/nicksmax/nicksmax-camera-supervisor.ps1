$ErrorActionPreference = "Continue"
# NicksMax camera supervisor -- ONE tick. NicksMaxCameraSupervisorSystem (SYSTEM, at startup)
# runs data\nicksmax-camera-supervisor-loop.ps1, which calls this tick every ~30s.
#
# 2026-10-02 - this file is the single source. data\nicksmax-camera-supervisor.ps1 on the box
# is a shim that invokes this path, so a `git pull` on NicksMax is the deploy. Before this, the
# box ran a hand-edited data\ copy that had drifted 36 lines ahead of the repo.
#
# What it heals, in order (cheap checks first, slow RTSP decode probes last):
#   0. single tick at a time (file lock) -- two supervisors once fought over the relay.
#   1. office conversation worker (StateNour-OfficeIntelligence-NicksMax): not running -> start;
#      running but heartbeat stale -> restart; code dir missing -> ESCALATE.
#   2. Eufy bridge (:3000) + agent (:3601) tasks: not running -> start; port closed two ticks
#      in a row -> restart.
#   3. sign pipeline: relay -> MediaMTX -> crop -> production edge (decoded-frame proof).
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
$officeHeartbeatStaleMinutes = 10
$eufyTasks = @(
  @{ Name = "StateNour-Eufy-Bridge-NicksMax"; Port = 3000; Key = "eufy-bridge" },
  @{ Name = "StateNour-Eufy-Agent-NicksMax";  Port = 3601; Key = "eufy-agent" }
)
$escalateRestartsPerHour = 6

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

function Log([string]$m) {
  try {
    Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) -Encoding utf8
  } catch {
    # Logging must never break supervision across privilege-context races.
  }
}

# ---- restart ledger --------------------------------------------------------------------------
# { "<component>": { "restarts": [epoch...], "escalatedAt": epoch, "portMisses": n } }
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

function Port-Open([int]$port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $ar = $c.BeginConnect("127.0.0.1",$port,$null,$null)
    $ok = $ar.AsyncWaitHandle.WaitOne(400,$false) -and $c.Connected
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

function Find-ProcessByCommand([string]$needle) {
  return Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $needle } |
    Select-Object -First 1
}

function Stop-ProcessesByCommand([string]$needle,[string]$label) {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $needle } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      Log ("ACTION stopped {0} pid={1}" -f $label,$_.ProcessId)
    }
}

# Start (or restart) a scheduled task, at most once per $minGapMinutes, and ledger it.
function Kick-Task([string]$taskName,[string]$key,[string]$why,[bool]$restart,[int]$minGapMinutes = 1) {
  if ((Restarts-InLastMinutes $key $minGapMinutes) -gt 0) { return }
  try {
    if ($restart) { Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop; Start-Sleep -Milliseconds 800 }
    Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
    Record-Restart $key $why
  } catch {
    Record-Restart $key ("{0}; start FAILED: {1}" -f $why,$_.Exception.Message)
  }
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

# Legacy GUI/WGC lane is retired on NicksMax. Disabled means disabled; do not resurrect it.
# NicksMaxCameraSupervisorUser is the pre-SYSTEM copy of this supervisor; two supervisors
# fought over the relay after the 2026-10-02 reboot, so it stays disabled too.
foreach ($taskName in @("V380Watchdog","NickEdgeProducer","NickEdgeProducerRight","NickEdgeSignCandidate","NicksMaxCameraSupervisorUser")) {
  $t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($t -and $t.State -ne "Disabled") {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
    Log ("SAFETY disabled retired task {0}" -f $taskName)
  }
}

# ---- 1. office conversation worker ----------------------------------------------------------
$ot = Get-ScheduledTask -TaskName $officeTask -ErrorAction SilentlyContinue
if ($ot -and $ot.State -ne "Disabled") {
  $workDir = $ot.Actions | Select-Object -First 1 -ExpandProperty WorkingDirectory
  # The task was commissioned from git worktrees twice; a worktree cleanup deleted its code and
  # the worker failed at every boot from 2026-10-02 09:15. Repoint it once at the stable checkout
  # (the same tree this supervisor runs from), then let the normal start path below run it.
  if ($workDir -and $workDir -match '\\worktrees\\' -and (Test-Path (Join-Path $root "vision\officewake.py"))) {
    try {
      $action = $ot.Actions | Select-Object -First 1
      $action.WorkingDirectory = $root
      Set-ScheduledTask -TaskName $officeTask -Action $action -ErrorAction Stop | Out-Null
      Stop-ScheduledTask -TaskName $officeTask -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 800
      Start-ScheduledTask -TaskName $officeTask -ErrorAction SilentlyContinue
      Record-Restart "office-worker" ("repointed from worktree {0} to {1}" -f $workDir,$root)
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
    Kick-Task $officeTask "office-worker" ("task state {0}" -f $ot.State) $false 2
  } elseif (($officeFp = Get-OfficeCodeFingerprint $workDir) -and ((Get-Entry "office-code-version").fingerprint -ne $officeFp)) {
    # A long-running Python process keeps the code it started with. When `git pull` changes the
    # office worker's modules, restart it once so a deploy is just a pull (2026-10-02). The new
    # fingerprint is recorded only when the restart is actually issued, so a throttled tick
    # retries instead of forgetting the change.
    if ((Restarts-InLastMinutes "office-worker" 2) -eq 0) {
      Kick-Task $officeTask "office-worker" "office worker code changed on disk; restarting to load it" $true 2
      (Get-Entry "office-code-version").fingerprint = $officeFp
    }
  } elseif (Test-Path $officeStatusPath) {
    try {
      $hb = (Get-Content $officeStatusPath -Raw | ConvertFrom-Json).conversationWorkerHeartbeatAt
      if ($hb) {
        $age = ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($hb)).TotalMinutes
        if ($age -gt $officeHeartbeatStaleMinutes) {
          Kick-Task $officeTask "office-worker" ("running but heartbeat {0:N0} min old" -f $age) $true 10
        }
      }
    } catch {
      Log ("WARN office status unreadable: {0}" -f $_.Exception.Message)
    }
  }
}

# ---- 2. Eufy bridge + agent -------------------------------------------------------------------
foreach ($et in $eufyTasks) {
  $t = Get-ScheduledTask -TaskName $et.Name -ErrorAction SilentlyContinue
  if (-not $t -or $t.State -eq "Disabled") { continue }
  $e = Get-Entry $et.Key
  if ($t.State -ne "Running") {
    $e.portMisses = 0
    Kick-Task $et.Name $et.Key ("task state {0}" -f $t.State) $false 2
  } elseif (-not (Port-Open $et.Port)) {
    $e.portMisses = $e.portMisses + 1
    # Two consecutive misses (~1 min) so a process mid-restart is not killed again.
    if ($e.portMisses -ge 2) {
      $e.portMisses = 0
      Kick-Task $et.Name $et.Key ("running but :{0} closed two ticks in a row" -f $et.Port) $true 5
    }
  } else {
    $e.portMisses = 0
  }
}

# Do not kill V380 if the operator manually opens it; it simply is no longer infrastructure.

# ---- 3. sign pipeline -------------------------------------------------------------------------
# 3a. Cloud/P2P relay -> localhost full three-lens stack on 8554.
# Listener health is authoritative here. An elevated/System relay can hide its command line
# from this token, so command-line discovery alone causes duplicate restart attempts.
$relayReady = (Port-Open 8554) -and (Port-Open 8080)
# A refused V380 cloud login is not a crash a restart can heal. Witnessed 2026-10-02/03: the
# relay exited "login failed result: 1002" and this loop re-tried the cloud login ~120x/hour
# for 11+ hours, which risks locking the account. On a login refusal, retry once per 30 min
# and escalate it as a credential problem.
$relayErr = Join-Path (Split-Path $relayLauncher) $(if ($isSystem) { "relay-system.stderr.log" } else { "relay.stderr.log" })
$relayAuthFailed = (Test-Path $relayErr) -and (Select-String -Path $relayErr -Pattern 'login failed' -SimpleMatch -Quiet)
$relayAuthHold = (-not $relayReady) -and $relayAuthFailed -and ((Restarts-InLastMinutes "sign-relay" 30) -gt 0)
if ($relayAuthHold) {
  $e = Get-Entry "sign-relay"
  if ($e.escalatedAt -lt ($nowEpoch - 3600)) {
    $e.escalatedAt = $nowEpoch
    Log "ESCALATE sign-relay V380 cloud login refused; holding retries to 1 per 30 min -- check the shop-sign camera credential"
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

$free = (Get-PSDrive C).Free
if ($free -lt 2GB) { Log ("WARN disk free below 2 GB: {0:N2} GB" -f ($free/1GB)) }

try {
  $state | ConvertTo-Json -Depth 4 | Set-Content -Path $statePath -Encoding ascii
} catch {
  Log ("WARN could not persist supervisor state: {0}" -f $_.Exception.Message)
}

if ($supervisorLockHandle) { $supervisorLockHandle.Dispose() }

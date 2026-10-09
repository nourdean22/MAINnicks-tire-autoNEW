# NicksMax authoritative sign edge launcher -- installed as data\run-sign-rtsp-production.ps1; the
# supervisor starts it (hidden) after a decoded-frame proof on rtsp://127.0.0.1:8555/sign and it
# runs the production edge in the foreground until the edge exits.
#
# Canonical source since 2026-10-09: camera-bridge\scripts\nicksmax\ (it was a box-only file).
# scripts\nicksmax\install-nicksmax-supervisor-host.ps1 installs it; the tick says once a day when
# the installed copy differs. A change takes effect at the next edge start.
#
# The previous run's stdout/stderr are kept as .prev: deleting them at start (the old behaviour)
# meant a crashed edge's own log was gone the moment the supervisor restarted it.
$ErrorActionPreference = "Stop"
$root = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge"
$python = Join-Path $root ".venv\Scripts\python.exe"
$config = Join-Path $root "data\config-nicksmax-sign-production.yaml"
$calibration = Join-Path $root "data\calib-nicksmax-sign-rtsp.json"
$model = Join-Path $root "ov_models\vehicle-detection-0200\FP16\vehicle-detection-0200.xml"
$cameraSecret = "C:\Users\nourd\NicksMax\lab\secrets\machine\camera-ingest.machine"
$stateNourSecret = "C:\Users\nourd\NicksMax\lab\secrets\machine\statenour-sync.machine"
$statusLog = Join-Path $root "logs\edge-NicksMaxSignProduction.status.log"
$outLog = Join-Path $root "logs\edge-NicksMaxSignProduction.stdout.log"
$errLog = Join-Path $root "logs\edge-NicksMaxSignProduction.stderr.log"
$wrapperLockPath = Join-Path $root "data\.nicksmax-sign-production.lock"

# The supervisor's writer, verbatim (a test keeps the copies identical): Windows PowerShell 5.1's
# Add-Content and Set-Content fail beside any open reader.
function Write-SharedFile([string]$path, [string]$text, [switch]$Append) {
  $mode = if ($Append) { [IO.FileMode]::Append } else { [IO.FileMode]::Create }
  $share = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
  $stream = [IO.FileStream]::new($path, $mode, [IO.FileAccess]::Write, $share)
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($text)
    $stream.Write($bytes, 0, $bytes.Length)
  } finally {
    $stream.Dispose()
  }
}

function Log([string]$m) {
  try { Write-SharedFile $statusLog ("{0} {1}`r`n" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) -Append } catch {}
}

# Keep the last run's output beside the new one; fall back to removing it if it cannot move.
function Rotate-Log([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  try { Move-Item -LiteralPath $path -Destination ($path + ".prev") -Force }
  catch { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
}

try {
  $wrapperLockHandle = [IO.File]::Open(
    $wrapperLockPath,
    [IO.FileMode]::OpenOrCreate,
    [IO.FileAccess]::ReadWrite,
    [IO.FileShare]::None
  )
} catch {
  Log "SKIP duplicate production wrapper; lock held"
  exit 0
}

function Read-MachineSecret([string]$path) {
  if (-not (Test-Path $path)) { throw "missing machine credential: $path" }
  Add-Type -AssemblyName System.Security
  $enc = [Convert]::FromBase64String([IO.File]::ReadAllText($path).Trim())
  $dec = $null
  try {
    $dec = [Security.Cryptography.ProtectedData]::Unprotect(
      $enc,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    return [Text.Encoding]::UTF8.GetString($dec)
  } finally {
    if ($enc) { [Array]::Clear($enc,0,$enc.Length) }
    if ($dec) { [Array]::Clear($dec,0,$dec.Length) }
  }
}

$env:CAMERA_SOURCE_URL = "rtsp://127.0.0.1:8555/sign"
$env:OPENCV_FFMPEG_CAPTURE_OPTIONS = "rtsp_transport;tcp|timeout;5000000"
$env:EDGE_PROGRESS_LEASE = Join-Path $root "data\.nicksmax-sign-production.progress"
Write-SharedFile $env:EDGE_PROGRESS_LEASE ((Get-Date -Format o) + "`r`n")
$env:CAMERA_INGEST_KEY = Read-MachineSecret $cameraSecret
$env:STATENOUR_SYNC_KEY = Read-MachineSecret $stateNourSecret

$args = @(
  "edge_main.py",
  "--config",$config,
  "--camera","sign",
  "--source","rtsp",
  "--source-url-env","CAMERA_SOURCE_URL",
  "--calibration",$calibration,
  "--model",$model,
  "--device","CPU",
  "--hard-cases",(Join-Path $root "data\nicksmax-sign-production-hard-cases"),
  "--hard-case-max-gb","0.15",
  "--hard-case-episodes","both",
  "--ledger",(Join-Path $root "data\nicksmax-sign-production.sqlite"),
  "--trajectories",(Join-Path $root "data\nicksmax-sign-production-trajectories.sqlite"),
  "--mode","production",
  "--log-level","INFO",
  "--fps","4",
  "--heartbeat-seconds","30",
  "--stall-exit-seconds","60"
)

try {
  Rotate-Log $outLog
  Rotate-Log $errLog
  Log "START authoritative RTSP sign producer source=rtsp://127.0.0.1:8555/sign"
  $p = Start-Process -FilePath $python -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -Wait
  Log ("EXIT rc={0}" -f $p.ExitCode)
  exit $p.ExitCode
} finally {
  Remove-Item Env:\CAMERA_INGEST_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\STATENOUR_SYNC_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\CAMERA_SOURCE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\OPENCV_FFMPEG_CAPTURE_OPTIONS -ErrorAction SilentlyContinue
  Remove-Item Env:\EDGE_PROGRESS_LEASE -ErrorAction SilentlyContinue
  if ($wrapperLockHandle) { $wrapperLockHandle.Dispose() }
}

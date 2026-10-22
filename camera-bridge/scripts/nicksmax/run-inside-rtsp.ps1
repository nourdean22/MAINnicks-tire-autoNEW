# NicksMax INSIDE (bay) camera edge launcher -- PREP ONLY, NOT ARMED (counter prep, 2026-10-21).
#
# Mirrors run-sign-rtsp-production.ps1 for camera "inside", with three differences that keep it
# unarmed until the bay camera is commissioned:
#   1. --mode shadow, always. Production is a later, reviewed edit of this file, never a flag.
#   2. No machine secrets are read and --dry-run is passed: nothing posts to the shop or to
#      StateNour. Visits, hard cases and trajectories stay in this machine's local files.
#   3. It refuses to start without -SourceUrl and an existing -Calibration file: an inside edge
#      with no calibration would run census mode and report nothing useful.
# Nothing registers or supervises it; run it by hand once the bay camera has an RTSP URL:
#   powershell -NoProfile -ExecutionPolicy Bypass -File run-inside-rtsp.ps1 `
#     -SourceUrl rtsp://127.0.0.1:8556/inside -Calibration <root>\data\calib-nicksmax-inside.json
# -PrintArgs prints the edge arguments and exits. The URL travels in an environment variable,
# never on the command line, so a credential-bearing URL does not land in a process listing.
param(
  [string]$SourceUrl = "",
  [string]$Calibration = "",
  [switch]$PrintArgs
)
$ErrorActionPreference = "Stop"
$root = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge"
# String paths, not Join-Path: Join-Path throws on a host with no C: drive (Linux CI), before
# -PrintArgs and the refusal can run.
$python = "$root\.venv\Scripts\python.exe"
$config = "$root\data\config-nicksmax-inside.yaml"
$model = "$root\ov_models\vehicle-detection-0200\FP16\vehicle-detection-0200.xml"
$statusLog = "$root\logs\edge-NicksMaxInside.status.log"
$outLog = "$root\logs\edge-NicksMaxInside.stdout.log"
$errLog = "$root\logs\edge-NicksMaxInside.stderr.log"
$wrapperLockPath = "$root\data\.nicksmax-inside.lock"

# The supervisor's writer, verbatim: Windows PowerShell 5.1's Add-Content and Set-Content fail
# beside any open reader.
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

# Only into an existing logs folder: on a host without it the path is a bare file name in the cwd.
function Log([string]$m) {
  try {
    if (Test-Path -LiteralPath "$root\logs") {
      Write-SharedFile $statusLog ("{0} {1}`r`n" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) -Append
    }
  } catch {}
}

# Keep the last run's output beside the new one; fall back to removing it if it cannot move.
function Rotate-Log([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  try { Move-Item -LiteralPath $path -Destination ($path + ".prev") -Force }
  catch { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
}

if (-not $SourceUrl -or -not $Calibration -or -not (Test-Path -LiteralPath $Calibration -PathType Leaf)) {
  $why = "REFUSE inside edge: needs -SourceUrl and an existing -Calibration file (got calibration '{0}')" -f $Calibration
  Log $why
  Write-Output $why
  exit 2
}

$args = @(
  "edge_main.py",
  "--config",$config,
  "--camera","inside",
  "--source","rtsp",
  "--source-url-env","INSIDE_CAMERA_SOURCE_URL",
  "--calibration",$Calibration,
  "--model",$model,
  "--device","CPU",
  "--hard-cases","$root\data\nicksmax-inside-hard-cases",
  "--hard-case-max-gb","0.15",
  "--hard-case-episodes","both",
  "--ledger","$root\data\nicksmax-inside.sqlite",
  "--trajectories","$root\data\nicksmax-inside-trajectories.sqlite",
  "--mode","shadow",
  "--dry-run",
  "--log-level","INFO",
  "--fps","4",
  "--heartbeat-seconds","30",
  "--stall-exit-seconds","60"
)
if ($PrintArgs) { $args; exit 0 }

try {
  $wrapperLockHandle = [IO.File]::Open(
    $wrapperLockPath,
    [IO.FileMode]::OpenOrCreate,
    [IO.FileAccess]::ReadWrite,
    [IO.FileShare]::None
  )
} catch {
  Log "SKIP duplicate inside wrapper; lock held"
  exit 0
}

$env:INSIDE_CAMERA_SOURCE_URL = $SourceUrl
$env:OPENCV_FFMPEG_CAPTURE_OPTIONS = "rtsp_transport;tcp|timeout;5000000"
$env:EDGE_PROGRESS_LEASE = "$root\data\.nicksmax-inside.progress"
Write-SharedFile $env:EDGE_PROGRESS_LEASE ((Get-Date -Format o) + "`r`n")

try {
  Rotate-Log $outLog
  Rotate-Log $errLog
  Log "START inside RTSP edge in SHADOW (dry run, local files only)"
  $p = Start-Process -FilePath $python -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -Wait
  Log ("EXIT rc={0}" -f $p.ExitCode)
  exit $p.ExitCode
} finally {
  Remove-Item Env:\INSIDE_CAMERA_SOURCE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\OPENCV_FFMPEG_CAPTURE_OPTIONS -ErrorAction SilentlyContinue
  Remove-Item Env:\EDGE_PROGRESS_LEASE -ErrorAction SilentlyContinue
  if ($wrapperLockHandle) { $wrapperLockHandle.Dispose() }
}

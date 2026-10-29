# Front-desk PC sign producer launcher (lot vision v2 phase 4). Started by the SYSTEM task that
# scripts\install-frontdesk-sign.ps1 registers; runs cloud\run_cloud.py --primary in the foreground
# until it exits, so the task's restart policy and 5-minute heal trigger bring it back.
#
# The V380 login is decrypted from the LocalMachine DPAPI file into THIS process's environment
# only (never a command line this script builds, never a log) and removed on exit. The shop
# ingest key comes from the machine environment the office lane already set.
$ErrorActionPreference = "Stop"
$bridge = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $bridge
$settings = Get-Content -LiteralPath (Join-Path $root "frontdesk-settings.json") -Raw | ConvertFrom-Json
$secretFile = Join-Path $env:ProgramData "NickLotVision\v380.machine"
$calibration = Join-Path $root "calibration-sign.json"
$logDir = Join-Path $root "logs"
$outLog = Join-Path $logDir "frontdesk-sign.stdout.log"
$errLog = Join-Path $logDir "frontdesk-sign.stderr.log"

# Keep 8 days of earlier runs' output: the relay login-hold check reads a week of relay lines.
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
foreach ($log in @($outLog, $errLog)) {
  if (Test-Path -LiteralPath $log) { Move-Item -LiteralPath $log -Destination ($log + "." + $stamp) -Force -ErrorAction SilentlyContinue }
}
Get-ChildItem -LiteralPath $logDir -Filter "frontdesk-sign.std*.log.*" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-8) } | Remove-Item -Force -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.Security
$enc = [Convert]::FromBase64String([IO.File]::ReadAllText($secretFile).Trim())
$dec = $null
try {
  $dec = [Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
  $login = [Text.Encoding]::UTF8.GetString($dec) | ConvertFrom-Json
} finally {
  if ($dec) { [Array]::Clear($dec, 0, $dec.Length) }
}

try {
  $env:V380_DEVICE_ID = $login.id
  $env:V380_USERNAME = $login.username
  $env:V380_PASSWORD = $login.password
  $login = $null
  $env:RELAY_BIN = $settings.relay
  $env:MEDIAMTX_BIN = $settings.mediamtx
  $env:FFMPEG_BIN = $settings.ffmpeg
  $env:EDGE_ROLE = "shop"
  $env:LEDGER_DIR = Join-Path $root "data"
  $env:CAMERA_SOURCE_URL = "rtsp://127.0.0.1:8555/sign"
  $env:OPENCV_FFMPEG_CAPTURE_OPTIONS = "rtsp_transport;tcp|timeout;5000000"
  $env:VISION_OV_MODEL = Join-Path $bridge "ov_models\vehicle-detection-0200\FP16\vehicle-detection-0200.xml"
  if (Test-Path -LiteralPath $calibration) { $env:EDGE_CALIBRATION = $calibration }
  $p = Start-Process -FilePath $settings.python -ArgumentList @("-m", "cloud.run_cloud", "--primary") -WorkingDirectory $bridge -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -Wait
  exit $p.ExitCode
} finally {
  Remove-Item Env:\V380_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:\V380_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:\V380_DEVICE_ID -ErrorAction SilentlyContinue
}

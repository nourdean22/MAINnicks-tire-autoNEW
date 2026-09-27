<#
.SYNOPSIS
  Set up the office conversation capture on the SHOP PC and register it to run at boot.

.DESCRIPTION
  One command, run once, on the machine that can reach the office camera. It:
    1. verifies every prerequisite BEFORE changing anything, and names the fix for each;
    2. writes CAMERA_INGEST_KEY to the machine environment (never echoed);
    3. registers a Scheduled Task that runs officeloop.py at boot as SYSTEM.

  The loop itself decides when to capture: 08:00-18:00 America/New_York, every day. The task
  runs continuously and sleeps outside those hours, so there is no second schedule to keep in
  sync with the first -- the shop's hours live in ONE place, officeloop.py.

.NOTES
  DELIBERATELY NOT AUTOMATED: fetching the key. It is read from Railway by the operator, or
  passed in -IngestKey. This script never prints it, never logs it, and never writes it to the
  repo. -WhatIf shows every change without making one.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  # Audio source spec. For rtsp this is the camera URL. For dshow this is the exact
  # Windows microphone name (or an audio=<device> DirectShow spec).
  [Parameter(Mandatory = $true)][string]$SourceUrl,

  [ValidateSet("rtsp", "dshow")][string]$SourceKind = "rtsp",

  # The shared ingest secret. Read it from Railway rather than typing it from memory:
  #   railway run -s MAINnicks-tire-auto -- printenv CAMERA_INGEST_KEY
  [Parameter(Mandatory = $true)][string]$IngestKey,

  [string]$OutDir       = "C:\nick-office-audio",
  [string]$Transcriber  = "whisper-cli",
  [string]$WhisperModel = "",
  [double]$WindowSeconds = 300,
  [string]$OpenAt  = "08:00",
  [string]$CloseAt = "18:00",
  [string]$TaskName = "NickOfficeCapture",
  # Where this repo's camera-bridge lives on the shop PC.
  [string]$BridgeDir = "C:\NOURCITY\camera-bridge"
)

$ErrorActionPreference = "Stop"

function Fail([string]$what, [string]$fix) {
  Write-Host "BLOCKED: $what" -ForegroundColor Red
  Write-Host "  fix:   $fix" -ForegroundColor Yellow
  exit 1
}

Write-Host "=== Preflight (nothing is changed until every check passes) ===" -ForegroundColor Cyan

# --- 1. admin -----------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Fail "not running as Administrator" "re-open PowerShell with 'Run as administrator'"
}
Write-Host "  [ok] administrator"

# --- 2. the bridge --------------------------------------------------------------
$loop = Join-Path $BridgeDir "vision\officeloop.py"
if (-not (Test-Path $loop)) {
  Fail "officeloop.py not found at $loop" "git clone the repo to $BridgeDir, or pass -BridgeDir"
}
Write-Host "  [ok] camera-bridge at $BridgeDir"

# --- 3. python ------------------------------------------------------------------
$py = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $py) { Fail "python is not on PATH" "install Python 3.11+ and tick 'Add to PATH'" }
$pyVer = (& python -c "import sys;print('%d.%d'%sys.version_info[:2])").Trim()
if ([version]$pyVer -lt [version]"3.9") {
  Fail "python $pyVer is too old for zoneinfo" "install Python 3.11 or newer"
}
Write-Host "  [ok] python $pyVer at $($py.Source)"

# --- 4. tzdata ------------------------------------------------------------------
# WINDOWS SHIPS NO SYSTEM TZ DATABASE. Without this package zoneinfo cannot resolve
# America/New_York and the loop refuses to start -- by design, because the alternative is a
# fixed UTC offset that silently moves the shop's hours by an hour on each DST day.
& python -c "import zoneinfo;zoneinfo.ZoneInfo('America/New_York')" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "  [..] installing tzdata (Windows has no system tz database)" -ForegroundColor Yellow
  if ($PSCmdlet.ShouldProcess("python environment", "pip install tzdata")) {
    & python -m pip install --quiet "tzdata>=2026.1"
    & python -c "import zoneinfo;zoneinfo.ZoneInfo('America/New_York')" 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "tzdata still not resolving America/New_York" "run: python -m pip install tzdata" }
  }
}
Write-Host "  [ok] tz database resolves America/New_York"

# --- 5. ffmpeg ------------------------------------------------------------------
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Fail "ffmpeg is not on PATH" "winget install Gyan.FFmpeg  (then reopen PowerShell)"
}
Write-Host "  [ok] ffmpeg"

# --- 6. the transcriber ---------------------------------------------------------
# The whole feature is worthless without it, and a MISSING transcriber is the failure that
# would otherwise post a day of empty transcripts. Checked here rather than discovered at 8am.
if (-not (Get-Command $Transcriber -ErrorAction SilentlyContinue)) {
  Fail "transcriber '$Transcriber' is not on PATH" @"
install a whisper.cpp build and put whisper-cli on PATH, e.g.
    winget install ggml.whispercpp
  then download a model and pass -WhisperModel <path-to.bin>
  (or pass -Transcriber <full path> if it is installed elsewhere)
"@
}
Write-Host "  [ok] transcriber $Transcriber"

# --- 7. the audio source --------------------------------------------------------
if ($SourceKind -eq "rtsp") {
  Write-Host "  [..] probing RTSP for an AUDIO stream" -ForegroundColor Yellow
  $probe = & ffprobe -v error -select_streams a -show_entries stream=codec_name,sample_rate `
                     -of default=nw=1 -rtsp_transport tcp -i $SourceUrl -t 1 2>&1
  if ($LASTEXITCODE -ne 0 -or -not $probe) {
    Fail "no audio stream from RTSP source" "check the URL and that NAS(RTSP) is enabled on the camera"
  }
  Write-Host "  [ok] RTSP audio: $($probe -join ' ')"
} else {
  $dshowSpec = if ($SourceUrl.ToLower().StartsWith("audio=")) { $SourceUrl } else { "audio=$SourceUrl" }
  $probeFile = Join-Path $env:TEMP "nick-office-mic-probe.wav"
  Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
  Write-Host "  [..] probing DirectShow microphone for 5s" -ForegroundColor Yellow
  $probe = & ffmpeg -hide_banner -f dshow -i $dshowSpec -vn -acodec pcm_s16le -ar 16000 -ac 1 -t 5 -y $probeFile 2>&1
  $probeInfo = Get-Item -LiteralPath $probeFile -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -ne 0 -or -not $probeInfo -or $probeInfo.Length -lt 1024) {
    Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
    Fail "DirectShow microphone did not produce audio" "run ffmpeg -list_devices true -f dshow -i dummy and pass the exact microphone name"
  }
  Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
  Write-Host "  [ok] DirectShow microphone produced PCM audio"
}

Write-Host ""
Write-Host "=== Applying ===" -ForegroundColor Cyan

if (-not (Test-Path $OutDir)) {
  if ($PSCmdlet.ShouldProcess($OutDir, "create audio directory")) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
  }
}
Write-Host "  [ok] audio dir $OutDir"

# Secrets go to the MACHINE environment, not the task's command line: a scheduled task's
# arguments are readable by any user via schtasks /query /v.
if ($PSCmdlet.ShouldProcess("machine environment", "set office summary source and ingest key")) {
  [Environment]::SetEnvironmentVariable("CAMERA_INGEST_KEY", $IngestKey, "Machine")
  [Environment]::SetEnvironmentVariable("NICK_OFFICE_AUDIO_SOURCE", $SourceUrl, "Machine")
  [Environment]::SetEnvironmentVariable("NICK_OFFICE_AUDIO_INPUT_FORMAT", $SourceKind, "Machine")
  if ($SourceKind -eq "rtsp") {
    [Environment]::SetEnvironmentVariable("NICK_OFFICE_RTSP", $SourceUrl, "Machine")
  }
}
Write-Host "  [ok] office audio source + CAMERA_INGEST_KEY stored (machine scope, not echoed)"

$argList = @(
  "`"$loop`"",
  "--source-url", "`"%NICK_OFFICE_AUDIO_SOURCE%`"",
  "--input-format", "`"%NICK_OFFICE_AUDIO_INPUT_FORMAT%`"",
  "--out-dir", "`"$OutDir`"",
  "--seconds", $WindowSeconds,
  "--open", $OpenAt,
  "--close", $CloseAt,
  "--transcriber", "`"$Transcriber`""
)
if ($WhisperModel) { $argList += @("--model", "`"$WhisperModel`"") }

$action = New-ScheduledTaskAction -Execute $py.Source -Argument ($argList -join " ") -WorkingDirectory (Join-Path $BridgeDir "vision")
if ($SourceKind -eq "dshow") {
  # DirectShow audio devices belong to the logged-in Windows desktop. Register the task
  # under the current operator account so the scheduled run sees the same mic that passed
  # preflight above.
  $runAs = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $runAs
  $principal = New-ScheduledTaskPrincipal -UserId $runAs -LogonType Interactive -RunLevel Highest
} else {
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
}
# RestartCount/Interval: the loop is long-lived, so a crash must bring it back the same day.
# ExecutionTimeLimit 0 = never kill it; the loop decides its own hours.
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 5) `
              -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

if ($PSCmdlet.ShouldProcess($TaskName, "register scheduled task")) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description "Nick's Tire office conversation capture. Hours live in officeloop.py (08:00-18:00 ET)." | Out-Null
  Start-ScheduledTask -TaskName $TaskName
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
$taskMode = if ($SourceKind -eq "dshow") { "at logon, interactive user, auto-restart" } else { "at boot, SYSTEM, auto-restart" }
Write-Host "  task:    $TaskName ($taskMode)"
Write-Host "  hours:   $OpenAt-$CloseAt America/New_York, every day"
Write-Host "  window:  $WindowSeconds s per capture"
Write-Host ""
Write-Host "Verify it end to end with ONE window, right now:" -ForegroundColor Cyan
Write-Host "  cd `"$(Join-Path $BridgeDir 'vision')`""
Write-Host "  python officepost.py --source-url `$env:NICK_OFFICE_AUDIO_SOURCE --input-format `$env:NICK_OFFICE_AUDIO_INPUT_FORMAT --out-dir `"$OutDir`" --seconds 60"
Write-Host ""
Write-Host "Drop --dry-run to actually post. A real post replies with transcriptStatus and coverage;"
Write-Host "coverage below 0.65 means the server stored the episode but refused to extract facts"
Write-Host "from it, which is the gate working, not a failure."

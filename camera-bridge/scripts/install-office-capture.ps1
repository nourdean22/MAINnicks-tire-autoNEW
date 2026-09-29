<#
.SYNOPSIS
  Commission the event-triggered Office conversation-intelligence worker.
.DESCRIPTION
  Installs ONE production path:
  NICKS EUCLID semantic event -> officewake.py -> bounded local audio -> local whisper.cpp
  -> POST /api/conversation-episodes -> evidence-backed Admin summary.
  The legacy continuous-hours officeloop.py task is disabled by this installer.
  Production defaults to the NicksMax loopback Eufy fragmented-MP4 recording route, so the
  worker can run as SYSTEM at startup without Chrome, an unlocked desktop, or a Windows mic.
  DirectShow remains an explicit fallback and therefore uses the interactive desktop session.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$SourceUrl = "",
  [ValidateSet("generic", "rtsp", "dshow")][string]$SourceKind = "generic",
  [Parameter(Mandatory = $true)][string]$IngestKey,
  [string]$OfficeSerial = "T8410P5225154105",
  [string]$BridgeUrl = "ws://127.0.0.1:3000/ws",
  [string]$BridgeDir = "C:\NOURCITY\camera-bridge",
  [string]$PythonPath = "",
  [string]$FfmpegPath = "ffmpeg",
  [string]$Transcriber = "whisper-cli",
  [string]$WhisperModel = "",
  [string]$OutDir = "$env:LOCALAPPDATA\StateNour\OfficeIntelligence\audio",
  [string]$LedgerPath = "$env:LOCALAPPDATA\StateNour\OfficeIntelligence\officewake.jsonl",
  [string]$StatusPath = "$env:LOCALAPPDATA\StateNour\OfficeIntelligence\office-conversation-status.json",
  [string]$ScheduleJson = '{"mon":"08:00-18:00","tue":"08:00-18:00","wed":"08:00-18:00","thu":"08:00-18:00","fri":"08:00-18:00","sat":"08:00-18:00","sun":"09:00-16:00"}',
  [double]$WindowSeconds = 120,
  [double]$CooldownSeconds = 30,
  [double]$RetentionHours = 6,
  [double]$RetentionMaxMb = 256,
  [double]$MinFreeMb = 768,
  [string]$TaskName = "StateNour-OfficeIntelligence-NicksMax",
  [string]$DesktopUser = "",
  [switch]$ProbeOnly
)

$ErrorActionPreference = "Stop"
$SourceKind = $SourceKind.ToLowerInvariant()

function Fail([string]$what, [string]$fix) {
  Write-Host "BLOCKED: $what" -ForegroundColor Red
  Write-Host "  fix: $fix" -ForegroundColor Yellow
  exit 1
}

if (-not $SourceUrl) {
  if ($SourceKind -ne "generic") {
    Fail "SourceUrl is required for $SourceKind" "pass -SourceUrl explicitly or use the generic NICKS EUCLID default"
  }
  $bridgeMaxSeconds = [math]::Min(300, [math]::Max(5, [math]::Ceiling($WindowSeconds + 15)))
  $SourceUrl = "http://127.0.0.1:3000/record/$OfficeSerial`?maxSeconds=$bridgeMaxSeconds"
}

function Resolve-Executable([string]$candidate) {
  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    return (Resolve-Path -LiteralPath $candidate).Path
  }
  $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

$ffmpeg = Resolve-Executable $FfmpegPath
if (-not $ffmpeg) {
  Fail "ffmpeg is not runnable as '$FfmpegPath'" "pass -FfmpegPath with the full ffmpeg.exe path"
}

function Test-AudioSource {
  if ($WhatIfPreference) {
    Write-Host "  [whatif] audio probe skipped; no probe file created"
    return
  }
  if ($SourceKind -in @("rtsp", "generic")) {
    $ffprobe = Join-Path (Split-Path -Parent $ffmpeg) "ffprobe.exe"
    if (-not (Test-Path $ffprobe)) { $ffprobe = Resolve-Executable "ffprobe" }
    if (-not $ffprobe) { Fail "ffprobe is unavailable" "install ffprobe beside ffmpeg or put it on PATH" }
    $label = if ($SourceKind -eq "rtsp") { "RTSP" } else { "generic fMP4/HTTP" }
    Write-Host "  [..] probing $label for an audio stream" -ForegroundColor Yellow
    $probeOut = Join-Path $env:TEMP ("nick-office-probe-" + [guid]::NewGuid().ToString("N") + ".txt")
    $probeErr = Join-Path $env:TEMP ("nick-office-probe-" + [guid]::NewGuid().ToString("N") + ".err")
    try {
      $probeArgs = @("-v","error","-select_streams","a","-show_entries","stream=codec_name,sample_rate,channels","-of","default=nw=1")
      if ($SourceKind -eq "rtsp") {
        $probeArgs += @("-rtsp_transport","tcp")
      } else {
        $probeArgs += @("-rw_timeout","15000000")
      }
      $probeArgs += $SourceUrl
      $p = Start-Process -FilePath $ffprobe -ArgumentList $probeArgs -RedirectStandardOutput $probeOut -RedirectStandardError $probeErr -Wait -PassThru
      $body = (Get-Content $probeOut -Raw -ErrorAction SilentlyContinue)
      if ($p.ExitCode -ne 0 -or -not $body.Trim()) {
        $detail = (Get-Content $probeErr -Raw -ErrorAction SilentlyContinue)
        Fail "$label source has no usable audio stream" ($detail.Trim() | Select-Object -First 1)
      }
      Write-Host "  [ok] $label audio stream proved"
    } finally {
      Remove-Item $probeOut,$probeErr -Force -ErrorAction SilentlyContinue
    }
    return
  }

  $spec = if ($SourceUrl.ToLowerInvariant().StartsWith("audio=")) { $SourceUrl } else { "audio=$SourceUrl" }
  $probeFile = Join-Path $env:TEMP ("nick-office-mic-" + [guid]::NewGuid().ToString("N") + ".wav")
  $captureOut = Join-Path $env:TEMP ("nick-office-mic-" + [guid]::NewGuid().ToString("N") + ".out")
  $captureErr = Join-Path $env:TEMP ("nick-office-mic-" + [guid]::NewGuid().ToString("N") + ".err")
  try {
    Write-Host "  [..] recording DirectShow microphone for 5 seconds" -ForegroundColor Yellow
    $p = Start-Process -FilePath $ffmpeg -ArgumentList @("-hide_banner","-loglevel","warning","-f","dshow","-i",$spec,"-vn","-acodec","pcm_s16le","-ar","16000","-ac","1","-t","5","-y",$probeFile) -RedirectStandardOutput $captureOut -RedirectStandardError $captureErr -Wait -PassThru
    $info = Get-Item -LiteralPath $probeFile -ErrorAction SilentlyContinue
    if ($p.ExitCode -ne 0 -or -not $info -or $info.Length -lt 1024) {
      Fail "DirectShow microphone did not produce audio" "pass the exact device name from ffmpeg -list_devices true -f dshow -i dummy"
    }
    $levelOut = Join-Path $env:TEMP ("nick-office-level-" + [guid]::NewGuid().ToString("N") + ".out")
    $levelErr = Join-Path $env:TEMP ("nick-office-level-" + [guid]::NewGuid().ToString("N") + ".err")
    try {
      $p2 = Start-Process -FilePath $ffmpeg -ArgumentList @("-hide_banner","-i",$probeFile,"-af","volumedetect","-f","null","NUL") -RedirectStandardOutput $levelOut -RedirectStandardError $levelErr -Wait -PassThru
      $level = (Get-Content $levelErr -Raw -ErrorAction SilentlyContinue)
      $match = [regex]::Match($level, 'mean_volume:\s*(-?\d+(?:\.\d+)?) dB')
      if ($p2.ExitCode -ne 0 -or -not $match.Success) { Fail "microphone level could not be measured" "verify the selected device" }
      $meanDb = [double]::Parse($match.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
      if ($meanDb -le -70.0) { Fail "DirectShow microphone is effectively silent ($meanDb dBFS)" "unmute/connect the microphone" }
      Write-Host "  [ok] microphone signal measured at $meanDb dBFS mean"
    } finally {
      Remove-Item $levelOut,$levelErr -Force -ErrorAction SilentlyContinue
    }
  } finally {
    Remove-Item $probeFile,$captureOut,$captureErr -Force -ErrorAction SilentlyContinue
  }
}

if ($ProbeOnly) {
  Test-AudioSource
  exit 0
}

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail "installer is not elevated" "re-run PowerShell as Administrator" }

$wake = Join-Path $BridgeDir "vision\officewake.py"
if (-not (Test-Path -LiteralPath $wake)) { Fail "officewake.py not found at $wake" "pass -BridgeDir for the current camera-bridge checkout" }

if (-not $PythonPath) {
  $venvPython = Join-Path $BridgeDir ".venv\Scripts\python.exe"
  $PythonPath = if (Test-Path $venvPython) { $venvPython } else { (Resolve-Executable "python") }
}
if (-not $PythonPath -or -not (Test-Path -LiteralPath $PythonPath)) { Fail "Python runtime not found" "create camera-bridge .venv or pass -PythonPath" }
& $PythonPath -c "import zoneinfo, websockets; zoneinfo.ZoneInfo('America/New_York')" 2>$null
if ($LASTEXITCODE -ne 0) { Fail "Python dependencies missing" "install requirements-office-wake.txt into the selected Python" }

$transcriberPath = Resolve-Executable $Transcriber
if (-not $transcriberPath) { Fail "transcriber '$Transcriber' is not runnable" "pass -Transcriber with the full whisper-cli.exe path" }
if (-not $WhisperModel -or -not (Test-Path -LiteralPath $WhisperModel)) { Fail "Whisper model is missing" "pass -WhisperModel with a local ggml model file" }

Write-Host "=== Preflight ===" -ForegroundColor Cyan
Write-Host "  [ok] camera-bridge: $BridgeDir"
Write-Host "  [ok] Python: $PythonPath"
Write-Host "  [ok] ffmpeg: $ffmpeg"
Write-Host "  [ok] STT: $transcriberPath"
Write-Host "  [ok] Office camera: $OfficeSerial"
Test-AudioSource

if ($PSCmdlet.ShouldProcess("office intelligence directories", "create")) {
  New-Item -ItemType Directory -Force -Path $OutDir,(Split-Path -Parent $LedgerPath),(Split-Path -Parent $StatusPath) | Out-Null
}

$episodeSource = if ($SourceKind -eq "dshow") { "counter-mic" } else { "eufy-office" }
$envs = @{
  "CAMERA_INGEST_KEY" = $IngestKey
  "EUFY_BRIDGE_URL" = $BridgeUrl
  "EUFY_OFFICE_CAMERA_SERIAL" = $OfficeSerial
  "OFFICE_INTERACTION_CAPTURE_ENABLED" = "1"
  "OFFICE_AUDIO_POLICY_ACK" = "1"
  "OFFICE_AUDIO_SOURCE" = $SourceUrl
  "OFFICE_AUDIO_INPUT_FORMAT" = $SourceKind
  "OFFICE_AUDIO_SOURCE_NAME" = $episodeSource
  "OFFICE_ACTIVE_SCHEDULE_JSON" = $ScheduleJson
  "OFFICE_INTERACTION_DIR" = $OutDir
  "OFFICE_WAKE_LEDGER" = $LedgerPath
  "OFFICE_CONVERSATION_STATUS_PATH" = $StatusPath
  "OFFICE_TRANSCRIBER" = $transcriberPath
  "OFFICE_WHISPER_MODEL" = $WhisperModel
  "OFFICE_CAPTURE_SECONDS" = [string]$WindowSeconds
  "OFFICE_CAPTURE_COOLDOWN_SECONDS" = [string]$CooldownSeconds
  "OFFICE_RAW_AUDIO_RETENTION_HOURS" = [string]$RetentionHours
  "OFFICE_RAW_AUDIO_MAX_MB" = [string]$RetentionMaxMb
  "OFFICE_MIN_FREE_MB" = [string]$MinFreeMb
  "FFMPEG_BIN" = $ffmpeg
}
if ($PSCmdlet.ShouldProcess("machine environment", "store OfficeWake config and ingest key")) {
  foreach ($name in $envs.Keys) {
    [Environment]::SetEnvironmentVariable($name, $envs[$name], "Machine")
    Set-Item -Path ("Env:" + $name) -Value $envs[$name]
  }
}

$action = New-ScheduledTaskAction -Execute $PythonPath -Argument '-m vision.officewake --capture' -WorkingDirectory $BridgeDir
if ($SourceKind -eq "dshow") {
  $runAs = $DesktopUser
  if (-not $runAs) { $runAs = (Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue).UserName }
  if (-not $runAs) { Fail "interactive desktop user could not be determined" "rerun with -DesktopUser DOMAIN\user" }
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $runAs
  $principal = New-ScheduledTaskPrincipal -UserId $runAs -LogonType Interactive -RunLevel Highest
  $taskMode = "interactive at-logon; survives lock, requires a logged-in audio session"
} else {
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $taskMode = "SYSTEM at-startup"
}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

if ($PSCmdlet.ShouldProcess($TaskName, "register OfficeWake production task")) {
  if (Get-ScheduledTask -TaskName "NickOfficeCapture" -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName "NickOfficeCapture" -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName "NickOfficeCapture" -ErrorAction SilentlyContinue
  }
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Nick's Tire Office intelligence: NICKS EUCLID semantic wake -> bounded local audio -> local STT -> evidence-backed Admin summary." | Out-Null
  Start-ScheduledTask -TaskName $TaskName
}

Write-Host ""
Write-Host "=== Office intelligence commissioned ===" -ForegroundColor Green
Write-Host "  task: $TaskName ($taskMode)"
Write-Host "  trigger camera: $OfficeSerial"
Write-Host "  audio: $episodeSource / $SourceUrl"
Write-Host "  capture: $WindowSeconds sec max, $CooldownSeconds sec cooldown"
Write-Host "  raw audio: <= $RetentionHours h, <= $RetentionMaxMb MB, disk floor $MinFreeMb MB"
Write-Host "  status: $StatusPath"
Write-Host "  summaries: https://nickstire.org/admin -> Lot -> Office intelligence"

[CmdletBinding()]
param(
  [string]$RepoRoot = "",
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "StateNour\Eufy"),
  [string]$BridgeRoot = (Join-Path $env:LOCALAPPDATA "StateNour\Eufy\ha-eufy-sdk-bridge-0.3.0"),
  [string]$OfficeSerial = "T8410P5225154105",
  [string]$NickHeartbeatUrl = "https://nickstire.org/api/camera/heartbeat",
  [string]$Go2RtcApiListen = "127.0.0.1:1984",
  [string]$Go2RtcRtspListen = "127.0.0.1:8654",
  [string]$Go2RtcWebrtcListen = "127.0.0.1:8655",
  [string]$FfmpegPath = "",
  [switch]$EnableControl,
  [switch]$CommissionPtz,
  [Nullable[int]]$HomePresetId = $null,
  [switch]$InstallPrerequisites
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$BridgeCommit = "f00dd987a7b86d1b5fd91731fcdb179513c88ac4"
$Go2RtcVersion = "1.9.14"
$Go2RtcZipSha256 = "dd4167d75cb04abe618855b7c71f8658bd009f60c1a71835d134d2c11c939907"
$BridgeUrl = "ws://127.0.0.1:3000/ws"
$BridgeHealthUrl = "http://127.0.0.1:3000/healthz"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Elevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this installer from an elevated PowerShell window."
  }
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Ensure-Command([string]$Name, [string]$WingetId) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  if (-not $InstallPrerequisites) {
    throw "$Name is required. Re-run with -InstallPrerequisites or install $WingetId first."
  }
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) { throw "$Name is missing and winget is unavailable." }
  Write-Step "Installing prerequisite $WingetId"
  & $winget.Source install --id $WingetId -e --silent --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { throw "winget failed installing $WingetId" }
  Refresh-Path
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "$Name still unavailable after installing $WingetId" }
  return $cmd.Source
}

function Resolve-Python {
  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($py) {
    $resolved = (& $py.Source -3.12 -c "import sys; print(sys.executable)" 2>$null | Select-Object -Last 1)
    if ($LASTEXITCODE -eq 0 -and $resolved -and (Test-Path $resolved.Trim())) {
      return $resolved.Trim()
    }
  }

  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($python) {
    $resolved = (& $python.Source -c "import sys; print(sys.executable)" 2>$null | Select-Object -Last 1)
    if ($LASTEXITCODE -eq 0 -and $resolved -and (Test-Path $resolved.Trim())) {
      return $resolved.Trim()
    }
  }

  if (-not $InstallPrerequisites) {
    throw "A working Python interpreter is required. The Windows Store python.exe alias does not count."
  }
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) { throw "Python is missing and winget is unavailable." }
  Write-Step "Installing prerequisite Python.Python.3.12"
  & $winget.Source install --id Python.Python.3.12 -e --silent --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { throw "winget failed installing Python.Python.3.12" }
  Refresh-Path

  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($py) {
    $resolved = (& $py.Source -3.12 -c "import sys; print(sys.executable)" 2>$null | Select-Object -Last 1)
    if ($LASTEXITCODE -eq 0 -and $resolved -and (Test-Path $resolved.Trim())) {
      return $resolved.Trim()
    }
  }
  throw "Python 3.12 installation completed but no working interpreter could be resolved."
}

function Save-DpapiSecret([string]$Name, [string]$Label, [switch]$PlainPrompt) {
  $secretDir = Join-Path $StateRoot "secrets"
  New-Item -ItemType Directory -Force -Path $secretDir | Out-Null
  $path = Join-Path $secretDir "$Name.dpapi"
  if (Test-Path $path) { return $path }

  if ($PlainPrompt) {
    $plain = Read-Host $Label
    if ([string]::IsNullOrWhiteSpace($plain)) { throw "$Label may not be empty" }
    $secure = ConvertTo-SecureString $plain -AsPlainText -Force
  } else {
    $secure = Read-Host $Label -AsSecureString
  }
  $secure | ConvertFrom-SecureString | Set-Content -LiteralPath $path -Encoding UTF8 -NoNewline
  return $path
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Install-Task([string]$Name, [string]$ScriptPath) {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File ""$ScriptPath"""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
}

function Wait-Bridge([int]$TimeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $health = Invoke-RestMethod -UseBasicParsing -Uri $BridgeHealthUrl -TimeoutSec 4
      if ($health) { return $health }
    } catch {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)
  throw "Eufy bridge did not become healthy before timeout."
}

function Invoke-BridgeWs([string]$VenvPython, [hashtable]$Payload) {
  # Payload (including 2FA/captcha answers) travels over stdin. It never appears in the
  # process command line, scheduled-task definition, runtime JSON, or receipt logs.
  $pythonCode = @'
import asyncio, json, sys, uuid
import websockets

payload = json.load(sys.stdin)
payload["id"] = payload.get("id") or uuid.uuid4().hex

async def main():
    async with websockets.connect(
        "ws://127.0.0.1:3000/ws",
        open_timeout=10,
        close_timeout=2,
        ping_interval=None,
        max_size=2 * 1024 * 1024,
    ) as ws:
        await ws.send(json.dumps(payload))
        while True:
            reply = json.loads(await asyncio.wait_for(ws.recv(), timeout=12))
            if str(reply.get("id", "")) == str(payload["id"]):
                print(json.dumps(reply))
                return

asyncio.run(main())
'@
  $json = $Payload | ConvertTo-Json -Compress -Depth 8
  $raw = $json | & $VenvPython -c $pythonCode
  if ($LASTEXITCODE -ne 0) { throw "Bridge WebSocket command failed." }
  try {
    return ($raw | Select-Object -Last 1) | ConvertFrom-Json
  } catch {
    throw "Bridge returned invalid JSON to installer auth client."
  }
}

function Complete-BridgeAuth([string]$VenvPython, [int]$MaxChallenges = 5) {
  $attempts = 0
  $deadline = (Get-Date).AddMinutes(5)

  while ((Get-Date) -lt $deadline) {
    $reply = Invoke-BridgeWs $VenvPython @{ cmd = "auth.status" }
    if (-not $reply.ok) { throw "auth.status failed: $($reply.error)" }
    $auth = $reply.auth
    $state = if ($auth -and $auth.state) { [string]$auth.state } else { "unknown" }

    if ($state -eq "ok") { return $auth }

    if ($state -in @("pending", "reauth")) {
      Start-Sleep -Seconds 2
      continue
    }

    if ($state -eq "require_2fa") {
      if (++$attempts -gt $MaxChallenges) { throw "Too many Eufy 2FA attempts." }
      $code = Read-Host "Enter the Eufy 2FA code sent to the account"
      if ([string]::IsNullOrWhiteSpace($code)) { throw "Eufy 2FA code may not be empty." }
      $submit = Invoke-BridgeWs $VenvPython @{ cmd = "auth.submit"; code = $code.Trim() }
      $code = $null
      if (-not $submit.ok) { throw "Eufy 2FA submission failed: $($submit.error)" }
      continue
    }

    if ($state -eq "require_captcha") {
      if (++$attempts -gt $MaxChallenges) { throw "Too many Eufy captcha attempts." }
      $image = [string]$auth.image
      if ([string]::IsNullOrWhiteSpace($image) -or $image -notmatch "^data:image/[^;]+;base64,(.+)$") {
        throw "Eufy requested captcha but did not provide a decodable image."
      }

      $captchaPath = Join-Path $env:TEMP "statenour-eufy-captcha.png"
      try {
        [IO.File]::WriteAllBytes($captchaPath, [Convert]::FromBase64String($matches[1]))
        Start-Process $captchaPath
        $answer = Read-Host "Enter the text shown in the Eufy captcha image"
        if ([string]::IsNullOrWhiteSpace($answer)) { throw "Eufy captcha answer may not be empty." }
        $submit = Invoke-BridgeWs $VenvPython @{ cmd = "auth.submit"; captcha = $answer.Trim() }
        $answer = $null
        if (-not $submit.ok) { throw "Eufy captcha submission failed: $($submit.error)" }
      } finally {
        Remove-Item -LiteralPath $captchaPath -Force -ErrorAction SilentlyContinue
      }
      continue
    }

    throw "Unsupported Eufy auth state: $state"
  }

  throw "Eufy bridge authentication did not reach ok within 5 minutes."
}

function Get-OfficeDevice([string]$VenvPython, [string]$LocalAgentDir) {
  $old = $env:EUFY_BRIDGE_URL
  $env:EUFY_BRIDGE_URL = $BridgeUrl
  try {
    Push-Location $LocalAgentDir
    $code = @'
import json
from eufy_bridge import list_devices
print(json.dumps(list_devices()))
'@
    $json = & $VenvPython -c $code
    if ($LASTEXITCODE -ne 0) { throw "devices.list failed" }
    $devices = $json | ConvertFrom-Json
    return $devices | Where-Object {
      ($_.serialNumber -eq $OfficeSerial) -or
      ($_.serial -eq $OfficeSerial) -or
      ($_.sn -eq $OfficeSerial)
    } | Select-Object -First 1
  } finally {
    Pop-Location
    $env:EUFY_BRIDGE_URL = $old
  }
}

Require-Elevated

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
}
$LocalAgentDir = Join-Path $RepoRoot "apps\statenour\local-agent"
$OverlayScript = Join-Path $LocalAgentDir "eufy_bridge_overlay.py"

foreach ($required in @(
  (Join-Path $LocalAgentDir "agent.py"),
  (Join-Path $LocalAgentDir "eufy_bridge.py"),
  $OverlayScript
)) {
  if (-not (Test-Path $required)) { throw "Required repo file missing: $required" }
}

Write-Step "Resolving prerequisites"
$node = Ensure-Command "node.exe" "OpenJS.NodeJS.LTS"
$npm = Ensure-Command "npm.cmd" "OpenJS.NodeJS.LTS"
$python = Resolve-Python
if ($FfmpegPath) {
  if (-not (Test-Path -LiteralPath $FfmpegPath -PathType Leaf)) {
    throw "FfmpegPath does not exist: $FfmpegPath"
  }
  $ffmpeg = (Resolve-Path -LiteralPath $FfmpegPath).Path
} else {
  $ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if ($ffmpegCommand) {
    $ffmpeg = $ffmpegCommand.Source
  } elseif ($InstallPrerequisites) {
    $ffmpeg = Ensure-Command "ffmpeg.exe" "Gyan.FFmpeg"
  } else {
    throw "ffmpeg.exe is required for bridge live-picture/record helpers. Pass -FfmpegPath or re-run with -InstallPrerequisites."
  }
}
$ffmpegDir = Split-Path -Parent $ffmpeg

New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$downloadDir = Join-Path $StateRoot "downloads"
$receiptDir = Join-Path $StateRoot "receipts"
$wrapperDir = Join-Path $StateRoot "wrappers"
New-Item -ItemType Directory -Force -Path $downloadDir,$receiptDir,$wrapperDir | Out-Null

Write-Step "Installing pinned Eufy bridge v0.3.0 runtime"
if (-not (Test-Path (Join-Path $BridgeRoot "package.json"))) {
  $bridgeZip = Join-Path $downloadDir "ha-eufy-sdk-bridge-$BridgeCommit.zip"
  $extract = Join-Path $downloadDir "bridge-extract"
  if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/mega-yfue/ha-eufy-sdk-bridge/archive/$BridgeCommit.zip" -OutFile $bridgeZip -TimeoutSec 90
  Expand-Archive -LiteralPath $bridgeZip -DestinationPath $extract -Force
  $source = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
  if (-not $source -or -not (Test-Path (Join-Path $source.FullName "package.json"))) {
    throw "Pinned bridge archive did not contain package.json"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $BridgeRoot) | Out-Null
  Move-Item -LiteralPath $source.FullName -Destination $BridgeRoot
}

$package = Get-Content (Join-Path $BridgeRoot "package.json") -Raw | ConvertFrom-Json
if ($package.name -ne "ha-eufy-sdk-bridge" -or $package.version -ne "0.3.0") {
  throw "Unexpected bridge package $($package.name) $($package.version)"
}

Push-Location $BridgeRoot
try {
  & $npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed for bridge runtime" }
} finally {
  Pop-Location
}

Write-Step "Installing pinned go2rtc v$Go2RtcVersion"
$goZip = Join-Path $downloadDir "go2rtc_win64_v$Go2RtcVersion.zip"
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/AlexxIT/go2rtc/releases/download/v$Go2RtcVersion/go2rtc_win64.zip" -OutFile $goZip -TimeoutSec 90
$goHash = (Get-FileHash -Algorithm SHA256 $goZip).Hash.ToLowerInvariant()
if ($goHash -ne $Go2RtcZipSha256) {
  throw "go2rtc asset SHA-256 mismatch: got $goHash"
}
$goExtract = Join-Path $downloadDir "go2rtc-extract"
if (Test-Path $goExtract) { Remove-Item -Recurse -Force $goExtract }
Expand-Archive -LiteralPath $goZip -DestinationPath $goExtract -Force
$goExe = Get-ChildItem -LiteralPath $goExtract -Filter "go2rtc*.exe" -Recurse | Select-Object -First 1
if (-not $goExe) { throw "go2rtc.exe missing from pinned release archive" }
Copy-Item -LiteralPath $goExe.FullName -Destination (Join-Path $BridgeRoot "go2rtc.exe") -Force

Write-Step "Applying and verifying fail-closed bridge overlay"
& $python $OverlayScript --bridge-root $BridgeRoot --apply
if ($LASTEXITCODE -ne 0) { throw "Eufy bridge overlay apply failed" }
& $python $OverlayScript --bridge-root $BridgeRoot --check
if ($LASTEXITCODE -ne 0) { throw "Eufy bridge overlay verification failed" }

Write-Step "Creating isolated Eufy-only Python runtime"
$venv = Join-Path $StateRoot ".venv-eufy"
if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
  & $python -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw "Python venv creation failed" }
}
$venvPython = Join-Path $venv "Scripts\python.exe"
& $venvPython -m pip install --disable-pip-version-check --upgrade pip
& $venvPython -m pip install --disable-pip-version-check "requests>=2.31.0" "python-dotenv>=1.0.0"
if ($LASTEXITCODE -ne 0) { throw "Eufy-only Python dependency install failed" }

Write-Step "Capturing machine-local secrets with Windows DPAPI"
[void](Save-DpapiSecret "eufy-email" "Eufy account email" -PlainPrompt)
[void](Save-DpapiSecret "eufy-password" "Eufy account password")
[void](Save-DpapiSecret "statenour-sync-key" "StateNour sync key")
[void](Save-DpapiSecret "nicks-camera-ingest-key" "Nick's camera ingest key")

$runtimePath = Join-Path $StateRoot "shop-runtime.json"
$runtime = [ordered]@{
  officeSerial = $OfficeSerial
  heartbeatUrl = $NickHeartbeatUrl
  heartbeatMode = "PRODUCTION"
  controlEnabled = $false
  homePresetId = if ($HomePresetId.HasValue) { $HomePresetId.Value } else { $null }
  bridgeCommit = $BridgeCommit
  go2rtcVersion = $Go2RtcVersion
  go2rtcApiListen = $Go2RtcApiListen
  go2rtcRtspListen = $Go2RtcRtspListen
  go2rtcWebrtcListen = $Go2RtcWebrtcListen
  repoRoot = $RepoRoot
  bridgeRoot = $BridgeRoot
}
$runtime | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $runtimePath -Encoding UTF8

$bridgeWrapper = Join-Path $wrapperDir "start-bridge.ps1"
$agentWrapper = Join-Path $wrapperDir "start-agent.ps1"

$secretLoader = @'
function Read-DpapiSecret([string]$Name) {
  $path = Join-Path (Join-Path $StateRoot "secrets") "$Name.dpapi"
  if (-not (Test-Path $path)) { throw "Missing DPAPI secret: $Name" }
  $secure = Get-Content -LiteralPath $path -Raw | ConvertTo-SecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
'@

$bridgeTemplate = @'
$ErrorActionPreference = "Stop"
$StateRoot = "__STATE_ROOT__"
__SECRET_LOADER__
$env:EUFY_EMAIL = Read-DpapiSecret "eufy-email"
$env:EUFY_PASSWORD = Read-DpapiSecret "eufy-password"
$env:EUFY_COUNTRY = "US"
$env:BRIDGE_HOST = "127.0.0.1"
$env:BRIDGE_PORT = "3000"
$env:BRIDGE_SELF_HOST = "127.0.0.1"
$env:EUFY_SESSION = Join-Path $StateRoot "state\.eufy-session.json"
$env:GO2RTC_ENABLE = "1"
$env:GO2RTC_API_LISTEN = "__GO2RTC_API_LISTEN__"
$env:GO2RTC_RTSP_LISTEN = "__GO2RTC_RTSP_LISTEN__"
$env:GO2RTC_WEBRTC_LISTEN = "__GO2RTC_WEBRTC_LISTEN__"
$env:BRIDGE_PREWARM = "1"
$env:BRIDGE_EVENT_LOG = "1"
$env:BRIDGE_DEBUG = "0"
$env:PATH = "__BRIDGE_ROOT__;__FFMPEG_DIR__;$env:PATH"
New-Item -ItemType Directory -Force -Path (Join-Path $StateRoot "state") | Out-Null
Set-Location "__BRIDGE_ROOT__"
# server.mjs by its absolute path: node.exe is the system node, so the script path is the only part
# of the command line that says whose process this is (camera-bridge nicksmax-camera-supervisor.ps1).
& "__NODE__" "__BRIDGE_ROOT__\server.mjs"
'@

$agentTemplate = @'
$ErrorActionPreference = "Stop"
$StateRoot = "__STATE_ROOT__"
__SECRET_LOADER__
$cfg = Get-Content -LiteralPath "__RUNTIME_PATH__" -Raw | ConvertFrom-Json
$env:STATENOUR_API_URL = "https://bdnick.info"
$env:STATENOUR_SYNC_KEY = Read-DpapiSecret "statenour-sync-key"
$env:EUFY_BRIDGE_URL = "__BRIDGE_URL__"
$env:EUFY_CONTROL_ENABLED = if ($cfg.controlEnabled) { "1" } else { "0" }
$env:EUFY_EVENTS_ENABLED = "1"
$env:EUFY_OFFICE_CAMERA_SERIAL = [string]$cfg.officeSerial
$env:EUFY_EVENT_DEVICE_SNS = [string]$cfg.officeSerial
$env:NICKS_CAMERA_HEARTBEAT_URL = [string]$cfg.heartbeatUrl
$env:NICKS_OFFICE_CAMERA_MODE = if ($cfg.heartbeatMode) { [string]$cfg.heartbeatMode } else { "PRODUCTION" }
$env:OFFICE_CONVERSATION_STATUS_PATH = Join-Path (Split-Path $StateRoot -Parent) "OfficeIntelligence\office-conversation-status.json"
$env:OFFICE_CONVERSATION_STATUS_MAX_AGE_SECONDS = "120"
$env:NICKS_CAMERA_INGEST_KEY = Read-DpapiSecret "nicks-camera-ingest-key"
if ($null -ne $cfg.homePresetId) { $env:EUFY_OFFICE_HOME_PRESET = [string]$cfg.homePresetId }
Set-Location "__LOCAL_AGENT_DIR__"
& "__VENV_PYTHON__" agent.py --eufy-only
'@

$bridgeText = $bridgeTemplate.Replace("__STATE_ROOT__", $StateRoot).Replace("__SECRET_LOADER__", $secretLoader).Replace("__BRIDGE_ROOT__", $BridgeRoot).Replace("__FFMPEG_DIR__", $ffmpegDir).Replace("__NODE__", $node).Replace("__GO2RTC_API_LISTEN__", $Go2RtcApiListen).Replace("__GO2RTC_RTSP_LISTEN__", $Go2RtcRtspListen).Replace("__GO2RTC_WEBRTC_LISTEN__", $Go2RtcWebrtcListen)
$agentText = $agentTemplate.Replace("__STATE_ROOT__", $StateRoot).Replace("__SECRET_LOADER__", $secretLoader).Replace("__RUNTIME_PATH__", $runtimePath).Replace("__BRIDGE_URL__", $BridgeUrl).Replace("__LOCAL_AGENT_DIR__", $LocalAgentDir).Replace("__VENV_PYTHON__", $venvPython)

Write-Utf8NoBom $bridgeWrapper $bridgeText
Write-Utf8NoBom $agentWrapper $agentText

Write-Step "Registering restart-capable scheduled tasks"
Install-Task "StateNour-Eufy-Bridge" $bridgeWrapper
Install-Task "StateNour-Eufy-Agent" $agentWrapper
if (Get-ScheduledTask -TaskName "StateNour-Eufy-OfficeWake" -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName "StateNour-Eufy-OfficeWake" -ErrorAction SilentlyContinue
  Disable-ScheduledTask -TaskName "StateNour-Eufy-OfficeWake" | Out-Null
}

Stop-ScheduledTask -TaskName "StateNour-Eufy-Bridge" -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName "StateNour-Eufy-Bridge"

Write-Step "Waiting for bridge process"
[void](Wait-Bridge 120)

Write-Step "Completing Eufy authentication if challenged"
$auth = Complete-BridgeAuth $venvPython
if (-not $auth -or [string]$auth.state -ne "ok") {
  throw "Bridge authentication did not reach ok."
}
Write-Host "Eufy bridge authentication verified." -ForegroundColor Green

Write-Step "Verifying office camera identity and PTZ capability"
$office = Get-OfficeDevice $venvPython $LocalAgentDir
if (-not $office) { throw "Office camera $OfficeSerial not returned by devices.list" }
$capabilities = @($office.capabilities)
if ($capabilities -notcontains "ptz") {
  throw "Office camera $OfficeSerial did not report PTZ capability"
}

if ($EnableControl) {
  $runtime.controlEnabled = $true
  $runtime | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $runtimePath -Encoding UTF8
  Write-Host "PTZ command queue enabled after auth + identity + capability proof." -ForegroundColor Green
} else {
  Write-Host "PTZ command queue remains disabled. Re-run with -EnableControl after review." -ForegroundColor Yellow
}

Start-ScheduledTask -TaskName "StateNour-Eufy-Agent"

Write-Step "Forcing one real office media-byte probe"
$oldBridge = $env:EUFY_BRIDGE_URL
$oldSerial = $env:EUFY_OFFICE_CAMERA_SERIAL
$env:EUFY_BRIDGE_URL = $BridgeUrl
$env:EUFY_OFFICE_CAMERA_SERIAL = $OfficeSerial
Push-Location $LocalAgentDir
try {
  $media = & $venvPython -c "from eufy_bridge import probe_office_media_health; print(probe_office_media_health(force=True))"
  Write-Host "Media probe result: $media"
} finally {
  Pop-Location
  $env:EUFY_BRIDGE_URL = $oldBridge
  $env:EUFY_OFFICE_CAMERA_SERIAL = $oldSerial
}

if ($CommissionPtz) {
  if (-not $EnableControl) { throw "-CommissionPtz requires -EnableControl" }
  if (-not $HomePresetId.HasValue) { throw "-CommissionPtz requires -HomePresetId" }

  Write-Step "Running bounded PTZ receipt cycle: right then approved preset"
  $oldBridge = $env:EUFY_BRIDGE_URL
  $oldSerial = $env:EUFY_OFFICE_CAMERA_SERIAL
  $oldHome = $env:EUFY_OFFICE_HOME_PRESET
  $env:EUFY_BRIDGE_URL = $BridgeUrl
  $env:EUFY_OFFICE_CAMERA_SERIAL = $OfficeSerial
  $env:EUFY_OFFICE_HOME_PRESET = [string]$HomePresetId.Value
  Push-Location $LocalAgentDir
  try {
    $commission = @"
import json, time
import eufy_bridge as b
b.start_event_thread()
time.sleep(2.0)
device = {"platformDeviceId": "eufy-$OfficeSerial"}
right = b.execute_command({"command": "ptz_right", "params": {}, "device": device})
home = b.execute_command({"command": "ptz_preset", "params": {"id": $($HomePresetId.Value)}, "device": device})
print(json.dumps({"right": right, "home": home, "health": b.runtime_health_snapshot()}, default=str))
"@
    $receipt = & $venvPython -c $commission
    if ($LASTEXITCODE -ne 0) { throw "PTZ commissioning cycle failed" }
    $receipt | Set-Content -LiteralPath (Join-Path $receiptDir "ptz-commissioning.json") -Encoding UTF8
    Write-Host "PTZ motor receipts verified. Absolute home still requires visual verification." -ForegroundColor Green
  } finally {
    Pop-Location
    $env:EUFY_BRIDGE_URL = $oldBridge
    $env:EUFY_OFFICE_CAMERA_SERIAL = $oldSerial
    $env:EUFY_OFFICE_HOME_PRESET = $oldHome
  }
}

Write-Step "Runtime status"
Get-ScheduledTask -TaskName "StateNour-Eufy-*" | Select-Object TaskName,State | Format-Table -AutoSize

[pscustomobject]@{
  BridgeHealth = $BridgeHealthUrl
  OfficeSerial = $OfficeSerial
  PtzCapability = $true
  ControlEnabled = [bool]$runtime.controlEnabled
  OfficeWakeMode = "delegated_to_StateNour-OfficeIntelligence-NicksMax"
  Secrets = "DPAPI current-user"
  StateRoot = $StateRoot
  Next = if ($CommissionPtz) {
    "Capture and approve the visual home reference, then enable the home verifier."
  } else {
    "Observe a real motion/person receipt; optionally re-run with -EnableControl -CommissionPtz -HomePresetId <id>."
  }
} | Format-List

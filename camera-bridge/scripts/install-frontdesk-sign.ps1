<#
.SYNOPSIS
  Make the front-desk PC the primary (p1) sign producer: relay, MediaMTX, crop and edge under one task.
.DESCRIPTION
  Lot vision v2 phase 4 (camera-bridge/docs/LOT-VISION-V2-DESIGN-2026-10-26.md). Run from the copy of
  camera-bridge this script sits in; nothing outside -Root and the one secret file is changed.

    relay    V380Decoder v1.0.4 (cloud mode, :8554)   -- the camera session
    MediaMTX v1.21.2 (:8555)                          -- serves the crop
    crop     ffmpeg, the NicksMax middle-lens command -- rtsp://127.0.0.1:8555/sign
    edge     edge_main.py as p1-shop-sign             -- counts arrivals, takes the existing lease

  All four run under ONE SYSTEM task at below-normal priority: scripts/run-frontdesk-sign.ps1 runs
  cloud/run_cloud.py --primary, which supervises them and retries the relay and crop in place.
  With no calibration installed the edge does not start (relay and crop only), so the first run can
  supply the still the calibration is drawn on, and nothing is ever counted in census mode.

  Both downloads are pinned by byte count and SHA-256 (phase 3, PR 3313) and fail closed before
  anything is extracted. The relay has no licence upstream: run-only, never copied anywhere else.

  The V380 login (device id, user, password) is typed by Nour at the prompts of -SetCredentials and
  kept as a LocalMachine DPAPI file under ProgramData that only SYSTEM and Administrators can read.
  The shop ingest key is NOT asked for: the office lane's installer already put it in the machine
  environment, which the SYSTEM task inherits.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-frontdesk-sign.ps1 -SetCredentials
  powershell -ExecutionPolicy Bypass -File scripts\install-frontdesk-sign.ps1 -Calibration C:\path\calibration-sign.json
  powershell -ExecutionPolicy Bypass -File scripts\install-frontdesk-sign.ps1 -VerifyOnly -RelayZip C:\path\V380Decoder-win-x64.zip
  powershell -ExecutionPolicy Bypass -File scripts\install-frontdesk-sign.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$PythonPath = "",
  [string]$FfmpegPath = "ffmpeg",
  [string]$Calibration = "",
  [switch]$SetCredentials,
  [switch]$VerifyOnly,
  [string]$RelayZip = "",
  [string]$MediaMtxZip = "",
  [switch]$Uninstall,
  [string]$TaskName = "NickLotVisionFrontDesk"
)

$ErrorActionPreference = "Stop"
$bridge = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = Split-Path -Parent $bridge }

$pins = @{
  relay = @{
    Url = "https://github.com/PyanSofyan/V380Decoder/releases/download/v1.0.4/V380Decoder-win-x64.zip"
    Bytes = 10869110
    Sha256 = "3125fbefb9bc4a14faa8ec80d35c06e6bf00c9a20134c6c9b17196dc118a8126"
  }
  mediamtx = @{
    Url = "https://github.com/bluenviron/mediamtx/releases/download/v1.21.2/mediamtx_v1.21.2_windows_amd64.zip"
    Bytes = 28583662
    Sha256 = "a84224f5a490855684e62ba6fb71e80ea2a5e16aed61883bb58380290e93e467"
  }
}

function Fail([string]$what) {
  Write-Host "STOP: $what" -ForegroundColor Red
  exit 1
}

function Assert-Pinned([string]$name, [string]$path) {
  $pin = $pins[$name]
  $bytes = (Get-Item -LiteralPath $path).Length
  if ($bytes -ne $pin.Bytes) { Fail "$name is $bytes bytes, pinned $($pin.Bytes) bytes. Nothing changed." }
  $sha = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sha -ne $pin.Sha256) { Fail "$name SHA-256 is $sha, pinned $($pin.Sha256). Nothing changed." }
  Write-Host "  [ok] $name $bytes bytes, SHA-256 matches the pin"
}

# Stop-ScheduledTask ends the launcher but not its children (the office lane left orphan ffmpeg the
# same way, 2026-10-26), so a reinstall or uninstall also ends every process this lane started.
function Stop-FrontDeskSign {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  # Matched on what the lane runs, never on the folder name alone: the shell that started this
  # installer has the folder on its own command line.
  $edge = Join-Path $bridge "edge_main.py"
  $mine = Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $PID -and (
      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) -or
      ($_.CommandLine -and ($_.CommandLine.Contains("run-frontdesk-sign.ps1") -or $_.CommandLine.Contains("cloud.run_cloud --primary") -or
        $_.CommandLine.Contains($edge) -or ($_.Name -eq "ffmpeg.exe" -and $_.CommandLine.Contains("127.0.0.1:8555/sign")))))
  }
  $mine | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host "  [ok] lane stopped; processes ended: $(@($mine).Count)"
}

if ($VerifyOnly) {
  if (-not $RelayZip -and -not $MediaMtxZip) { Fail "-VerifyOnly needs -RelayZip and/or -MediaMtxZip" }
  if ($RelayZip) { Assert-Pinned "relay" $RelayZip }
  if ($MediaMtxZip) { Assert-Pinned "mediamtx" $MediaMtxZip }
  exit 0
}

# After -VerifyOnly: ProgramData exists only on Windows, and the pin check also runs on Linux CI.
$secretDir = Join-Path $env:ProgramData "NickLotVision"
$secretFile = Join-Path $secretDir "v380.machine"
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail "not elevated: open PowerShell as Administrator" }

if ($Uninstall) {
  Stop-FrontDeskSign
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Write-Host "UNINSTALLED: task $TaskName removed; $Root and $secretFile left for inspection."
  exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $bridge "cloud\run_cloud.py"))) { Fail "cloud\run_cloud.py not found under $bridge" }

# --- 1. Relay and MediaMTX at the pins ------------------------------------------------------------
Stop-FrontDeskSign  # a reinstall overwrites the relay, MediaMTX and venv files these processes hold
$bin = Join-Path $Root "bin"
$downloads = Join-Path $Root "downloads"
New-Item -ItemType Directory -Force -Path $bin, $downloads, (Join-Path $Root "data"), (Join-Path $Root "logs") | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "SilentlyContinue"  # Windows PowerShell 5.1 downloads crawl with the progress bar on
foreach ($name in @("relay", "mediamtx")) {
  $zip = Join-Path $downloads ([IO.Path]::GetFileName($pins[$name].Url))
  if (-not (Test-Path -LiteralPath $zip)) {
    # .part first, so a cut-off download is retried next run instead of failing the pin forever.
    Invoke-WebRequest -Uri $pins[$name].Url -OutFile "$zip.part" -UseBasicParsing
    Move-Item -LiteralPath "$zip.part" -Destination $zip -Force
  }
  Assert-Pinned $name $zip
  Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $bin $name) -Force
}
$relayExe = Get-ChildItem -LiteralPath (Join-Path $bin "relay") -Recurse -Filter "V380Decoder.exe" | Select-Object -First 1
if (-not $relayExe) { Fail "V380Decoder.exe not found in the relay archive" }
$mtxExe = Join-Path $bin "mediamtx\mediamtx.exe"
if (-not (Test-Path -LiteralPath $mtxExe)) { Fail "mediamtx.exe not found in the MediaMTX archive" }

$ffmpeg = (Get-Command $FfmpegPath -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) { Fail "ffmpeg is not runnable as '$FfmpegPath': pass -FfmpegPath with the full ffmpeg.exe path" }

# --- 2. Python venv and the pinned detector model --------------------------------------------------
$venvPython = Join-Path $Root "venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $venvPython)) {
  if (-not $PythonPath) { $PythonPath = (Get-Command python -ErrorAction SilentlyContinue).Source }
  if (-not $PythonPath) { Fail "Python 3.12+ not found: pass -PythonPath" }
  $version = (& $PythonPath -c "import sys; print('%d.%d' % sys.version_info[:2])").Trim()
  if ([version]$version -lt [version]"3.12") { Fail "Python $version is too old; the edge needs 3.12+" }
  & $PythonPath -m venv (Join-Path $Root "venv")
  if ($LASTEXITCODE -ne 0) { Fail "python -m venv failed" }
}
& $venvPython -m pip install --disable-pip-version-check -q -r (Join-Path $bridge "requirements.txt") -r (Join-Path $bridge "vision\requirements.txt")
if ($LASTEXITCODE -ne 0) { Fail "pip install of the edge requirements failed" }
Push-Location $bridge
try {
  & $venvPython -m vision.fetch_models --dest ov_models
  if ($LASTEXITCODE -ne 0) { Fail "the detector model did not fetch or did not match its pin" }
} finally { Pop-Location }

# --- 3. Calibration (optional until phase 4 has a live still) --------------------------------------
$calTarget = Join-Path $Root "calibration-sign.json"
if ($Calibration) {
  & $venvPython -c "import sys; sys.path.insert(0, r'$bridge'); from cloud.run_cloud import _check_calibration; _check_calibration(r'$Calibration')"
  if ($LASTEXITCODE -ne 0) { Fail "calibration $Calibration cannot count arrivals" }
  Copy-Item -LiteralPath $Calibration -Destination $calTarget -Force
}

# --- 4. The V380 login: Nour types it ---------------------------------------------------------------
if ($SetCredentials -or -not (Test-Path -LiteralPath $secretFile)) {
  Write-Host "Nour types the V380 login now (the password is not shown; nothing is logged)." -ForegroundColor Yellow
  $deviceId = Read-Host "V380 device id"
  $user = Read-Host "V380 user"
  $secure = Read-Host -AsSecureString "V380 password"
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $plain = $null
  $clear = $null
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if (-not $deviceId -or -not $user -or -not $plain) { Fail "device id, user and password are all required" }
    Add-Type -AssemblyName System.Security
    $clear = [Text.Encoding]::UTF8.GetBytes((@{ id = $deviceId; username = $user; password = $plain } | ConvertTo-Json -Compress))
    $enc = [Security.Cryptography.ProtectedData]::Protect($clear, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    # LocalMachine DPAPI opens for any process on this PC, so the folder ACL is the real guard:
    # restrict it BEFORE the file exists.
    New-Item -ItemType Directory -Force -Path $secretDir | Out-Null
    & icacls.exe $secretDir /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "could not restrict $secretDir to SYSTEM and Administrators" }
    [IO.File]::WriteAllText($secretFile, [Convert]::ToBase64String($enc))
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    if ($clear) { [Array]::Clear($clear, 0, $clear.Length) }
    $plain = $null
  }
  Write-Host "  [ok] V380 login stored (LocalMachine DPAPI, SYSTEM and Administrators only)"
}

if (-not [Environment]::GetEnvironmentVariable("CAMERA_INGEST_KEY", "Machine")) {
  Fail "CAMERA_INGEST_KEY is not in the machine environment (the office lane installer sets it)"
}

# --- 5. Non-secret settings and the task ------------------------------------------------------------
$settings = [ordered]@{ relay = $relayExe.FullName; mediamtx = $mtxExe; ffmpeg = $ffmpeg; python = $venvPython }
[IO.File]::WriteAllText((Join-Path $Root "frontdesk-settings.json"), ($settings | ConvertTo-Json))

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'run-frontdesk-sign.ps1')`"" -WorkingDirectory $bridge
$trigger = @(
  New-ScheduledTaskTrigger -AtStartup
  # Resurrects a stopped run; IgnoreNew drops the start while one is already running.
  New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -Priority 7
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $taskSettings -Description "Nick's Tire lot vision v2: front-desk sign producer (p1), relay + MediaMTX + crop + edge." | Out-Null
Start-ScheduledTask -TaskName $TaskName

# --- 6. Health: one frame from the crop -------------------------------------------------------------
$ErrorActionPreference = "Continue"  # ffmpeg's stderr must not throw in Windows PowerShell 5.1 while it waits
$still = Join-Path $Root "sign-still.jpg"
Remove-Item -LiteralPath $still -Force -ErrorAction SilentlyContinue
$deadline = (Get-Date).AddSeconds(150)
while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $still)) {
  Start-Sleep -Seconds 10
  & $ffmpeg -hide_banner -loglevel error -rtsp_transport tcp -timeout 5000000 -i "rtsp://127.0.0.1:8555/sign" -frames:v 1 -y $still 2>$null
}
$state = (Get-ScheduledTask -TaskName $TaskName).State
$counting = if (Test-Path -LiteralPath $calTarget) { "edge on (calibration installed)" } else { "edge off until a calibration is installed" }
if (Test-Path -LiteralPath $still) {
  Write-Host "PASS: task $TaskName $state; sign stream has a frame ($still); $counting" -ForegroundColor Green
} else {
  Write-Host "FAIL: task $TaskName $state; no frame on rtsp://127.0.0.1:8555/sign after 150 s; logs in $(Join-Path $Root 'logs')" -ForegroundColor Red
  exit 1
}

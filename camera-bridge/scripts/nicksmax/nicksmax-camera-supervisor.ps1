$ErrorActionPreference = "Continue"
$root = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge"
$log = Join-Path $root "logs\nicksmax-camera-supervisor.log"
$relayLauncher = "C:\Users\nourd\NicksMax\lab\v380-cloud-relay\run-shopsign-cloud.ps1"
$relaySecret = "C:\Users\nourd\NicksMax\lab\secrets\machine\shopsign-device.machine"
$mediaLauncher = "C:\Users\nourd\NicksMax\lab\v380-cloud-relay\run-mediamtx-sign.ps1"
$cropLauncher = "C:\Users\nourd\NicksMax\lab\v380-cloud-relay\run-sign-crop.ps1"
$shadowLauncher = Join-Path $root "data\run-sign-rtsp-candidate.ps1"
$productionLauncher = Join-Path $root "data\run-sign-rtsp-production.ps1"
$productionMarker = Join-Path $root "data\NICKSMAX-SIGN-PRODUCTION-ARMED"
$prodStartMarker = Join-Path $root "data\.nicksmax-prod-start-last"

function Log([string]$m) {
  Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) -Encoding utf8
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
  $psi.Arguments = '-hide_banner -loglevel error -rtsp_transport tcp -i "' + $url + '" -frames:v 1 -f null NUL'
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

# Legacy GUI/WGC lane is retired on NicksMax. Disabled means disabled; do not resurrect it.
foreach ($taskName in @("V380Watchdog","NickEdgeProducer","NickEdgeProducerRight","NickEdgeSignCandidate")) {
  $t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($t -and $t.State -ne "Disabled") {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
    Log ("SAFETY disabled retired task {0}" -f $taskName)
  }
}

# Do not kill V380 if the operator manually opens it; it simply is no longer infrastructure.

# 1. Cloud/P2P relay -> localhost full three-lens stack on 8554.
# Listener health is authoritative here. An elevated/System relay can hide its command line
# from this token, so command-line discovery alone causes duplicate restart attempts.
$relayReady = (Port-Open 8554) -and (Port-Open 8080)
if (-not $relayReady -and (Test-Path $relaySecret) -and (Test-Path $relayLauncher)) {
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$relayLauncher)
  Log "ACTION started SHOPSIGN V380 cloud relay"
  Start-Sleep -Milliseconds 900
}

# 2. Loopback RTSP broker for the isolated sign lens.
$media = Find-ProcessByCommand "mediamtx-sign\.yml"
if (-not $media -and (Test-Path $mediaLauncher)) {
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$mediaLauncher)
  Log "ACTION started loopback MediaMTX sign proxy"
  Start-Sleep -Milliseconds 700
}

# 3. Crop middle 1920x1080 lens from the 1920x3240 cloud stack -> 640x360 @ 4fps.
$crop = Find-ProcessByCommand "ffmpeg.*8554/live.*8555/sign"
if ((Port-Open 8554) -and -not $crop -and (Test-Path $cropLauncher)) {
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$cropLauncher)
  Log "ACTION started SHOPSIGN middle-lens crop proxy"
  Start-Sleep -Milliseconds 900
}

$directReady = (Port-Open 8554) -and (Port-Open 8555) -and [bool](Find-ProcessByCommand "ffmpeg.*8554/live.*8555/sign")
$authorityModeFile = Join-Path $root "data\nicksmax-camera-authority.mode"
$authorityMode = if (Test-Path $authorityModeFile) { (Get-Content $authorityModeFile -Raw).Trim().ToLowerInvariant() } else { "shadow" }
$armed = ($authorityMode -eq "production") -and (Test-Path $productionMarker)
if (($authorityMode -eq "production") -and -not (Test-Path $productionMarker)) {
  Log "REFUSE production authority: production mode lacks armed audit marker"
}
$shadow = Find-ProcessByCommand "python.*config-nicksmax-sign-rtsp\.yaml"
$prod = Find-ProcessByCommand "python.*config-nicksmax-sign-production\.yaml"
$prodHealthy = Port-Open 9095
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
        Log "ACTION started NicksMax authoritative RTSP sign producer after decoded-frame proof"
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

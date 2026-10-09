# NicksMax Eufy bridge launcher -- installed as C:\Users\nourd\AppData\Local\StateNour\Eufy\start-bridge-nicksmax.ps1,
# the action of the scheduled task StateNour-Eufy-Bridge-NicksMax (runs as nourd). It reads the
# Eufy credentials from the user's DPAPI secrets and runs the ha-eufy-sdk bridge (node + go2rtc)
# in the foreground; the camera supervisor restarts the task when port 3000 stays closed.
#
# Canonical source since 2026-10-09: camera-bridge\scripts\nicksmax\ (it was a box-only file; the
# generic shop-runtime template in apps\statenour\local-agent\install-eufy-shop-runtime.ps1 builds
# a different wrapper). scripts\nicksmax\install-nicksmax-supervisor-host.ps1 installs it; the
# supervisor tick says once a day when the installed copy differs. A change takes effect at the
# next bridge start.
#
# The previous run's stdout/stderr are kept as .prev: deleting them at start meant a crashed
# bridge's own log was gone the moment the task restarted it.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'StateNour\Eufy'
$bridge = Join-Path $root 'ha-eufy-sdk-bridge-0.3.0'
$secretRoot = Join-Path $root 'secrets'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir,(Join-Path $root 'state') | Out-Null

function Read-UserSecret([string]$Name) {
  $path = Join-Path $secretRoot ($Name + '.dpapi')
  if (-not (Test-Path -LiteralPath $path)) { throw ('missing protected secret: ' + $Name) }
  $secure = Get-Content -Raw -LiteralPath $path | ConvertTo-SecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# Keep the last run's output beside the new one; fall back to removing it if it cannot move.
function Rotate-Log([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  try { Move-Item -LiteralPath $path -Destination ($path + '.prev') -Force }
  catch { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
}

$env:EUFY_EMAIL = Read-UserSecret 'eufy-email'
$env:EUFY_PASSWORD = Read-UserSecret 'eufy-password'
$env:EUFY_COUNTRY = 'US'
$env:BRIDGE_HOST = '127.0.0.1'
$env:BRIDGE_PORT = '3000'
$env:BRIDGE_SELF_HOST = '127.0.0.1'
$env:BRIDGE_OPENUDID = '4e69636b734d6178'
$env:EUFY_SESSION = Join-Path $root 'state\.eufy-session.json'
$env:GO2RTC_ENABLE = '1'
$env:GO2RTC_API_LISTEN = '127.0.0.1:1984'
$env:GO2RTC_RTSP_LISTEN = '127.0.0.1:8654'
$env:GO2RTC_WEBRTC_LISTEN = '127.0.0.1:8655'
$env:BRIDGE_PREWARM = '1'
$env:BRIDGE_EVENT_LOG = '1'
$env:BRIDGE_DEBUG = '0'
$ffmpegBin = 'C:\Users\nourd\NicksMax\lab\ffmpeg-essentials\ffmpeg-9.0.2-essentials_build\bin'
$env:PATH = $bridge + ';' + $ffmpegBin + ';' + $env:PATH

$stdout = Join-Path $logDir 'bridge.stdout.log'
$stderr = Join-Path $logDir 'bridge.stderr.log'
Rotate-Log $stdout
Rotate-Log $stderr

try {
  # server.mjs by its absolute path: node.exe is the system node, so the script path is the only
  # part of the command line that tells the camera supervisor this node is the bridge's (2026-10-08).
  $p = Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList ('"' + (Join-Path $bridge 'server.mjs') + '"') -WorkingDirectory $bridge -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -Wait
  exit $p.ExitCode
} finally {
  Remove-Item Env:\EUFY_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:\EUFY_PASSWORD -ErrorAction SilentlyContinue
}

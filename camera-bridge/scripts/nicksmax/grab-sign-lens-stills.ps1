# NicksMax lens stills -- READ-ONLY. One ffmpeg run against the relay's three-lens stack
# (rtsp://127.0.0.1:8554/live, 1920x3240) writes four pictures into a new dated folder and prints it:
#   stack.jpg   the whole stack
#   top.jpg     top lens, full 1920x1080      (shop-left / building frontage)
#   middle.jpg  middle lens, full 1920x1080   (shop-right / side lot; today's counter lens)
#   bottom.jpg  bottom lens, full 1920x1080   (front / Euclid / PTZ)
# Send the four to Nour so he can say which lens sees the driveway entrance. Then follow
# camera-bridge/docs/NICKSMAX-SIGN-LENS.md. This script only reads the relay: it starts, stops
# and changes nothing, and it refuses plainly when the relay is not serving.
#
# Run on NicksMax:
#   powershell -NoProfile -ExecutionPolicy Bypass -File grab-sign-lens-stills.ps1
param(
  [string]$SourceUrl = "rtsp://127.0.0.1:8554/live",
  [string]$OutRoot = "C:\Users\nourd\NicksMax\lab\lens-stills",
  [string]$Ffmpeg = "C:\Users\nourd\NicksMax\lab\ffmpeg-essentials\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe",
  [switch]$PrintArgs
)
$ErrorActionPreference = "Stop"

$folder = Join-Path $OutRoot (Get-Date -Format "yyyyMMdd-HHmmss")
$filter = "[0:v]split=4[s][t][m][b];[t]crop=1920:1080:0:0[top];[m]crop=1920:1080:0:1080[mid];[b]crop=1920:1080:0:2160[bot]"
$ffArgs = @(
  "-hide_banner",
  "-loglevel","error",
  "-rtsp_transport","tcp",
  "-timeout","5000000",
  "-i",$SourceUrl,
  "-filter_complex",$filter,
  "-map","[s]","-frames:v","1","-q:v","2",(Join-Path $folder "stack.jpg"),
  "-map","[top]","-frames:v","1","-q:v","2",(Join-Path $folder "top.jpg"),
  "-map","[mid]","-frames:v","1","-q:v","2",(Join-Path $folder "middle.jpg"),
  "-map","[bot]","-frames:v","1","-q:v","2",(Join-Path $folder "bottom.jpg")
)
if ($PrintArgs) { $ffArgs; exit 0 }

$uri = [Uri]$SourceUrl
$port = if ($uri.Port -gt 0) { $uri.Port } else { 554 }
$serving = $false
$client = New-Object Net.Sockets.TcpClient
try {
  $serving = $client.BeginConnect($uri.Host, $port, $null, $null).AsyncWaitHandle.WaitOne(1500) -and $client.Connected
} catch {
  $serving = $false
} finally {
  $client.Close()
}
if (-not $serving) {
  Write-Output ("REFUSED: the relay is not serving on {0}:{1}; no pictures taken. Check the V380 cloud relay on NicksMax, then run this again." -f $uri.Host, $port)
  exit 2
}
if (-not (Test-Path -LiteralPath $Ffmpeg)) {
  Write-Output ("REFUSED: ffmpeg not found at {0}; pass -Ffmpeg <path>." -f $Ffmpeg)
  exit 2
}

New-Item -ItemType Directory -Path $folder -Force | Out-Null
# ffmpeg reports on stderr; under "Stop" a host that wraps stderr as errors would end the run early.
$ErrorActionPreference = "Continue"
& $Ffmpeg @ffArgs
$rc = $LASTEXITCODE
$missing = @("stack.jpg", "top.jpg", "middle.jpg", "bottom.jpg") | Where-Object { -not (Test-Path -LiteralPath (Join-Path $folder $_)) }
if ($rc -ne 0 -or $missing) {
  Write-Output ("FAILED: ffmpeg exit {0}; missing: {1}. The relay may be up with no picture (the solar sign camera is dark at night)." -f $rc, ($missing -join ", "))
  exit 1
}
Write-Output ("STILLS {0}" -f $folder)
Write-Output "Send stack.jpg, top.jpg, middle.jpg and bottom.jpg to Nour: which lens shows the driveway entrance?"

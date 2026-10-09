# NicksMax sign crop launcher -- installed as C:\Users\nourd\NicksMax\lab\v380-cloud-relay\run-sign-crop.ps1;
# the supervisor starts it (hidden) when rtsp://127.0.0.1:8555/sign has no decodable frame while
# the relay's stack (rtsp://127.0.0.1:8554/live) does. It crops the middle 1920x1080 lens of the
# relay's 1920x3240 three-lens stack to 640x360 @ 4 fps and republishes it on 8555/sign.
#
# Canonical source since 2026-10-09: camera-bridge\scripts\nicksmax\ (it was a box-only file).
# scripts\nicksmax\install-nicksmax-supervisor-host.ps1 installs it; the tick says once a day when
# the installed copy differs. A change takes effect at the next crop start.
#
# The previous run's stdout/stderr are kept as .prev: deleting them at start meant a crashed
# crop's own log was gone the moment the supervisor restarted it.
$ErrorActionPreference = "Stop"
$root = "C:\Users\nourd\NicksMax\lab\v380-cloud-relay"
$ffmpeg = "C:\Users\nourd\NicksMax\lab\ffmpeg-essentials\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe"
$outLog = Join-Path $root "sign-crop.stdout.log"
$errLog = Join-Path $root "sign-crop.stderr.log"
$statusLog = Join-Path $root "sign-crop-status.log"
$instanceLockPath = Join-Path $root ".sign-crop.lock"

# The supervisor's writer, verbatim (a test keeps the copies identical): Windows PowerShell 5.1's
# Add-Content fails beside any open reader.
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
  $instanceLock = [IO.File]::Open(
    $instanceLockPath,
    [IO.FileMode]::OpenOrCreate,
    [IO.FileAccess]::ReadWrite,
    [IO.FileShare]::None
  )
} catch {
  Log "SKIP duplicate sign crop; lock held"
  exit 0
}

$args = @(
  "-hide_banner",
  "-loglevel","warning",
  "-use_wallclock_as_timestamps","1",
  "-fflags","+genpts+discardcorrupt",
  "-rtsp_transport","tcp",
  "-timeout","5000000",
  "-i","rtsp://127.0.0.1:8554/live",
  "-an",
  "-vf","crop=1920:1080:0:1080,scale=640:360,fps=4,setpts=N/(4*TB)",
  "-c:v","libx264",
  "-preset","ultrafast",
  "-tune","zerolatency",
  "-pix_fmt","yuv420p",
  "-g","8",
  "-keyint_min","8",
  "-sc_threshold","0",
  "-fps_mode","cfr",
  "-f","rtsp",
  "-rtsp_transport","tcp",
  "rtsp://127.0.0.1:8555/sign"
)

try {
  Rotate-Log $outLog
  Rotate-Log $errLog
  Log "START middle-lens crop proxy with wallclock timestamp normalization"
  $p = Start-Process -FilePath $ffmpeg -ArgumentList $args -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -Wait
  Log ("EXIT rc={0}" -f $p.ExitCode)
  exit $p.ExitCode
} finally {
  if ($instanceLock) { $instanceLock.Dispose() }
}

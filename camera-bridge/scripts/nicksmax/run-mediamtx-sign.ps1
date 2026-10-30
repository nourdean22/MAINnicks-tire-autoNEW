# NicksMax sign MediaMTX launcher -- installed as C:\Users\nourd\NicksMax\lab\v380-cloud-relay\run-mediamtx-sign.ps1;
# the supervisor starts it (hidden, no arguments) when 127.0.0.1:8555 is not listening. MediaMTX is the
# loopback RTSP broker the sign crop publishes to (8555/sign) and the production edge reads from.
#
# Canonical source since 2026-10-30: camera-bridge\scripts\nicksmax\ (it was a box-only file).
# scripts\nicksmax\install-nicksmax-supervisor-host.ps1 installs it; the tick says once a day when
# the installed copy differs. A change takes effect at the next MediaMTX start.
#
# THE LOG IS CAPPED. The box copy appended MediaMTX's output with `*>> $log` for MediaMTX's whole life:
# at logLevel info every frame probe of 8555/sign writes five lines, so mediamtx-sign.log grew
# about 11 MB a day from 2026-09-28 and reached 348 MB on 2026-10-30, on a 40 GB disk that had
# 1.26 GB free that morning. A redirect also holds the file open, so it could not be trimmed
# without stopping MediaMTX. Now each line is appended with the shared writer (open, write,
# close), and when the file passes -CapBytes it becomes mediamtx-sign.log.prev (the older .prev
# is dropped): at most two caps of log on disk, and the newest lines always in the live file.
param(
  [string]$Root = "C:\Users\nourd\NicksMax\lab\v380-cloud-relay",
  [string]$Exe = "C:\Users\nourd\AppData\Local\Microsoft\WinGet\Packages\bluenviron.mediamtx_Microsoft.Winget.Source_8wekyb3d8bbwe\mediamtx.exe",
  [string]$Config = "",
  [long]$CapBytes = 20MB
)
$ErrorActionPreference = "Stop"
# String paths, not Join-Path: Join-Path throws on a host with no C: drive (Linux CI).
if (-not $Config) { $Config = "$Root\mediamtx-sign.yml" }
$log = "$Root\mediamtx-sign.log"
$instanceLockPath = "$Root\.mediamtx-sign.lock"

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

# Move the live log to .prev once it is past the cap; fall back to removing it if it cannot move.
function Limit-Log {
  $f = Get-Item -LiteralPath $log -ErrorAction SilentlyContinue
  if (-not $f -or $f.Length -le $CapBytes) { return }
  try { Move-Item -LiteralPath $log -Destination ($log + ".prev") -Force }
  catch { Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue }
}

function Log([string]$m) {
  try { Write-SharedFile $log ("{0}`r`n" -f $m) -Append } catch {}
}

try {
  $instanceLock = [IO.File]::Open(
    $instanceLockPath,
    [IO.FileMode]::OpenOrCreate,
    [IO.FileAccess]::ReadWrite,
    [IO.FileShare]::None
  )
} catch {
  Log ("{0} SKIP duplicate MediaMTX; lock held" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
  exit 0
}

try {
  Limit-Log
  # Checked here because Continue (below) would turn a missing binary into exit 0.
  if (-not (Test-Path -LiteralPath $Exe)) {
    Log ("{0} FAIL MediaMTX binary missing: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Exe)
    exit 2
  }
  # Continue, not Stop: Windows PowerShell 5.1 turns a native stderr line under 2>&1 into an error
  # record, and Stop would end the launcher (and with it MediaMTX's output) on the first one.
  $ErrorActionPreference = "Continue"
  & $Exe $Config 2>&1 | ForEach-Object {
    Log ([string]$_)
    Limit-Log
  }
  exit $LASTEXITCODE
} finally {
  if ($instanceLock) { $instanceLock.Dispose() }
}

# NicksMax camera supervisor SHIM -- installed as data\nicksmax-camera-supervisor.ps1, the file the
# loop starts every tick. The supervisor itself lives in the repo at scripts\nicksmax\, so a
# `git pull` on NicksMax is the deploy (2026-10-02). If that file is missing or does not parse (a
# half-finished checkout), run data\nicksmax-camera-supervisor.fallback.ps1 instead -- the last
# version that completed a tick, which the supervisor refreshes itself -- so the camera stack is
# never left unsupervised.
#
# Canonical source since 2026-10-09: camera-bridge\scripts\nicksmax\. It runs from data\, outside
# the tracked tree, for the same reason the fallback exists; scripts\nicksmax\
# install-nicksmax-supervisor-host.ps1 installs it, and the tick says once a day when the
# installed copy differs from this one. The loop reads this file afresh every tick.
param(
  [string]$RepoTick = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge\scripts\nicksmax\nicksmax-camera-supervisor.ps1",
  [string]$FallbackTick = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge\data\nicksmax-camera-supervisor.fallback.ps1",
  [string]$LogPath = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge\logs\nicksmax-camera-supervisor.log"
)
$ErrorActionPreference = "Continue"

# The supervisor's writer, verbatim (a test keeps the copies identical): Windows PowerShell 5.1's
# Add-Content fails beside any open reader of the log.
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

# A line that cannot reach the log goes to its overflow, which the next healthy tick restores.
function Log([string]$m) {
  $line = "{0} {1}`r`n" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m
  try { Write-SharedFile $LogPath $line -Append } catch { try { Write-SharedFile ($LogPath + ".overflow") $line -Append } catch {} }
}

$tick = $null
if (Test-Path -LiteralPath $RepoTick) {
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($RepoTick, [ref]$null, [ref]$errors)
  if (-not $errors -or $errors.Count -eq 0) { $tick = $RepoTick }
}
if (-not $tick) {
  if (-not (Test-Path -LiteralPath $FallbackTick)) {
    Log "ESCALATE repo supervisor missing or unparseable and no fallback copy exists; nothing supervised this tick -- needs a human"
    exit 1
  }
  Log "ESCALATE repo supervisor missing or unparseable; running fallback copy"
  $tick = $FallbackTick
}
& $tick
exit $LASTEXITCODE

# Installs the NicksMax camera supervisor's HOST scripts from this checkout. They run from outside
# the tracked tree on purpose -- the loop and the shim must survive a half-finished `git pull`, and
# the launchers are started by path -- so a pull alone never deploys them. Run this after a pull
# that changed any of them (the supervisor tick logs a WARN once a day while an installed copy
# differs from its repo copy):
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\nicksmax\install-nicksmax-supervisor-host.ps1 [-Check]
#
# Each source is parse-checked, staged beside its target and swapped in with [IO.File]::Replace,
# which keeps the replaced file as <target>.bak-<stamp>. A source that does not parse is refused and
# its target left alone. -Check reports what would change and changes nothing.
#
# When each change takes effect: the shim at the next tick (the loop reads it afresh every ~30 s);
# the edge, crop and Eufy bridge launchers at their next start; the loop only when its task starts again (next
# boot, or an elevated restart of NicksMaxCameraSupervisorSystem). The fallback copy is not
# installed here: the supervisor refreshes it from the last version that completed a tick.
param(
  [string]$Root = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge",
  [string]$CropDir = "C:\Users\nourd\NicksMax\lab\v380-cloud-relay",
  [string]$EufyDir = "C:\Users\nourd\AppData\Local\StateNour\Eufy",
  [switch]$Check
)
$ErrorActionPreference = "Stop"

# Nested Join-Path, never an embedded "\": the same paths on the box, and real ones in the Linux tests.
$source = Join-Path (Join-Path $Root "scripts") "nicksmax"
$data = Join-Path $Root "data"
$targets = @(
  @{ Name = "loop"; From = "nicksmax-camera-supervisor-loop.ps1"; To = (Join-Path $data "nicksmax-camera-supervisor-loop.ps1") },
  @{ Name = "shim"; From = "nicksmax-camera-supervisor-shim.ps1"; To = (Join-Path $data "nicksmax-camera-supervisor.ps1") },
  @{ Name = "edge"; From = "run-sign-rtsp-production.ps1";        To = (Join-Path $data "run-sign-rtsp-production.ps1") },
  @{ Name = "crop"; From = "run-sign-crop.ps1";                   To = (Join-Path $CropDir "run-sign-crop.ps1") },
  @{ Name = "eufy-bridge"; From = "start-bridge-nicksmax.ps1";     To = (Join-Path $EufyDir "start-bridge-nicksmax.ps1") }
)
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$updated = 0
$refused = 0

function Get-Sha([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return "" }
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}

foreach ($t in $targets) {
  $from = Join-Path $source $t.From
  if (-not (Test-Path -LiteralPath $from)) {
    "REFUSED {0}: source {1} is missing" -f $t.Name, $from
    $refused++
    continue
  }
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($from, [ref]$null, [ref]$errors)
  if ($errors -and $errors.Count -gt 0) {
    "REFUSED {0}: {1} does not parse ({2})" -f $t.Name, $from, $errors[0].Message
    $refused++
    continue
  }
  $fromSha = Get-Sha $from
  $toSha = Get-Sha $t.To
  if ($fromSha -eq $toSha) {
    "UNCHANGED {0} {1} (sha256 {2})" -f $t.Name, $t.To, $fromSha.Substring(0, 12)
    continue
  }
  if ($Check) {
    "WOULD UPDATE {0} {1} (sha256 {2} -> {3})" -f $t.Name, $t.To, $(if ($toSha) { $toSha.Substring(0, 12) } else { "missing" }), $fromSha.Substring(0, 12)
    $updated++
    continue
  }
  $staged = $t.To + ".new"
  [IO.File]::Copy($from, $staged, $true)
  $backup = $null
  # The shim is read at the start of every tick; a replace that lands in that instant is retried.
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      if (Test-Path -LiteralPath $t.To) {
        $backup = "{0}.bak-{1}" -f $t.To, $stamp
        [IO.File]::Replace($staged, $t.To, $backup)
      } else {
        [IO.File]::Move($staged, $t.To)
      }
      break
    } catch {
      if ($attempt -eq 5) { throw }
      Start-Sleep -Milliseconds 400
    }
  }
  if ((Get-Sha $t.To) -ne $fromSha) { throw ("installed {0} does not match its source after the replace" -f $t.To) }
  "UPDATED {0} {1} (sha256 {2}{3})" -f $t.Name, $t.To, $fromSha.Substring(0, 12), $(if ($backup) { "; previous kept as " + (Split-Path $backup -Leaf) } else { "" })
  $updated++
}

"{0} {1}, {2} refused" -f $updated, $(if ($Check) { "would change" } else { "updated" }), $refused
"NOTE the running loop keeps the code it started with until NicksMaxCameraSupervisorSystem starts again (next boot)"
if ($refused -gt 0) { exit 1 }
exit 0

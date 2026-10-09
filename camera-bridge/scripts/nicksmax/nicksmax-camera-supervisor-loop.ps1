# NicksMax camera supervisor LOOP -- the process the SYSTEM task NicksMaxCameraSupervisorSystem
# keeps alive from startup (NicksMaxCameraSupervisorUser runs the same file as nourd and stays
# disabled while the SYSTEM lane is healthy). Every ~30 s it starts one supervisor tick through the
# shim (data\nicksmax-camera-supervisor.ps1) and ends a tick that runs past 45 s.
#
# Canonical source since 2026-10-09: camera-bridge\scripts\nicksmax\. It runs from data\, outside
# the tracked tree, so a half-finished pull can never leave the camera stack unsupervised;
# scripts\nicksmax\install-nicksmax-supervisor-host.ps1 installs it, and the tick says once a day
# when the installed copy differs from this one. The running loop reads this file only when its
# task starts: an install takes effect at the next boot (or a restart of the SYSTEM task).
#
# This loop must never die. Its only writes are its own log lines, through the same shared writer
# as the tick (Windows PowerShell 5.1's Add-Content fails beside any open reader), and a line that
# cannot be written is dropped rather than allowed to end the loop.
param(
  [string]$Supervisor = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge\data\nicksmax-camera-supervisor.ps1",
  [string]$LogPath = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge\logs\nicksmax-camera-supervisor-loop.log",
  [int]$IntervalSeconds = 30,
  # Cold boot can legitimately require two 12 s decoded-frame probes plus relay/crop startup. Keep
  # the watchdog comfortably above that bounded work so it does not kill a healthy recovery tick
  # immediately before the authoritative producer start.
  [int]$TimeoutSeconds = 45,
  # 0 runs forever (the scheduled task); tests run one pass.
  [int]$MaxIterations = 0,
  # Windows PowerShell 5.1 on the box, the runtime the tick is written for; tests pass pwsh.
  [string]$PowerShellExe = "powershell.exe"
)
$ErrorActionPreference = "Continue"

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
  try { Write-SharedFile $LogPath ("{0} {1}`r`n" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) -Append } catch {}
}

$who = try { [Security.Principal.WindowsIdentity]::GetCurrent().Name } catch { [Environment]::UserName }
Log ("START supervisor loop pid={0} user={1}" -f $PID, $who)
$iteration = 0
while ($true) {
  $iteration++
  $p = $null
  try {
    $start = @{
      FilePath     = $PowerShellExe
      ArgumentList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $Supervisor)
      PassThru     = $true
    }
    if ($env:OS -eq "Windows_NT") { $start["WindowStyle"] = "Hidden" }
    $p = Start-Process @start
    # Touch the handle now: a Process from Start-Process -PassThru that exits before its handle is
    # read can report a null ExitCode, which would read as a failed tick.
    $null = $p.Handle
    if (-not $p.WaitForExit($TimeoutSeconds * 1000)) {
      try { $p.Kill() } catch {}
      Log ("WARN supervisor iteration timed out after {0}s; killed pid={1}" -f $TimeoutSeconds, $p.Id)
    } elseif ($p.ExitCode -ne 0) {
      Log ("WARN supervisor iteration exit={0}" -f $p.ExitCode)
    }
  } catch {
    Log ("ERROR supervisor iteration: {0}" -f $_.Exception.Message)
  } finally {
    if ($p) { $p.Dispose() }
  }
  if ($MaxIterations -gt 0 -and $iteration -ge $MaxIterations) { break }
  Start-Sleep -Seconds $IntervalSeconds
}

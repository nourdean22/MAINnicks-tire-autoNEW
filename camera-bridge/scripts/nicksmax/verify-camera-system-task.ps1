# 2026-09-28 receipt script -- it verifies `NicksMaxCameraSupervisor` (every minute), NOT the live
# `NicksMaxCameraSupervisorSystem` (at startup, ~30 s loop) the box has run since the SYSTEM cutover,
# so it may report the task missing on the current host. See
# docs/operations/NICKSMAX-CAMERA-HOST-2026-09-28.md ("Corrected 2026-10-07").
$ErrorActionPreference = "Stop"
$taskName = "NicksMaxCameraSupervisor"
$receipt = "C:\Users\nourd\NicksMax\lab\v380-cloud-relay\system-supervisor-verify.txt"

function R([string]$m) {
  Add-Content -Path $receipt -Value ("{0} {1}" -f (Get-Date -Format o), $m) -Encoding utf8
}

Remove-Item $receipt -Force -ErrorAction SilentlyContinue
R ("BEGIN verify identity={0}" -f [Security.Principal.WindowsIdentity]::GetCurrent().Name)

$t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $t) {
  R "SYSTEM_TASK missing"
  exit 2
}
$i = Get-ScheduledTaskInfo -TaskName $taskName
R ("SYSTEM_TASK state={0} enabled={1} principal={2} logon={3} runLevel={4} lastRun={5:o} lastResult=0x{6:X8}" -f
  $t.State,$t.Settings.Enabled,$t.Principal.UserId,$t.Principal.LogonType,$t.Principal.RunLevel,$i.LastRunTime,[uint32]$i.LastTaskResult)

if ($t.Principal.UserId -ne "SYSTEM") {
  R ("FAIL expected SYSTEM principal, got {0}" -f $t.Principal.UserId)
  exit 3
}

if ($t.State -ne "Running") {
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 2
  $t = Get-ScheduledTask -TaskName $taskName
  $i = Get-ScheduledTaskInfo -TaskName $taskName
  R ("SYSTEM_TASK restarted state={0} lastResult=0x{1:X8}" -f $t.State,[uint32]$i.LastTaskResult)
}

R "DONE"

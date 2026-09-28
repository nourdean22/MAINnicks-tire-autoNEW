$ErrorActionPreference = "Stop"
$receipt = "C:\Users\nourd\NicksMax\lab\camera-system-verify-receipt.txt"
$taskName = "NicksMaxCameraSupervisorSystem"
$legacyName = "NicksMaxCameraSupervisor"
Remove-Item $receipt -Force -ErrorAction SilentlyContinue

function R([string]$m) {
  Add-Content -Path $receipt -Value ("{0} {1}" -f (Get-Date -Format o), $m) -Encoding utf8
}

R ("BEGIN elevated verify identity={0}" -f [Security.Principal.WindowsIdentity]::GetCurrent().Name)

$t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $t) {
  R "SYSTEM_TASK missing"
  exit 2
}
$i = Get-ScheduledTaskInfo -TaskName $taskName
R ("SYSTEM_TASK exists state={0} enabled={1} principal={2} lastRun={3:o} lastResult=0x{4:X8}" -f $t.State,$t.Settings.Enabled,$t.Principal.UserId,$i.LastRunTime,[uint32]$i.LastTaskResult)
R ("SYSTEM_TASK action={0} {1}" -f $t.Actions[0].Execute,$t.Actions[0].Arguments)
R ("SYSTEM_TASK triggerClass={0}" -f $t.Triggers[0].CimClass.CimClassName)

if ($t.State -ne "Running") {
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 3
  $t = Get-ScheduledTask -TaskName $taskName
  $i = Get-ScheduledTaskInfo -TaskName $taskName
  R ("SYSTEM_TASK restarted state={0} lastResult=0x{1:X8}" -f $t.State,[uint32]$i.LastTaskResult)
}

$proc = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match "nicksmax-camera-supervisor-loop\.ps1"
} | Select-Object -First 1
if ($proc) {
  R ("SYSTEM_LOOP pid={0} parent={1} name={2}" -f $proc.ProcessId,$proc.ParentProcessId,$proc.Name)
} else {
  R "SYSTEM_LOOP process-not-found"
}

$legacy = Get-ScheduledTask -TaskName $legacyName -ErrorAction SilentlyContinue
if ($legacy) {
  Stop-ScheduledTask -TaskName $legacyName -ErrorAction SilentlyContinue
  Disable-ScheduledTask -TaskName $legacyName -ErrorAction SilentlyContinue | Out-Null
  R "LEGACY_INTERACTIVE disabled"
}

R "DONE"

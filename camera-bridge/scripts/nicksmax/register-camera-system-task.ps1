# 2026-09-28 receipt script -- NOT the live configuration. It registers `NicksMaxCameraSupervisor`
# (every minute, SYSTEM). Since the SYSTEM cutover the box runs `NicksMaxCameraSupervisorSystem`
# (at startup), whose loop script calls nicksmax-camera-supervisor.ps1 about every 30 s. Registering
# this task beside it would run two supervisors. Read docs/operations/NICKSMAX-CAMERA-HOST-2026-09-28.md
# ("Corrected 2026-10-07") and docs/adr/0022-camera-vision-as-built.md before running it.
$ErrorActionPreference = "Stop"
$taskName = "NicksMaxCameraSupervisor"
$supervisor = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge\data\nicksmax-camera-supervisor.ps1"
$receipt = "C:\Users\nourd\NicksMax\lab\v380-cloud-relay\system-supervisor-only.txt"

try {
  $action = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $supervisor + '"'
  & schtasks.exe /End /TN $taskName 2>$null | Out-Null
  & schtasks.exe /Delete /TN $taskName /F 2>$null | Out-Null
  $out = & schtasks.exe /Create /TN $taskName /TR $action /SC MINUTE /MO 1 /RU SYSTEM /RL HIGHEST /F 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($out -join " ") }
  & schtasks.exe /Run /TN $taskName | Out-Null
  Start-Sleep -Seconds 2
  $t = Get-ScheduledTask -TaskName $taskName
  $i = Get-ScheduledTaskInfo -TaskName $taskName
  @(
    "ok=true"
    "at=$(Get-Date -Format o)"
    "user=$($t.Principal.UserId)"
    "logon=$($t.Principal.LogonType)"
    "runlevel=$($t.Principal.RunLevel)"
    "state=$($t.State)"
    ("result=0x{0:X8}" -f ([uint32]$i.LastTaskResult))
  ) | Set-Content $receipt -Encoding ascii
} catch {
  @("ok=false","at=$(Get-Date -Format o)","error=$($_.Exception.Message)") | Set-Content $receipt -Encoding ascii
  exit 1
}

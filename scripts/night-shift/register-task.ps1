<#
.SYNOPSIS
  Register (or remove) the nightly Windows Scheduled Task for Night Shift.

.DESCRIPTION
  NOT run automatically by any agent — registering a standing task that runs
  Claude unattended on this machine is an operator decision. Run it yourself:

    powershell -File scripts\night-shift\register-task.ps1            # 02:30 local, daily
    powershell -File scripts\night-shift\register-task.ps1 -Remove

  Run run.ps1 by hand at least once first, and confirm STATENOUR_SYNC_URL /
  STATENOUR_SYNC_KEY are set for the user the task runs as.
#>
param(
  [string]$At = "02:30",
  [switch]$Remove,
  [string]$RepoRoot = "C:\Users\nourd\NOURCITY"
)
$name = "NOURCITY Night Shift"
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "removed '$name'"
  exit 0
}
$script = Join-Path $RepoRoot "scripts\night-shift\run.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 3) -StartWhenAvailable -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description "One scoped PR proposal per night; never merges." -Force | Out-Null
Write-Host "registered '$name' daily at $At — first run: powershell -File `"$script`""

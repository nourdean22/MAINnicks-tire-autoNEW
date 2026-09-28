$ErrorActionPreference = "Stop"
$receipt = "C:\Users\nourd\NicksMax\lab\camera-system-task-receipt.txt"
$loop = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge\data\nicksmax-camera-supervisor-loop.ps1"
$taskName = "NicksMaxCameraSupervisorSystem"
$legacyName = "NicksMaxCameraSupervisor"

function Receipt([string]$m) {
  Add-Content -Path $receipt -Value ("{0} {1}" -f (Get-Date -Format o), $m) -Encoding utf8
}
Remove-Item $receipt -Force -ErrorAction SilentlyContinue
Receipt ("BEGIN elevated registration user={0}" -f [Security.Principal.WindowsIdentity]::GetCurrent().Name)

if (-not (Test-Path $loop)) { throw "missing loop script: $loop" }

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $loop)
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3

$t = Get-ScheduledTask -TaskName $taskName
$i = Get-ScheduledTaskInfo -TaskName $taskName
Receipt ("SYSTEM_TASK task={0} state={1} principal={2} lastResult=0x{3:X8}" -f $taskName,$t.State,$t.Principal.UserId,[uint32]$i.LastTaskResult)

$legacy = Get-ScheduledTask -TaskName $legacyName -ErrorAction SilentlyContinue
if ($legacy) {
  Stop-ScheduledTask -TaskName $legacyName -ErrorAction SilentlyContinue
  Disable-ScheduledTask -TaskName $legacyName -ErrorAction SilentlyContinue | Out-Null
  Receipt ("DISABLED legacy interactive supervisor task={0}" -f $legacyName)
}

# NicksMax is a plugged-in appliance: never sleep/hibernate or sleep on lid-close while on AC.
powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 0 | Out-Null
powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP HIBERNATEIDLE 0 | Out-Null
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 | Out-Null
powercfg /S SCHEME_CURRENT | Out-Null
Receipt "POWER ac-sleep=never ac-hibernate=never ac-lid=do-nothing"
Receipt "DONE"

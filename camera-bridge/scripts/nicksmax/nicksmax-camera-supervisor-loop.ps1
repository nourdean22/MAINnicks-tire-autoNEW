$ErrorActionPreference = "Continue"
$supervisor = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge\data\nicksmax-camera-supervisor.ps1"
$log = "C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge\logs\nicksmax-camera-supervisor-system.log"

function Log([string]$m) {
  Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) -Encoding utf8
}

Log ("SYSTEM supervisor loop starting as {0}" -f [Security.Principal.WindowsIdentity]::GetCurrent().Name)
while ($true) {
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $supervisor | Out-Null
  } catch {
    Log ("ERROR supervisor iteration: {0}" -f $_.Exception.Message)
  }
  Start-Sleep -Seconds 30
}

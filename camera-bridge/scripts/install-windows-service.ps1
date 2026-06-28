# PowerShell script to register the Camera Bridge as a Windows background task starting on system startup.
# Requires Administrator privileges.

$ScriptPath = Join-Path (Get-Item .).FullName "bridge\bridge.py"
$WorkingDir = Join-Path (Get-Item .).FullName "bridge"
$LogPath = Join-Path (Get-Item .).FullName "bridge.log"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Registering Camera Bridge Windows Task" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Check Admin Privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "This script must be run as Administrator! Re-launch PowerShell as Administrator."
    Exit
}

# 2. Check Python installation
$pythonCheck = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCheck) {
    Write-Error "python command not found in environment PATH! Install Python and add it to system PATH."
    Exit
}

# 3. Create Task parameters
$TaskName = "NicksTireArrivalIntelligenceBridge"
$Action = New-ScheduledTaskAction -Execute "python.exe" -Argument "$ScriptPath" -WorkingDirectory "$WorkingDir"
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# 4. Register Task
Write-Host "Registering task '$TaskName' to run at system startup..." -ForegroundColor Yellow
$registered = Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -User "NT AUTHORITY\SYSTEM" -RunLevel Highest -Force -ErrorAction SilentlyContinue

if ($registered) {
    Write-Host "[SUCCESS] Task successfully registered!" -ForegroundColor Green
    Write-Host "The bridge will start automatically on boot." -ForegroundColor Gray
    Write-Host "To start the bridge now, run:" -ForegroundColor Gray
    Write-Host "  Start-ScheduledTask -TaskName $TaskName" -ForegroundColor Cyan
} else {
    Write-Error "Failed to register scheduled task."
}

$ErrorActionPreference='Stop'
$homeDir=$env:USERPROFILE
$openCodeExe=Join-Path $env:APPDATA 'npm\node_modules\opencode-ai\bin\opencode.exe'
$pythonExe=Join-Path $env:APPDATA 'open-webui\python\python.exe'
$bridge=Join-Path $env:LOCALAPPDATA 'StateNour\cockpit\nour_cockpit_bridge.py'
$workspace=Join-Path $homeDir 'NOURCITY'

function Get-JsonHealth([string]$url){
  try { return Invoke-RestMethod $url -TimeoutSec 3 } catch { return $null }
}
function Stop-Matching([string]$pattern){
  Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -match $pattern} | ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force } catch {}
  }
  Start-Sleep -Milliseconds 700
}
if(!(Test-Path -LiteralPath $openCodeExe)){throw "OpenCode CLI missing: $openCodeExe"}
if(!(Test-Path -LiteralPath $pythonExe)){throw "OpenWebUI Python missing: $pythonExe"}
if(!(Test-Path -LiteralPath $bridge)){throw "NOUR cockpit bridge missing: $bridge"}
if(!(Test-Path -LiteralPath $workspace)){throw "NOURCITY workspace missing: $workspace"}

$cliVersion=((& $openCodeExe --version) | Select-Object -First 1).Trim()
$h=Get-JsonHealth 'http://127.0.0.1:4097/global/health'
if((-not $h) -or (-not $h.healthy) -or ([string]$h.version -ne $cliVersion)){
  Stop-Matching 'opencode\.exe.*serve.*127\.0\.0\.1.*4097'
  Start-Process -FilePath $openCodeExe -ArgumentList @('serve','--hostname','127.0.0.1','--port','4097') -WorkingDirectory $workspace -WindowStyle Hidden
  $h=$null
  for($i=0;$i -lt 40;$i++){
    Start-Sleep -Milliseconds 500
    $h=Get-JsonHealth 'http://127.0.0.1:4097/global/health'
    if($h -and $h.healthy -and ([string]$h.version -eq $cliVersion)){break}
  }
}
if((-not $h) -or (-not $h.healthy)){throw 'OpenCode headless server did not become ready on 4097'}
Write-Output "OpenCode $($h.version) ready on 4097"

$c=Get-JsonHealth 'http://127.0.0.1:4101/health'
if((-not $c) -or (-not $c.ok) -or ([string]$c.cockpit -ne 'ready')){
  Stop-Matching 'nour_cockpit_bridge\.py.*--serve'
  Start-Process -FilePath $pythonExe -ArgumentList @($bridge,'--serve') -WorkingDirectory (Split-Path $bridge) -WindowStyle Hidden
  $c=$null
  for($i=0;$i -lt 40;$i++){
    Start-Sleep -Milliseconds 500
    $c=Get-JsonHealth 'http://127.0.0.1:4101/health'
    if($c -and $c.ok -and ([string]$c.cockpit -eq 'ready')){break}
  }
}
if((-not $c) -or (-not $c.ok)){throw 'NOUR Cockpit bridge did not become ready on 4101'}
if($c.mission_task_writes -ne $false){throw 'Cockpit bridge reported Mission/Task writes enabled; refusing startup'}
Write-Output "NOUR Cockpit ready on 4101; Mission/Task writes disabled"

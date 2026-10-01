$ErrorActionPreference='Stop'
trap {
  try {
    $p=Join-Path $env:USERPROFILE 'AI\logs\nour-ai-launch.log'
    Add-Content -LiteralPath $p -Value ((Get-Date -Format o)+' ERROR '+$_.Exception.Message)
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Nour AI could not finish starting.`n`n$($_.Exception.Message)",'Nour AI startup problem','OK','Error')|Out-Null
  } catch {}
  exit 1
}
$homeDir=$env:USERPROFILE
$baseModels=@('nour-auto','qwen35-4b-local','nour-research','nour-codex-chatgpt','nour-claude-subscription','nour-antigravity')
$planModel='nour-chatgpt-plan'
$planCreds=Test-Path (Join-Path $env:LOCALAPPDATA 'StateNour\chatgpt-plan\credentials.dpapi')
$configuredModels=if($planCreds){@($baseModels[0..2] + $planModel + $baseModels[3..5])}else{@($baseModels)}
$uiModels=@('nour-cockpit')+$configuredModels
$toolServerConnections=@(
  [ordered]@{
    url='http://127.0.0.1:4101'
    path='/openapi.json'
    type='openapi'
    auth_type='none'
    forward_cookies=$false
    headers=$null
    key=$null
    config=[ordered]@{enable=$true}
    info=[ordered]@{
      id='nour-cockpit'
      name='NOUR Cockpit'
      description='Start and supervise isolated OpenCode work from OpenWebUI without writing StateNour Mission/Task records.'
    }
  }
)|ConvertTo-Json -Depth 8 -Compress
$logDir=Join-Path $homeDir 'AI\logs'
New-Item -ItemType Directory -Path $logDir -Force|Out-Null
$log=Join-Path $logDir 'nour-ai-launch.log'
function Log([string]$m){Add-Content -LiteralPath $log -Value ((Get-Date -Format o)+' '+$m)}
function Router-Ready {
  try {
    $m=Invoke-RestMethod 'http://127.0.0.1:11436/v1/models' -TimeoutSec 2
    $ids=@($m.data.id)
    return (@($configuredModels | Where-Object {$ids -notcontains $_}).Count -eq 0)
  } catch {return $false}
}
function WebUI-Ready {
  try {$c=Invoke-RestMethod 'http://127.0.0.1:8080/api/config' -TimeoutSec 2;return [bool]$c.status} catch {return $false}
}
function Stop-WebUIOwned {
  $webuiRoot="$env:APPDATA\open-webui"
  $ownedPattern='(?i)(\\Scripts\\open-webui\.exe\b|-m\s+uv\s+run\s+open-webui\b|\\Scripts\\open-terminal\.exe\b|-m\s+uv\s+run\s+open-terminal\b)'
  Get-CimInstance Win32_Process|Where-Object {($_.ExecutablePath -like "$env:LOCALAPPDATA\Programs\open-webui\*") -or (($_.ExecutablePath -like "$webuiRoot\python\*") -and ($_.CommandLine -match $ownedPattern))}|Sort-Object ProcessId -Descending|ForEach-Object {try{Stop-Process -Id $_.ProcessId -Force}catch{}}
  Start-Sleep -Seconds 2
}function Ensure-WebUIDatabase {
  $py="$env:APPDATA\open-webui\python\python.exe"
  $repair="$homeDir\bin\nour-webui-db-repair.py"
  if(!(Test-Path $py) -or !(Test-Path $repair)){throw 'Open WebUI database repair helper missing'}
  $out=@(& $py $repair 2>&1)
  if($LASTEXITCODE -ne 0){throw ('Open WebUI database repair failed: '+($out -join ' | '))}
  return ($out -contains 'changed=true')
}function Ensure-WebUIRuntimePatch {
  $py="$env:APPDATA\open-webui\python\python.exe"
  $patch="$homeDir\bin\nour-webui-runtime-patch.py"
  if(!(Test-Path $py) -or !(Test-Path $patch)){throw 'Open WebUI runtime patch helper missing'}
  $out=@(& $py $patch 2>&1)
  if($LASTEXITCODE -ne 0){throw ('Open WebUI runtime patch failed: '+($out -join ' | '))}
  return ($out -contains 'changed=true')
}function Ensure-WebUIConfig {
  $cfgPath="$env:APPDATA\open-webui\config.json"
  if(!(Test-Path $cfgPath)){return $false}
  $bytes=[System.IO.File]::ReadAllBytes($cfgPath)
  $hadBom=($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)
  $raw=[System.Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF)
  $cfg=$raw|ConvertFrom-Json
  $before=$cfg|ConvertTo-Json -Depth 20 -Compress
  $cfg.defaultConnectionId='local'
  $cfg.runInBackground=$true;$cfg.showSidebar=$true;$cfg.windowMaximized=$true
  $cfg.localServer.port=8080;$cfg.localServer.serveOnLocalNetwork=$false;$cfg.localServer.autoUpdate=$false
  $cfg.openTerminal.enabled=$true;$cfg.openTerminal.cwd="$homeDir\AI\workspace"
  $cfg.llamaCpp.enabled=$false
  $vars=[ordered]@{}
  if($cfg.envVars){foreach($p in $cfg.envVars.PSObject.Properties){$vars[$p.Name]=[string]$p.Value}}
  $required=[ordered]@{
    WEBUI_AUTH='false';ENABLE_OPENAI_API='true';OPENAI_API_BASE_URL='http://127.0.0.1:11436/v1';OPENAI_API_BASE_URLS='http://127.0.0.1:11436/v1'
    OPENAI_API_KEY='local-no-key';OPENAI_API_KEYS='local-no-key';OPENAI_API_CONFIGS=([ordered]@{'0'=[ordered]@{enable=$true;model_ids=$configuredModels}}|ConvertTo-Json -Compress)
    ENABLE_OPENAI_API_PASSTHROUGH='false';ENABLE_DIRECT_CONNECTIONS='false';ENABLE_COMMUNITY_SHARING='false';ENABLE_SIGNUP='false'
    DEFAULT_MODELS='nour-cockpit';DEFAULT_PINNED_MODELS=($uiModels -join ',');MODEL_ORDER_LIST=($uiModels|ConvertTo-Json -Compress)
    DEFAULT_MODEL_PARAMS='{"temperature":0.7,"top_p":0.8,"presence_penalty":1.5,"function_calling":"legacy","custom_params":{"top_k":20,"min_p":0}}';ENABLE_WEB_SEARCH='true';WEB_SEARCH_ENGINE='duckduckgo';WEB_LOADER_TIMEOUT='20';WEB_FETCH_MAX_CONTENT_LENGTH='50000'
    TASK_MODEL='qwen35-4b-local';TASK_MODEL_EXTERNAL='qwen35-4b-local';TASK_MODEL_PARAMS='{"max_tokens":512,"temperature":0.2,"top_p":0.8,"custom_params":{"top_k":20,"min_p":0}}'
    ENABLE_TITLE_GENERATION='true';ENABLE_TAGS_GENERATION='false';ENABLE_FOLLOW_UP_GENERATION='false';ENABLE_AUTOCOMPLETE_GENERATION='false';ENABLE_SEARCH_QUERY_GENERATION='true';ENABLE_RETRIEVAL_QUERY_GENERATION='true'
    AIOHTTP_CLIENT_TIMEOUT='510';AIOHTTP_CLIENT_TIMEOUT_MODEL_LIST='3';AIOHTTP_CLIENT_TIMEOUT_OPENAI_MODEL_LIST='3';AIOHTTP_CLIENT_TIMEOUT_TOOL_SERVER='180';AIOHTTP_CLIENT_TIMEOUT_TOOL_SERVER_DATA='15';MCP_INITIALIZE_TIMEOUT='30'
    TOOL_SERVER_CONNECTIONS=$toolServerConnections
  }
  foreach($k in $required.Keys){$vars[$k]=$required[$k]}
  $cfg.envVars=[pscustomobject]$vars
  $after=$cfg|ConvertTo-Json -Depth 20 -Compress
  [System.IO.File]::WriteAllText($cfgPath,($cfg|ConvertTo-Json -Depth 20),(New-Object System.Text.UTF8Encoding($false)))
  return ($hadBom -or ($before -ne $after))
}Log 'launch requested'
$dbChanged=Ensure-WebUIDatabase
$runtimeChanged=Ensure-WebUIRuntimePatch
$configChanged=Ensure-WebUIConfig
if($dbChanged -or $runtimeChanged -or $configChanged){Log 'desktop config repaired';Stop-WebUIOwned}

if(-not (Router-Ready)){
  Log 'router missing; starting'
  & (Join-Path $homeDir 'bin\start-local-ai.ps1') | ForEach-Object {Log $_}
}
if(-not (Router-Ready)){throw 'Local AI router did not become ready.'}

$cockpitStart=Join-Path $homeDir 'bin\start-nour-cockpit.ps1'
if(!(Test-Path -LiteralPath $cockpitStart)){throw "NOUR Cockpit starter missing: $cockpitStart"}
Log 'ensuring OpenCode + NOUR Cockpit'
& $cockpitStart | ForEach-Object {Log $_}
try{
  $cockpitHealth=Invoke-RestMethod 'http://127.0.0.1:4101/health' -TimeoutSec 3
  if((-not $cockpitHealth.ok) -or $cockpitHealth.mission_task_writes -ne $false){throw 'cockpit health boundary failed'}
}catch{throw "NOUR Cockpit did not become safe/ready: $($_.Exception.Message)"}

$ensureCockpit=Join-Path $env:LOCALAPPDATA 'StateNour\cockpit\ensure_openwebui_cockpit.py'
$openWebUIPython=Join-Path $env:APPDATA 'open-webui\python\python.exe'
if(!(Test-Path -LiteralPath $ensureCockpit)){throw "NOUR Cockpit OpenWebUI repair missing: $ensureCockpit"}
if(!(Test-Path -LiteralPath $openWebUIPython)){throw "OpenWebUI Python missing: $openWebUIPython"}
$env:DATA_DIR=Join-Path $env:APPDATA 'open-webui\data'
$env:WEBUI_AUTH='false'
$ensureOutput=@(& $openWebUIPython $ensureCockpit 2>&1)
$ensureLine=$ensureOutput | Where-Object {[string]$_ -like 'NOUR_COCKPIT_ENSURE=*'} | Select-Object -Last 1
if(-not $ensureLine){throw "NOUR Cockpit OpenWebUI repair returned no receipt: $($ensureOutput -join ' | ')"}
$ensureState=(([string]$ensureLine -replace '^NOUR_COCKPIT_ENSURE=','') | ConvertFrom-Json)
if($ensureState.mission_task_writes -ne $false){throw 'Cockpit model repair reported Mission/Task writes enabled'}
Log "cockpit model=$($ensureState.model) base=$($ensureState.base_model) changed=$($ensureState.changed)"
if($ensureState.changed){Stop-WebUIOwned}

$webExe=Join-Path $env:LOCALAPPDATA 'Programs\open-webui\open-webui.exe'
if(!(Test-Path $webExe)){throw "Open WebUI executable missing: $webExe"}

if(-not (WebUI-Ready)){
  Log 'Open WebUI backend missing; starting desktop app'
  Start-Process -FilePath $webExe -WorkingDirectory (Join-Path $homeDir 'AI\workspace')
  for($i=0;$i -lt 240;$i++){if(WebUI-Ready){break};Start-Sleep -Milliseconds 500}
} else {
  Log 'Open WebUI backend already ready; bringing app forward'
  Start-Process -FilePath $webExe -WorkingDirectory (Join-Path $homeDir 'AI\workspace')
}
if(-not (WebUI-Ready)){throw 'Open WebUI did not become ready.'}
Log 'Nour AI ready'
exit 0
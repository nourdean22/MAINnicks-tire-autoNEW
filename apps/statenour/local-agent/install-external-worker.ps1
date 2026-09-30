param(
  [string]$BaseUrl = "https://bdnick.info",
  [string]$RuntimeRoot = "$env:LOCALAPPDATA\StateNour\external-worker",
  [string]$WorkspaceRoot = "$env:USERPROFILE\Documents\Codex\NATTYNOUR-RUNTIME-WRITES-DO-NOT-CLEAN",
  [switch]$EnableWrites,
  [switch]$Start
)

$ErrorActionPreference = "Stop"
$TaskName = "StateNour-ExternalWorker-NattyNour"
$SourceAgent = Join-Path $PSScriptRoot "external_worker_agent.py"
$SourceChatGptBridge = Join-Path $PSScriptRoot "chatgpt-plan-bridge.mjs"

function Write-Step([string]$Message) {
  Write-Host "[external-worker] $Message"
}

if (-not (Test-Path -LiteralPath $SourceAgent)) {
  throw "Missing external worker source: $SourceAgent"
}
if (-not (Test-Path -LiteralPath $SourceChatGptBridge)) {
  throw "Missing ChatGPT-plan bridge source: $SourceChatGptBridge"
}

$python = (Get-Command python.exe -ErrorAction Stop).Source
& $python -c "import requests" 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Python requests package is required by external_worker_agent.py"
}

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
$RuntimeAgent = Join-Path $RuntimeRoot "external_worker_agent.py"
$RuntimeChatGptBridge = Join-Path $RuntimeRoot "chatgpt-plan-bridge.mjs"
$SecretPath = Join-Path $RuntimeRoot "runner-secret.dpapi"
$LauncherPath = Join-Path $RuntimeRoot "run-external-worker.ps1"

Copy-Item -LiteralPath $SourceAgent -Destination $RuntimeAgent -Force
Copy-Item -LiteralPath $SourceChatGptBridge -Destination $RuntimeChatGptBridge -Force

$plain = [Environment]::GetEnvironmentVariable("RUNNER_SHARED_SECRET")
if ([string]::IsNullOrWhiteSpace($plain)) {
  $secure = Read-Host "StateNour RUNNER_SHARED_SECRET" -AsSecureString
} else {
  $secure = ConvertTo-SecureString $plain -AsPlainText -Force
}
$secure | ConvertFrom-SecureString | Set-Content -LiteralPath $SecretPath -Encoding UTF8 -NoNewline
$plain = $null
Remove-Item Env:RUNNER_SHARED_SECRET -ErrorAction SilentlyContinue

$workspaceMap = @{
  repo = $WorkspaceRoot
  statenour = (Join-Path $WorkspaceRoot "apps\statenour")
  nickstire = (Join-Path $WorkspaceRoot "apps\nickstire")
} | ConvertTo-Json -Compress
$writes = if ($EnableWrites) { "1" } else { "0" }

$launcher = @'
$ErrorActionPreference = "Stop"
$runtime = "__RUNTIME__"
$secretPath = Join-Path $runtime "runner-secret.dpapi"
$agent = Join-Path $runtime "external_worker_agent.py"
$log = Join-Path $runtime "external-worker.log"
$secure = Get-Content -LiteralPath $secretPath -Raw | ConvertTo-SecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:RUNNER_SHARED_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
$env:STATENOUR_BASE_URL = "__BASE_URL__"
$env:NOUR_EXTERNAL_WORKER_ALLOW_WRITES = "__WRITES__"
$env:NOUR_EXTERNAL_WORKER_WORKSPACES_JSON = '__WORKSPACES__'
$env:OPENAI_API_KEY = $null
$env:CODEX_API_KEY = $null
$env:CODEX_ACCESS_TOKEN = $null
$env:ANTHROPIC_API_KEY = $null
$env:GEMINI_API_KEY = $null
$env:GOOGLE_API_KEY = $null
& "__PYTHON__" $agent *>> $log
exit $LASTEXITCODE
'@
$launcher = $launcher.Replace("__RUNTIME__", $RuntimeRoot.Replace("'", "''"))
$launcher = $launcher.Replace("__BASE_URL__", $BaseUrl.Replace("'", "''"))
$launcher = $launcher.Replace("__WRITES__", $writes)
$launcher = $launcher.Replace("__WORKSPACES__", $workspaceMap.Replace("'", "''"))
$launcher = $launcher.Replace("__PYTHON__", $python.Replace("'", "''"))
Set-Content -LiteralPath $LauncherPath -Value $launcher -Encoding UTF8

$taskArgs = '-NoProfile -ExecutionPolicy Bypass -File "' + $LauncherPath + '"'
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

# Manual-only by design: no time/logon trigger. The desktop toggle is the start/stop control.
Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings -Description "StateNour manual-only outbound external subscription/local worker. API-key envs scrubbed; writes double-gated." -Force | Out-Null

if ($Start) {
  Start-ScheduledTask -TaskName $TaskName
}

$agentHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $RuntimeAgent).Hash.ToLowerInvariant()
$chatGptBridgeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $RuntimeChatGptBridge).Hash.ToLowerInvariant()
Write-Step "installed"
[pscustomobject]@{
  taskName = $TaskName
  runtimeRoot = $RuntimeRoot
  workspaceRoot = $WorkspaceRoot
  baseUrl = $BaseUrl
  writesEnabled = [bool]$EnableWrites
  started = [bool]$Start
  agentSha256 = $agentHash
  chatgptPlanBridgeSha256 = $chatGptBridgeHash
  secretStorage = "Windows DPAPI current-user"
} | ConvertTo-Json -Depth 3

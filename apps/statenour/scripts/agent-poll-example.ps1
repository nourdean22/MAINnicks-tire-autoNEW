# ============================================================
# statenour-os ↔ nour-os-unified device command poller
# ============================================================
# Drop this into nour-os-unified/modules/ (or wherever the agent
# lives). Run under pwsh (or Windows PowerShell 5+). Every 20s
# pulls a batch of pending DeviceCommand rows from statenour-os,
# dispatches each to the right vendor bridge, and acks back.
#
# Env required:
#   STATENOUR_URL  — https://autonicks.com (no trailing slash)
#   SYNC_KEY       — matches Vercel env SYNC_KEY
#   BRIDGE_ROOT    — absolute path to nour-os-unified/modules
#                    (where iot/ring/bridge.js lives)
#
# Example .env:
#   STATENOUR_URL=https://autonicks.com
#   SYNC_KEY=xxx
#   BRIDGE_ROOT=C:\Users\nourd\NOUR-OS\nour-os-unified\modules
#
# Logs to stdout + optionally to a file if $env:LOG_PATH is set.
# Ctrl+C cleanly exits.
# ============================================================

$ErrorActionPreference = "Stop"

$BaseUrl  = if ($env:STATENOUR_URL)  { $env:STATENOUR_URL.TrimEnd("/") } else { "https://autonicks.com" }
$SyncKey  = $env:SYNC_KEY
$BridgeRoot = $env:BRIDGE_ROOT
$PollSec  = if ($env:POLL_SECONDS) { [int]$env:POLL_SECONDS } else { 20 }
$Platforms = if ($env:AGENT_PLATFORMS) { $env:AGENT_PLATFORMS } else { "TUYA,RING,EUFY,GOOGLE_HOME,V380" }

if (-not $SyncKey) {
  Write-Error "SYNC_KEY env var required"
  exit 1
}
if (-not $BridgeRoot -or -not (Test-Path $BridgeRoot)) {
  Write-Warning "BRIDGE_ROOT not set or missing — commands will fail with 'bridge not found'. Continuing anyway so agent still acks failures."
}

function Write-Log($msg) {
  $stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  $line = "[$stamp] $msg"
  Write-Host $line
  if ($env:LOG_PATH) { Add-Content -Path $env:LOG_PATH -Value $line }
}

function Invoke-Bridge($platform, $platformDeviceId, $command, $params) {
  # Converts the command into a call to the right bridge. Each
  # bridge is expected to return a JSON-ish hash to stdout; we
  # parse it as the resultState.
  $paramsJson = if ($params) { ($params | ConvertTo-Json -Compress -Depth 5) } else { "{}" }

  $result = switch ($platform) {
    "TUYA" {
      $script = Join-Path $BridgeRoot "iot/tuya/controller.py"
      if (-not (Test-Path $script)) { throw "tuya controller not found at $script" }
      $out = python $script $platformDeviceId $command $paramsJson 2>&1
      $out
    }
    "RING" {
      $script = Join-Path $BridgeRoot "iot/ring/bridge.js"
      if (-not (Test-Path $script)) { throw "ring bridge not found at $script" }
      $out = node $script $platformDeviceId $command $paramsJson 2>&1
      $out
    }
    "EUFY" {
      $script = Join-Path $BridgeRoot "iot/eufy/bridge.js"
      if (-not (Test-Path $script)) { throw "eufy bridge not found at $script" }
      $out = node $script $platformDeviceId $command $paramsJson 2>&1
      $out
    }
    "GOOGLE_HOME" {
      $script = Join-Path $BridgeRoot "iot/google/controller.py"
      if (-not (Test-Path $script)) { throw "google controller not found at $script" }
      $out = python $script $platformDeviceId $command $paramsJson 2>&1
      $out
    }
    default {
      throw "unsupported platform: $platform"
    }
  }

  # Try to parse stdout as JSON for resultState; if it's not JSON,
  # return it as a raw text field.
  try {
    return ($result | ConvertFrom-Json -ErrorAction Stop)
  } catch {
    return @{ raw = "$result" }
  }
}

function Ack-Command($id, $status, $resultState, $error) {
  $body = @{
    status = $status
  }
  if ($resultState) { $body.resultState = $resultState }
  if ($error)       { $body.error = $error }

  $json = $body | ConvertTo-Json -Depth 6 -Compress
  try {
    Invoke-RestMethod "$BaseUrl/api/devices/command/$id" `
      -Method PATCH `
      -Headers @{ "x-sync-key" = $SyncKey; "Content-Type" = "application/json" } `
      -Body $json `
      -TimeoutSec 10 | Out-Null
    Write-Log "  ack $status: $id"
  } catch {
    Write-Log "  !! ack FAILED for $id: $_"
  }
}

Write-Log "agent starting — base=$BaseUrl poll=${PollSec}s platforms=$Platforms"

while ($true) {
  try {
    $url = "$BaseUrl/api/devices/queue?platform=$Platforms&limit=10"
    $batch = Invoke-RestMethod $url `
      -Headers @{ "x-sync-key" = $SyncKey } `
      -TimeoutSec 10

    if ($batch.count -gt 0) {
      Write-Log "got $($batch.count) command(s)"
    }

    foreach ($cmd in $batch.commands) {
      $label = "$($cmd.device.platform)/$($cmd.device.name) -> $($cmd.command)"
      Write-Log "exec $label [$($cmd.id)]"
      try {
        $result = Invoke-Bridge `
          -platform $cmd.device.platform `
          -platformDeviceId $cmd.device.platformDeviceId `
          -command $cmd.command `
          -params $cmd.params
        Ack-Command -id $cmd.id -status "acked" -resultState $result
      } catch {
        $errMsg = $_.Exception.Message
        Write-Log "  error: $errMsg"
        Ack-Command -id $cmd.id -status "failed" -error $errMsg
      }
    }
  } catch {
    Write-Log "poll error: $_"
  }

  Start-Sleep -Seconds $PollSec
}

<#
  local-mcp-servers.ps1 - start, check or stop the shared local MCP server(s) listed in
  config/agent-os/local-services.json. Today that is graphify (repo graph, read-only queries) on 127.0.0.1:8765/mcp.
  Serena was trialled 2026-10-19 and dropped (docs/UPSTREAMS.md has the numbers).

  Install (the HTTP transport needs the mcp extra; sql adds the .sql files): pipx install "graphifyy[mcp,sql]==0.9.80"

  One HTTP server each, shared by every Claude, Codex and VS Code session on this machine. One process per session was
  ruled out: per-session daemons ran this laptop out of memory on 2026-10-16. They serve the PRIMARY checkout (main),
  never a worktree's branch or uncommitted edits.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-mcp-servers.ps1 -Status   (default)
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-mcp-servers.ps1 -Start
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-mcp-servers.ps1 -Stop

  -Status prints one UP / DOWN / WRONG SERVICE line per server. -Start starts each DOWN server hidden (a no-op for one
  already UP; WRONG SERVICE means another program holds the port, so it is not started), waits up to 45 s for its port
  (graphify took about 21 s to listen on the 86k-node graph), records its pid in %LOCALAPPDATA%\nourcity\mcp-<name>.pid,
  and exits 1 if any server is not UP. -Stop stops a listener only when its command line names graphify or its pid is
  the recorded one; anything else is REFUSED (exit 1), never killed.
  "UP" means an MCP initialize POST answers HTTP 200 with serverInfo.name = <kind> within 2 s; refused or no answer is
  DOWN; any other answer is WRONG SERVICE. -ConfigFile <file> points at another local-services.json (tests).
  Logs: %LOCALAPPDATA%\nourcity\mcp-<name>.log (stdout) and mcp-<name>.err.log (stderr), replaced on each start.
  Registered at logon by scripts/register-local-mcp-task.ps1. Checked every session by scripts/agent-os/session-health.mjs.
#>
param(
    [switch]$Start,
    [switch]$Status,
    [switch]$Stop,
    [string]$ConfigFile = (Join-Path (Split-Path -Parent $PSScriptRoot) 'config\agent-os\local-services.json')
)

$ErrorActionPreference = 'Stop'
if (-not ($Start -or $Stop)) { $Status = $true }

$repo = Split-Path -Parent $PSScriptRoot
$config = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json

# The primary checkout is the parent of the ONE .git every worktree shares (same lookup as graphify-session-context.ps1).
$primary = $repo
$prev = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
$common = (& git -C $repo rev-parse --path-format=absolute --git-common-dir 2>$null | Out-String).Trim()
if ($LASTEXITCODE -eq 0 -and $common) { $primary = Split-Path -Parent $common }
$ErrorActionPreference = $prev

if (-not (@($config.hosts) | Where-Object { $_ -ieq $env:COMPUTERNAME })) {
    Write-Output "local MCP servers: not expected on host $env:COMPUTERNAME (config/agent-os/local-services.json hosts)"
    exit 0
}

# Same probe as session-health.mjs: a raw TCP connect accepts any listener, so ask the MCP service who it is.
$initBody = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"health","version":"1"}}}'
function Test-Mcp($server) {
    $url = "http://127.0.0.1:$($server.port)$($server.path)"
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $url -Body $initBody -ContentType 'application/json' `
            -Headers @{ Accept = 'application/json, text/event-stream' } -TimeoutSec 2
        # A pass-through answers with its upstream's name: `expect` names it; every other kind answers as itself.
        $kind = [regex]::Escape([string]$(if ($server.expect) { $server.expect } else { $server.kind }))
        if ($r.StatusCode -eq 200 -and [string]$r.Content -match "`"serverInfo`"\s*:\s*\{[^}]*`"name`"\s*:\s*`"$kind`"") { return 'UP' }
        return 'WRONG SERVICE'
    } catch {
        # An HTTP error status, a dropped connection or a non-HTTP reply means some other program answered; refused or
        # no answer in time means nothing is serving (DOWN), as in session-health.mjs.
        if ($_.Exception.Response) { return 'WRONG SERVICE' }
        $status = [string]$_.Exception.Status
        if ($status -eq 'ConnectFailure' -or $status -eq 'Timeout') { return 'DOWN' }
        return 'WRONG SERVICE'
    }
}

function Test-Port([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { return ($client.ConnectAsync('127.0.0.1', $Port).Wait(300) -and $client.Connected) }
    catch { return $false }
    finally { $client.Close() }
}

# PATH first, then the user bin dir pipx and uv install into: ~/.local/bin was not on PATH for older processes.
function Resolve-Bin([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    $local = Join-Path $env:USERPROFILE ".local\bin\$Name.exe"
    if (Test-Path $local) { return $local }
    return $null
}

# Returns @{ Bin; Args } or @{ Problem } for one server entry. Paths are quoted: -ArgumentList joins on spaces.
function Get-Launch($server) {
    switch ($server.kind) {
        'graphify' {
            $bin = Resolve-Bin 'graphify-mcp'
            if (-not $bin) { return @{ Problem = 'graphify-mcp not found on PATH or in ~/.local/bin; fix: pipx install "graphifyy[mcp,sql]==0.9.80"' } }
            $graph = Join-Path $primary 'graphify-out\graph.json'
            if (-not (Test-Path $graph)) { return @{ Problem = "no $graph yet: run scripts/graphify-sync-launcher.ps1 in the primary checkout first" } }
            return @{ Bin = $bin; Args = @('--transport', 'http', '--host', '127.0.0.1', '--port', "$($server.port)", '--path', $server.path, "`"$graph`"") }
        }
        'host-rewrite' {
            # Loopback pass-through that rewrites Host for `tailscale serve` (graphify's loopback bind answers 421 otherwise).
            $node = Resolve-Bin 'node'
            if (-not $node) { return @{ Problem = 'node not found on PATH' } }
            $script = Join-Path $repo 'scripts\tailnet-host-proxy.mjs'
            if (-not (Test-Path $script)) { return @{ Problem = "missing $script" } }
            if (-not $server.upstream) { return @{ Problem = "server '$($server.name)' has no upstream port in local-services.json" } }
            return @{ Bin = $node; Args = @("`"$script`"", '--listen', "$($server.port)", '--upstream', "$($server.upstream)") }
        }
        default { return @{ Problem = "unknown kind '$($server.kind)'" } }
    }
}

$logDir = Join-Path $env:LOCALAPPDATA 'nourcity'
$down = 0
foreach ($server in @($config.servers)) {
    $url = "http://127.0.0.1:$($server.port)$($server.path)"
    $pidFile = Join-Path $logDir "mcp-$($server.name).pid"

    if ($Stop) {
        if (-not (Test-Port $server.port)) { Write-Output "DOWN  $($server.name)  $url (nothing to stop)"; continue }
        $recorded = $null
        if (Test-Path $pidFile) { $recorded = [int]((Get-Content $pidFile -Raw).Trim()) }
        $owners = @(Get-NetTCPConnection -LocalPort $server.port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
        foreach ($owner in $owners) {
            # graphify-mcp.exe is a pipx shim: the LISTENING pid is a python.exe child whose command line names graphify.
            $p = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
            if (([string]$p.CommandLine -match 'graphify') -or ($owner -eq $recorded)) {
                Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
                Write-Output "STOPPED  $($server.name)  $url (pid $owner)"
            } else {
                $exe = if ($p.ExecutablePath) { $p.ExecutablePath } elseif ($p.Name) { $p.Name } else { '?' }
                Write-Output "REFUSED  $($server.name)  pid $owner is $exe, not graphify"
                $down++
            }
        }
        continue
    }

    $state = Test-Mcp $server
    if ($state -eq 'UP') { Write-Output "UP    $($server.name)  $url"; continue }
    if ($state -eq 'WRONG SERVICE') {
        Write-Output "WRONG SERVICE  $($server.name)  $url - another program holds port $($server.port): Get-NetTCPConnection -LocalPort $($server.port) -State Listen"
        if ($Start) { $down++ }
        continue
    }
    if (-not $Start) { Write-Output "DOWN  $($server.name)  $url"; continue }

    $launch = Get-Launch $server
    if ($launch.Problem) { Write-Output "DOWN  $($server.name)  $url - cannot start: $($launch.Problem)"; $down++; continue }
    New-Item -ItemType Directory -Force $logDir | Out-Null
    $log = Join-Path $logDir "mcp-$($server.name).log"
    $proc = Start-Process -FilePath $launch.Bin -ArgumentList $launch.Args -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $log -RedirectStandardError (Join-Path $logDir "mcp-$($server.name).err.log")
    Set-Content -Path $pidFile -Value $proc.Id -Encoding ASCII
    for ($i = 0; $i -lt 90 -and -not (Test-Port $server.port); $i++) {
        if ($proc.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    $state = Test-Mcp $server
    if ($state -eq 'UP') {
        Write-Output "UP    $($server.name)  $url (started pid $($proc.Id))"
    } else {
        $why = if ($proc.HasExited) { "exited $($proc.ExitCode)" } elseif ($state -eq 'WRONG SERVICE') { 'listening but not answering as graphify' } else { "pid $($proc.Id) still starting after 45 s" }
        # graphify 0.9.80 without the mcp extra exits at once: "HTTP transport needs the mcp extra".
        $errLog = Join-Path $logDir "mcp-$($server.name).err.log"
        if ($server.kind -eq 'graphify' -and (Test-Path $errLog) -and (Select-String -Path $errLog -Pattern 'mcp extra' -Quiet)) {
            $why += '; fix: pipx install "graphifyy[mcp,sql]==0.9.80" --force'
        }
        Write-Output "DOWN  $($server.name)  $url - $why; see $log and mcp-$($server.name).err.log"
        $down++
    }
}

if (($Start -or $Stop) -and $down -gt 0) { exit 1 }
exit 0

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

  -Status prints one UP/DOWN line per server. -Start starts each DOWN server hidden (a no-op for one already UP), waits
  up to 45 s for its port (graphify took about 21 s to listen on the 86k-node graph), and exits 1 if any server is still DOWN. -Stop stops the process listening on each port.
  "UP" means a TCP connect to 127.0.0.1:<port> succeeds within 300 ms.
  Logs: %LOCALAPPDATA%\nourcity\mcp-<name>.log (stdout) and mcp-<name>.err.log (stderr), replaced on each start.
  Registered at logon by scripts/register-local-mcp-task.ps1. Checked every session by scripts/agent-os/session-health.mjs.
#>
param(
    [switch]$Start,
    [switch]$Status,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
if (-not ($Start -or $Stop)) { $Status = $true }

$repo = Split-Path -Parent $PSScriptRoot
$config = Get-Content (Join-Path $repo 'config\agent-os\local-services.json') -Raw -Encoding UTF8 | ConvertFrom-Json

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
        default { return @{ Problem = "unknown kind '$($server.kind)'" } }
    }
}

$logDir = Join-Path $env:LOCALAPPDATA 'nourcity'
$down = 0
foreach ($server in @($config.servers)) {
    $url = "http://127.0.0.1:$($server.port)$($server.path)"
    $up = Test-Port $server.port

    if ($Stop) {
        if (-not $up) { Write-Output "DOWN  $($server.name)  $url (nothing to stop)"; continue }
        $owners = @(Get-NetTCPConnection -LocalPort $server.port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
        foreach ($owner in $owners) { Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue }
        Write-Output "STOPPED  $($server.name)  $url (pid $($owners -join ','))"
        continue
    }

    if ($up) { Write-Output "UP    $($server.name)  $url"; continue }
    if (-not $Start) { Write-Output "DOWN  $($server.name)  $url"; continue }

    $launch = Get-Launch $server
    if ($launch.Problem) { Write-Output "DOWN  $($server.name)  $url - cannot start: $($launch.Problem)"; $down++; continue }
    New-Item -ItemType Directory -Force $logDir | Out-Null
    $log = Join-Path $logDir "mcp-$($server.name).log"
    $proc = Start-Process -FilePath $launch.Bin -ArgumentList $launch.Args -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $log -RedirectStandardError (Join-Path $logDir "mcp-$($server.name).err.log")
    for ($i = 0; $i -lt 90 -and -not (Test-Port $server.port); $i++) {
        if ($proc.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    if (Test-Port $server.port) {
        Write-Output "UP    $($server.name)  $url (started pid $($proc.Id))"
    } else {
        $why = if ($proc.HasExited) { "exited $($proc.ExitCode)" } else { "pid $($proc.Id) still starting after 45 s" }
        # graphify 0.9.80 without the mcp extra exits at once: "HTTP transport needs the mcp extra".
        $errLog = Join-Path $logDir "mcp-$($server.name).err.log"
        if ($server.kind -eq 'graphify' -and (Test-Path $errLog) -and (Select-String -Path $errLog -Pattern 'mcp extra' -Quiet)) {
            $why += '; fix: pipx install "graphifyy[mcp,sql]==0.9.80" --force'
        }
        Write-Output "DOWN  $($server.name)  $url - $why; see $log and mcp-$($server.name).err.log"
        $down++
    }
}

if ($Start -and $down -gt 0) { exit 1 }
exit 0

<#
.SYNOPSIS
  Start the codebase-memory MCP filesystem server for NOURCITY.

.DESCRIPTION
  Launches the @anthropic/mcp-server-filesystem server pointed at the
  NOURCITY monorepo. This gives AI agents read-access to the codebase
  via the Model Context Protocol, enabling code-aware reasoning without
  manual file-by-file reading.

  The server runs on stdio (standard MCP transport) and is configured
  as an MCP server entry in the IDE or agent config.

.EXAMPLE
  # Start the server:
  powershell scripts/start-codebase-mcp.ps1

  # Or with a custom root:
  powershell scripts/start-codebase-mcp.ps1 -RepoRoot C:\path\to\repo

.PARAMETER RepoRoot
  Root directory to expose. Defaults to the NOURCITY monorepo root.

.PARAMETER AllowedDirs
  Additional directories to expose beyond the repo root.
  Default: apps/statenour, apps/nickstire, packages, docs
#>
param(
  [string]$RepoRoot = "",
  [string[]]$AllowedDirs = @()
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = Split-Path -Parent $PSScriptRoot
}

# Default allowed directories within the repo
$defaultDirs = @(
  (Join-Path $RepoRoot "apps/statenour"),
  (Join-Path $RepoRoot "apps/nickstire"),
  (Join-Path $RepoRoot "packages"),
  (Join-Path $RepoRoot "docs"),
  (Join-Path $RepoRoot "scripts")
)

$dirs = if ($AllowedDirs.Count -gt 0) { $AllowedDirs } else { $defaultDirs }

# Filter to only existing directories
$existingDirs = $dirs | Where-Object { Test-Path $_ }

if ($existingDirs.Count -eq 0) {
  Write-Host "[codebase-mcp] ERROR: No valid directories found to expose." -ForegroundColor Red
  exit 1
}

Write-Host "[codebase-mcp] Starting MCP filesystem server..." -ForegroundColor Cyan
Write-Host "[codebase-mcp] Repo root: $RepoRoot" -ForegroundColor Gray
Write-Host "[codebase-mcp] Exposed directories:" -ForegroundColor Gray
foreach ($d in $existingDirs) {
  Write-Host "  - $d" -ForegroundColor Gray
}

# Check if the MCP filesystem server is installed
$npxCmd = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npxCmd) {
  Write-Host "[codebase-mcp] ERROR: npx not found. Install Node.js first." -ForegroundColor Red
  exit 1
}

# Launch the server via npx
# @modelcontextprotocol/server-filesystem is the official MCP filesystem server
$args_list = @("-y", "@modelcontextprotocol/server-filesystem") + $existingDirs

Write-Host "[codebase-mcp] Running: npx $($args_list -join ' ')" -ForegroundColor DarkGray
& npx @args_list

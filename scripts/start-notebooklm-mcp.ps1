param(
    [int]$Port = 3003
)

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   NOUR OS - Local NotebookLM MCP Sidecar & Tunnel Setup" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
if (!(Get-Command "npx" -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not installed. Please install Node.js first." -ForegroundColor Red
    exit 1
}

Write-Host "[1/3] Authenticating with Google NotebookLM..." -ForegroundColor Yellow
Write-Host "This will open a browser to save your Google session cookies locally." -ForegroundColor Gray
Write-Host "Only run this if it's your first time or your session expired." -ForegroundColor Gray
$response = Read-Host "Run authentication now? (y/N)"
if ($response -eq 'y') {
    Write-Host "Running: npx notebooklm-mcp-auth..." -ForegroundColor Cyan
    npx -y --package=notebooklm-mcp-server notebooklm-mcp-auth
}

Write-Host ""
Write-Host "[2/3] Starting NotebookLM MCP Server on port $Port..." -ForegroundColor Yellow
Write-Host "(Press Ctrl+C at any time to stop both the server and the tunnel)" -ForegroundColor Gray
Write-Host ""

# Use mcp-proxy to wrap the stdio server and expose an SSE endpoint
$mcpProcess = Start-Process -NoNewWindow -PassThru -FilePath "cmd.exe" -ArgumentList "/c npx -y mcp-proxy --port $Port --shell -- npx -y --package=notebooklm-mcp-server notebooklm-mcp-server"
Start-Sleep -Seconds 3

if ($mcpProcess.HasExited) {
    Write-Host "[ERROR] MCP Server failed to start. Check the logs above." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[3/3] Establishing Cloud Tunnel..." -ForegroundColor Yellow
Write-Host "Using localtunnel to expose port $Port to the internet..." -ForegroundColor Gray

# Use localtunnel to expose the port. We capture the URL it generates.
# localtunnel prints "your url is: https://something.loca.lt"
Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "                    SYSTEM ONLINE" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "1. Wait for the localtunnel URL to appear below." -ForegroundColor White
Write-Host "2. Copy the URL and append '/sse' to it." -ForegroundColor White
Write-Host "3. Go to Railway -> statenour -> Variables." -ForegroundColor White
Write-Host "4. Add/Update: NOTEBOOKLM_MCP_URL = <YOUR_URL>/sse" -ForegroundColor White
Write-Host "5. Redeploy Railway." -ForegroundColor White
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""

try {
    npx localtunnel --port $Port
} finally {
    Write-Host "`nShutting down NotebookLM MCP server..." -ForegroundColor Yellow
    Stop-Process -Id $mcpProcess.Id -Force -ErrorAction SilentlyContinue
}

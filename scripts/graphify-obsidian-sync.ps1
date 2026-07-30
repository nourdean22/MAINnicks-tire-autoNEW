# graphify-obsidian-sync.ps1 - refresh the code knowledge graph, then
# regenerate the Obsidian vault digests from it. Safe to run on a
# schedule: graphify update is incremental (AST-only, no LLM), the
# python step backs up the previous vault export before replacing it,
# and everything appends to graphify-out/obsidian-sync.log.
#
# Usage: powershell -File scripts/graphify-obsidian-sync.ps1
param(
    [string]$RepoRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = "Continue"
$log = Join-Path $RepoRoot "graphify-out\obsidian-sync.log"
New-Item -ItemType Directory -Force (Split-Path $log -Parent) | Out-Null

function Log($msg) {
    "[$(Get-Date -Format o)] $msg" | Add-Content -Path $log
}

Log "=== sync start (repo: $RepoRoot) ==="
Set-Location $RepoRoot

# graphify skips graph.html above 5,000 nodes by default; this repo is ~46k.
# Headroom over current size without being unbounded - the full node-level
# render is ~43 MB at 46k nodes and grows roughly linearly. graph.html is
# gitignored and overwritten each run (the daily graphify-out/<date>/ backup
# copies only graph.json + report + labels + manifest, never the HTML).
$env:GRAPHIFY_VIZ_NODE_LIMIT = "60000"

# Use the interpreter that OWNS the graphify the CLI runs. `graphify update`
# (step 1) executes from a uv-managed tool venv, but the .graphify_python marker
# points at a system interpreter whose site-packages holds a SEPARATE, older
# graphify. Step 1 was building graph.json with 0.9.8 while step 2 rendered it
# with 0.9.6 - harmless today, but a graph.json schema change on any
# `uv tool upgrade graphifyy` would break the render or, worse, render it wrong.
# Resolve the venv first; fall back to the old marker path if uv is absent.
$py = $null
$uvToolDir = (& uv tool dir 2>$null | Out-String).Trim()
if ($uvToolDir) {
    $uvPython = Join-Path $uvToolDir "graphifyy\Scripts\python.exe"
    if (Test-Path $uvPython) { $py = $uvPython }
}
if (-not $py) {
    $pyMarker = Join-Path $RepoRoot "graphify-out\.graphify_python"
    $py = if (Test-Path $pyMarker) { (Get-Content $pyMarker -Raw).Trim() } else { "python" }
    Log "WARN: uv graphifyy venv not found - falling back to $py (may differ from the CLI's graphify version)"
}
Log "python for render/digest steps: $py"

# 1. Incremental graph update (tree-sitter AST, no LLM, no API keys).
graphify update . 2>&1 | Add-Content -Path $log
if ($LASTEXITCODE -ne 0) {
    Log "ERROR: graphify update exited $LASTEXITCODE - aborting before vault write"
    exit 1
}

# 2. Aggregated community-level graph.html (~2.3k nodes, ~2 MB) alongside the
#    full render. The full one is the whole graph and heavy; this one is the
#    browsable overview. Non-fatal: core outputs already landed by this point.
& $py (Join-Path $RepoRoot "scripts\graphify-render-communities.py") 2>&1 | Add-Content -Path $log
if ($LASTEXITCODE -ne 0) {
    Log "WARN: community render exited $LASTEXITCODE - continuing (graph.json + report are already written)"
}

# 3. Regenerate the Obsidian community digests from the fresh graph.
& $py (Join-Path $RepoRoot "scripts\graphify-obsidian-sync.py") 2>&1 | Add-Content -Path $log
if ($LASTEXITCODE -ne 0) {
    Log "ERROR: obsidian sync exited $LASTEXITCODE"
    exit 1
}

Log "=== sync done ==="

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
# render is ~43 MB at 46k nodes and grows roughly linearly, so 100k implies a
# ~92 MB ceiling. graph.html is gitignored and overwritten each run (the daily
# graphify-out/<date>/ backup copies only graph.json + report + labels +
# manifest, never the HTML). Note the full render is already NOT interactive at
# 46k (~344 s load, ~2,205 ms redraw) - graph-communities.html is the usable
# view and is unaffected by this limit.
$env:GRAPHIFY_VIZ_NODE_LIMIT = "100000"

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

# 1.5. Refresh community NAMES with the LLM.
#
# WHY THIS EXISTS. `graphify update` re-clusters but never relabels. When the
# community set shifts it renames every drifted community after its
# highest-degree hub, so curated plain-language names rot into raw symbols.
# Measured 2026-08-11: 2,499 of 2,565 communities had degraded that way, and the
# vault digests were named after them - ".error.md", "cached.md", "App.tsx.md",
# "AGENTS.md.md". The digests' CONTENT stays correct; what dies is the ability to
# find anything by name, which is most of the vault's value.
#
# Runs BEFORE steps 2 and 3 because both consume the labels: the community render
# titles its nodes from them, and the vault write derives digest filenames.
#
# NOT --missing-only. That flag reuses existing labels keyed by community id
# (graphify/cli.py), but ids are unseeded and reshuffle on every re-cluster, so it
# would paste yesterday's names onto today's entirely different communities -
# silently wrong, which is worse than the drift it would be papering over.
#
# NON-FATAL BY DESIGN. The backend is Ollama Cloud, found down, signed-out and
# 403ing on three separate occasions on 2026-08-11 alone. A cosmetic naming step
# must never cost the daily graph + vault refresh, so every failure path here logs
# and continues; graphify keeps its deterministic hub labels when labeling fails,
# which is exactly the pre-existing behaviour.
$labelBackend = if ($env:GRAPHIFY_LABEL_BACKEND) { $env:GRAPHIFY_LABEL_BACKEND } else { "ollama" }
$labelModel   = if ($env:GRAPHIFY_LABEL_MODEL)   { $env:GRAPHIFY_LABEL_MODEL }   else { "glm-5.2:cloud" }
Log "labeling communities via $labelBackend/$labelModel"
$labelOut = graphify label . --backend=$labelBackend --model=$labelModel 2>&1
$labelOut | Add-Content -Path $log
if ($LASTEXITCODE -ne 0) {
    Log "WARN: graphify label exited $LASTEXITCODE - continuing with hub-derived names"
} elseif ($labelOut -match 'community labeling failed|no LLM backend configured') {
    # `graphify label` exits 0 even when EVERY batch fails, so the exit code alone
    # cannot tell a real relabel from a silent no-op. Measured 2026-08-11: all 26
    # batches failed on a missing 'openai' package and it still returned 0. Match
    # the message so a dead backend is visible in the log instead of looking green.
    Log "WARN: labeling produced no LLM names (backend unavailable) - hub-derived names retained"
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

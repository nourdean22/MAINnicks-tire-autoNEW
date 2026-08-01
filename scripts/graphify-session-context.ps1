<#
  Emits a compact code-graph briefing at Claude Code session start.

  Pulls three sections out of graphify-out/GRAPH_REPORT.md (the one graphify
  artifact that is committed - see .gitignore's "!graphify-out/GRAPH_REPORT.md")
  and prints them with a staleness verdict.

  Sections are located by HEADING, never by line number: the report is
  regenerated daily and the community nav list above these sections grows with
  the community count, so fixed offsets silently drift onto the wrong content.

  "Surprising Connections" is deliberately excluded - it is the INFERRED tier
  (~0.7 confidence) and in practice is dominated by cross-language name
  collisions (a Python test class "using" a TypeScript symbol).

  Exits 0 and prints nothing when the report is absent (fresh clone, CI) so the
  hook can never block a session from starting.
#>

$ErrorActionPreference = 'Stop'

# How many commits behind HEAD before the graph is called stale. The graph is
# rebuilt by a daily scheduled task, so a handful of commits behind is normal;
# raise this if you commit in bursts and find the warning noisy.
$StaleCommitThreshold = 25

try {
    $repo = Split-Path -Parent $PSScriptRoot
    $report = Join-Path $repo 'graphify-out\GRAPH_REPORT.md'
    if (-not (Test-Path $report)) { exit 0 }

    # The report is UTF-8 and full of middots. Windows PowerShell 5.1 defaults to
    # ANSI on both read and write, which turns them into mojibake; pin both ends.
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $lines = Get-Content $report -Encoding UTF8

    # Grab everything under a heading up to the next heading of the same level.
    function Get-Section {
        param([string[]]$Lines, [string]$StartsWith, [int]$MaxLines = 40)
        $start = -1
        for ($i = 0; $i -lt $Lines.Count; $i++) {
            if ($Lines[$i].StartsWith($StartsWith)) { $start = $i; break }
        }
        if ($start -lt 0) { return @() }
        $out = @($Lines[$start])
        for ($i = $start + 1; $i -lt $Lines.Count -and $out.Count -lt $MaxLines; $i++) {
            if ($Lines[$i] -match '^## ') { break }
            $out += $Lines[$i]
        }
        return $out
    }

    # Summary only. God Nodes and Import Cycles are deliberately NOT emitted:
    #   - God Nodes ranks by degree, and doc headings are graph nodes too, so the
    #     list mixes markdown sections in with code symbols (the #1 entry is an H2
    #     from apps/statenour/docs/audits/api-readiness-2026-05-12.md). Misleading
    #     without a caveat longer than the list.
    #   - Import Cycles is a fix-it list, i.e. an action item. Action items belong
    #     in a task, not in the preamble of every session including trivial ones.
    # Both stay one grep away; see the drill-down line below.
    $summary = Get-Section -Lines $lines -StartsWith '## Summary' -MaxLines 8

    # Native git writes progress/errors to stderr, and under EAP=Stop those become
    # thrown exceptions - which would hit the outer catch and silently kill the whole
    # briefing on the exact failure this staleness check exists to report. Run git
    # with errors suppressed and branch on $LASTEXITCODE instead.
    function Invoke-Git {
        param([string[]]$GitArgs)
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'SilentlyContinue'
        try { $out = (& git @GitArgs 2>$null | Out-String).Trim(); return @{ Ok = ($LASTEXITCODE -eq 0); Out = $out } }
        finally { $ErrorActionPreference = $prev }
    }

    # Staleness: the report records the commit it was built from.
    $builtFrom = $null
    foreach ($l in $lines) {
        if ($l -match 'Built from commit:\s*`([0-9a-f]+)`') { $builtFrom = $Matches[1]; break }
    }

    $verdict = 'graph freshness: unknown (no build commit in report)'
    if ($builtFrom) {
        $head = Invoke-Git @('-C', $repo, 'rev-parse', 'HEAD')
        if ($head.Ok -and $head.Out) {
            if ($head.Out.StartsWith($builtFrom)) {
                $verdict = "graph freshness: CURRENT (built from HEAD $builtFrom)"
            } else {
                # Count commits added since the graph was built. Fails closed:
                # an unreachable commit (rebased/squashed away) reads as stale.
                $behind = Invoke-Git @('-C', $repo, 'rev-list', '--count', "$builtFrom..HEAD")
                if ($behind.Ok -and $behind.Out -match '^\d+$') {
                    $n = [int]$behind.Out
                    $state = if ($n -gt $StaleCommitThreshold) { 'STALE' } else { 'ok' }
                    $verdict = "graph freshness: $state - built from $builtFrom, HEAD is $n commit(s) ahead"
                } else {
                    $verdict = "graph freshness: STALE - built from $builtFrom, which is not an ancestor of HEAD (rebased or squashed away); rerun scripts/graphify-obsidian-sync.ps1"
                }
            }
        }
    }

    Write-Output '=== CODE GRAPH (graphify) ==='
    Write-Output $verdict
    if ($summary) { $summary | Where-Object { $_ -match '^- ' } | Select-Object -First 1 | Write-Output }
    Write-Output 'Query: grep a symbol in graphify-out/GRAPH_REPORT.md to find its community + neighbours (638 KB - never read whole). Sections: God Nodes, Import Cycles, Communities.'
    Write-Output 'Per-community digests (~3 KB each) in the Obsidian vault under "NOURCITY Codebase Graph/".'
    Write-Output 'Caveat: markdown headings are graph nodes too, so degree ranks mix doc sections with code symbols. Community IDs are unseeded and reshuffle between runs - do not cite a community number across sessions.'
}
catch {
    # Never block session startup - but say so out loud. A briefing that vanishes
    # on error is indistinguishable from one that had nothing to report.
    Write-Output "=== CODE GRAPH (graphify) ==="
    Write-Output "briefing unavailable: $($_.Exception.Message)"
    exit 0
}

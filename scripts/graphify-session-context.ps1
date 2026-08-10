<#
  Emits a compact code-graph briefing at Claude Code session start.

  Reads graphify-out/GRAPH_REPORT.md - preferring the PRIMARY checkout's copy
  over the local one, newest mtime wins - and prints it with a staleness verdict.

  Why reach across to the primary: GRAPH_REPORT.md is the single graphify
  artifact git tracks (see .gitignore's "!graphify-out/GRAPH_REPORT.md"), so a
  worktree checks out whatever was last COMMITTED, while the scheduled rebuild
  only ever refreshes the primary checkout's WORKING copy. Reading across is
  what keeps every session on the newest graph without a commit step at all.
  Measured 2026-08-03: the committed copy was 87 commits behind HEAD, the
  primary's live copy 14.

  Sections are located by HEADING, never by line number: the report is
  regenerated weekly and the community nav list above these sections grows with
  the community count, so fixed offsets silently drift onto the wrong content.

  "Surprising Connections" is deliberately excluded - it is the INFERRED tier
  (~0.7 confidence) and in practice is dominated by cross-language name
  collisions (a Python test class "using" a TypeScript symbol).

  Exits 0 and prints nothing when the report is absent (fresh clone, CI) so the
  hook can never block a session from starting.
#>

$ErrorActionPreference = 'Stop'

# How many commits behind HEAD before the graph is called stale. The graph is
# rebuilt by the weekly "NOURCITY-Graphify-Sync" scheduled task, so a run of
# commits behind is normal; raise this if you merge in bursts and find the
# warning noisy.
$StaleCommitThreshold = 25

try {
    $repo = Split-Path -Parent $PSScriptRoot

    # Native git writes progress/errors to stderr, and under EAP=Stop those become
    # thrown exceptions - which would hit the outer catch and kill the whole
    # briefing on the exact failure this staleness check exists to report. Run git
    # with errors suppressed and branch on $LASTEXITCODE instead.
    #
    # The catch is NOT redundant with EAP=SilentlyContinue: a missing git raises
    # CommandNotFoundException at command-RESOLUTION time, which is terminating no
    # matter what EAP says, so it unwinds straight past the preference to the outer
    # catch. Verified by running with git off PATH - without this, the node/edge
    # counts (which need no git at all) were lost to "briefing unavailable".
    function Invoke-Git {
        param([string[]]$GitArgs)
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'SilentlyContinue'
        try { $out = (& git @GitArgs 2>$null | Out-String).Trim(); return @{ Ok = ($LASTEXITCODE -eq 0); Out = $out } }
        catch { return @{ Ok = $false; Out = '' } }
        finally { $ErrorActionPreference = $prev }
    }

    # Prefer the primary checkout's copy - see the header for why. --git-common-dir
    # resolves to the ONE .git shared by every worktree, so its parent is the primary
    # root from wherever this runs; --path-format=absolute (git 2.31+) stops it
    # returning a bare relative ".git" when run in the primary itself. Newest mtime
    # wins, so a rebuild run inside a worktree still beats a staler primary. Any
    # failure here simply leaves the local copy selected.
    $report = Join-Path $repo 'graphify-out\GRAPH_REPORT.md'
    $via = ''
    $common = Invoke-Git @('-C', $repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    if ($common.Ok -and $common.Out) {
        $primaryReport = Join-Path (Split-Path -Parent $common.Out) 'graphify-out\GRAPH_REPORT.md'

        # mtime ALONE picks the wrong copy in a fresh worktree - which is where
        # most sessions now run. `git checkout` stamps the committed artifact
        # with the checkout time, so a worktree created at 09:41 always looks
        # newer than the primary working copy the scheduled rebuild wrote at
        # 07:33, while being by construction the OLDER graph. Measured
        # 2026-08-10 in a harness worktree: the local copy said "built from
        # 75439362" (Aug 7, 47,208 nodes) and won the mtime race against the
        # primary's ea9e05aa (Aug 9, 47,796) sitting on disk - so the briefing
        # served a two-day-old graph and labelled it authoritative. Silent: the
        # numbers look plausible and no staleness signal fires.
        #
        # Fix: in a worktree, an UNMODIFIED report IS the committed artifact,
        # so prefer the primary regardless of mtime. Only a dirty local copy
        # (someone ran a rebuild inside this worktree) falls back to the mtime
        # race, which preserves the documented "a rebuild run inside a worktree
        # still beats a staler primary" case. In the primary itself $inWorktree
        # is false and this whole branch behaves exactly as before.
        $gitDir = Invoke-Git @('-C', $repo, 'rev-parse', '--path-format=absolute', '--git-dir')
        $inWorktree = $gitDir.Ok -and ($gitDir.Out -ne $common.Out)
        $localState = Invoke-Git @('-C', $repo, 'status', '--porcelain', '--', 'graphify-out/GRAPH_REPORT.md')
        $localIsCommittedCopy = $inWorktree -and $localState.Ok -and -not $localState.Out

        if ((Test-Path $primaryReport) -and (
                -not (Test-Path $report) -or
                $localIsCommittedCopy -or
                (Get-Item $primaryReport).LastWriteTime -gt (Get-Item $report).LastWriteTime)) {
            $report = $primaryReport
            $via = ' [via primary checkout]'
        }
    }
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

    # Staleness: the report records the commit it was built from.
    $builtFrom = $null
    foreach ($l in $lines) {
        if ($l -match 'Built from commit:\s*`([0-9a-f]+)`') { $builtFrom = $Matches[1]; break }
    }

    $verdict = 'graph freshness: unknown (no build commit in report)'
    if ($builtFrom) {
        # Distinct from the no-build-commit case above: we know what it was built
        # from, git just could not tell us how far HEAD has moved since.
        $verdict = "graph freshness: unknown (built from $builtFrom; git unavailable to compare)"
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
    Write-Output ($verdict + $via)
    if ($summary) { $summary | Where-Object { $_ -match '^- ' } | Select-Object -First 1 | Write-Output }
    # Point grep at the file this briefing actually DESCRIBES. When the primary's
    # copy won, a worktree's own graphify-out/GRAPH_REPORT.md is the stale committed
    # one - naming the relative path there would send every lookup to a different
    # graph than the numbers above. Size is read live; it was hardcoded at 638 KB
    # and had already drifted.
    $kb = [int]((Get-Item $report).Length / 1KB)
    $grepTarget = if ($via) { $report } else { 'graphify-out/GRAPH_REPORT.md' }
    Write-Output "Query: grep a symbol in $grepTarget to find its community + neighbours ($kb KB - never read whole). Sections: God Nodes, Import Cycles, Communities."
    Write-Output 'Per-community digests (~3 KB each) in the Obsidian vault under "NOURCITY Codebase Graph/".'
    Write-Output 'Caveat: markdown headings are graph nodes too, so degree ranks mix doc sections with code symbols. Community IDs are unseeded and reshuffle between runs - do not cite a community number across sessions.'

    # --- Session-ledger freshness -------------------------------------------
    # apps/<app>/.remember/now.md is the five-field "what are we doing right now"
    # ledger that AGENTS.md, AGENT-OPERATING-PROFILE.md, AGENT-CONTEXT.md and the
    # ciitty skill all route agents into ("check it BEFORE touching that app").
    # Nothing ever checked whether it was current: statenour's went 114 days without
    # an update (2026-04-18 -> 2026-08-10) and in that window asserted "Active branch:
    # main / single push to main is the deploy" - inverting the repo's hardest safety
    # rule - and that /decisions had been deleted, while the page is 634 lines and live.
    # A ledger cannot rot silently once it announces its own age; that is the entire
    # mechanism, and it is the same one the graph verdict above uses.
    #
    # Age comes from the "Updated: YYYY-MM-DD" line INSIDE the file, never mtime:
    # a worktree checkout stamps every file with the checkout time, so mtime reports
    # a four-month-old ledger as seconds old - the exact trap that made this script
    # serve a two-day-stale graph (see the tiebreak comment above).
    #
    # Own try/catch: a ledger problem must never cost the graph briefing already
    # printed above, and the outer catch replaces the whole output with one line.
    try {
        foreach ($ledger in @(Get-ChildItem -Path (Join-Path $repo 'apps\*\.remember\now.md') -ErrorAction SilentlyContinue)) {
            $app = Split-Path (Split-Path (Split-Path $ledger.FullName -Parent) -Parent) -Leaf
            $stamp = Select-String -Path $ledger.FullName -Pattern 'Updated:\s*(\d{4}-\d{2}-\d{2})' -Encoding UTF8 |
                Select-Object -First 1
            if (-not $stamp) {
                Write-Output "session ledger apps/$app/.remember/now.md: UNDATED - add an 'Updated: YYYY-MM-DD' line so staleness is detectable."
                continue
            }
            $parsed = [datetime]::MinValue
            if (-not [datetime]::TryParseExact(
                    $stamp.Matches[0].Groups[1].Value, 'yyyy-MM-dd', $null, 'None', [ref]$parsed)) {
                Write-Output "session ledger apps/$app/.remember/now.md: unparseable Updated: stamp."
                continue
            }
            $days = [int]((Get-Date).Date - $parsed.Date).TotalDays
            if ($days -gt 14) {
                Write-Output "session ledger apps/$app/.remember/now.md: STALE - $days days since last update. Treat its claims as unverified and re-derive from source."
            } else {
                Write-Output "session ledger apps/$app/.remember/now.md: $days day(s) old - read it for objective / last decision / blocker / next action."
            }
        }
    }
    catch {
        Write-Output "session ledger: check unavailable ($($_.Exception.Message))"
    }
}
catch {
    # Never block session startup - but say so out loud. A briefing that vanishes
    # on error is indistinguishable from one that had nothing to report.
    Write-Output "=== CODE GRAPH (graphify) ==="
    Write-Output "briefing unavailable: $($_.Exception.Message)"
    exit 0
}

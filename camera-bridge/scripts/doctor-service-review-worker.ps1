<#
.SYNOPSIS
Diagnose the offline outside-service review worker without changing anything.
#>
[CmdletBinding()]
param(
    [string]$TaskName = "NickOutsideServiceReview",
    [string]$PythonPath = "",
    [string]$CasesDir = ""
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
if (-not $CasesDir) { $CasesDir = Join-Path $root "data\hard-cases" }
if (-not $PythonPath) { $PythonPath = Join-Path $root ".venv-service-review\Scripts\python.exe" }
$fails = 0
$warns = 0

function Check($name, $state, $detail) {
    $color = switch ($state) { "PASS" { "Green" } "WARN" { "Yellow" } default { "Red" } }
    Write-Host ("  {0} {1}  {2}" -f $name.PadRight(24), $state.PadRight(4), $detail) -ForegroundColor $color
    if ($state -eq "FAIL") { $script:fails++ }
    if ($state -eq "WARN") { $script:warns++ }
}

Write-Host ""
Write-Host "Nick Outside-Service Review -- doctor" -ForegroundColor Cyan
Write-Host ""

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Check "scheduled task" "FAIL" "'$TaskName' is not registered"
} else {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    Check "scheduled task" "PASS" "$($task.State); last=$($info.LastRunTime); result=$($info.LastTaskResult)"
    if ([string]$task.Settings.MultipleInstances -eq "IgnoreNew") {
        Check "overlap guard" "PASS" "MultipleInstances=IgnoreNew"
    } else {
        Check "overlap guard" "FAIL" "MultipleInstances=$($task.Settings.MultipleInstances); heavy runs may overlap"
    }
    if ([int]$task.Settings.Priority -ge 7) {
        Check "task priority" "PASS" "$($task.Settings.Priority)"
    } else {
        Check "task priority" "WARN" "$($task.Settings.Priority) -- reviewer is not in the background-friendly range"
    }
}

$taskSlug = ($TaskName -replace '[^A-Za-z0-9._-]', '_')
$wrapper = Join-Path $root ("service-review-task-" + $taskSlug + ".cmd")
if (-not (Test-Path $wrapper)) {
    Check "wrapper" "FAIL" "$wrapper missing"
} else {
    $body = Get-Content $wrapper -Raw
    if ($body -match "--force") {
        Check "idempotency" "FAIL" "installed wrapper contains --force"
    } else {
        Check "idempotency" "PASS" "no --force; successful analyzer receipts are skipped"
    }
    if ($body -match "vision\.service_review_worker") {
        Check "worker command" "PASS" "real service_review_worker is on the installed command line"
    } else {
        Check "worker command" "FAIL" "wrapper does not call vision.service_review_worker"
    }
}

if (-not (Test-Path $PythonPath)) {
    Check "review python" "FAIL" "$PythonPath missing"
} else {
    $probe = & $PythonPath -c "import torch,transformers; from PIL import Image; from vision.service_review_worker import MODEL_ID,MODEL_REVISION; print(torch.__version__+'|'+transformers.__version__+'|'+MODEL_ID+'@'+MODEL_REVISION)" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Check "review python" "PASS" (($probe | Select-Object -Last 1) -join "")
    } else {
        Check "review python" "FAIL" (($probe | Select-Object -Last 1) -join "")
    }
}

if (-not (Test-Path $CasesDir)) {
    Check "hard-case corpus" "WARN" "$CasesDir does not exist yet"
} else {
    $caseFiles = @(Get-ChildItem $CasesDir -Filter case.json -File -Recurse -ErrorAction SilentlyContinue)
    $reviewCases = 0
    $receipts = 0
    $errors = 0
    foreach ($case in $caseFiles) {
        try {
            $meta = Get-Content $case.FullName -Raw | ConvertFrom-Json
            if ($meta.reason -ne "NO_BAY_ACTIVITY_REVIEW") { continue }
            $reviewCases++
            $receipt = Join-Path $case.DirectoryName "service-review.json"
            if (Test-Path $receipt) {
                $receipts++
                try {
                    $r = Get-Content $receipt -Raw | ConvertFrom-Json
                    if ($r.status -eq "error") { $errors++ }
                } catch { $errors++ }
            }
        } catch {}
    }
    $pending = [math]::Max(0, $reviewCases - $receipts)
    Check "review corpus" "PASS" "$reviewCases no-bay case(s); $receipts receipt(s); $pending pending"
    if ($errors -gt 0) {
        Check "review errors" "WARN" "$errors case-local error receipt(s); retryable on the next run"
    } else {
        Check "review errors" "PASS" "none"
    }
}

$ledger = Join-Path $CasesDir "service-evidence.jsonl"
if (-not (Test-Path $ledger)) {
    Check "shadow ledger" "PASS" "none yet; zero candidates and missing output are distinct from task health above"
} else {
    $lines = @(Get-Content $ledger -ErrorAction SilentlyContinue | Where-Object { $_.Trim() })
    $badAuthority = 0
    foreach ($line in $lines) {
        try {
            $row = $line | ConvertFrom-Json
            if ($row.authority -ne "shadow_only") { $badAuthority++ }
        } catch { $badAuthority++ }
    }
    if ($badAuthority -gt 0) {
        Check "shadow ledger" "FAIL" "$badAuthority row(s) are malformed or violate authority=shadow_only"
    } else {
        Check "shadow ledger" "PASS" "$($lines.Count) candidate row(s), all shadow_only"
    }
}

Write-Host ""
if ($fails -gt 0) { Write-Host "$fails FAIL, $warns WARN" -ForegroundColor Red }
elseif ($warns -gt 0) { Write-Host "0 FAIL, $warns WARN" -ForegroundColor Yellow }
else { Write-Host "All checks passed." -ForegroundColor Green }
Write-Host ""
exit $fails

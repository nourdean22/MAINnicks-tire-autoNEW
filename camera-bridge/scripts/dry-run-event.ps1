<#
.SYNOPSIS
    Publish a realistic Frigate 0.17 visit (new/update/end + an lpr tracked_object_update) to MQTT,
    or write the same sequence as JSONL for `python -m visitd.main --replay`.
.DESCRIPTION
    With mosquitto_pub on PATH (and -ForceJsonl absent) the messages are published live, paced by the
    real gaps divided by -Speed. Without it, a JSONL file is written and the replay command printed.
    Expected visitd outcome: ENTERED_ZONE -> ARRIVAL_CANDIDATE -> CONFIRMED_ARRIVAL (stationary) -> LEFT, plate CONFIRMED.
.EXAMPLE
    powershell -File scripts/dry-run-event.ps1 -Speed 10
    powershell -File scripts/dry-run-event.ps1 -ForceJsonl -OutFile data/dry-run.jsonl
#>
[CmdletBinding()]
param(
    [string]$Broker = "127.0.0.1",
    [int]$Port = 1883,
    [string]$Username = $env:MQTT_USERNAME,
    [string]$Password = $env:MQTT_PASSWORD,
    [string]$Camera = "lot",
    [string]$Zone = "front_lot",
    [string]$Plate = "ABC1234",
    [string]$OutFile = "",
    [double]$Speed = 1.0,
    [switch]$ForceJsonl
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$t0 = [math]::Round(([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0), 3)
$trackId = "$t0-dryrun"

function New-ObjectBlock {
    param([double]$Frame, [string[]]$Zones, [int[]]$Box, [bool]$Stationary, [double]$End, [string]$PlateText, [double]$PlateScore, [double]$Score)
    $block = [ordered]@{
        id = $trackId; camera = $Camera; frame_time = $Frame; snapshot = $null; label = "car"; sub_label = $null
        top_score = [math]::Max($Score, 0.9); false_positive = $false; start_time = $t0
        end_time = $(if ($End -gt 0) { $End } else { $null }); score = $Score
        box = $Box; area = (($Box[2] - $Box[0]) * ($Box[3] - $Box[1])); ratio = 1.36
        region = @(($Box[0] - 100), ($Box[1] - 100), ($Box[2] + 100), ($Box[3] + 100))   # comma binds tighter than minus
        active = (-not $Stationary); stationary = $Stationary; motionless_count = $(if ($Stationary) { 60 } else { 0 })
        position_changes = 1; current_zones = $Zones; entered_zones = $(if ($Zones.Count -gt 0) { $Zones } else { @($Zone) })
        has_clip = $true; has_snapshot = $true; attributes = @{}; current_attributes = @()
        recognized_license_plate = $(if ($PlateText) { $PlateText } else { $null })
        recognized_license_plate_score = $(if ($PlateText) { $PlateScore } else { $null })
    }
    return $block
}

$box = @(400, 300, 700, 520)
$a0 = New-ObjectBlock -Frame $t0 -Zones @() -Box $box -Stationary $false -End 0 -PlateText "" -PlateScore 0 -Score 0.72
$a1 = New-ObjectBlock -Frame ($t0 + 0.6) -Zones @($Zone) -Box $box -Stationary $false -End 0 -PlateText "" -PlateScore 0 -Score 0.8
$a2 = New-ObjectBlock -Frame ($t0 + 12.0) -Zones @($Zone) -Box $box -Stationary $true -End 0 -PlateText "" -PlateScore 0 -Score 0.87
$a3 = New-ObjectBlock -Frame ($t0 + 47.0) -Zones @($Zone) -Box $box -Stationary $true -End 0 -PlateText $Plate -PlateScore 0.93 -Score 0.87
$a4 = New-ObjectBlock -Frame ($t0 + 60.0) -Zones @() -Box @(900, 340, 1180, 560) -Stationary $false -End 0 -PlateText $Plate -PlateScore 0.93 -Score 0.8
$a5 = New-ObjectBlock -Frame ($t0 + 63.0) -Zones @() -Box @(1100, 380, 1280, 580) -Stationary $false -End ($t0 + 63.0) -PlateText $Plate -PlateScore 0.93 -Score 0.8

# (delay before send in seconds, topic, payload)
$sequence = @(
    @(0.0,  "frigate/events", [ordered]@{ type = "new";    before = @{}; after = $a0 }),
    @(0.6,  "frigate/events", [ordered]@{ type = "update"; before = $a0; after = $a1 }),
    @(11.4, "frigate/events", [ordered]@{ type = "update"; before = $a1; after = $a2 }),
    @(1.0,  "frigate/tracked_object_update", [ordered]@{ type = "lpr"; id = $trackId; plate = $Plate; score = 0.95; camera = $Camera; timestamp = ($t0 + 13.0) }),
    @(34.0, "frigate/events", [ordered]@{ type = "update"; before = $a2; after = $a3 }),
    @(13.0, "frigate/events", [ordered]@{ type = "update"; before = $a3; after = $a4 }),
    @(3.0,  "frigate/events", [ordered]@{ type = "end";    before = $a4; after = $a5 })
)

$hasPub = [bool](Get-Command mosquitto_pub -ErrorAction SilentlyContinue)
if ($hasPub -and -not $ForceJsonl) {
    Write-Host "Publishing $($sequence.Count) messages to $Broker`:$Port (speed x$Speed), track $trackId" -ForegroundColor Cyan
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        foreach ($step in $sequence) {
            $delay = [double]$step[0] / [math]::Max($Speed, 0.01)
            if ($delay -gt 0) { Start-Sleep -Milliseconds ([int]($delay * 1000)) }
            $json = $step[2] | ConvertTo-Json -Compress -Depth 8
            [System.IO.File]::WriteAllText($tmp, $json, [System.Text.UTF8Encoding]::new($false))
            $pubArgs = @("-h", $Broker, "-p", $Port, "-t", $step[1], "-f", $tmp)
            if ($Username) { $pubArgs += @("-u", $Username) }
            if ($Password) { $pubArgs += @("-P", $Password) }
            & mosquitto_pub @pubArgs
            if ($LASTEXITCODE -ne 0) { throw "mosquitto_pub failed (exit $LASTEXITCODE) on topic $($step[1])" }
            Write-Host ("  sent {0,-30} {1}" -f $step[1], $step[2].type) -ForegroundColor Gray
        }
    } finally {
        Remove-Item $tmp -ErrorAction SilentlyContinue
    }
    Write-Host "Done. Watch visitd logs for ENTERED_ZONE -> ARRIVAL_CANDIDATE -> CONFIRMED_ARRIVAL -> LEFT." -ForegroundColor Green
} else {
    if (-not $OutFile) {
        $dir = Join-Path $root "data"
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
        $OutFile = Join-Path $dir ("dry-run-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".jsonl")
    }
    $lines = @("# generated by scripts/dry-run-event.ps1 camera=$Camera zone=$Zone")
    foreach ($step in $sequence) {
        $lines += ([ordered]@{ topic = $step[1]; payload = $step[2] } | ConvertTo-Json -Compress -Depth 8)
    }
    [System.IO.File]::WriteAllLines($OutFile, $lines, [System.Text.UTF8Encoding]::new($false))
    $reason = $(if ($ForceJsonl) { "-ForceJsonl" } else { "mosquitto_pub not on PATH" })
    Write-Host "Wrote $OutFile ($reason)" -ForegroundColor Cyan
    Write-Host "Replay it with:" -ForegroundColor Gray
    Write-Host "  python -m visitd.main --config config.yaml --replay `"$OutFile`"" -ForegroundColor Green
}

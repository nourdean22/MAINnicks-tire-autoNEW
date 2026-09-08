<#
.SYNOPSIS
    Stage a recorded MP4 as the Frigate `replay` camera so the whole edge stack runs without a live camera.
.DESCRIPTION
    1. Copies -Source into ./fixtures/<Name>.mp4 (the compose file mounts ./fixtures at /media/fixtures:ro).
    2. Validates the file with ffprobe when available (H.264/H.265 yuv420p decodes everywhere; other codecs may not).
    3. Prints the exact Frigate camera block and the visitd cameras entry to paste, then the compose command.
    Recording source (plan 3.3 step 6): V380 desktop client -> record 10-15 min of the SHOPSIGN view during traffic
    (Documents\V380\Record), or any phone clip of the lot.
.EXAMPLE
    powershell -File scripts/replay-fixture.ps1 -Source "$env:USERPROFILE\Documents\V380\Record\sign-2026-09-08.mp4" -Name sign
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Source,
    [string]$Name = "sign",
    [string]$Zone = "bay_entrance",
    [string]$CloudDeviceId = "v380-shopsign"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$fixtures = Join-Path $root "fixtures"
if (-not (Test-Path $Source)) { throw "Source not found: $Source" }
if (-not (Test-Path $fixtures)) { New-Item -ItemType Directory -Path $fixtures | Out-Null }
$target = Join-Path $fixtures "$Name.mp4"
Copy-Item -Path $Source -Destination $target -Force
$sizeMb = [math]::Round((Get-Item $target).Length / 1MB, 1)
Write-Host "Staged $target ($sizeMb MB)" -ForegroundColor Green

if (Get-Command ffprobe -ErrorAction SilentlyContinue) {
    $info = & ffprobe -v error -show_entries "stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt" -of csv=p=0 $target 2>&1
    Write-Host "ffprobe: $(($info | Out-String).Trim() -replace "`r?`n", ' | ')" -ForegroundColor Gray
    if (($info | Out-String) -notmatch "h264|hevc") {
        Write-Host "Codec is not H.264/H.265 - transcode first: ffmpeg -i in.mp4 -c:v libx264 -pix_fmt yuv420p -an $target" -ForegroundColor DarkYellow
    }
} else {
    Write-Host "ffprobe not on PATH; skipping codec check." -ForegroundColor DarkYellow
}

$frigateBlock = @"
  replay:
    enabled: true
    ffmpeg:
      inputs:
        - path: /media/fixtures/$Name.mp4
          input_args: -re -stream_loop -1 -fflags +genpts
          roles: [detect]
    detect: { width: 1280, height: 720 }
    record: { enabled: false }
    zones:
      ${Zone}:
        coordinates: "0.30,0.40,0.70,0.40,0.85,0.95,0.15,0.95"   # redraw in the Frigate UI for this clip
        inertia: 2
        objects: [car, truck, motorcycle]
"@

$visitdBlock = @"
  replay:
    cloudDeviceId: $CloudDeviceId
    displayName: Replay ($Name)
    arrivalZones: [$Zone]
    bayZones: []
"@

Write-Host ""
Write-Host "1. Paste under `cameras:` in frigate/config/config.yml (a commented template is already there):" -ForegroundColor Cyan
Write-Host $frigateBlock
Write-Host "2. Paste under `cameras:` in config.yaml (visitd):" -ForegroundColor Cyan
Write-Host $visitdBlock
Write-Host "3. Start the stack and watch visitd in dry-run:" -ForegroundColor Cyan
Write-Host "   docker compose up -d mqtt frigate" -ForegroundColor Green
Write-Host "   python -m visitd.main --config config.yaml --dry-run" -ForegroundColor Green
Write-Host "   Frigate UI: http://localhost:8971 (draw the zone on the replay camera, paste coordinates, restart frigate)" -ForegroundColor Gray
Write-Host "4. Expected: one ENTERED_ZONE/ARRIVAL_CANDIDATE/CONFIRMED_ARRIVAL/LEFT chain per real visit in the clip; no exceptions across a 24 h loop (gate G1)." -ForegroundColor Gray

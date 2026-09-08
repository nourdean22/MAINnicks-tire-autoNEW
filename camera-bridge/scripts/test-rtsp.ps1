<#
.SYNOPSIS
    Fingerprint the shop cameras: ping, TCP ports, generation verdict, ffprobe over candidate RTSP paths.
.DESCRIPTION
    Port rule (plan 3.1/3.2):
      554 or 8899 open            -> "ONVIF-era: RTSP available" (validate with ffprobe below)
      only 8800/9800 open         -> "LOCKED generation (Xiongmai fingerprint): replace camera, do NOT run ceshi.ini"
    ffprobe runs only when 554 is open, over the known V380/Reolink/Dahua path list, with and without admin:<pw>@.
.PARAMETER Cameras
    Hashtable name -> IP. Defaults to the two V380 units measured on 2026-09-08.
.PARAMETER Password
    Optional camera password for the admin:<pw>@ URL variants. Never printed.
.EXAMPLE
    powershell -File scripts/test-rtsp.ps1
    powershell -File scripts/test-rtsp.ps1 -Cameras @{ LOT = "192.168.30.11" } -Password "secret"
#>
[CmdletBinding()]
param(
    [hashtable]$Cameras = @{ "SHOPINSIDE" = "192.168.0.154"; "SHOPSIGN" = "192.168.0.155" },
    [string]$Password = "",
    [int]$TimeoutMs = 800,
    [switch]$SkipFfprobe
)

$ErrorActionPreference = "Continue"
$Ports = @(80, 443, 554, 5050, 5051, 8000, 8080, 8800, 8899, 9800)
$Paths = @(
    "/live/ch00_1", "/live/ch00_0", "/stream", "/profile0", "/profile1", "/onvif1", "/11",
    "/h264Preview_01_main", "/cam/realmonitor?channel=1&subtype=0"
)

function Test-TcpPort {
    param([string]$Ip, [int]$Port, [int]$Timeout)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($Ip, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($Timeout, $false)) { return $false }
        $client.EndConnect($async) | Out-Null
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Get-GenerationVerdict {
    param([int[]]$Open)
    if ($Open -contains 554 -or $Open -contains 8899) { return "ONVIF-era: RTSP available" }
    $others = @($Open | Where-Object { $_ -ne 8800 -and $_ -ne 9800 })
    if (($Open -contains 8800 -or $Open -contains 9800) -and $others.Count -eq 0) {
        return "LOCKED generation (Xiongmai fingerprint): replace camera, do NOT run ceshi.ini"
    }
    if ($Open.Count -eq 0) { return "No TCP port answered: check power/Wi-Fi or subnet" }
    return "Unclassified port set: read the firmware string in the V380 Pro app before acting"
}

function Invoke-Ffprobe {
    param([string]$Url)
    $ffArgs = @(
        "-rtsp_transport", "tcp", "-v", "error", "-rw_timeout", "6000000",
        "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate", "-of", "csv=p=0", $Url
    )
    $output = & ffprobe @ffArgs 2>&1
    return [pscustomobject]@{ Ok = ($LASTEXITCODE -eq 0); Text = (($output | Out-String).Trim()) }
}

function Hide-Secret {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Password)) { return $Text }
    return $Text.Replace($Password, "***")
}

$hasFfprobe = [bool](Get-Command ffprobe -ErrorAction SilentlyContinue)
$summary = @()

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Nick's Tire & Auto - camera fingerprint" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

foreach ($name in ($Cameras.Keys | Sort-Object)) {
    $ip = $Cameras[$name]
    Write-Host ""
    Write-Host "== $name ($ip)" -ForegroundColor Yellow
    $ping = Test-Connection -ComputerName $ip -Count 1 -Quiet -ErrorAction SilentlyContinue
    Write-Host ("  ping: " + $(if ($ping) { "OK" } else { "no reply" }))

    $open = @()
    foreach ($port in $Ports) {
        if (Test-TcpPort -Ip $ip -Port $port -Timeout $TimeoutMs) { $open += $port }
    }
    $openText = $(if ($open.Count -gt 0) { ($open -join ",") } else { "none" })
    Write-Host "  open tcp: $openText"
    $verdict = Get-GenerationVerdict -Open $open
    $color = $(if ($verdict -like "ONVIF-era*") { "Green" } elseif ($verdict -like "LOCKED*") { "Red" } else { "DarkYellow" })
    Write-Host "  verdict: $verdict" -ForegroundColor $color

    $working = @()
    if ($open -contains 554 -and -not $SkipFfprobe) {
        if (-not $hasFfprobe) {
            Write-Host "  ffprobe not on PATH - install ffmpeg to validate stream paths" -ForegroundColor DarkYellow
        } else {
            $prefixes = @("rtsp://$ip:554")
            if (-not [string]::IsNullOrEmpty($Password)) { $prefixes += "rtsp://admin:$Password@$ip:554" }
            foreach ($prefix in $prefixes) {
                foreach ($path in $Paths) {
                    $url = "$prefix$path"
                    $probe = Invoke-Ffprobe -Url $url
                    $shown = Hide-Secret -Text $url
                    if ($probe.Ok -and $probe.Text.Length -gt 0) {
                        Write-Host "  [OK]   $shown -> $($probe.Text -replace "`r?`n", ' | ')" -ForegroundColor Green
                        $working += $shown
                    } else {
                        Write-Host "  [no]   $shown" -ForegroundColor Gray
                    }
                }
            }
        }
    }
    $summary += [pscustomobject]@{ Camera = $name; IP = $ip; Ping = $ping; OpenPorts = $openText; Verdict = $verdict; WorkingRtsp = ($working -join " ; ") }
}

Write-Host ""
Write-Host "Summary" -ForegroundColor Cyan
$summary | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
Write-Host "Next: an ONVIF-era camera goes into frigate/config.yml go2rtc streams; a LOCKED camera is replaced (plan section 3)." -ForegroundColor Gray

# Windows PowerShell script to test reachability and ports of shop cameras
# Confirmed camera IPs:
#   SHOPINSIDE: 192.168.0.154
#   SHOPSIGN:   192.168.0.155

$CameraIPs = @{
    "SHOPINSIDE" = "192.168.0.154"
    "SHOPSIGN"   = "192.168.0.155"
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Nick's Tire & Auto Camera Reachability check" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

foreach ($name in $CameraIPs.Keys) {
    $ip = $CameraIPs[$name]
    Write-Host "`nProbing $name at $ip..." -ForegroundColor Yellow
    
    # 1. Test Ping
    $ping = Test-Connection -ComputerName $ip -Count 1 -Quiet -ErrorAction SilentlyContinue
    if ($ping) {
        Write-Host "[SUCCESS] Camera is reachable via PING" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] Camera did not respond to PING. Check power and WiFi connection." -ForegroundColor Red
        continue
    }

    # 2. Test ONVIF Port 8899
    $onvifConn = New-Object System.Net.Sockets.TcpClient
    $onvifPromise = $onvifConn.BeginConnect($ip, 8899, $null, $null)
    $onvifSuccess = $onvifPromise.AsyncWaitHandle.WaitOne(800, $false)
    if ($onvifSuccess -and $onvifConn.Connected) {
        Write-Host "[SUCCESS] ONVIF Port 8899 is OPEN. Camera supports ONVIF discovery." -ForegroundColor Green
        $onvifConn.Close()
    } else {
        Write-Host "[INFO] ONVIF Port 8899 is CLOSED." -ForegroundColor Gray
    }

    # 3. Test RTSP Port 554
    $rtspConn = New-Object System.Net.Sockets.TcpClient
    $rtspPromise = $rtspConn.BeginConnect($ip, 554, $null, $null)
    $rtspSuccess = $rtspPromise.AsyncWaitHandle.WaitOne(800, $false)
    if ($rtspSuccess -and $rtspConn.Connected) {
        Write-Host "[SUCCESS] RTSP Port 554 is OPEN. Video stream is available." -ForegroundColor Green
        $rtspConn.Close()
        
        # 4. Check stream URL using ffprobe if available
        if (Get-Command ffprobe -ErrorAction SilentlyContinue) {
            Write-Host "Attempting stream validation via ffprobe..." -ForegroundColor Gray
            # Common V380 RTSP paths:
            # rtsp://<ip>:554/live/ch00_0
            # rtsp://admin:password@<ip>:554/live/ch00_0
            $streamUrl = "rtsp://$ip:554/live/ch00_0"
            Write-Host "Trying stream path: $streamUrl" -ForegroundColor Gray
            $result = ffprobe -v error -show_entries stream=codec_name -of default=noprint_wrappers=1 "$streamUrl" 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host "[SUCCESS] Stream works! Codec detected: $result" -ForegroundColor Green
            } else {
                Write-Host "[WARN] Path failed or auth required. Check V380 Pro App Settings -> Remote Settings -> RTSP." -ForegroundColor DarkYellow
            }
        } else {
            Write-Host "[INFO] ffprobe not found in path. Skipping codec check." -ForegroundColor Gray
        }
    } else {
        Write-Host "[FAIL] RTSP Port 554 is CLOSED!" -ForegroundColor Red
        Write-Host ">> ACTION REQUIRED: Enable RTSP in the V380 Pro App under Settings -> Remote Settings -> RTSP." -ForegroundColor Yellow
    }
}
Write-Host "`nFinished checks." -ForegroundColor Cyan

# setup-cloudflare-tunnel.ps1
# Sets up and configures the permanent Cloudflare named tunnel "nour-local" on Windows.
# Creates folders, downloads cloudflared, configures config.yml, and provides service installation steps.

$ErrorActionPreference = "Stop"

$tunnelDir = "$env:USERPROFILE\.cloudflared"
$exePath = "$tunnelDir\cloudflared.exe"
$configPath = "$tunnelDir\config.yml"
$downloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Cloudflare Named Tunnel Setup & Configuration" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Create directory if not exists
if (-not (Test-Path $tunnelDir)) {
    Write-Host "[INFO] Creating directory: $tunnelDir" -ForegroundColor Yellow
    New-Item -Path $tunnelDir -ItemType Directory | Out-Null
}

# 2. Download cloudflared.exe if missing
if (-not (Test-Path $exePath)) {
    Write-Host "[INFO] cloudflared.exe not found. Downloading latest version from Github..." -ForegroundColor Yellow
    Write-Host "URL: $downloadUrl" -ForegroundColor Gray
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $downloadUrl -OutFile $exePath -UseBasicParsing
        Write-Host "[SUCCESS] Downloaded cloudflared.exe successfully." -ForegroundColor Green
    }
    catch {
        Write-Host "[ERROR] Failed to download cloudflared.exe. Please download manually and save to: $exePath" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        Exit 1
    }
} else {
    Write-Host "[INFO] cloudflared.exe is already present." -ForegroundColor Green
}

# 3. Check authentication status
$certPath = "$tunnelDir\cert.pem"
if (-not (Test-Path $certPath)) {
    Write-Host ""
    Write-Host "========================================================" -ForegroundColor Yellow
    Write-Host "  STEP 1: AUTHENTICATION REQUIRED" -ForegroundColor Yellow
    Write-Host "========================================================" -ForegroundColor Yellow
    Write-Host "No login certificate found at: $certPath"
    Write-Host "Please run the following command in a PowerShell terminal to authenticate:" -ForegroundColor Cyan
    Write-Host "  & `"$exePath`" tunnel login" -ForegroundColor Green
    Write-Host ""
    Write-Host "This will open a browser window. log in with your Cloudflare account,"
    Write-Host "and select the domain (e.g., nickstire.org or bdnick.info) to authorize."
    Write-Host "After the cert.pem file is saved, run this setup script again." -ForegroundColor Yellow
    Exit 0
}

Write-Host "[INFO] Found authentication certificate: cert.pem" -ForegroundColor Green

# 4. Check or Create Tunnel "nour-local"
Write-Host ""
Write-Host "[INFO] Checking existing tunnels..." -ForegroundColor Yellow

$tunnelsJson = & $exePath tunnel list --output json
$tunnels = $tunnelsJson | ConvertFrom-Json
$targetTunnel = $tunnels | Where-Object { $_.name -eq "nour-local" }

$tunnelId = ""
if ($targetTunnel) {
    $tunnelId = $targetTunnel.id
    Write-Host "[INFO] Found existing named tunnel 'nour-local' with ID: $tunnelId" -ForegroundColor Green
} else {
    Write-Host "[INFO] Creating new named tunnel 'nour-local'..." -ForegroundColor Yellow
    try {
        $createOutput = & $exePath tunnel create nour-local
        Write-Host $createOutput -ForegroundColor Gray
        
        # Re-fetch tunnel list to get ID
        $tunnelsJson = & $exePath tunnel list --output json
        $tunnels = $tunnelsJson | ConvertFrom-Json
        $targetTunnel = $tunnels | Where-Object { $_.name -eq "nour-local" }
        if ($targetTunnel) {
            $tunnelId = $targetTunnel.id
            Write-Host "[SUCCESS] Created named tunnel 'nour-local' with ID: $tunnelId" -ForegroundColor Green
        } else {
            Write-Host "[ERROR] Created tunnel but could not retrieve ID." -ForegroundColor Red
            Exit 1
        }
    }
    catch {
        Write-Host "[ERROR] Failed to create tunnel. Ensure you are authorized and online." -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        Exit 1
    }
}

# 5. Write config.yml
Write-Host ""
Write-Host "[INFO] Writing configuration file to: $configPath" -ForegroundColor Yellow

$configContent = @"
tunnel: $tunnelId
credentials-file: $tunnelDir\$tunnelId.json

ingress:
  # Nick's Tire Dev Server (Vite)
  - hostname: dev.nickstire.org
    service: http://localhost:3000
  
  # Statenour Dev Server (Next.js)
  - hostname: dev.bdnick.info
    service: http://localhost:3001

  # Catch-all rule (Required by Cloudflare)
  - service: http_status:404
"@

Set-Content -Path $configPath -Value $configContent -Encoding utf8
Write-Host "[SUCCESS] config.yml written successfully." -ForegroundColor Green

# 6. Service / Startup Persistence Instructions
Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  SETUP COMPLETE & PERSISTENCE STEPS" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host "1. CNAME DNS Record Setup:" -ForegroundColor Yellow
Write-Host "   Add the CNAME records at your DNS provider (globaldomaingroup.com):"
Write-Host "     Name: dev.nickstire.org  --> Target: $tunnelId.cfargotunnel.com" -ForegroundColor Cyan
Write-Host "     Name: dev.bdnick.info    --> Target: $tunnelId.cfargotunnel.com" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Install as a Windows Service (Persistent on boot):" -ForegroundColor Yellow
Write-Host "   Open a PowerShell console as ADMINISTRATOR and run:"
Write-Host "     & `"$exePath`" service install" -ForegroundColor Green
Write-Host ""
Write-Host "3. Start the service:" -ForegroundColor Yellow
Write-Host "     Start-Service -Name `"$exePath`" (or Start-Service cloudflared)" -ForegroundColor Green
Write-Host ""
Write-Host "4. Verify status:" -ForegroundColor Yellow
Write-Host "   Tunnel Status will be updated automatically in the Admin Command Center dashboard."
Write-Host "========================================================" -ForegroundColor Green

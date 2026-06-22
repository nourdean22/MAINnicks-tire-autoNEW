# install-cockpit-plugins.ps1 - Power up Obsidian Vault with cockpit plugins
$ErrorActionPreference = "Stop"

$vaultPath = "C:\Users\nourd\OneDrive\Documents\Obsidian Vault"
$pluginsDir = Join-Path -Path $vaultPath -ChildPath ".obsidian\plugins"
$communityPluginsFile = Join-Path -Path $vaultPath -ChildPath ".obsidian\community-plugins.json"

if (-not (Test-Path -Path $pluginsDir)) {
    New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null
}

$plugins = @(
    @{ id = "dataview"; repo = "blacksmithgu/obsidian-dataview"; files = @("main.js", "manifest.json", "styles.css") },
    @{ id = "templater-obsidian"; repo = "SilentVoid13/Templater"; files = @("main.js", "manifest.json", "styles.css") },
    @{ id = "obsidian-spaced-repetition"; repo = "st3v3nmw/obsidian-spaced-repetition"; files = @("main.js", "manifest.json", "styles.css") },
    @{ id = "quickadd"; repo = "chhoumann/quickadd"; files = @("main.js", "manifest.json", "styles.css") },
    @{ id = "obsidian-local-rest-api"; repo = "coddingtonbear/obsidian-local-rest-api"; files = @("main.js", "manifest.json", "styles.css") }
)

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Installing Obsidian Cockpit Plugins..." -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

foreach ($plugin in $plugins) {
    $pluginPath = Join-Path -Path $pluginsDir -ChildPath $plugin.id
    if (-not (Test-Path -Path $pluginPath)) {
        New-Item -ItemType Directory -Path $pluginPath -Force | Out-Null
    }

    Write-Host "Installing plugin: $($plugin.id) ($($plugin.repo))..." -ForegroundColor Yellow
    $downloadedCount = 0

    foreach ($file in $plugin.files) {
        $destFile = Join-Path -Path $pluginPath -ChildPath $file
        $url = "https://github.com/$($plugin.repo)/releases/latest/download/$file"
        
        $success = $false
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $url -OutFile $destFile -UseBasicParsing -ErrorAction Stop
            $success = $true
        } catch {
            $success = $false
        }

        if ($success) {
            Write-Host "  * Downloaded $file" -ForegroundColor Gray
            $downloadedCount++
        }
    }

    if ($downloadedCount -eq 0) {
        Write-Host "  [WARNING] Failed to download any files for $($plugin.id). Check internet or repo." -ForegroundColor Red
    } else {
        Write-Host "  [OK] Installed successfully." -ForegroundColor Green
    }
}

Write-Host "" -ForegroundColor Yellow
Write-Host "Updating community-plugins.json..." -ForegroundColor Yellow

$currentEnabled = @()
if (Test-Path -Path $communityPluginsFile) {
    try {
        $content = Get-Content -Path $communityPluginsFile -Raw
        $currentEnabled = ConvertFrom-Json -InputObject $content
        if ($currentEnabled -eq $null) { $currentEnabled = @() }
    } catch {
        Write-Host "  [WARNING] Failed to parse existing community-plugins.json. Initializing new." -ForegroundColor Yellow
        $currentEnabled = @()
    }
}

$updatedEnabled = @()
foreach ($item in $currentEnabled) {
    if ($item -notin $updatedEnabled) {
        $updatedEnabled += $item
    }
}

foreach ($plugin in $plugins) {
    if ($plugin.id -notin $updatedEnabled) {
        $updatedEnabled += $plugin.id
        Write-Host "  * Enabled: $($plugin.id)" -ForegroundColor Green
    }
}

$jsonOut = ConvertTo-Json -InputObject $updatedEnabled -Compress
Set-Content -Path $communityPluginsFile -Value $jsonOut

Write-Host "" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host "Obsidian Cockpit Plugins Installation Complete!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green

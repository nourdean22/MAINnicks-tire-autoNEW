# PowerShell script to publish mock Frigate events to the local MQTT broker.
# Uses Python's paho-mqtt package to publish without needing mosquitto client binaries.

$Broker = "localhost"
$Topic = "frigate/events"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Publishing Mock Frigate Event Sequence" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Stage 1: Vehicle enters zone (type: new)
$EventNew = @{
    type = "new"
    before = @{}
    after = @{
        id = "mock-track-$(Get-Random)"
        camera = "outside_v380"
        label = "car"
        confidence = 0.88
        current_zones = @("front_lot")
        area = 15000
    }
} | ConvertTo-Json -Compress

$escapedNew = $EventNew -replace '"', '\"'

Write-Host "`n1. Publishing vehicle ENTERED_ZONE event..." -ForegroundColor Yellow
python -c "import paho.mqtt.publish as pub; pub.single('$Topic', '$escapedNew', hostname='$Broker')"
Write-Host "Event published. Checking logs/Telegram..." -ForegroundColor Gray

# Wait 3 seconds to exceed the minDwell threshold
Start-Sleep -Seconds 3

# Stage 2: Vehicle confirmed arrival (type: update)
# We update the same track to trigger CONFIRMED_ARRIVAL state
$trackId = (ConvertFrom-Json $EventNew).after.id
$EventUpdate = @{
    type = "update"
    before = @{}
    after = @{
        id = $trackId
        camera = "outside_v380"
        label = "car"
        confidence = 0.94
        current_zones = @("front_lot")
        area = 15500
    }
} | ConvertTo-Json -Compress

$escapedUpdate = $EventUpdate -replace '"', '\"'

Write-Host "`n2. Publishing vehicle CONFIRMED_ARRIVAL event (Track ID: $trackId)..." -ForegroundColor Yellow
python -c "import paho.mqtt.publish as pub; pub.single('$Topic', '$escapedUpdate', hostname='$Broker')"
Write-Host "Event published. Check Telegram for alert update." -ForegroundColor Gray

# Wait 2 seconds
Start-Sleep -Seconds 2

# Stage 3: Vehicle departs (type: end)
$EventEnd = @{
    type = "end"
    before = @{}
    after = @{
        id = $trackId
        camera = "outside_v380"
        label = "car"
        confidence = 0.94
        current_zones = @("front_lot")
        area = 15500
    }
} | ConvertTo-Json -Compress

$escapedEnd = $EventEnd -replace '"', '\"'

Write-Host "`n3. Publishing vehicle LEFT event (Track ID: $trackId)..." -ForegroundColor Yellow
python -c "import paho.mqtt.publish as pub; pub.single('$Topic', '$escapedEnd', hostname='$Broker')"
Write-Host "Event published. Deduplication cycle complete." -ForegroundColor Gray

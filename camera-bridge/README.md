# Nick's Tire & Auto — Arrival Intelligence Runbook

This directory contains the local camera NVR and bridge system that connects the shop's V380 outdoor cameras to the Statenour-OS cloud backend.

## Architecture

```
[V380 Camera] --(RTSP)--> [Frigate (Docker)] --(MQTT)--> [Bridge (Python)] --(HTTP+SyncKey)--> [Statenour Cloud]
```

1. **Frigate** decodes the RTSP stream, performs local object detection, filters for vehicle labels in the `front_lot` zone, and publishes coordinates/track events to the MQTT broker.
2. **Camera Bridge** subscribes to MQTT, measures vehicle dwell times, runs snapshots through the ALPR plate capture reader, and posts structured event payloads to the cloud endpoint.
3. **Statenour Cloud** logs the arrival events, debounces duplicates, and alerts the operator via Telegram.

---

## 1. Local Pre-requisites

Make sure Python 3.9+ and Docker Desktop are installed on the shop PC.

Install Python dependencies:
```bash
cd camera-bridge/bridge
pip install -r requirements.txt
```

---

## 2. V380 RTSP Configuration & Testing

V380 / MacroVideo cameras do **NOT** expose RTSP (port 554) or ONVIF (port 8899) by default. They run in proprietary P2P mode.

### Steps to Enable RTSP:
1. Open the **V380 Pro** app on your phone.
2. Go to **Settings** -> **Remote Settings** (or Network Settings).
3. Look for **RTSP** or **ONVIF** and toggle it **ON**.
4. Set an RTSP stream password when prompted.

### Verify Reachability:
Run the PowerShell reachability tool to scan the camera IPs and check if RTSP is active:
```powershell
powershell -File scripts/test-rtsp.ps1
```

If port 554 shows **CLOSED**, the bridge cannot capture frames. Follow the app toggle path.

---

## 3. Starting the Local System

### Step A: Boot Frigate & MQTT
1. Copy `frigate/config.example.yml` to `frigate/config.yml` and enter the correct camera stream credentials and IPs.
2. Launch Docker Compose:
   ```bash
   docker-compose up -d
   ```
3. Open the Frigate dashboard at `http://localhost:5000` to verify streams are decoding properly and draw the `front_lot` zone coordinates.

### Step B: Configure the Bridge
1. Copy `bridge/config.example.yaml` to `bridge/config.yaml` and set:
   - `backend.ingestUrl`: your cloud instance endpoint (e.g. `https://bdnick.info/api/devices/v380-shopsign/events`)
   - `plateCapture.provider`: set to `easyocr` for local offline OCR, `plate_recognizer` for API-driven, or `mock` for testing.
2. Copy `bridge/.env.example` to `bridge/.env` and set `STATENOUR_SYNC_KEY` to match the cloud sync key.

### Step C: Run the Bridge
Run the bridge manually to verify the loop:
```bash
python bridge/bridge.py
```

To test without uploading to the cloud, pass the `--dry-run` flag:
```bash
python bridge/bridge.py --dry-run
```

---

## 4. End-to-End Simulation & Verification

To verify the entire local-to-cloud notification loop works:
1. Ensure the bridge is running locally.
2. Run the mock publisher script:
   ```powershell
   powershell -File scripts/dry-run-event.ps1
   ```
3. Verify that:
   - The bridge console logs the event.
   - An alert containing the mock vehicle and plate is sent to the operator's Telegram.
   - The `/system/camera` page in bdnick.info shows the mock arrival event in real-time.

---

## 5. Production Windows Service Deployment

To run the bridge in the background on the shop PC:
1. Open PowerShell as Administrator.
2. Run the service installer:
   ```powershell
   powershell -File scripts/install-windows-service.ps1
   ```
This configures the bridge to launch automatically on boot and log errors to `bridge.log`.

# Home Camera System — 192.168.1.x Network
Discovered: 2026-03-26

## Network: Old Home WiFi (192.168.1.x)

---

## 192.168.1.123 — GeoVision DVR/NVR

- **Brand**: GeoVision
- **Type**: DVR/NVR (multi-channel, up to 16 cameras)
- **Device name**: "0812" (from web config)
- **Open ports**: 80 (HTTP web UI), 554 (RTSP), 10000 (GeoVision VSS protocol)

### Web Interface
- URL: http://192.168.1.123/
- Accessible without HTTP auth (static files served openly)
- CGI login at: `/login.cgi?account=<gv_base64_user>&password=<gv_base64_pwd>`
- **TODO**: Find the admin password to log in (all common defaults failed)
- Response format on success: `<session_id>&<num_channels>&<ch0_name>&...`

### RTSP (locked)
- Port 554 open, Basic auth required, realm="GeoVision"
- All paths tried return 401 (no working credentials yet)
- Paths to try once password is known:
  - `rtsp://admin:<pwd>@192.168.1.123:554/CH001.sdp`
  - `rtsp://admin:<pwd>@192.168.1.123:554/CH002.sdp`
  - `rtsp://admin:<pwd>@192.168.1.123:554/live.sdp`

### GeoVision VSS Protocol (port 10000)
- Binary protocol, magic: "GeOv" header
- Used by GeoVision Windows client software (GV-VMS, GV-Monitor)
- The JS uses `g_vssport=10000`

### Features (from web JS)
- Supports: ONVIF, RTSP, P2P cloud, GeoVision protocol
- Has cloud service + P2P (GV-DDNs / GV-Cloud)
- 4 alarm inputs, 1 alarm output
- Up to 16 display divisions

### GV-Eye Cloud Account
- **Email**: moeseuclid@gmail.com
- **App**: GV-Eye v3.5.1 (iOS)
- **Mobile UUID**: 2ad669e5-1003-4061-ac41-fbdf74e3ad81
- Cloud relay account is separate from local DVR password

### Notes
- GeoVision uses custom Base64 encoding for login (shifted alphabet, 1-indexed)
- Login is via GET /login.cgi (not POST)
- Web login separate from RTSP auth
- Cloud account (GV-Eye) linked to moeseuclid@gmail.com
- Local DVR password: UNKNOWN (admin/admin1234 and many others failed)

---

## 192.168.1.130 — Unknown IP Camera

- **MAC**: 90:bf:d9:3d:b2:60
- **OUI**: 90:BF:D9 — unconfirmed brand (possibly Hikvision/EZVIZ/Reolink)
- **Open ports**: 554 (RTSP), 9000 (unknown, timeout)

### RTSP Status
- OPTIONS: `200 OK` — server is running
- DESCRIBE: `404 Stream Not Found` for ALL paths tried
- No auth prompt — camera responds but has no active streams
- This may mean RTSP streaming is not configured/enabled

### Paths tried (all 404):
`/`, `/live.sdp`, `/video`, `/stream`, `/ch1`, `/h264Preview_01_main`,
`/Streaming/Channels/1`, `/Streaming/Channels/101`, `/cam/realmonitor`,
`/live/ch01_0`, `/live/main`, `/h264`, `/mjpeg`, and more

### Next steps:
- Find a web/config interface for this camera
- Try ONVIF discovery to get correct RTSP URL
- Check if port 9000 is a config port

---

## 192.168.1.103 — Unknown (Express.js server)

- **Open ports**: 8000 (Express.js HTTP), 8080 (403 for all), 8443 (refused)
- Port 8000 only responds to `GET /` → "Server is running..."
- All other paths: 404
- Express.js server (`X-Powered-By: Express`)
- System clock is wrong (epoch ~14 Jan 1970) — no NTP

### Possible identity:
- Custom NVR software
- Raspberry Pi / embedded device running a Node.js service
- Could be related to the camera system or completely unrelated

---

## Other devices on subnet (for reference)
- 192.168.1.1 — Router
- 192.168.1.113 — Laptop (this machine)
- Other devices: ARP scan would reveal more

---

## TODO
1. [ ] Get GeoVision DVR password (user to provide or recover)
2. [ ] Enable RTSP on GeoVision, get stream URL
3. [ ] Identify .130 camera brand, find correct RTSP path
4. [ ] Identify .103 device, explore API
5. [ ] Integrate working streams into NOUR OS dashboard (live view / playback)

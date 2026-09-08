# camera-bridge v2 - Arrival Intelligence edge runbook

Frigate 0.17.2 does detection, tracking, zones and plate reading on the shop LAN; `visitd` (this package) turns
Frigate's MQTT stream into deterministic **visits** and ships idempotent events to statenour
(`https://bdnick.info`). Spec: `docs/research/2026-09-08-camera-vision-MASTER-PLAN.md` sections 4.2, 6, 8.2, 9, 11, 13, 15.

```
SHOP LAN (camera VLAN later)                                              CLOUD
+-----------+  RTSP   +--------------------+  MQTT (user/pass)  +-------------------+  HTTPS x-sync-key  +--------------------+
| PoE cam A |-------->| Frigate 0.17.2     |------------------->| visitd 2.0.0      |------------------->| statenour-web      |
| lot       |         |  go2rtc restream   | frigate/events     |  frigate_events   | POST /api/devices/ |  handleVehicleEvent|
| PoE cam B |-------->|  native LPR        | frigate/tracked_   |  state_machine    |   {id}/events      |  Telegram + push   |
| sign/LPR  |         |  zones/review/rec  |  object_update     |  ledger (SQLite)  | PATCH /api/devices/|  /system/camera    |
+-----------+         +--------------------+                    |  cloud_client     |   {id} (heartbeat) |  sentinel cron     |
                        mosquitto 2.0 (no anonymous)            |  metrics :9090    |                    +--------------------+
                                                                +-------------------+
                            one Linux mini-PC (Docker Compose); this laptop + Docker Desktop for the lab only
```

Data flow inside visitd: paho thread **only enqueues** raw messages -> main thread parses, drives the pure state
machine, writes the SQLite ledger + outbox -> cloud worker thread drains the outbox in order with backoff.
Timers run on Frigate `frame_time`, never on the wall clock; a 5 s tick covers stationary objects that send no updates.

## 1. TODAY - which camera path (plan 3.2 / 3.3)

```
Run:  powershell -File scripts/test-rtsp.ps1            (add -Password <app password> to try authenticated paths)

Do both cams open 554/8899 after the app's ONVIF switch (Settings -> Advanced settings, if present)?
  YES -> "ONVIF-era: RTSP available". ffprobe finds a working path -> put it in frigate go2rtc streams.
         VLAN-isolate, nightly ffprobe check (the unlock can revert). Interim only; never the LPR camera.
  NO  -> Firmware string (V380 Pro app -> device -> Settings -> device info) reads Hw_HsAK... / HwV380E... (Anyka)?
           YES -> ceshi.ini ONCE on ONE camera (plan 3.3 step 4), then re-run the probe (UNLOCK-THEN-REPLACE).
           NO  -> HsXM / AppXM5 / 3-lens = locked Xiongmai generation: REPLACE the camera.
                  Never run ceshi.ini on an XM unit (self-reset reports), never factory-reset,
                  never deploy a protocol bridge (plan 3.4). The 8800/9800 port fingerprint alone does NOT decide
                  the generation - both shop units show it and are Anyka.
```

Measured 2026-09-08: both units answer ping and expose **only 8800/9800**; the app's firmware page reads
`Hw_HsAKQQXG_WIFI_20230421` on both (Anyka `HsAK`) -> UNLOCK branch: try `ceshi.ini` on SHOPSIGN (.155) first, then
`scripts/test-rtsp.ps1` again; expect `rtsp://192.168.0.155:554/live/ch00_1`. Good enough for the lot-overview lane
and the replay fixture, never for LPR. Fastest path to real data: one $55-130 PoE camera + a $15 injector this week;
the full VLAN build later.

## 2. Files

| Path | Purpose |
|---|---|
| `visitd/` | the service: `frigate_events` (0.17 payload normalization) - `state_machine` (pure) - `contract` (event v2) - `ledger` (SQLite WAL) - `cloud_client` (worker) - `mqtt_client` (paho 2.1, enqueue only) - `metrics` - `replay` - `config` - `main` |
| `config.example.yaml` | every visitd key with its default; copy to `config.yaml` |
| `.env.example` | `STATENOUR_SYNC_KEY`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `FRIGATE_RTSP_PASSWORD`, `FRIGATE_MQTT_PASSWORD` |
| `frigate/config.example.yml` | Frigate 0.17.2 config (plan section 9): two cameras, LPR, record/review, commented `replay` camera |
| `docker-compose.yml` (+ `docker-compose.linux.yml`) | mqtt + frigate + visitd; Linux overlay adds `/dev/dri` |
| `mosquitto/mosquitto.conf` | anonymous disabled, password file |
| `visitd.Dockerfile` | python:3.12-slim, non-root |
| `scripts/*.ps1` | `test-rtsp` (fingerprint), `dry-run-event` (publish or JSONL), `replay-fixture` (MP4 loop), `install-windows-service` (lab) |
| `tests/` | stdlib unittest, deterministic, no network; `tests/fixtures/*.jsonl` are also `--replay` inputs |

## 3. Setup - Docker Desktop lab (this laptop)

1. `cd camera-bridge` ; `Copy-Item .env.example .env` ; `Copy-Item config.example.yaml config.yaml` ;
   `New-Item -ItemType Directory frigate/config, data, fixtures, storage/media -Force` ;
   `Copy-Item frigate/config.example.yml frigate/config/config.yml`.
2. Fill `.env` (the sync key is the Railway `STATENOUR_SYNC_KEY`; pick MQTT passwords now).
3. Mosquitto bootstrap (section 5). It must exist before `docker compose up` or the broker refuses to start.
4. In `frigate/config/config.yml` comment out the `ov` detector and `ffmpeg.hwaccel_args`, uncomment `cpu1`
   (WSL2 cannot pass the iGPU/NPU through).
5. `docker compose up -d mqtt frigate` ; open `http://localhost:8971`, create the admin user, check the cameras decode.
6. Draw zones (section 6) and paste the coordinates; `docker compose restart frigate`.
7. Run visitd on the host first: `pip install -r requirements.txt` ; set `mqtt.host: 127.0.0.1` in `config.yaml` ;
   `python -m visitd.main --config config.yaml --dry-run` ; then `docker compose up -d --build visitd` for the container.
8. `visitd` posts nothing until a real visit happens; prove the lane with section 7 first.

## 4. Setup - Linux production (mini-PC)

1. Ubuntu Server 24.04, Docker Engine, `sudo usermod -aG docker,render $USER`, Tailscale (subnet router, no port-forwarding).
2. Same copies as section 3 steps 1-3 (use `cp`); keep `ov` (OpenVINO GPU) and `preset-vaapi`.
3. `docker compose -f docker-compose.yml -f docker-compose.linux.yml up -d` ; verify `docker compose logs frigate | grep -i openvino`.
4. Camera VLAN with WAN egress denied; NTP from the router; UPS; Frigate 8971 only via Tailscale ACL.
5. `curl -s 127.0.0.1:9090/metrics` on the box shows the visitd counters; the cockpit gets them through the heartbeat.

## 5. Mosquitto bootstrap (passwords)

Mosquitto refuses anonymous clients (`allow_anonymous false`). Create the password file once, on the host:

```
docker run --rm -v "${PWD}/mosquitto:/work" eclipse-mosquitto:2.0 sh -c "mosquitto_passwd -c -b /work/passwd frigate '<FRIGATE_MQTT_PASSWORD>' && mosquitto_passwd -b /work/passwd visitd '<MQTT_PASSWORD>' && chmod 0700 /work/passwd"
```

(`-c` creates the file; the second call appends. Use the same values as `.env`. Mosquitto 2.0.18+ wants the file
non-world-readable, hence the chmod. Rotate by re-running and `docker compose restart mqtt`.)

## 6. Frigate zone drawing

1. Mount the camera, wait for the detect stream in the UI (`http://<box>:8971`).
2. Settings -> Zones -> the camera -> draw the polygon; name it exactly as in `config.yaml` (`front_lot`,
   `entrance_lane`, `bay_entrance`; bay cameras later `bay_1`..`bay_n`).
3. Copy the relative coordinates into `frigate/config/config.yml`, commit, `docker compose restart frigate`.
4. `inertia` 2-3 frames debounces the zone; visitd adds no debounce of its own. `loitering_time` stays 0 - dwell is measured by visitd.
5. Mask the timestamp overlay and the public road (`motion.mask`) so passing traffic never becomes a sighting.

## 7. Prove the lane (replay validation)

| Step | Command | Expect |
|---|---|---|
| Unit tests | `python -m unittest discover -s tests -v` | `OK`, < 1 s |
| Fixture replay | `python -m visitd.main --config config.example.yaml --replay tests/fixtures/arrival_and_leave.jsonl` | ENTERED_ZONE -> ARRIVAL_CANDIDATE -> CONFIRMED_ARRIVAL (estimated, then confirmed) -> LEFT with plate CONFIRMED, `open_visits=0` |
| Synthetic live visit | `powershell -File scripts/dry-run-event.ps1 -Speed 10` (needs `mosquitto_pub` + `MQTT_*` env) | same chain in the visitd log within ~7 s |
| No broker tools | `powershell -File scripts/dry-run-event.ps1 -ForceJsonl` then the printed `--replay` command | same chain |
| Cloud round trip (G0) | run visitd WITHOUT `--dry-run` after the dry-run JSONL: `python -m visitd.main --config config.yaml --replay data/dry-run-*.jsonl --ledger data/lab.sqlite` posts nothing (replay is always dry-run); instead publish with `dry-run-event.ps1` against a live visitd | Railway http log shows `POST /api/devices/v380-shopsign/events 200`; `/system/camera` shows the visit |
| Video loop | `powershell -File scripts/replay-fixture.ps1 -Source <clip.mp4> -Name sign` and follow the printed steps | one visit chain per real car in the clip, 24 h without exceptions (gate G1) |

Fixtures: `arrival_and_leave.jsonl` (park, plate, leave), `pass_through.jsonl` (4 s drive-through), `split_track.jsonl`
(Frigate re-ids a parked car after occlusion; visitd keeps one visit). Regenerate with `python tests/fixtures/make_fixtures.py`.

## 8. Visit model in one screen

States: `DETECTED` (not sent) -> `ENTERED_ZONE` -> `ARRIVAL_CANDIDATE` (10 s in an arrival zone, or stationary) ->
`CONFIRMED_ARRIVAL` (45 s, or stationary >= 20 s; priority high) -> `IN_SERVICE` (bay zone) -> `DEPARTING` (not sent,
20 s grace) -> `LEFT`; `PASS_THROUGH` when it left before ever being a candidate (priority low). Tick-driven promotions
carry `estimated: true` and are re-sent with `estimated: false` on the next Frigate message for that visit.

Identity, in order: same-camera track split (<= 10 s, IoU >= 0.5) - plate match to an open visit (hard reject when two
>= 0.9 reads differ by Levenshtein >= 2) - `topology` hop (`sign -> lot` within 1-90 s) - else a new `visitId` (UUID).
A visit absorbed by a plate match after it already emitted gets a final `LEFT` with `metadata.mergedIntoVisitId`.

Event: `eventId = sha1(visitId|state|seq)` (cloud dedupes), `timestamp` from `frame_time`, `data.plate.status` in
NONE / UNREADABLE / CANDIDATE / CONFIRMED, `data.metadata.snapshotRef = events/<sightingId>/snapshot.jpg`
(fetch through the Frigate API only; 0.18 stops writing jpgs to disk).

## 9. Service install (Windows lab only)

`powershell -File scripts/install-windows-service.ps1` registers a Scheduled Task as the **current user** at logon
(auto-restart every minute, log in `logs\visitd.log`). `-RunAsSystem` opts into SYSTEM at startup from an elevated
shell; `-Uninstall` removes it; `-DryRun` prints the plan. Production runs under Docker Compose with
`restart: unless-stopped`; nothing on Windows is production.

## 10. Metrics and heartbeats

`GET http://127.0.0.1:9090/metrics` (Prometheus text, loopback only). Key series: `visitd_transitions_total{state}`,
`visitd_tick_promotions_total{state}`, `visitd_open_visits`, `visitd_outbox_depth`, `visitd_outbox_dropped_total`,
`visitd_cloud_events_total{result}`, `visitd_cloud_dropped_total{reason}`, `visitd_mqtt_connected`,
`visitd_mqtt_disconnects_total`, `visitd_tracker_*` (stitch counters), `visitd_parse_errors_total`.
Every 60 s visitd PATCHes each configured device with `status: ONLINE`, `lastSeenAt`, and `currentState`
(`bridgeVersion`, `frigateVersion`, `mqttConnected`, `frigateAvailable`, `outboxDepth`, `lastEventAt`, `openVisits`,
`metrics`). The cloud sentinel (`device-heartbeat-sentinel`, worker-fired every 15 min) flips a device OFFLINE once
it has been silent for 20 min (two missed heartbeats plus one tick) and pages once per transition.

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `mqtt connect failed reason=Not authorized` | wrong `MQTT_USERNAME`/`MQTT_PASSWORD` or passwd file missing | section 5, then `docker compose restart mqtt visitd` |
| broker container exits at start | `mosquitto/passwd` absent or world-readable | create it (section 5) |
| Frigate logs `No such file: /config/config.yml` | file mounted instead of the directory | keep `./frigate/config:/config`, put `config.yml` inside |
| `cloud dropped ... reason=sync_key_rejected` | `STATENOUR_SYNC_KEY` differs from Railway | fix `.env`; dropped events are gone (log has the eventId) |
| `cloud dropped ... reason=http_404` | `cloudDeviceId` is not a statenour `platformDeviceId` | check `smart_devices.platform_device_id`; the cloud resolves id OR platformDeviceId since PR `statenour/camera-arrival-p0` |
| `cloud blocked reason=missing_sync_key` | key not in env | events wait in the outbox (max 5000); set the key and restart |
| events stuck, `visitd_outbox_depth` grows, `cloud retry ... status=0` | WAN down / DNS | nothing to do; flushes in order on reconnect, cloud dedupes by `eventId` |
| visit never becomes CONFIRMED | zone not in `arrivalZones`, or the zone polygon never triggers (draw it in the UI) | `docker compose logs visitd | grep transition`; check `current_zones` in `frigate/events` with `mosquitto_sub` |
| parked car never LEFT | expected: stationary objects keep the visit open until Frigate `end` (no time-based purge) | if Frigate ended it inside the zone, LEFT follows 20 s later (`estimated: true`) |
| `LEFT` arrives with `estimated: true` and a still-alive track | grace expired while the car sat outside every zone | normal; re-entry later starts a new visit |
| `ignored_unknown_camera` climbs | Frigate camera name missing from `config.yaml` `cameras` | add it (the `replay` camera too) |
| metrics port busy | another visitd on the host | change `metrics.port` |
| Frigate CPU pegged on Docker Desktop | `ov` detector left enabled | switch to `cpu1`, 5 fps, 1280x720 detect |
| `The operation was canceled` in CI | a sibling merge superseded the run | rerun |

## 12. What changed from v1 (defect register 4.2)

| # | v1 defect | v2 fix |
|---|---|---|
| E1 | ingest URL embedded the id; heartbeat URL derived by string replace | `cameras.<name>.cloudDeviceId` -> `POST /api/devices/{id}/events` and `PATCH /api/devices/{id}` built by `cloud_client.events_url/device_url` |
| E2 | relative zone coordinates on Frigate 0.13.2 (pixel zones) + `rtmp` role | Frigate pinned `0.17.2`; zones relative by design; go2rtc restream, `detect`/`record` roles |
| E3 | `current_zones[0]` on every `end` -> `IndexError` | LEFT uses the sighting's last known zone; `tests/test_state_machine.py::test_end_with_empty_current_zones_emits_left_from_last_known_zone` |
| E4 | dwell = wall clock since first MQTT message, zones ignored | zone intervals on `frame_time`, union per zone, arrival dwell = union of arrival zones |
| E5 | CONFIRMED after 2 s | candidate 10 s, confirmed 45 s or stationary >= 20 s, all in `config.yaml` |
| E6 | HTTP retries + `time.sleep` inside the paho callback thread | paho callback only enqueues; `CloudClient` worker thread + SQLite outbox with exponential backoff |
| E7 | tracks, cooldowns, offline queue in memory | `data/visitd.sqlite` (WAL): visits, sightings, visit_zone_intervals, outbox; open visits reload on start |
| E8 | `paho-mqtt>=1.6.1` across the 2.0 break; easyocr/cv2 imported but unlisted | pinned `paho-mqtt==2.1.0`, `requests==2.34.2`, `PyYAML==6.0.3`, `python-dotenv==1.2.2`; plates come from Frigate native LPR, no OCR in the bridge |
| E9 | LEFT only if previously alerted; tracks purged after 15 min | stationary visits stay open until Frigate `end`; no time-based purge; every zoned visit ends in LEFT or PASS_THROUGH |
| E10 | anonymous MQTT; Frigate 5000 on the LAN | Mosquitto password file, `allow_anonymous false`; 5000 bound to 127.0.0.1; humans use 8971 (JWT) |
| E11 | `/dev/bus/usb` + `/etc/localtime` mounts, `privileged: true` | no privileged, no USB, no localtime; `/dev/dri` only in `docker-compose.linux.yml` |
| E12 | default plate provider `mock` returning `NICKS1` | provider is always `frigate_lpr`; no mock anywhere; `--dry-run` only changes where events go |
| E13 | service as `NT AUTHORITY\SYSTEM` | current user by default, `-RunAsSystem` opt-in, lab only |
| E14 | dormant `local-agent/v380_agent.py` | statenour follow-up PR deletes it once the v2 heartbeat is live (not part of this tree) |

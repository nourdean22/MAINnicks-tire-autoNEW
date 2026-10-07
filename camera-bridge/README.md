# camera-bridge v2 - Arrival Intelligence edge runbook

> **As built (2026-10-07; ADR-0022).** Production does NOT run the Frigate lane drawn below. The `sign`
> camera is read through the V380 vendor relay (`:8554`) -> FFmpeg middle-lens crop -> MediaMTX
> `rtsp://127.0.0.1:8555/sign` -> `edge_main.py` (OpenVINO detector council + `vision/pipeline.py` +
> visitd's `VisitTracker`), on the shop's Windows PC NicksMax under the SYSTEM supervisor
> `scripts/nicksmax/nicksmax-camera-supervisor.ps1` (~30 s loop). It posts visits and heartbeats to BOTH
> nickstire (`/api/camera/visits`, `/api/camera/heartbeat`) and StateNour (`/api/devices/{id}/events`).
> The office counter lane (`vision/officewake.py`, Eufy `/record` audio -> local whisper -> text only;
> stills to a cloud vision model) is a second producer on the same box: `docs/SHOP-PC-RUNBOOK.md` section 8.
> Host receipts: `docs/operations/NICKSMAX-CAMERA-HOST-2026-09-28.md`. The Frigate + MQTT + PoE design
> below is the ADR-0017 plan and the Docker lab lane; `visitd` (state machine, ledger, outbox, cloud
> client) is shared by both and is what the sections on delivery, metrics and troubleshooting describe.

Frigate 0.17.2 does detection, tracking, zones and plate reading on the shop LAN; `visitd` (this package) turns
Frigate's MQTT stream into deterministic **visits** and ships idempotent events to statenour
(`https://bdnick.info`). Spec: `docs/research/2026-09-08-camera-vision-MASTER-PLAN.md` sections 4.2, 6, 8.2, 9, 11, 13, 15.

```
SHOP LAN (camera VLAN later)                                              CLOUD
+-----------+  RTSP   +--------------------+  MQTT (user/pass)  +-------------------+  HTTPS x-sync-key  +--------------------+
| PoE cam A |-------->| Frigate 0.17.2     |------------------->| visitd 2.1.2      |------------------->| statenour-web      |
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
5. `curl -s 127.0.0.1:9090/metrics` on the box shows the visitd counters (the compose file sets
   `VISITD_METRICS_HOST=0.0.0.0` inside the container so the loopback-published port reaches it; `metrics.host` in
   `config.yaml` stays `127.0.0.1` for host runs); the cockpit gets them through the heartbeat.

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
| Frigate config schema check (no camera) | copy `frigate/config.example.yml` to a scratch dir as `config.yml`; `docker run --rm -e FRIGATE_RTSP_PASSWORD=x -e FRIGATE_MQTT_PASSWORD=x -v <dir>:/config ghcr.io/blakeblackshear/frigate:0.17.2 python3 -u -m frigate --validate-config` | no `Config Validation Errors` block in the log (Frigate then tries to start; the `ov` GPU detector failing under Docker Desktop is expected - section 3 step 4). Receipt 2026-09-08: this check caught a real bug - a GLOBAL `review.alerts.required_zones` must exist on every camera, so it is now per camera |
| Broker + visitd on Docker, no camera (`lab/`) | from `camera-bridge/`: `docker volume create lab-mqtt-config` ; one-off `eclipse-mosquitto:2.0` container copies `mosquitto/mosquitto.conf` into it and runs `mosquitto_passwd` (users visitd / frigate) ; `cp config.example.yaml config.yaml` ; `docker compose -f lab/lab-compose.yml up -d --build` (the file's paths are written relative to `lab/`, so it works from any cwd) ; `docker exec lab-visitd python /lab/lab_publish.py /lab/fixtures/arrival_and_leave.jsonl 20` | visitd log: ENTERED_ZONE -> ARRIVAL_CANDIDATE -> CONFIRMED_ARRIVAL -> LEFT (estimated, ~20 s after the `end`); `curl 127.0.0.1:9090/metrics` shows `visitd_cloud_events_total{result="dry_run"} 4`, `visitd_outbox_depth 0`. Receipt 2026-09-08 on this laptop (Docker Desktop 4.88.1, engine 29.7.2) |
| Cloud round trip (G0) | run visitd WITHOUT `--dry-run` after the dry-run JSONL: `python -m visitd.main --config config.yaml --replay data/dry-run-*.jsonl --ledger data/lab.sqlite` posts nothing (replay is always dry-run); instead publish with `dry-run-event.ps1` against a live visitd | Railway http log shows `POST /api/devices/v380-shopsign/events 200`; `/system/camera` shows the visit |
| Video loop | `powershell -File scripts/replay-fixture.ps1 -Source <clip.mp4> -Name sign` and follow the printed steps | one visit chain per real car in the clip, 24 h without exceptions (gate G1) |

Fixtures: `arrival_and_leave.jsonl` (park, plate, leave), `pass_through.jsonl` (4 s drive-through), `split_track.jsonl`
(Frigate re-ids a parked car after occlusion; visitd keeps one visit). Regenerate with `python tests/fixtures/make_fixtures.py`.

## 8. Visit model in one screen

States: `DETECTED` (not sent) -> `ENTERED_ZONE` -> `ARRIVAL_CANDIDATE` (10 s in an arrival zone, or stationary) ->
`CONFIRMED_ARRIVAL` (45 s, or stationary >= 20 s; priority high) -> `IN_SERVICE` (bay zone) -> `DEPARTING` (not sent,
20 s grace) -> `LEFT`; `PASS_THROUGH` when it left before ever being a candidate (priority low). Tick-driven promotions
carry `estimated: true` and are re-sent with `estimated: false` on the next Frigate message for that visit.
A Frigate `end` never emits `LEFT` by itself: the visit goes `DEPARTING` and `LEFT` / `PASS_THROUGH` follows once the
20 s grace (>= `splitTrackSeconds`) passes without a split track or topology hop rejoining it, tick-driven and
therefore always `estimated: true`.

Identity, in order: same-camera track split (<= 10 s, IoU >= 0.5) - plate match to an open visit (hard reject when two
>= 0.9 reads differ by Levenshtein >= 2) - `topology` hop (`sign -> lot` within 1-90 s) - else a new `visitId` (UUID).
A visit absorbed by a plate match after it already emitted gets a final `LEFT` with `metadata.mergedIntoVisitId`.
A visit closed by the grace after a `maxSightingSeconds` force-end is never resurrected: when Frigate updates the
same object id again (the car never moved) the new `visitId` carries `metadata.continuesVisitId` = the closed one on
every emission, its `CONFIRMED_ARRIVAL` is priority `normal` instead of `high`, and
`visitd_tracker_max_age_continuations_total` counts it (map of closed ids: TTL `maxSightingSeconds`, 1000 entries,
rebuilt from the ledger on restart).

Event: `eventId = sha1(visitId|state|seq)` (cloud dedupes), `timestamp` from `frame_time`, `data.plate.status` in
NONE / UNREADABLE / CANDIDATE / CONFIRMED, `data.metadata.snapshotRef = events/<sightingId>/snapshot.jpg`
(fetch through the Frigate API only; 0.18 stops writing jpgs to disk).

## 9. Service install (Windows lab only)

`powershell -File scripts/install-windows-service.ps1` registers a Scheduled Task as the **current user** at logon
(auto-restart every minute, log in `logs\visitd.log`) that runs a generated `visitd-task.cmd` wrapper (re-run the
installer after moving the tree). `-RunAsSystem` opts into SYSTEM at startup from an elevated shell; `-Uninstall`
removes task and wrapper; `-DryRun` prints the plan. Production runs under Docker Compose with
`restart: unless-stopped`; nothing on Windows is production.

> **Corrected 2026-09-09.** That sentence described the plan, not the measurement. The only
> pixel source proven against the real SHOPSIGN feed is **Windows Graphics Capture of the V380
> client on the Windows machine** (`vision/capture.py::WgcWindowSource`, 12.9 fps, occluded-window
> safe); RTSP on these exact V380 units is still UNVERIFIED (ports 8800/9800 only until the
> `ceshi.ini` unlock is proven). Until that flips, **Windows + WGC is a supported edge source**, not
> a lab curiosity, and the Linux/RTSP path in section 4 is the intended successor -- it replaces the
> capture stage only; everything from `FrameHealth` down to `visitd` is shared.

### The durable edge runtime — `edge_main.py` (2026-09-09)

`vision/run_live.py` is the LAB lane: it runs the whole vision chain correctly and then
hands its emissions to a bare HTTP sink, so a failed POST is a lost visit. `visitd` owns
the ledger, the outboxes, retries and restart recovery but is fed by MQTT from Frigate,
which cannot see a P2P-only V380. The two halves of a production sensor were built and
never joined. `edge_main.py` joins them:

```
frame -> VisionPipeline.step()            pixels -> emissions (all the vision invariants)
      -> Pipeline.after_step(emissions)   visits + StateNour outbox + shop outbox, ONE txn
      -> CloudClient worker               drains StateNour, retries, dead-letters
      -> Pipeline.drain_shop()            drains the shop projection, retries
```

There is exactly ONE `VisitTracker`: visitd's `Pipeline` builds it (restoring open visits
from the ledger, so a restart resumes the cars that were on the lot) and the vision
pipeline is handed it via `tracker=`. The tick belongs to `VisionPipeline.step()`, which
already calls it -- this loop owns only the heartbeat and the shop drain.

```powershell
cp config.example.yaml config.yaml     # then set backend.shopUrl + cameras.<name>
$env:CAMERA_INGEST_KEY = "<the shop ingest secret>"
python edge_main.py --config config.yaml --camera sign `
  --calibration ./scratchpad/shopsign_calibration.json --fps 4
```

Without `--calibration` it runs in CENSUS MODE: the portal polygon is empty so no arrival
can be fabricated, and the heartbeat reports a missing calibration, which the shop renders
as `CALIBRATION_INVALID` rather than healthy. `--commissioning-run C-YYYYMMDD-NNN` tags
every row `COMMISSIONING`, which the shop excludes from its KPIs by default and never
deletes. `--dry-run` silences StateNour only; the shop lane is unaffected.

The shutdown line is the receipt, and it counts DELIVERIES, not attempts:

```
edge stopping frames=190 read_failures=0 heartbeats=4/4 delivered visits=0/0
      outbox=0 shop_queue=0 dead_letters=0
```

`config.yaml` and `data/` are gitignored: the first carries this site's ingest URL and
cloud device ids, the second is the ledger.

### Running it 24/7 on Windows (2026-09-09)

```powershell
powershell -File scripts/doctor-edge-runtime.ps1 -Calibration .\scratchpad\shopsign_calibration.json
powershell -File scripts/install-edge-runtime.ps1 -Role shop -EncryptSecret -Calibration .\scratchpad\shopsign_calibration.json
Start-ScheduledTask -TaskName NickEdgeProducer
```

**At logon, never as SYSTEM.** WGC reads a window on the INTERACTIVE DESKTOP; a service
runs in Session 0, which has no desktop, so a SYSTEM task would start, find no window and
stall forever while looking perfectly healthy in Task Scheduler. The doctor treats a
service-account principal as a FAIL for exactly that reason. Revisit once RTSP is proven.

**Two supervision layers, and the boundary between them is deliberate.** The OS restarts a
process that DIED. The process exits 3 itself when it is ALIVE but its source stopped
delivering (`--stall-exit-seconds`, default 180 s), which the OS layer cannot see. A frozen
or looping camera is NOT a stall -- it still delivers frames, the pipeline already reports
DEGRADED_VISION and suppresses detections, and restarting on it would only loop against a
dirty lens.

**The secret is never plaintext beside the code.** `-EncryptSecret` reads
`CAMERA_INGEST_KEY` from `.env.local` once and writes a DPAPI blob under `secrets/` that
only that user on that machine can decrypt; the generated wrapper decrypts it into the
child's environment, so the key never reaches a command line (Task Manager shows those) or
a log. `secrets/`, `logs/` and the generated `edge-task.cmd` are gitignored.

`doctor-edge-runtime.ps1` exits with the number of FAILs, so it is scriptable. WARN and
FAIL differ on purpose: FAIL means it cannot do the job, WARN means it will run and report
its limits honestly -- no calibration is a WARN because census mode is a legitimate state
that reports itself as `CALIBRATION_INVALID` rather than pretending to be healthy.

### Producer heartbeat (2026-09-09)

Both producers now report the INFRASTRUCTURE fact to the shop, apart from visits, at
`POST /api/camera/heartbeat` (same `x-sync-key` as the visit ingest; migration 0120):

| producer | cadence | what it can honestly report |
|---|---|---|
| `vision.run_live --post-to ... [--heartbeat-seconds 30]` | every 30 s | source type + generation (`<mux index>.<restores>`), fps, `FrameHealth.ok`, pose (once a reference exists), calibration id, detector, model sha256, open visits |
| `visitd` live loop | with the StateNour heartbeat | broker+Frigate connectivity, outbox / dead-letter depth, open visits, per-camera `calibrationVersion` / `cameraPose` / `detectorName` from `config.yaml` |

The shop derives one state per camera from the lattice (NEVER_INGESTED / PRODUCER_OFFLINE /
STALE / CAMERA_OFFLINE / CALIBRATION_INVALID / DEGRADED_VISION / CLOUD_BACKLOG / HEALTHY) and
keeps the dimensions, so a quiet lot reads HEALTHY and a dead producer no longer hides behind
"no visits". `run_live --commissioning-run C-YYYYMMDD-NNN` tags every row `COMMISSIONING`, which
the shop excludes from KPIs by default and never deletes.

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
| `cloud dropped ... reason=sync_key_rejected` | `STATENOUR_SYNC_KEY` differs from Railway | fix `.env`; since 2026-10-07 the payload is parked in the ledger's `dead_letter` table for 7 days (not deleted) and raises `deadLetterDepth` in the heartbeat, so the shop reads CLOUD_BACKLOG and pages instead of staying green |
| `cloud dropped ... reason=http_404` | `cloudDeviceId` is not a statenour `platformDeviceId` | check `smart_devices.platform_device_id`; the cloud resolves id OR platformDeviceId since PR `statenour/camera-arrival-p0`; the refused payload is parked in `dead_letter` |
| `cloud blocked reason=missing_sync_key` | key not in env | events wait in the outbox (max 5000); set the key and restart |
| events stuck, `visitd_outbox_depth` grows, `cloud retry ... status=0` | WAN down / DNS | nothing to do; flushes in order on reconnect, cloud dedupes by `eventId` |
| `cloud dead-lettered event_id=...` | the cloud answered ONE event with an HTTP error (5xx/429) `outboxMaxAttempts` times: a poison payload | delivery moves on; the row waits 7 days in the ledger's `dead_letter` table (`sqlite3 data/visitd.sqlite "select event_id,last_status,last_error from dead_letter"`); `deadLetterDepth` is in the heartbeat |
| `outbox full ... refused event_id=...` | outbox at `outboxMaxDepth` with only OPEN visits queued (nothing terminal to evict) | the row is dropped and counted (`visitd_outbox_refused_total`); fix whatever stalls delivery (the `cloud retry` lines above it) |
| visit never becomes CONFIRMED | zone not in `arrivalZones`, or the zone polygon never triggers (draw it in the UI) | `docker compose logs visitd | grep transition`; check `current_zones` in `frigate/events` with `mosquitto_sub` |
| parked car never LEFT | expected: stationary objects keep the visit open until Frigate `end` (no time-based purge before `maxSightingSeconds`) | after the `end` LEFT follows 20 s later (`estimated: true`), whether the track ended inside or outside the zone |
| `LEFT` arrives with `estimated: true` and a still-alive track | grace expired while the car sat outside every zone | normal; re-entry later starts a new visit |
| `ignored_unknown_camera` climbs | Frigate camera name missing from `config.yaml` `cameras` | add it (the `replay` camera too) |
| metrics port busy | another visitd on the host | change `metrics.port` |
| Frigate CPU pegged on Docker Desktop | `ov` detector left enabled | switch to `cpu1`, 5 fps, 1280x720 detect |
| `The operation was canceled` in CI | a sibling merge superseded the run | rerun |
| Docker Desktop dies at start: `initializing Ingest server ... .sock: remove ...: The file cannot be accessed by the system` (or the same for `docker-secrets-engine/engine.sock`) | Windows 11 26200 makes a unix-socket file undeletable once its process exits; Docker's remove-then-listen crash-loops on the leftover | stop every `docker*` process, RENAME `%LOCALAPPDATA%\Docker\run` and `%LOCALAPPDATA%\docker-secrets-engine` (e.g. `.broken-<time>`), relaunch. Not a factory reset. A reboot clears the stuck files for good |
| `docker pull` / `docker images` fail with `input/output error` in `/var/lib/desktop-containerd` | host C: ran out of space under the WSL2 disk image | free C: (turbo cache, pnpm store prune, Temp), then the socket recipe above if the engine died; the partial pull is rolled back |

## 12. What changed from v1 (defect register 4.2)

| # | v1 defect | v2 fix |
|---|---|---|
| E1 | ingest URL embedded the id; heartbeat URL derived by string replace | `cameras.<name>.cloudDeviceId` -> `POST /api/devices/{id}/events` and `PATCH /api/devices/{id}` built by `cloud_client.events_url/device_url` |
| E2 | relative zone coordinates on Frigate 0.13.2 (pixel zones) + `rtmp` role | Frigate pinned `0.17.2`; zones relative by design; go2rtc restream, `detect`/`record` roles |
| E3 | `current_zones[0]` on every `end` -> `IndexError` | LEFT uses the sighting's last known zone; `tests/test_state_machine.py::test_end_with_empty_current_zones_enters_departing_and_left_follows_after_the_grace_from_the_last_known_zone` |
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

### v2.1 (review round 2)

| # | Finding | Fix |
|---|---|---|
| 1 | a plate read re-parented a sighting mid-snapshot; the next read used the stale visit (`KeyError`, every later message for that object dropped) | `_apply_snapshot` re-resolves the visit after each read; `tests/test_stitching.py::test_plate_and_sub_label_on_one_snapshot_reparent_a_split_track_sighting_once` |
| 2 | sightings Frigate would never `end` (its registry lost on restart, runaway track) stayed open forever | force-end on `frigate/available` offline -> online and after `maxSightingSeconds`; `visitd_tracker_force_ended_total{reason}` |
| 3 | one poison payload wedged the outbox behind endless 5xx retries | parked in the `dead_letter` table after `outboxMaxAttempts` HTTP failures (transport failures never count); `deadLetterDepth` in the heartbeat |
| 4 | the ledger grew without bound | hourly housekeeping: terminal visits past `ledger.retentionDays`, dead letters after 7 days, then a WAL checkpoint |
| 5 | the outbox cap evicted the oldest ROWS, so the cloud could receive a LEFT for a visit whose arrival was thrown away | eviction by WHOLE terminal visit, oldest first; when only open visits are queued the new row is refused and counted (`visitd_outbox_refused_total`) |
| 6 | a step's outbox rows and its visit update were two transactions; a crash between them reloaded the visit one seq behind its queued events | `Ledger.commit_step`: visits and outbox rows in one BEGIN/COMMIT |
| 7 | paho queued `time.time()` and the main thread stamped `time.monotonic()` at dequeue: elapsed time understated under backpressure | the monotonic receipt time travels with the message (`Pipeline.process_inbox_item`) |
| 8 | inbox-full drops only bumped a counter | `mqtt inbox full ... dropped=N` warning at most once per 60 s, carrying the drops since the last one |
| 9 | `install-windows-service.ps1` interpolated paths into a cmd.exe argument string (`& \| ^ %` unescaped) | generated `visitd-task.cmd` with double-quoted tokens, `%` doubled, newline-bearing paths refused; `-Uninstall` removes it |
| 10 | `docker-compose.yml` published no visitd port, so section 4 step 5 could not work | `127.0.0.1:9090:9090` on the visitd service (set `metrics.host: 0.0.0.0` in the container's config.yaml) |
| 11 | a Frigate `end` outside every zone emitted LEFT at once, so rule 1 (split-track stitching within `splitTrackSeconds`) could never fire | `end` -> `DEPARTING`; LEFT / PASS_THROUGH only after the 20 s grace, `estimated: true`; `test_new_track_within_split_window_after_an_end_outside_the_zone_rejoins_the_same_visit` |

### v2.1.1 (review round 3)

| # | Finding | Fix |
|---|---|---|
| A | `after_step` drained closed visits from the tracker BEFORE `commit_step`; a failed commit (disk I/O, disk full) rolled the ledger back to the open visit while memory had already forgotten it, so the next restart resurrected a stale visit and the LEFT never reached the cloud | commit first, drain only on success; the closed visits stay buffered (`VisitTracker.closed_visits`) and the step's outbox rows are held, so the next step re-commits the same seq / `eventId`; `log.error` on the failure; `tests/test_main.py::CommitFailureTest` |
| B | a max-aged track that Frigate kept updating was force-ended again on every later tick; an update gap longer than the leave grace closed the visit and the next update minted a second `visitId` for the same parked car | `maxSightingSeconds` fires once per track (`Sighting.max_age_fired`, persisted); a resurrected track is a real parked car and stays one visit until Frigate ends it; `test_max_age_fires_once_per_track_so_a_resurrected_parked_car_stays_one_visit` |
| C | under backpressure the live loop processed ONE queued message and then ticked with the current wall clock, so an exit + quick re-entry that were both already queued (received while a heartbeat blocked the loop) split into two visits: the tick emitted LEFT before reading the re-entry | `Pipeline.consume_inbox` drains every queued item in receipt order before the loop ticks; `test_every_queued_message_is_consumed_before_a_tick_so_exit_and_quick_reentry_stay_one_visit` |
| D | the documented setup copies `config.example.yaml` (`metrics.host: 127.0.0.1`), which inside the container binds only the container's loopback, so the published `127.0.0.1:9090` reached nothing (row 10's manual step was easy to miss) | env `VISITD_METRICS_HOST` overrides `metrics.host`; `docker-compose.yml` sets it to `0.0.0.0` on the visitd service, the file default stays loopback for host runs; `test_env_metrics_host_overrides_the_file` |

### v2.1.2 (review round 4)

| # | Finding | Fix |
|---|---|---|
| E | a max-aged track that got no update during the leave grace was closed and its sighting mapping dropped, so the next update for the SAME Frigate object id (still parked, Frigate never sent `end`) minted an unrelated second `visitId` (row B only helped while the update beat the closure) | the tracker remembers max-age-closed sighting ids (TTL `maxSightingSeconds`, 1000 entries, recomputed from the ledger's terminal visits on restart); the terminal visit stays closed, the new visit carries `metadata.continuesVisitId`, its `CONFIRMED_ARRIVAL` is priority `normal`, `visitd_tracker_max_age_continuations_total` counts it; `tests/test_state_machine.py::test_max_age_closed_track_that_updates_again_continues_the_old_visit_without_a_high_alert`, `tests/test_ledger.py::test_max_age_continuation_map_survives_a_restart` |
| F | `consume_inbox` took messages until the queue was empty, so under sustained ingress it never returned and the tick, heartbeat and housekeeping behind it starved (stationary visits stuck, devices marked OFFLINE while the bridge was busy) | one pass drains what `qsize()` reported once the first item was in hand, capped at `mqtt.inboxBatchMax` (500), then returns so the periodic work runs; the next pass keeps draining in receipt order (row C's guarantee holds for everything queued at entry); `tests/test_main.py::test_consume_inbox_returns_after_the_snapshot_or_the_cap_so_the_periodic_work_runs` |

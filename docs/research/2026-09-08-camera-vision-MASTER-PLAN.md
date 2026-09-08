# Nick's Tire & Auto - Camera / Vision Intelligence - MASTER PLAN

**Date:** 2026-09-08 · **Author:** Claude (Fable 5.1) with 7 audit/research agents · **Operator:** Nour (on-site at the shop while this was written)
**Pinned to:** `origin/main @ fd0164bc2` (worktree `.worktrees/camera-vision`); camera code last touched by #315 (`c61f21606`, 2026-06-23) and #346 (`efd71a41a`, 2026-06-26).
**Method:** 3 read-only code audits (edge · statenour cloud · nickstire + cross-cutting) + 4 web research agents (V380 · Frigate · tracking/ALPR/hardware · cameras/network/Ohio law) + live LAN probes from the shop Wi-Fi + production DB/Railway probes via MCP. Agent reports are summarized here; every number below carries its evidence class.

Evidence classes: **A** verified current code at the pinned SHA · **B** verified rendered UI · **C** verified runtime / live probe (LAN, prod DB, Railway) · **D** first-party dated source (vendor docs, statutes, release notes) · **H** inference / design decision · **I** unknown. No numeric confidence anywhere.

---

## 0. Execution log (updated as work lands)

| Slice | Branch / PR | Status |
|---|---|---|
| This plan + ADR-0017 + UPSTREAMS rows | `docs/camera-vision-master-plan` | PR #2223 (`d311b499a`) |
| Cloud fixes (P0 device lookup, day boundary, silent-zero cockpit, `getPlates`, quiet hours, heartbeat sentinel, plate->customer link, route-level tests) | `statenour/camera-arrival-p0` | PR #2222 (`94d2307e7`), CI pending |
| Edge v2 (`camera-bridge/` rewrite: visit state machine, SQLite ledger/outbox, Frigate 0.17.2 config, mqtt auth, replay harness, unit tests) | `chore/camera-bridge-v2` | see PR link when landed |
| nickstire `vehicle_lookup_by_plate` bridge action (memberships plates; no migration needed) | `nickstire/vehicle-lookup-by-plate` | PR #2221 (`919e196b8`), CI pending |
| Typed visit ledger (`vehicle_visits`, `visit_events`, `visit_zone_intervals`) | Phase 3, after first 7 days of real data | designed in section 7, not coded |

---

## 1. The answer

1. **The system exists on the cloud side and has never received a single real event.** PR #315 shipped the ingest route, the `/system/camera` cockpit, Telegram alerts and dedupe (A). Production holds exactly 2 `vehicle_detected` rows, both for the June test device `test-camera-outside`; the two real cameras (`v380-shopinside`, `v380-shopsign`) have 0 events and `last_seen_at = 2026-04-14` (C).
2. **As shipped, the pipeline cannot work even with perfect cameras.** The bridge posts to `/api/devices/v380-shopsign/events`, but every `[id]` route resolves `SmartDevice.id` (a cuid); `v380-shopsign` is `platform_device_id`. Every event and heartbeat returns 404 "Device not found" (A: `app/api/devices/[id]/events/route.ts:36`; C: prod ids `cmn7h45nu0009rls02e3rypx0` etc.). The June test only passed because that test device was created with `id == platform_device_id` (C).
3. **The edge half cannot start as shipped either.** Frigate is pinned to 0.13.2 (2024-02) while its example config uses relative zone coordinates that only exist from 0.14 (D) and a deprecated `rtmp` role; `paho-mqtt` is unpinned across a breaking major; the departure path raises `IndexError`; dwell is wall-clock track age, not zone dwell (A, section 4).
4. **The cameras are the hard blocker; the answer is unlock-if-cheap, replace-for-LPR.** Live probe from the shop LAN at 11:5x ET: both V380 units answer ping and expose only TCP 8800/9800; 554 (RTSP), 8899 (ONVIF), 80/8080 all closed; no ONVIF WS-Discovery responders (C). The app's firmware page (12:09 ET, both cameras) reads `Hw_HsAKQQXG_WIFI_20230421` / `AppKN_VACL4_V1.5.3.0_20250611` (B): the `HsAK` family is the Anyka generation, for which the SD-card `ceshi.ini` unlock is documented to open 554/8899 without any firmware change (D, section 3) - the port fingerprint alone had over-classified them as Xiongmai. Try the unlock on ONE camera (30 minutes, reversible); it yields an unauthenticated RTSP stream good enough for the lot-overview lane and the replay fixture, not for LPR. Two standards-compliant PoE cameras cost $55-130 each (D) and remain the LPR and long-term answer.
5. **Frigate track IDs are not visit IDs and the current dwell is semantically wrong.** Frigate's tracker (Norfair, position-only, no appearance re-ID) splits a car into a new id after >5 s of occlusion and stops updating stationary objects; the bridge measures `time.time() - first_seen` per track and ignores zones (A/D). Section 6 defines a deterministic visit state machine keyed on zone intervals from Frigate `frame_time`, with plate-first identity stitching. No LLM anywhere in the truth path.
6. **Target stack (all MIT/Apache/BSD, offline, $0 software):** Frigate 0.17.2 with go2rtc, native LPR (YOLOv9 + PaddleOCR), zones with `loitering_time`, review items; a rewritten Python edge service (`visitd`) with a SQLite ledger and outbox; statenour Neon as the canonical visit ledger; nickstire reached read-only through the existing `nour-os/query` bridge for plate -> customer -> booking; Telegram + the existing push flood-control for alerts; a Linux mini-PC (N150, ~$190) as the edge box, not the Windows laptop (D).
7. **Costs:** Good $825-1,125 · Better $1,730-2,130 · Best $2,130-2,630 all-in including cabling and an edge box; the Axis P1475-LE LPR option adds ~$495 (Best ~$2,625-3,125) (D, section 17). Fastest path to real data: one $55-130 PoE camera + a $15 injector this week, the full VLAN build later.
8. **Legal (Ohio):** silent video of the lot and bays is lawful; never restrooms/changing areas (ORC 2907.08); audio is one-party consent (ORC 2933.52) but disable it anyway; no Ohio statute restricts private ALPR; plate-to-owner lookups are barred by DPPA/ORC 4501.27; retention 30-90 days, plates <=30 days unless tied to a customer record; no face recognition on customers (D, section 14).

---

## 2. Ground truth - receipts

### 2.1 Repository (A)

| Fact | Value |
|---|---|
| Edge code | `camera-bridge/` (vendored, non-workspace): `bridge/{bridge.py,client.py,dedupe.py,storage.py,cleanup.py,plate_reader.py}`, `frigate/config.example.yml`, `docker-compose.yml`, `scripts/{test-rtsp,dry-run-event,install-windows-service}.ps1`; `__pycache__/*.pyc` are git-tracked |
| Frigate pin | `ghcr.io/blakeblackshear/frigate:0.13.2` (`docker-compose.yml:25`); Mosquitto 2 started with `/mosquitto-no-auth.conf` (`:18`); `privileged: true` + `/dev/bus/usb` (`:23,31`); `5000:5000` published on the LAN |
| Python deps | `paho-mqtt>=1.6.1`, `requests>=2.28.0`, `pyyaml>=6.0`, `python-dotenv>=1.0.0` - no upper bounds; `plate_reader.py` imports `easyocr`, `cv2`, `numpy`, none listed |
| Cloud ingest | `apps/statenour/app/api/devices/[id]/events/route.ts` (POST, `auth: "sync"` = header `x-sync-key` vs `STATENOUR_SYNC_KEY`, `lib/auth-guard.ts:55-62`); `vehicle_detected` -> `lib/services/vehicle-detection.ts::handleVehicleEvent` |
| Cloud state model | `SmartDevice` (`id @default(cuid())`, `platformDeviceId @unique`), `DeviceEvent` (`data Json?`), `DeviceCommand`; no Visit/Plate model (`prisma/schema.prisma:1323-1380`) |
| Cockpit | `app/(mastery)/system/camera/page.tsx` polls `trpc.system.cameraArrivals` every 5 s; `lib/trpc/routers/system/devices.ts:200-252` |
| Chat tools | `lib/ai/agent-actions/camera-actions.ts` (4 handlers, wired in `nick-agent.ts:393-403`); `lib/brain/camera-intelligence.ts` (`getCameraIntelligence` live; `analyzeCameraData` has zero callers) |
| Flag | `NICK_ARRIVAL_INTELLIGENCE` (`lib/feature-flags.ts:437-444`, default off, gates Telegram only, not DB writes) |
| Legacy | `apps/statenour/local-agent/v380_agent.py` - liveness poller (TCP 554 / ping / PPCS relay), no video; dormant since 2026-05-01 per `docs/agent/DEVICE_DIAGNOSTIC.md:5-9`; nothing schedules it |
| nickstire | `vehicles.licensePlate varchar(20)` (unindexed) and `memberships.vehiclePlate` are the only plate columns; `bookings` has no plate; `bays` (`currentWorkOrderId`, `currentTechId`, `type`, `hasLift`) and `workOrders.assignedBay` exist (`drizzle/schema.ts:2094-2115, 2120-2180, 2880-2892`); `server/services/cameraProxy.ts:162-225` polls statenour `GET /api/devices` for snapshot metadata only |
| Bridge contract | `docs/NICKSTIRE-QUERY-CONTRACT.md` (mirrored in both apps): `POST /api/nour-os/query` with `x-sync-key`, 18 actions incl. `customer_search`, `customer_detail`, `bookings_today`; none touch plates |
| UPSTREAMS | row 58 Home Assistant WATCH ("camera-bridge + SmartDevice are the incumbents"); row 111 Auto-Editor WATCH ("camera-bridge is outdoor front-lot ALPR with no bay angle"); rows 87/88 reject CDC/outbox until a write lane exists; no Frigate/YOLO/Coral row |

### 2.2 Production (C, probed 2026-09-08 via Neon + Railway MCP)

| Fact | Value |
|---|---|
| `smart_devices` V380 rows | `v380-shopinside` id `cmn7h45mu0008rls0letng4og` OFFLINE last_seen 2026-04-14; `v380-shopsign` id `cmn7h45nu0009rls02e3rypx0` OFFLINE last_seen 2026-04-14 (`current_state.lan_ip = 192.168.1.156`, i.e. the HOME subnet, `rtsp_url .../live/ch00_0`, cloud ids 119923618 / 119972829); `v380-main` ONLINE never seen; `test-camera-outside` (id == platform id, created 2026-06-24) |
| `device_events` | 2 rows total, both `vehicle_detected` from `frigate` for `test-camera-outside`, last 2026-06-24 22:18Z |
| `vision_events` | 24 rows, 2026-03-25..27, legacy `nour-os-unified` experiments (YOLO on V380 app screenshots, moondream captions) - not this pipeline |
| Railway `statenour-web` vars | `STATENOUR_SYNC_KEY` set (value redacted to OAuth connectors); `NICK_ARRIVAL_INTELLIGENCE` NOT set -> flag off; `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` set |
| Railway http log (20 min window) | nickstire polls `GET /api/devices` (srcIp 162.220.232.68, UA `node`); zero `POST /api/devices/*/events` |

### 2.3 Shop LAN, 2026-09-08 11:35-12:05 ET (C)

| Fact | Value |
|---|---|
| Probe host | this laptop (`nattynour`, Tailscale 100.118.151.61), Wi-Fi `NICKS TIRE AND AUTO WIFI`, 802.11ax 5 GHz ch 52, IP 192.168.0.174 |
| Gateway | 192.168.0.1, MAC 80:82:FE:23:70:67 = Arcadyan Corporation (api.macvendors.com), HTTPS title "Fios Router" -> Verizon Fios gateway; 802.1Q VLAN capability on the LAN ports: I (assume none; plan uses a downstream VLAN switch/router) |
| Shop PC (memory: 192.168.0.157) | not on the LAN today (ping sweep found only .174) |
| SHOPINSIDE | 192.168.0.154, MAC 1C:4E:A2:C2:CE:37 (Shenzhen V-Link Technology = Wi-Fi module vendor, not the SoC), ping OK, open TCP: **8800, 9800** only |
| SHOPSIGN | 192.168.0.155, MAC 1C:4E:A2:C2:F0:6D, ping OK, open TCP: **8800, 9800** only |
| Closed on both | 80, 443, 554, 5050, 5051, 8000, 8080, 8899, 23, 22, 34567 |
| Firmware (V380 Pro app, both cameras, identical) | software `AppKN_VACL4_V1.5.3.0_20250611`; firmware `Hw_HsAKQQXG_WIFI_20230421`; keep-alive server `AppV380E2201_LP_V1.2.5_20240416` (B, operator screenshots 12:08-12:09 ET). Both cameras show the app's `LAN` badge; the IP page offers DHCP (current, .154/.155) or manual IP/mask/gateway/DNS; no ONVIF switch was found in the app |
| ONVIF WS-Discovery (239.255.255.250:3702) | no responders, 2 probes, 4 s window |
| Earlier in the session | both cameras dropped off entirely for ~15 min (ARP stale, no ping) and returned - consistent with a power/Wi-Fi blip, not with anything I ran |

### 2.4 Edge host candidate on hand (C)

| Fact | Value |
|---|---|
| This laptop | Intel Core Ultra 7 266V (8C, NPU), Intel Arc 140V iGPU, 15.7 GB RAM, Windows 11 Pro 26200, **6 GB free on C:** |
| Docker | Docker Desktop 29.7.2 installed, engine was not running at probe time |
| Python | 3.14.4; `paho-mqtt 2.1.0`, `requests 2.34.2`, `PyYAML 6.0.3`, `python-dotenv 1.2.2`, `numpy 2.4.6`; no `easyocr`/`cv2` |
| ffmpeg | 8.1 full build (`ffprobe` on PATH) |
| V380 desktop client | `C:\Program Files (x86)\V380\V380.exe` (2026-04-09), can LAN-search and record MP4 locally (`MP4Writter.dll`); `Documents\V380\{Record,Screenshot}` empty |

Verdict on this laptop as the edge box: excellent silicon (OpenVINO NPU + Arc), wrong OS and wrong role - Frigate is unsupported on Windows/WSL2 for iGPU/NPU passthrough (D, section 5) and the disk is nearly full. It is the operator's mobile workstation, not a fixture at the shop.

---

## 3. Camera decision - the branch that decides everything

### 3.1 What today's probe means (D + C)

The V380 ecosystem ships two hardware generations (D: SolveSoul gist + 120 comments through 2026-08; blog.caller.xyz; vladko312 research):

| Generation | Firmware strings | LAN fingerprint | RTSP/ONVIF |
|---|---|---|---|
| Anyka AK3918 era (2016-2024) | `HwV380E...`, `Hw_HsAk...`, `AK3918E-V200_V.2.5.9.5` | 554 + 8899 open after enable; sometimes open by default | Enable via app (Settings -> Advanced settings -> ONVIF) or `ceshi.ini` SD-card trick; unauthenticated on LAN; can revert after power cycle |
| Xiongmai era (2024+, all 3-lens) | `HsXM...`, `AppXM5...` | **only 8800 (+9800)** | No native RTSP/ONVIF; `ceshi.ini` ignored, some units factory-reset themselves |

Both cameras show the locked port fingerprint (C), but the firmware string `Hw_HsAKQQXG_WIFI_20230421` (B) puts them in the Anyka `HsAK` family, not Xiongmai - the port fingerprint alone over-classified them. The closest reported successes are `Hw_HsAkQQVL_WF_QQ_20240412` (dual-lens BQ8, 2024) and the 2026 dual-lens reports, all through `ceshi.ini`; the units that fail or reset are `HsXM`/`AppXM5`/3-lens (D). No ONVIF switch exists in this app build (B), so the SD-card path is the one to try - on one camera first.

### 3.2 Decision tree

```
App has an ONVIF switch?                                   -> NO (B, this app build)
Firmware strings Anyka-era (HwV380E / HsAK)?               -> YES: Hw_HsAKQQXG (B)
  -> Try ceshi.ini ONCE on ONE camera (3.3 step 4); verify with ffprobe or a
     phone RTSP viewer; power-cycle twice to test persistence.
     Success -> Native RTSP for the overview + replay lane: VLAN-isolate, nightly
                ffprobe health check (the unlock can revert), accept no audio and
                no auth. Never the LPR camera.
     Fail    -> stop. No extra ini keys, no factory reset (loses the cloud binding,
                adds no features), no protocol bridge (section 3.4).
In every branch: order the PoE overview camera now, the LPR camera after the survey.
```

Today's evidence puts us on the **UNLOCK-THEN-REPLACE** branch: the unlock buys real footage this week; the PoE cameras buy LPR and a supportable system.

### 3.3 TODAY - while on site (ordered, zero brick risk)

1. **Record identity** - DONE 12:09 ET: firmware `Hw_HsAKQQXG_WIFI_20230421`, software `AppKN_VACL4_V1.5.3.0_20250611`, both cameras; IPs, MACs and the port fingerprint are in section 2.3. Still worth one photo each: the label QR (payload decodes to `V380^<deviceID>^<hardware code>^...`).
2. **ONVIF switch** - checked, absent in this app build. Nothing to toggle.
3. **Addresses:** keep DHCP but reserve 192.168.0.154 / .155 for the two camera MACs in the Fios router (Advanced -> DHCP reservation), so the Frigate config never chases an IP. The app's Manual-IP page works too (IP/mask/gateway/DNS), but a camera-side static inside the router's DHCP pool can collide - reservation is the safer of the two.
4. **The unlock (Anyka `HsAK`, this unit) - ONE camera first, the SHOPSIGN unit (it is the one the pipeline needs):** any microSD card formatted FAT32 (the recording card already in the camera is fine); put a text file named `ceshi.ini` in the card's root containing exactly:
   ```
   [CONST_PARAM]
   rtsp=1
   rtsp_enable=1
   rtsp_ctrl=1
   onvif_enable=1
   ```
   Then: power the camera off -> insert the card -> power on -> wait 5 minutes (a Chinese voice prompt means it entered test mode; silence is also fine) -> power off -> take the card out and delete `ceshi.ini` (put the card back if it was the recording card) -> power on. Re-pair in the app if it asks. Never add port or password keys to the ini (a 2023 report lost Wi-Fi access that way). Leave SHOPINSIDE untouched until SHOPSIGN is proven.
5. **Validate a stream** from any phone on the shop Wi-Fi (VLC for Android/iOS -> Open Network Stream): `rtsp://192.168.0.155:554/live/ch00_1` (HD), then `/live/ch00_0` (SD); if either plays, the unlock worked. From the laptop: `ffprobe -rtsp_transport tcp -v error -show_streams rtsp://192.168.0.155:554/live/ch00_1`, also `/stream`, `/profile0`, `/onvif1`, `/11`, with and without `admin:<app password>@`. ONVIF: `POST http://<ip>:8899/onvif/device_service` with a `GetDeviceInformation` SOAP body returns Manufacturer/Model/FirmwareVersion. Then power-cycle the camera twice and re-test: the unlock is known to revert on some units, and a revert means a nightly ffprobe health check plus a repeat after any outage.
6. **Record a replay fixture** in the V380 desktop client: 10-15 min of the SHOPSIGN view during traffic, saved to `Documents\V380\Record`. This file is looped into Frigate as a camera (section 11) so the whole pipeline is validated before any new camera arrives.
7. **Physical survey for placement** (section 10): photos from each proposed mount, distance from mount to the entrance lane and to the bay doors, mount height, existing conduit/soffit paths for Cat6, where the Fios router sits, whether a PoE injector can plug into it today.
8. **Order the Phase-1 camera** (operator purchase - not automated): the lot camera from section 17 Good tier plus a PoE injector, so real data starts this week. The LPR camera waits for the placement survey.

### 3.4 Protocol bridges - assessed and rejected for production (D)

| Project | What it does | Maintenance | Verdict |
|---|---|---|---|
| PyanSofyan/V380Decoder (.NET) | decrypts the 8800 stream (AES-ECB session key from the auth ticket) -> RTSP 8554 / ONVIF 8080 / MJPEG; LAN or cloud dispatch over plain HTTP | 14 stars, pushed 2026-07-29, **no license**, prebuilt binaries, `--secure` off by default | Time-boxed lab experiment only |
| felipemarques/camera-v380decoder | fork claiming `AppXM5`/`Hw_HsXMQQFC` (our suspected generation) | 9 stars, 2026-03, no license | Same |
| Vasang123/camera-v380decoder | H.265 / 3-lens, "added with AI assistance... review before security-critical deployment" | 0 stars, 2026-08 | Same |
| prsyahmi/v380 (C++) | H.264 over 8800 -> stdout -> ffmpeg | 123 stars, MIT, 2025-01; fails on encrypted 2024+ firmware | Does not cover our generation |
| go2rtc / Scrypted / Frigate / HA | **zero** V380 code | - | No first-class path exists |

Why rejected: unlicensed code (no right to use commercially), reverse-engineered keys the vendor has rotated once already, unmaintained parsers of untrusted network input, cloud dispatch in cleartext to Alibaba/Huawei-hosted relays (`ipc1300.av380.net`, `dispa1.av380.net:8001`), and a 2023 disclosure of plaintext credentials at fixed packet offsets. A camera that costs $55 removes the entire class of risk. If the operator still wants a look, the only acceptable form is Windows Sandbox on this laptop, LAN-only, camera Wi-Fi isolated, deleted afterwards - and it never feeds the production pipeline.

### 3.5 Firmware modification - last resort, effectively unavailable (D)

OpenIPC lists Anyka SoCs on paper but has shipped zero `ak39*` images in every 2026 release (issues open since 2022); Xiongmai `XM530` needs UART + SPI flash dump + matching sensor driver. Recovery requires a CH341A programmer. Not worth one engineer-hour against a $55 camera.

---

## 4. Defect register (ranked; all A unless noted)

### 4.1 Cloud (apps/statenour)

| # | Sev | Where | Defect | Consequence | Fix (PR `statenour/camera-arrival-p0`) |
|---|---|---|---|---|---|
| C1 | P0 | `app/api/devices/[id]/events/route.ts:36`, `[id]/route.ts:13,36`, `[id]/command/route.ts:13,28` | Lookup by `SmartDevice.id` only; bridge and README use `platformDeviceId` | Every event and heartbeat 404s (C: prod ids are cuids) | `resolveDevice(idOrPlatformId)` helper: `findFirst({ where: { OR: [{ id }, { platformDeviceId: id }] } })`; all downstream writes use the resolved cuid |
| C2 | P1 | `lib/brain/camera-intelligence.ts:56-58` | `analyzeCameraData()` "called by brain-cycle cron" has zero callers; after-hours/long-wait alerts never fire | Silent dead control | Docstring corrected; wiring deferred until real events exist (recorded in RECONCILIATION backlog) |
| C3 | P1 | `tests/services/vehicle-detection.test.ts` | Tests call `handleVehicleEvent` directly; no test imports any `app/api/devices/**` handler | C1 invisible to CI | New `tests/api/devices-platform-id.test.ts` that hits the route handlers with a platformDeviceId, proven to FAIL against the unfixed code first (positive-control-first) |
| C4 | P2 | `app/(mastery)/system/camera/page.tsx:61` | `arrivalsQuery.data || {events:[], todayCount:0, ...}` with no error branch | A 401/500/quota failure renders "0 arrivals today" | Distinct error state (empty-vs-error skill) |
| C5 | P2 | `lib/trpc/routers/system/devices.ts:214-215` | `setHours(0,0,0,0)` on a UTC server = 8 pm ET | "Today" leaks 4-5 h of yesterday | `startOfDayET()` from `lib/utils/datetime` (already used in camera-intelligence.ts:152) |
| C6 | P2 | `lib/ai/agent-actions/camera-actions.ts:66-80` | `camera.getPlates` unconditionally returns `count: 0` | Chat tool lies to the operator | Query `DeviceEvent` for `data.plate.text` over the last N days |
| C7 | P3 | `lib/services/vehicle-detection.ts:124-146` | Only throttle is a 120 s same-zone cooldown; no quiet hours; no push flood-control | 3 am Telegram pages from a flapping detector | Quiet-hours gate (shop hours from a constant, 8 pm-7 am silent unless `priority: high` and after-hours zone) + `sendPush` with tag `arrival:<visit>` so PR #1740 cooldowns apply |
| C8 | P3 | none | No staleness -> OFFLINE writer; no bridge-silence alert | A dead bridge looks ONLINE forever (precedent: local agent "DIED Apr 14", RECONCILIATION:2674) | `device-heartbeat-sentinel` cron, worker-fired every 15 min (the Neon-wake cadence #1696 settled on; a 5-min tick would keep the compute awake): CAMERA/bridge devices with `lastSeenAt` older than 20 min flip ONLINE->OFFLINE and alert once per transition; devices that never reported are ignored (heartbeat birth-registry rule from #1737); a device that resumes heartbeats is cleared with a low "back online" push |
| C9 | P3 | `vehicle-detection.ts:12` | `payload: any`, no schema validation | Malformed edge payloads silently persisted | zod schema for the v2 contract with v1 fallback |

### 4.2 Edge (camera-bridge/)

| # | Sev | Where | Defect | Fix (PR `chore/camera-bridge-v2`) |
|---|---|---|---|---|
| E1 | P0 | `bridge/config.example.yaml:23`, `client.py:70-71` | URL embeds `platformDeviceId`; heartbeat URL derived by string-replace | Keep platformDeviceId in the URL (the cloud now resolves it); heartbeat URL built from a `deviceUrl` config key |
| E2 | P0 | `frigate/config.example.yml:51` + `docker-compose.yml:25` | Relative zone coordinates (0.12,0.85,...) on 0.13.2, whose zones are pixel coordinates (D: 0.14 notes) -> a ~1 px polygon that never triggers; `rtmp` role deprecated | Frigate 0.17.2 config (section 9) |
| E3 | P0 | `bridge.py:156` | `after.get("current_zones", ["front_lot"])[0]` raises `IndexError` on every `end` message whose `current_zones == []`, i.e. every departure | State machine emits LEFT from the sighting's last zone, never indexes the payload |
| E4 | P1 | `dedupe.py:17-20,70` | dwell = `time.time() - first_seen` since the first MQTT message; `update(zone_presence)` ignores its argument; not reset on zone exit | Zone intervals from Frigate `frame_time` (section 6) |
| E5 | P1 | `dedupe.py:88`, `config.example.yaml:10` | `CONFIRMED_ARRIVAL` after 2 s in zone | Candidate 10 s, confirmed 45 s or stationary >= 20 s, tunable |
| E6 | P1 | `bridge.py:88,173` + `client.py:117-140` | HTTP retries with `time.sleep` inside the paho callback thread (`loop_forever`) | Worker thread + SQLite outbox; MQTT callback only enqueues |
| E7 | P1 | `dedupe.py:29-31`, `client.py:24` | Tracks, cooldowns and the offline queue are in-memory | SQLite ledger (`visitd.sqlite`): sightings, visits, outbox; restart-safe |
| E8 | P1 | `requirements.txt` | `paho-mqtt>=1.6.1` spans the 2.0.0 break (`Client()` raised `ValueError` in 2.0.0, deprecation in 2.1.0, D: paho ChangeLog); `easyocr`/`cv2`/`numpy` imported but unlisted | Pinned: `paho-mqtt==2.1.0`, `requests==2.34.2`, `PyYAML==6.0.3`, `python-dotenv==1.2.2`; ALPR from Frigate native LPR, no OCR in the bridge |
| E9 | P2 | `dedupe.py:73-80,116-123` | LEFT only if previously alerted; tracks purged after 15 min without updates while Frigate stops updating stationary objects -> parked cars never produce LEFT | Stationary objects keep the visit open until Frigate `end`; no time-based purge of open visits |
| E10 | P2 | `docker-compose.yml:18,37` | Anonymous MQTT; Frigate 5000 published on the LAN | Mosquitto password file; 5000 bound to 127.0.0.1; humans use 8971 (JWT) |
| E11 | P2 | `docker-compose.yml:23,31,33` | `/dev/bus/usb` + `/etc/localtime` mounts are Linux-only | Linux target profile; Windows profile without device mounts |
| E12 | P3 | `config.example.yaml:45`, `plate_reader.py:34-44` | Default `provider: mock` returns plate `NICKS1` | Default `frigate` (reads `recognized_license_plate`) or `disabled`; `mock` only under `--dry-run` |
| E13 | P3 | `install-windows-service.ps1:34` | Runs as `NT AUTHORITY\SYSTEM` | Documented least-privilege service account option; SYSTEM remains the default only for the replay lab |
| E14 | P3 | `local-agent/v380_agent.py` | Dormant liveness poller, superseded | Delete in a follow-up PR (statenour) once the edge v2 heartbeat is live |

### 4.3 Integration gaps (H, from A3)

| Gap | Fix |
|---|---|
| No plate -> customer -> booking lookup anywhere | nickstire `vehicle_lookup_by_plate` action (read-only) + normalized-plate index; statenour enriches the alert after `CONFIRMED_ARRIVAL` |
| Two disagreeing cooldown layers (edge: camera+zone+label; cloud: zone only) | Cloud keys cooldown on `visitId` (v2) with per-camera fallback |
| One static ingest URL per bridge process | Bridge v2 maps Frigate camera name -> cloud device id per camera in config |

---

## 5. Target architecture

```
                 SHOP (192.168.0.0/24 today; camera VLAN when the switch lands)
 +------------------+   RTSP/ONVIF   +---------------------------+   MQTT (auth)   +----------------------+
 | PoE cam A: lot   |--------------->|  Frigate 0.17.2 (Docker)  |---------------->|  visitd (Python 3.12) |
 | PoE cam B: LPR   |--------------->|  go2rtc restream          |  frigate/events  |  zone-interval ledger|
 | PoE cam C/D: bays|--------------->|  native LPR (YOLOv9+Paddle)| tracked_object_ |  visit state machine |
 +------------------+                |  zones/review/record      |   update (lpr)   |  SQLite outbox       |
        PoE switch (VLAN 30)         +---------------------------+                  +----------+-----------+
              |                           Linux mini-PC (N150 -> Core Ultra later)             | HTTPS x-sync-key
              |  Tailscale subnet router (no port-forwarding)                                  v
 ---------------------------------------------------------------------------------------------------------------
                 CLOUD
 +------------------------------------------------------------------------------------------------------------+
 | statenour-web (bdnick.info, Railway)                                                                       |
 |  POST /api/devices/{platformDeviceId}/events  -> handleVehicleEvent (zod v2, idempotent by eventId)        |
 |  PATCH /api/devices/{platformDeviceId}        -> heartbeat; device-heartbeat-sentinel cron -> OFFLINE alert|
 |  DeviceEvent (JSON, today) -> vehicle_visits / visit_events / visit_zone_intervals (Phase 3, typed)        |
 |  Telegram (edit-in-place) + web-push (flood-controlled, quiet hours) ; /system/camera cockpit              |
 |  nick agent tools: camera.getIntelligence / getPlates / arrivals (read the ledger, never infer)            |
 +----------------------------+-------------------------------------------------------------------------------+
                              | queryNick("vehicle_lookup_by_plate") - read-only, advisory
 +----------------------------v-------------------------------------------------------------------------------+
 | nickstire (nickstire.org, TiDB)  vehicles.licensePlate (indexed) -> customers -> bookings/workOrders/bays  |
 |  admin Command Center keeps polling GET /api/devices for snapshot tiles (unchanged)                        |
 +------------------------------------------------------------------------------------------------------------+
```

Placement of responsibilities (H, grounded in A3):

| Concern | Lives in | Why |
|---|---|---|
| Detection, tracking, zones, LPR, recordings, live view | Frigate on the edge box | mature, MIT, offline; the operator's live-view need is Frigate's UI over Tailscale |
| Visit truth (state machine, dwell, identity stitching) | `visitd` on the edge box, persisted in SQLite, replicated to the cloud | must keep working when the WAN is down; deterministic; unit-testable without a camera |
| Canonical visit ledger, alerts, cockpit, AI summaries | statenour Neon | the incumbent (UPSTREAMS row 58); Postgres + pgvector for later re-ID embeddings; Telegram and push flood-control already live |
| Customer/booking/bay linkage | nickstire, read through the bridge | business data stays in the business system; no statenour->nickstire write lane exists and none is created (UPSTREAMS rows 87/88) |
| Worker app | fires the `device-heartbeat-sentinel` tick every 15 min (`apps/worker/src/scheduler.ts` HIGH_FREQ_JOBS entry, shipped in #2222) | the worker is the only scheduler in this system and holds no DB client, so it dispatches the HTTP route and the route does the work (`config/crons.ts` worker rule); camera traffic itself never touches it |

Deployment topology: Frigate + Mosquitto + visitd on one Linux mini-PC at the shop (Docker Compose, `restart: unless-stopped`, UPS); Frigate UI on 8971 reachable only via Tailscale ACL; 5000 bound to loopback for visitd; camera VLAN with WAN egress denied; NTP from the router. Until the mini-PC arrives, the same compose runs on this laptop under Docker Desktop with the CPU detector for validation only.

---

## 6. Deterministic visit model (the truth path)

### 6.1 Definitions (H, built on Frigate semantics D)

- **Sighting** = one Frigate tracked object (`after.id`) on one camera. Fields: `camera`, `label`, `start_time`, `last_frame_time`, `end_time`, `zone_intervals[]`, `stationary_since`, `plate_reads[]`, `best_score`, `last_box`.
- **Zone interval** = `[enter_frame_time, exit_frame_time)` for one zone. Opened when a zone appears in `after.current_zones` and was absent in `before.current_zones`; closed when it disappears, or at `end_time` on `type: end`. Frigate applies `inertia` (3 frames) and optional `loitering_time` before a zone appears, so the bridge does no extra debouncing.
- **Zone dwell** = sum of closed intervals plus the open interval measured at emit time. Measured on Frigate `frame_time`, never on wall clock; a stationary object stops sending updates but stays "in zone" until `end`, so its open interval keeps accruing correctly.
- **Visit** = the business fact: one vehicle present on the property from first arrival-zone entry to final departure. `visitId` is a UUID minted by the edge; it is not a Frigate id.

### 6.2 Visit state machine (per visit; inputs are sighting updates)

| State | Enter when | Emit to cloud |
|---|---|---|
| `DETECTED` | sighting exists, no arrival zone yet | no (counted locally as pass-through candidates) |
| `ENTERED_ZONE` | first arrival-zone interval opens (`front_lot`, `bay_entrance`) | yes, priority normal |
| `ARRIVAL_CANDIDATE` | zone dwell >= `candidateSeconds` (10) OR `stationary` in zone | yes |
| `CONFIRMED_ARRIVAL` | zone dwell >= `confirmSeconds` (45) OR (`stationary` AND dwell >= 20) | yes, priority high; alert |
| `IN_SERVICE` | a bay zone interval opens (Phase 2, bay cameras) | yes |
| `DEPARTING` | all arrival/bay intervals closed; grace timer `leaveGraceSeconds` (20) running | no |
| `LEFT` | Frigate `end` for the last sighting, or grace expired without re-entry | yes; carries total dwell, per-zone dwell, plate |
| `PASS_THROUGH` | LEFT reached without ever hitting `ARRIVAL_CANDIDATE` | yes, low priority (analytics only, no alert) |

Timers are evaluated on every message and on a 5 s wall-clock tick (needed for stationary objects that send no updates); tick promotions use `last_frame_time + elapsed_wall` and are flagged `estimated: true` until the next Frigate message confirms.

### 6.3 Identity stitching (deterministic, ordered rules)

1. **Same camera, track split:** a new sighting starting within 10 s of another sighting's `end_time` whose last box IoU >= 0.5 with the new first box joins the same visit. (Frigate re-ids after 5 s of occlusion, D.)
2. **Plate match:** normalized plate (uppercase, strip non-alphanumerics, apply Frigate `replace_rules`) equal to an open visit's plate within 30 min joins that visit. Two high-confidence reads (>= 0.9) with Levenshtein distance >= 2 are a hard reject.
3. **Cross-camera topology (Phase 2):** `sign.exit -> lot.entry` within 1-90 s joins; overlapping time on non-overlapping fields of view is a hard reject.
4. **Everything else:** new visit. Ambiguous cases (score 0.45-0.75 in the Phase 3 appearance model, section 6.5) go to a confirm queue in the cockpit (two crops, in-DOM two-tap confirm, never `window.confirm`).

### 6.4 Event contract v2 (edge -> cloud; backwards compatible)

```json
{
  "schemaVersion": 2,
  "event": "vehicle_detected",
  "eventId": "a1c3...",                      // sha1(visitId + state + seq) - idempotency key
  "source": "frigate",
  "timestamp": "2026-09-08T16:02:11Z",       // derived from Frigate frame_time
  "data": {
    "cameraId": "sign", "cameraName": "Shop Sign",
    "visitId": "9f3e...", "sightingId": "1757347331.12-abc123", "trackId": "1757347331.12-abc123",
    "zone": "front_lot", "zoneName": "Front Lot",
    "state": "CONFIRMED_ARRIVAL",
    "priority": "high",
    "label": "car", "confidence": 0.87,
    "dwellSeconds": 47.2,
    "zoneDwell": { "front_lot": 47.2, "bay_entrance": 0 },
    "stationary": true, "estimated": false,
    "plate": { "status": "CONFIRMED", "text": "ABC 1234", "normalizedText": "ABC1234",
               "confidence": 0.93, "provider": "frigate_lpr", "reads": 3 },
    "metadata": { "direction": "entering", "frigateStartTime": 1757347331.12, "frigateEndTime": null,
                  "snapshotRef": "events/1757347331.12-abc123/snapshot.jpg",
                  "bridgeVersion": "2.0.0", "frigateVersion": "0.17.2" }
  }
}
```

Cloud handling: `eventId` deduplicates retries; `visitId` (falling back to `trackId` for v1 payloads) keys the edit-in-place Telegram message; `state` enum is validated; unknown fields are stored in `DeviceEvent.data` untouched.

### 6.5 Phase 3 identity scoring (from R3, adopted as the design)

`S = 0.50*P + 0.30*A + 0.15*T + 0.05*C` - P plate (exact 1.0; length-equal, one confusable substitution 0.7; missing 0.5), A appearance (cosine of median 512-d vehicle re-ID embeddings, `occurra/vehicle_reid_siglip2_naflex_512d`, Apache-2.0), T spatiotemporal (topology table, linear decay to 0 at 300 s), C color/body attribute (Frigate custom classification). Auto-merge >= 0.75, confirm queue 0.45-0.75, new visit below. Every merge stores its components; operator confirmations become the calibration set. Not built until Phase 3 has 30 days of labeled visits.

---

## 7. Data model

### 7.1 Today (Phase 1-2): keep `DeviceEvent.data` JSON, add nothing to the schema

The v2 contract is stored verbatim; `cameraArrivals` and the cockpit already read `data.*`. This avoids a hand-applied migration before a single real event exists.

### 7.2 Phase 3: typed ledger (Prisma, hand-applied migration per `statenour-migration`)

```prisma
model VehicleVisit {
  id              String    @id @default(cuid())
  visitKey        String    @unique @map("visit_key")       // edge visitId
  siteId          String    @default("shop") @map("site_id")
  primaryCamera   String    @map("primary_camera")
  state           String                                     // enum as text, same set as 6.2 + ACKNOWLEDGED/FALSE_POSITIVE
  startedAt       DateTime  @map("started_at")
  confirmedAt     DateTime? @map("confirmed_at")
  leftAt          DateTime? @map("left_at")
  dwellSeconds    Float?    @map("dwell_seconds")
  zoneDwell       Json?     @map("zone_dwell")
  plateText       String?   @map("plate_text")
  plateNormalized String?   @map("plate_normalized")
  plateConfidence Float?    @map("plate_confidence")
  plateStatus     String    @default("NONE") @map("plate_status")
  snapshotRef     String?   @map("snapshot_ref")
  customerRef     Json?     @map("customer_ref")             // advisory: nickstire customer/vehicle/booking ids + score
  falsePositive   Boolean   @default(false) @map("false_positive")
  confirmedBy     String?   @map("confirmed_by")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
  events          VisitEvent[]
  intervals       VisitZoneInterval[]
  @@index([startedAt])
  @@index([plateNormalized, startedAt])
  @@index([state, startedAt])
  @@map("vehicle_visits")
}

model VisitEvent {
  id        String   @id                                      // edge eventId (sha1) -> idempotent inserts
  visitId   String   @map("visit_id")
  camera    String
  state     String
  zone      String?
  at        DateTime
  payload   Json
  visit     VehicleVisit @relation(fields: [visitId], references: [id], onDelete: Cascade)
  @@index([visitId, at])
  @@map("visit_events")
}

model VisitZoneInterval {
  id        String    @id @default(cuid())
  visitId   String    @map("visit_id")
  camera    String
  zone      String
  enteredAt DateTime  @map("entered_at")
  exitedAt  DateTime? @map("exited_at")
  seconds   Float?
  visit     VehicleVisit @relation(fields: [visitId], references: [id], onDelete: Cascade)
  @@index([visitId])
  @@index([zone, enteredAt])
  @@map("visit_zone_intervals")
}
```

Plus `vehicle_identities` (plate_normalized unique, first/last seen, visit_count, nickstire_vehicle_id, `embedding vector(512)` via raw SQL like `lib/db/pgvector.ts`) in Phase 3. Retention: `visit_events.payload` and snapshots 30 days; `vehicle_visits` rows 13 months without plate text unless linked to a customer record (section 14). Migration sequence: SQL in `prisma/migrations-pending/`, applied through `POST /api/system/apply-pending-migration` by the operator, then the Prisma models, then the code (memory rule: migration first, then schema fields).

---

## 8. Repo implementation plan

### 8.1 PR 1 - `statenour/camera-arrival-p0` (cloud, no schema change)

| File | Change |
|---|---|
| `lib/services/devices.ts` (new) | `resolveDevice(idOrPlatformId)` and `resolveDeviceId(...)` |
| `app/api/devices/[id]/events/route.ts`, `[id]/route.ts`, `[id]/command/route.ts` | resolve by id OR platformDeviceId; write with the cuid |
| `lib/services/vehicle-detection.ts` | zod schema (v2 with v1 fallback); dedupe key `visitId ?? trackId`; idempotent `eventId`; quiet hours; `sendPush` tag `arrival:<visitId>`; cooldown keyed per camera+zone; hands a CONFIRMED_ARRIVAL with a readable plate to the customer link |
| `lib/services/vehicle-customer-link.ts` (new) + `tests/services/vehicle-customer-link.test.ts` | fire-and-forget `vehicle_lookup_by_plate` over the nour-os bridge; writes `customerRef` (`matched` / `unmatched` / `lookup_failed`) on the event and appends one line to the Telegram alert; never throws into ingest |
| `lib/trpc/routers/system/devices.ts` | `startOfDayET()` day boundary; `cameraArrivals` returns `error: null` shape the page can distinguish |
| `app/(mastery)/system/camera/page.tsx` | explicit error state; "no data" vs "read failed" |
| `lib/ai/agent-actions/camera-actions.ts` | `getPlates` reads `DeviceEvent.data.plate` |
| `lib/brain/camera-intelligence.ts` | docstring truth: `analyzeCameraData` is not scheduled |
| `config/crons.ts` + `app/api/cron/device-heartbeat-sentinel/route.ts` (new) + `apps/worker/src/scheduler.ts` HIGH_FREQ_JOBS | 15-min sentinel, worker-fired (the #1696 Neon-wake cadence - a 5-min tick keeps the compute awake), transition-only alerts, `check:crons` compliant |
| `tests/api/devices-platform-id.test.ts` (new), `tests/services/vehicle-detection.test.ts`, `tests/services/device-heartbeat-sentinel.test.ts` (new) | route-level positive control for C1; quiet-hours and idempotency cases; sentinel transition + never-seen exclusion |
| `docs/RECONCILIATION.md` | wave entry (statenour-wave-reconcile) |

### 8.2 PR 2 - `chore/camera-bridge-v2` (edge, vendored)

| Path | Change |
|---|---|
| `camera-bridge/visitd/` (new package) | `frigate_events.py` (payload normalization for 0.17 `before/after`), `state_machine.py` (pure, no I/O), `ledger.py` (SQLite: sightings, visits, outbox), `cloud_client.py` (worker thread, retry with backoff, idempotent eventId), `mqtt_client.py` (paho 2.1 `CallbackAPIVersion.VERSION2`, enqueue only), `config.py` (YAML + env), `main.py` |
| `camera-bridge/tests/` (unittest, stdlib only) | arrival/departure timing, empty `current_zones` on `end`, stationary promotion via tick, split-track stitching, plate stitching, idempotent ids, restart recovery, outbox flush order |
| `camera-bridge/frigate/config.example.yml` | 0.17.2 config for two cameras + LPR + review + record (section 9) |
| `camera-bridge/docker-compose.yml` | 0.17.2 pinned; Mosquitto with password file; 5000 on loopback; 8971/8554/8555 published; `linux` and `windows` profiles; `replay` profile that loops an MP4 as a camera |
| `camera-bridge/scripts/` | `test-rtsp.ps1` (port fingerprint incl. 8800/9800 + ffprobe candidates), `replay-fixture.ps1`, `dry-run-event.ps1` (0.17 payloads), `install-windows-service.ps1` (least-privilege note) |
| `camera-bridge/README.md` | runbook rewritten around this plan; the old `bridge/` package retired (deleted, tracked `.pyc` removed) |

### 8.3 PR 3 - `nickstire/vehicle-lookup-by-plate`

| Path | Change |
|---|---|
| `server/routes/nour-os-query.ts` | action `vehicle_lookup_by_plate` (filters: `plate`, optional `sinceDays`): normalized match on `vehicles.license_plate` and `memberships.vehiclePlate`, joined to `customers`, today's `bookings` (by phone) and open `work_orders` -> `{ matches: [...], count }` |
| `server/lib/plate.ts` (new) | `normalizePlate()` shared helper |
| `drizzle/migrations/<ts>_vehicles_plate_index.sql` (hand-applied, per `nickstire-tidb-ddl`) | `CREATE INDEX idx_veh_plate ON vehicles (license_plate)`; TiDB-safe |
| `docs/NICKSTIRE-QUERY-CONTRACT.md` (both copies) | action documented, version bumped |
| tests | normalization + query shape |

### 8.4 Phase 3 (not in this wave)

Typed ledger (section 7.2), bay zones and `IN_SERVICE`, cross-camera stitching, appearance re-ID, confirm queue UI, `analyzeCameraData` rewired to the ledger, `v380_agent.py` deletion, nickstire Command Center arrival tile (reads statenour `GET /api/visits/today`, mirrors the existing `cameraProxy` polling pattern).

---

## 9. Frigate target configuration (0.17.2) - `camera-bridge/frigate/config.example.yml`

```yaml
mqtt:
  enabled: true
  host: mqtt
  port: 1883
  user: frigate
  password: "{FRIGATE_MQTT_PASSWORD}"
  topic_prefix: frigate

go2rtc:
  streams:
    lot:  ["rtsp://frigate:{FRIGATE_RTSP_PASSWORD}@192.168.30.11:554/h264Preview_01_main"]   # camera A, main
    lot_sub: ["rtsp://frigate:{FRIGATE_RTSP_PASSWORD}@192.168.30.11:554/h264Preview_01_sub"]
    sign: ["rtsp://frigate:{FRIGATE_RTSP_PASSWORD}@192.168.30.12:554/cam/realmonitor?channel=1&subtype=0"]  # LPR cam (Dahua-OEM path)
    sign_sub: ["rtsp://frigate:{FRIGATE_RTSP_PASSWORD}@192.168.30.12:554/cam/realmonitor?channel=1&subtype=1"]

detectors:
  # Linux mini-PC (target): OpenVINO on the iGPU; NPU on Core Ultra.
  ov:
    type: openvino
    device: GPU
  # Windows/WSL2 validation lab: replace with  cpu1: { type: cpu, num_threads: 3 }

model:
  width: 300
  height: 300
  input_tensor: nhwc
  input_pixel_format: bgr
  path: /openvino-model/ssdlite_mobilenet_v2.xml
  labelmap_path: /openvino-model/coco_91cl_bkgr.txt

ffmpeg:
  hwaccel_args: preset-vaapi        # Linux only; omit on WSL2

detect:
  enabled: true                     # 0.16+ default is false - keep explicit
  fps: 5
  stationary:
    interval: 50
    threshold: 50                   # ~10 s at 5 fps; no max_frames -> parked cars keep one id

objects:
  track: [car, truck, motorcycle, bus, person]
  filters:
    car:        { min_area: 4000, threshold: 0.7 }
    truck:      { min_area: 6000, threshold: 0.7 }
    motorcycle: { min_area: 1500, threshold: 0.7 }
    person:     { min_area: 1200, threshold: 0.75 }

lpr:
  enabled: true
  device: CPU
  model_size: small
  detection_threshold: 0.7
  recognition_threshold: 0.9
  min_area: 2000
  min_plate_length: 5
  match_distance: 1
  # format is a scoring hint only: Ohio standard ABC 1234; out-of-state/vanity plates will violate it
  format: "^[A-Z0-9]{5,8}$"
  known_plates:
    Shop Truck: ["ABC1234"]

record:
  enabled: true
  continuous: { days: 0 }
  motion: { days: 3 }
  alerts:     { pre_capture: 10, post_capture: 10, retain: { days: 30, mode: motion } }
  detections: { pre_capture: 5,  post_capture: 5,  retain: { days: 14, mode: motion } }

snapshots:
  enabled: true
  bounding_box: false
  timestamp: false
  retain: { default: 30 }

review:
  alerts:     { labels: [car, truck, motorcycle], required_zones: [front_lot, bay_entrance] }
  detections: { labels: [person] }

semantic_search:
  enabled: false                    # Phase 3 on the mini-PC (8 GB RAM minimum)

cameras:
  lot:
    enabled: true
    ffmpeg:
      inputs:
        - path: rtsp://127.0.0.1:8554/lot_sub
          roles: [detect]
        - path: rtsp://127.0.0.1:8554/lot
          roles: [record]
    detect: { width: 1280, height: 720 }
    zones:
      front_lot:      # placeholder polygon - draw in the Frigate UI, then paste here
        coordinates: "0.02,0.55,0.98,0.55,0.98,0.98,0.02,0.98"
        inertia: 3
        loitering_time: 0
        objects: [car, truck, motorcycle]
      entrance_lane:
        coordinates: "0.35,0.30,0.65,0.30,0.80,0.60,0.20,0.60"
        inertia: 2
        objects: [car, truck, motorcycle]
    motion:
      mask: []                      # mask the timestamp overlay + the public road once cameras are mounted
  sign:
    enabled: true
    ffmpeg:
      inputs:
        - path: rtsp://127.0.0.1:8554/sign
          roles: [detect, record]     # the plate camera detects on its MAIN stream (see the LPR geometry note)
    detect: { width: 2560, height: 1440, fps: 5 }   # = the main stream's size; never a sub-stream on the LPR camera
    lpr: { enabled: true, enhancement: 2 }     # camera-level: only enabled/min_area/enhancement
    zones:
      bay_entrance:
        coordinates: "0.30,0.40,0.70,0.40,0.85,0.95,0.15,0.95"
        inertia: 2
        objects: [car, truck, motorcycle]
```

LPR geometry (D): Frigate runs plate detection on the frames of the `detect` role, so the plate camera's detect input must be its full-resolution stream. At the section-10 minimum geometry (a plate >= 100 px wide on the 2560-px main stream) a 1280-wide sub-stream halves the plate to ~50x25 px, about 1,250 px^2, below the global `lpr.min_area: 2000` - the plate would be rejected before recognition and gate G4 would fail for configuration, not for camera geometry. Keep `detect` at the main stream's size and lower `fps` (5 -> 3) if the N150 iGPU exceeds 40 ms per inference; never shrink the frame. The `lot` camera keeps its sub-stream: it does no LPR. When the dedicated LPR camera arrives, switch that camera to Frigate's dedicated-LPR mode (`type: lpr`, `objects.track: [license_plate]`, 0.16+ docs) so the plate detector runs on the whole frame instead of inside vehicle boxes.

Notes (D): `frigate/events` keeps the `new/update/end` shape in 0.17.2; LPR results surface as `sub_label` (known plate) or `recognized_license_plate` + `_score`, and on `frigate/tracked_object_update` `{type: "lpr", id, plate, score}`; `GET /api/events/{id}/snapshot.jpg` is unchanged through 0.17.2 but 0.18 stops writing `.jpg` to disk - read snapshots only through the API. Pin `0.17.2`, never `stable` (it flips to 0.18 on release). Back up `/config/frigate.db` before every upgrade; the 0.14 migration is one-way.

Replay validation profile: a third camera `replay` with `ffmpeg.inputs[0].path: /media/fixtures/sign-2026-09-08.mp4` and `input_args: -re -stream_loop -1` (Frigate supports file inputs for testing, D) so the whole edge stack runs against the recorded fixture with no live camera.

---

## 10. Camera placement and zone design

| Camera | Role | Placement (from the on-site survey) | Zones |
|---|---|---|---|
| A - lot overview | arrivals/departures, dwell, occupancy, after-hours | high, wide (85-100 deg HFOV), covering the whole apron and both entrance lanes; 4 MP is enough | `entrance_lane`, `front_lot`, `exit_lane`, optional `street` mask |
| B - LPR | plate capture at the read point | 20-40 ft from where cars slow down (entrance apron), 8-32 mm varifocal, angle <= 30 deg horizontal / 15 deg vertical, mount 8-12 ft, IR on, WDR off, manual shutter >= 1/300 s, 4 MP -> plate >= 100 px wide (Plate Recognizer and Axis guidance, D) | `read_point` only; Frigate `type: lpr` optional if plates are missed on `car` tracks |
| C/D - bays | service timing, tech presence, safety | one per two bays, indoor, 2.8 mm, IR; audio disabled at the camera | `bay_1`..`bay_n`, `lift_zone` |

Geometry receipts (D): 100-130 px plate width, ~12-14 px per character on a 12-inch US plate; at 30 ft a 4 MP (2560 px) camera must keep HFOV <= ~46 deg (about 6 mm on a 1/2.8" sensor) - hence the varifocal. Reolink lacks manual shutter -> overview only. The existing V380 positions (sign + inside) map to A-lite and C-lite; neither can be the LPR camera.

Zone drawing procedure: mount camera -> Frigate UI zone editor -> copy relative coordinates into `config.yml` -> commit -> replay fixture test -> field test with a known car (section 11).

---

## 11. Validation and ground-truth methodology

1. **Fixture replay (day 0):** the V380 desktop recording (and later every camera's first hour) loops into Frigate; `visitd` runs in `--dry-run`; expected visits are hand-labeled once in `camera-bridge/tests/fixtures/<clip>.labels.json` (`{plate?, enter_ts, confirm_ts, leave_ts}`); the test asserts state transitions within tolerances.
2. **Positive controls before every gate:** each new test is run against the unfixed code first and its failure shape recorded (repo rule `positive-control-first`). The C1 route test fails on `origin/main` with 404; the `end`-with-empty-zones test fails on the old bridge with `IndexError`.
3. **Field truth log (week 1-2):** a phone shortcut writes `{timestamp, plate_last4, event: arrived|left|entered_bay}` to a sheet whenever staff see it; 100+ labeled visits before any threshold tuning.
4. **Metrics (computed nightly on the edge, reported to the cockpit):** arrival precision/recall vs the truth log; dwell mean absolute error (target < 15 s); plate read rate (share of confirmed visits with a >= 0.9 read) and plate accuracy vs the truth log; duplicate-visit rate (one physical visit -> >1 visitId); ghost rate (visit with no physical vehicle).
5. **Shadow mode:** alerts stay off (`NICK_ARRIVAL_INTELLIGENCE` unset) until gate G2 (section 12) passes; the cockpit shows everything from day 0.
6. **Mutation canaries:** the sentinel cron ships with a test that flips a device stale and asserts the alert fires, plus one that asserts a never-seen device does NOT alert (the #1737 false-page lesson).

---

## 12. Acceptance gates and SLOs

| Gate | Criterion | Receipt |
|---|---|---|
| G0 (this wave) | prod `POST /api/devices/v380-shopsign/events` returns 200 with `synced: 1` from a dry-run payload; sentinel cron registered and `check:crons` green | Railway http log line + CI run |
| G1 (fixture) | replay clip produces the labeled visits: 0 missed arrivals, <= 1 duplicate, `LEFT` emitted for every visit, no exceptions in 24 h loop | `visitd` metrics JSON |
| G2 (field, 14 days, alerts off) | arrival recall >= 0.95, precision >= 0.90 on the truth log; dwell MAE < 15 s; duplicate rate < 5 %; ghost rate < 3 %; bridge uptime >= 99.5 % (heartbeats) | cockpit metrics panel |
| G3 (alerts on) | <= 2 false alerts/day for 7 days; zero alerts in quiet hours except after-hours events; median alert latency (confirm -> Telegram) < 10 s | Telegram log + `push_suppressed` rows |
| G4 (LPR) | plate read rate >= 70 % of confirmed visits, accuracy >= 95 % on reads >= 0.9 (else fix geometry before buying compute) | truth log |
| G5 (customer link) | >= 80 % of plate-read visits with a `vehicles.license_plate` match resolve to the right customer (staff-confirmed) | confirm queue stats |
| Ops SLOs | edge box CPU < 60 % sustained; detector inference < 40 ms (N150 iGPU) ; recordings retention respected; disk < 80 % | Frigate `/api/stats` scraped by the sentinel |

---

## 13. Observability

- **Heartbeats:** `visitd` PATCHes each camera device every 60 s (`status`, `lastSeenAt`, `currentState: {frigateVersion, detectorMs, mqttConnected, outboxDepth, lastEventAt}`); the sentinel cron (worker-fired every 15 min) flips OFFLINE after 20 min of silence and alerts once per transition; never alerts on devices that have never reported.
- **Edge metrics:** `visitd` exposes `GET 127.0.0.1:9090/metrics` (Prometheus text) - visits open/closed, state transitions, outbox depth, MQTT reconnects, tick promotions; scraped by the heartbeat payload once a minute, so the cloud has it without another service.
- **Frigate:** `/api/stats` (detector inference, camera fps, storage) folded into the heartbeat; Frigate's own review UI for humans.
- **Cloud:** structured logs (`services/vehicle-detection`) already land in `/system/errors`; new counters `arrival_events_total{state}`, `arrival_duplicates_total`, `arrival_alert_suppressed_total{reason}` via the existing telemetry path.
- **Dashboards:** the cockpit gets a "pipeline health" strip (bridge age, detector ms, outbox depth, last event) with an explicit error state; Langfuse/Sentry stay for the AI surfaces only.
- **Silent-instrument rule:** every alert path ships with a planted positive (a `source: "test-panel"` event that must produce a suppressed-in-quiet-hours row at night and a real alert in the day).

---

## 14. Security, privacy, retention

### 14.1 Threat model (STRIDE, edge + cloud)

| Threat | Vector | Control |
|---|---|---|
| Spoofing events | anonymous MQTT on the LAN; unauthenticated Frigate 5000 (`docker-compose.yml:18,37`) | Mosquitto users/passwords; 5000 bound to loopback; visitd is the only MQTT consumer; cloud requires `x-sync-key` (timing-safe) |
| Tampering with the ledger | edge SQLite on a shared PC | dedicated Linux box, service account, disk encryption optional; cloud is the system of record after sync |
| Repudiation | staff disputes an arrival time | Frigate clip + `visit_events` with Frigate `frame_time` and the edge clock offset recorded in heartbeats |
| Information disclosure | camera cloud/P2P relays (V380 today, Reolink UID by default), Frigate UI port-forwarded, plates in logs | camera VLAN with WAN egress denied; Tailscale ACLs, no port-forwarding; plates only in structured fields, never in free-text logs; `--dry-run` payload logging off by default |
| Denial of service | MQTT flood or Wi-Fi drop | outbox with bounded depth (5,000) and oldest-first drop with a counter; wired PoE, UPS |
| Elevation of privilege | bridge as `NT AUTHORITY\SYSTEM`; `privileged: true` container | least-privilege service account on Linux; drop `privileged`, pass only `/dev/dri` |

### 14.2 Ohio and federal (D, from R4; statute links in section 19)

| Topic | Rule |
|---|---|
| Video on the premises | Lawful where there is no reasonable expectation of privacy (lot, bays, counter). Never restrooms or changing areas - ORC 2907.08. |
| Audio | ORC 2933.52 is one-party consent, but an unattended camera records conversations the shop is not party to; disable audio on every camera and in Frigate (`audio.enabled: false`). |
| ALPR by a private business | No Ohio statute (Ohio is not among NCSL's 16 ALPR states); LE-side rules changed 2026-09-07 (ORC 149.43(A)(1)(yy)); bills to limit government access to private ALPR data are pending - keep plate retention short and documented. |
| Plate -> owner identity | BMV records are barred for this use (ORC 4501.27, DPPA 18 USC 2721). The only lawful join is to plates the customer gave us (`vehicles.license_plate`). |
| Retention | Recordings 30 days (alerts) / 14 (detections) / 3 (motion); plate reads 30 days unless linked to a customer record; visit rows 13 months without plate text. |
| Biometrics / faces | Ohio has no biometric statute; still, no face recognition on customers (FTC v. Rite Aid precedent). Frigate `face_recognition.enabled: false`; person detection is used for presence only. |
| Notice | Post "video surveillance in use" signage at the entrance and counter; written staff policy acknowledged at onboarding; a one-page retention policy in `docs/operations/`. |
| Data security | ORC 1354 safe harbor rewards a written program: this document plus the controls above are its first draft. |
| Police requests | Voluntary disclosure is lawful; log every disclosure; compel-only for anything beyond an incident the shop reports itself. |

---

## 15. Failure modes and offline operation

| Failure | Behavior | Recovery |
|---|---|---|
| WAN down | Frigate keeps recording; visitd keeps the ledger and queues events in the SQLite outbox; heartbeats stop -> sentinel flips OFFLINE after 20 min (checked every 15) | outbox flushes in order on reconnect; cloud dedupes by `eventId`; the bridge's next heartbeat restores ONLINE and the sentinel clears its flag |
| Camera offline | Frigate `frigate/<cam>/status/detect` false; visitd marks open visits on that camera `DEPARTING` with `estimated: true` after `cameraLossGraceSeconds` (300) | on return, new sightings stitch by plate if within 30 min |
| Frigate restart | ids reset; open sightings get `end` on shutdown (D) | visits stay open in the ledger; stitching rules 1-2 reattach |
| visitd crash | supervisor restarts (systemd / Task Scheduler); ledger is on disk | on start, open visits are reloaded and their tick timers resume |
| MQTT broker down | visitd reconnects with backoff; Frigate buffers nothing (D) | short gaps produce missed transitions -> the next message re-derives zone state from `current_zones` |
| Disk full on the edge | Frigate retention drops oldest recordings; visitd outbox bounded | sentinel alerts at 80 % from the heartbeat payload |
| Clock skew | edge NTP from the router; heartbeat carries `edgeClockOffsetMs` vs the cloud response `Date` | cloud stores both edge and receive time |

---

## 16. Rollout phases

| Phase | Scope | Exit criteria | Timeline (H) |
|---|---|---|---|
| 0 - today | Cameras diagnosed (done), replay fixture recorded, placement survey, Phase-1 camera ordered; PRs 1-3 land; cloud accepts a dry-run event | G0 | this week |
| 1 - first real camera | The unlocked SHOPSIGN V380 over RTSP (if step 3.3-4 succeeds) and/or one PoE lot camera + injector on the existing router; Frigate + visitd on this laptop (Docker Desktop, CPU detector) as a lab; cockpit shows real visits; alerts off | G1, 7 days of data | week 1-2 |
| 2 - edge box + LPR | N150 mini-PC on Linux; PoE switch + camera VLAN; LPR camera at the apron; zones final; nickstire plate lookup enriches alerts; alerts on after G2/G3 | G2, G3, G4 | week 3-6 |
| 3 - visit ledger + bays | typed tables, bay cameras and `IN_SERVICE`, cross-camera stitching, confirm queue, `analyzeCameraData` rewired, nickstire Command Center tile | G5 | month 2-3 |
| 4 - intelligence | section 18 items, appearance re-ID, semantic search on the mini-PC (Core Ultra tier if needed) | operator-accepted summaries with zero unverifiable claims | month 3+ |

---

## 17. Costs (D, prices as listed on 2026-09-08; street prices move)

| Line | Good | Better | Best |
|---|---|---|---|
| Lot overview cam | Annke C800 $54.99 or Reolink RLC-810A $99.99 | Reolink CX810 $129.99 | EmpireTech B54IR-ZE-S3 (Dahua 5442 class) $289.99 |
| LPR cam | none yet | EmpireTech B54IR-Z4E-S3 8-32 mm $314.99 | B52IR-Z12E-S2 $304.99 (Axis P1475-LE ~$800 is a +$495 option outside the total - see the note) |
| Bay cams | Annke C800 $54.99 | Amcrest IP8M-T2599EW-AI-V3 $99.99 | 2x Amcrest $199.98 |
| Switch / router | TP-Link TL-SG108PE $69.95 (802.1Q, 4 PoE+) | UniFi USW-Lite-8-PoE $109 + UCG-Ultra $129 | same $238 |
| Cabling | 2 drops $300-500 | 4 drops $600-1,000 | 5 drops $750-1,250 |
| Edge box | Beelink EQ13 (N100) ~$259 or GMKtec G3 Plus (N150) ~$180-200 | same | same, + Hailo-8L M.2 optional |
| UPS | APC BE600M1 ~$86 | $86 | $86 |
| Software | $0 (Frigate MIT, PaddleOCR Apache-2.0, Norfair BSD-3); Frigate+ $50/yr optional | $0 | $0 |
| **Total** | **$825-1,125** | **$1,730-2,130** | **$2,130-2,630** |

Arithmetic: every total assumes the Beelink EQ13 ($259); the GMKtec G3 Plus saves $60-80 per tier. Good's upper bound includes the optional Frigate+ $50. Best = $289.99 + $304.99 + $199.98 + $238 + $750-1,250 + $259 + $86 = $2,128-2,628. The Axis P1475-LE (~$800) replaces the $304.99 B52IR and is NOT inside that range: choosing it puts Best at about $2,625-3,125 before the optional Hailo-8L.

Avoid: Ultralytics/BoxMOT (AGPL-3.0 - internal business use needs an enterprise license), CodeProject.AI (no asserted license, parent site offline), Coral USB for new builds (Frigate: "no longer recommended"), Jetson Orin Nano Super ($399 after the July 2026 increase), Plate Recognizer Stream ($840/yr for two cameras) unless native LPR fails after geometry fixes, UniFi cameras (Protect lock-in for RTSPS and plate data). Hikvision/Dahua-branded gear is legal for a private buyer after the FCC's 2026-07-16 order (use-restricted entries; continued use unaffected) but expect thin US supply - prefer the Dahua-OEM EmpireTech/Amcrest lines or NDAA-clean Uniview/Axis.

---

## 18. What the sensor system unlocks once trustworthy (privacy-checked)

| Capability | Mechanism | Guardrail |
|---|---|---|
| Wait-time SLA | `CONFIRMED_ARRIVAL -> IN_SERVICE` per visit; alert the counter at 10 min | staff-facing only |
| Bay throughput and tech utilization | `IN_SERVICE` intervals joined to `work_orders.assignedBay` | aggregate reporting; no per-tech ranking published without consent |
| No-show and early-arrival detection | booking time vs visit `confirmedAt` via `vehicle_lookup_by_plate` | advisory match; staff confirms before any customer contact |
| Repeat-vehicle CRM enrichment | plate -> `vehicles` row; visit count and last seen | only plates the customer gave us; no BMV lookups |
| Traffic curves for staffing and marketing | hourly arrivals/pass-throughs by day | aggregates only |
| Marketing attribution | arrivals after campaigns (Instagram/Google) with plate-linked first visits | aggregate lift only |
| After-hours security | person/vehicle in `front_lot` 8 pm-7 am -> high-priority alert with clip | retention 30 days; police disclosure logged |
| Lot occupancy / vehicle left overnight | open visits at close | staff checklist |
| Customer-facing ETA | (Phase 4) "your car is in bay 2, 25 min" via existing SMS lane | opt-in only; PROTECTED-CORE approval path |
| Insurance and disputes | timestamped clips per visit | 30-day retention, export on request |

Explicitly out: face recognition of customers, sharing plate data with third parties, any customer-facing message fired directly from a camera event.

---

## 19. Verified vs hypothesis ledger, and sources

### 19.1 Verified (A/C/D)
- Prod device ids, event counts, Railway variables, http log samples (section 2.2).
- LAN probe results, MAC vendors, gateway identity (section 2.3).
- Every file:line in section 4 (read in the pinned worktree).
- Frigate: 0.17.2 current (2026-06-28), 0.18.0-rc2 pre-release (2026-09-07); LPR native since 0.16.0 (2025-08-16); relative zone coordinates since 0.14.0 (2024-08-08); auth on 8971 since 0.14; `frigate/events` payload fields; `frigate/tracked_object_update` `type: lpr`; stationary semantics; Windows unsupported (docs.frigate.video + GitHub releases).
- paho-mqtt 2.0.0 breaking change; 2.1.0 smoothing (ChangeLog.txt).
- V380 generations, port fingerprints, bridge projects and their maintenance/licensing (gist SolveSoul + comments, GitHub API, dunderhay/CCTV-v380-pro, vladko312 research, blog.caller.xyz, OpenIPC docs/releases).
- Camera prices and specs from vendor stores; FCC DA 26-635 / DA 26-742; Ohio statutes at codes.ohio.gov; NCSL ALPR page; DPPA.

### 19.2 Hypotheses (H) - each has a test in the plan
- The `ceshi.ini` SD-card unlock takes on THIS Anyka variant (`Hw_HsAKQQXG_WIFI_20230421` + app `AppKN_VACL4_V1.5.3.0`). The family is verified (section 2.3, B); whether this firmware/app build still honours the config file is not - test = section 3.3 on SHOPSIGN, pass = `rtsp://192.168.0.155:554/live/ch00_1` answers after the power cycle. (The earlier "both cameras are Xiongmai-generation" hypothesis was refuted by the firmware string; the port fingerprint alone had over-classified them.)
- The Fios router cannot do 802.1Q VLANs on its LAN ports (assume no; the downstream switch/router design does not depend on it).
- `rtmp` role behavior on 0.13.2 (deprecated vs removed) - moot after the 0.17.2 upgrade.
- Dwell thresholds (10/45/20 s) and grace timers - tuned against the truth log in Phase 1.
- Identity scoring weights (section 6.5) - calibrated on confirmed pairs in Phase 3.
- Cabling labor estimates and street prices.

### 19.3 Primary sources (accessed 2026-09-08)
Frigate: docs.frigate.video/configuration/{reference,zones,stationary_objects,license_plate_recognition,semantic_search,genai,object_detectors,record,review,restream,authentication}, docs.frigate.video/frigate/{hardware,installation,updating}, docs.frigate.video/integrations/mqtt, github.com/blakeblackshear/frigate/releases (v0.13.0, v0.14.0, v0.15.0, v0.16.0, v0.17.0, v0.17.2, v0.18.0-rc2), raw `frigate/track/norfair_tracker.py`, `frigate/api/media.py`. paho-mqtt: eclipse.dev/paho migrations page, ChangeLog.txt. V380: gist.github.com/SolveSoul/9be5d9599c8b4b59f7cfa4cd0ce79c9c (+comments), github.com/dunderhay/CCTV-v380-pro, github.com/PyanSofyan/V380Decoder, github.com/felipemarques/camera-v380decoder, github.com/prsyahmi/v380, github.com/vladko312/Research_v380_IP_camera, blog.caller.xyz (hardware/firmware posts), docs.openipc.org, github.com/OpenIPC/firmware, v380camera.com support pages. Tracking/ALPR/hardware: github.com/{ifzhang/ByteTrack, NirAharon/BoT-SORT, noahcao/OC_SORT, mikel-brostrom/boxmot, tryolabs/norfair, ankandrew/fast-alpr, PaddlePaddle/PaddleOCR, codeproject/CodeProject.AI-Server}, ultralytics.com/license, huggingface.co/occurra/vehicle_reid_siglip2_naflex_512d, platerecognizer.com (pricing, camera guides), help.axis.com License Plate Verifier, raspberrypi.com AI HAT, hailo.ai, cnx-software.com (Jetson price), Beelink/GMKtec listings. Cameras/network/law: reolink.com, store.reolink.com, amcrest.com, empiretech01.com, annke.com, store.ui.com, tp-link.com, netgear.com, tailscale.com/docs/features/subnet-routers, docs.fcc.gov (DOC-389524A1, DA-26-294A1, DA-26-635A1, DA-26-742A1), acquisition.gov FAR 52.204-25, codes.ohio.gov (2907.08, 2933.51, 2933.52, 1354, 1349.19, 4501.27, 149.43), law.cornell.edu 18 USC 2721, ncsl.org ALPR statutes, ftc.gov Rite Aid order. MAC vendors: api.macvendors.com.

---

## 20. Appendix - commands used today

```powershell
# reachability + ports (both cams): camera-bridge/scripts/test-rtsp.ps1 (updated in PR 2)
# raw probe used for section 2.3
Test-NetConnection 192.168.0.155 -Port 554     # TcpTestSucceeded: False
Test-NetConnection 192.168.0.155 -Port 8899    # False
# ONVIF WS-Discovery: UDP multicast 239.255.255.250:3702 Probe -> no responders
# RTSP candidates (run once 554 opens):
ffprobe -rtsp_transport tcp -v error -show_streams rtsp://192.168.0.155:554/live/ch00_1
```

```sql
-- prod receipts (Neon, read-only)
SELECT id, platform_device_id, status, last_seen_at FROM smart_devices WHERE platform = 'V380';
SELECT device_id, event, source, count(*) FROM device_events GROUP BY 1,2,3;
```

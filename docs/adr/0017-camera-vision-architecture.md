# ADR-0017 · Camera / vision intelligence architecture for Nick's Tire & Auto

> **Status**: Accepted (2026-09-08)
> **Date**: 2026-09-08
> **Decision drivers**:
> 1. The Arrival Intelligence pipeline shipped in #315 has never received a real event: the bridge addresses devices by `platformDeviceId` while every `[id]` route resolves the cuid `id` (prod rows prove it), and the vendored edge stack is pinned to Frigate 0.13.2 with a config that only works on 0.14+.
> 2. The two V380 cameras expose only TCP 8800/9800 on the shop LAN (probed 2026-09-08): no RTSP/ONVIF by default and no ONVIF switch in this app build. Their firmware (`Hw_HsAKQQXG_WIFI_20230421`, the Anyka `HsAK` family) has a documented, reversible SD-card config unlock (`ceshi.ini`) that opens 554/8899 without a firmware change; whether it takes on this exact build is untested (master plan section 3.3).
> 3. Dwell and identity must be deterministic and auditable - the operator's fabrication-defense stance applies to sensors as much as to chat.
> 4. Business data (customers, bookings, bays) lives in nickstire/TiDB; the operator's intelligence surface lives in statenour/Neon; there is no write lane between them and UPSTREAMS rows 87/88 forbid inventing one.

Full analysis, receipts and the staged plan: [`docs/research/2026-09-08-camera-vision-MASTER-PLAN.md`](../research/2026-09-08-camera-vision-MASTER-PLAN.md).

---

## Context

`camera-bridge/` (Frigate + MQTT + Python bridge + ALPR adapters) and the statenour cockpit/ingest were built together in June 2026 and never activated: the local half needs LAN access to the cameras, the cameras never exposed RTSP, and the cloud half has a device-id mismatch that would have 404'd every call. Meanwhile Frigate moved from 0.13 to 0.17.2 (native LPR, review items, relative zones, authenticated API) and the V380 ecosystem moved to a locked firmware generation.

## Decision

1. **Cameras:** replace the V380 units with ONVIF Profile S / RTSP PoE cameras (overview + LPR + bays). Native V380 RTSP is used only until the PoE cameras arrive, and only through a non-firmware path: the app's ONVIF switch where a build has one (this build does not), otherwise the `ceshi.ini` SD-card unlock documented for the Anyka `HsAK` generation - tried on ONE camera first and accepted only once `rtsp://<camera>:554/live/ch00_1` answers (master plan section 3.3, the UNLOCK-THEN-REPLACE path). Reverse-engineered V380 protocol bridges are rejected for production (unlicensed, unmaintained parsers of untrusted input, cleartext cloud dispatch). Firmware REPLACEMENT (OpenIPC or similar) is rejected (no maintained images for these SoCs, brick risk); the config-file unlock changes no firmware and reverts on its own after a power cycle.
2. **Detection and tracking:** Frigate 0.17.2 pinned (never `stable`), go2rtc restream, native LPR, zones with `inertia`/`loitering_time`, review items, motion-based recordings. No custom tracker (Ultralytics/BoxMOT are AGPL; Frigate's Norfair tracker is sufficient for a two-camera lot).
3. **Visit truth:** a rewritten edge service (`camera-bridge/visitd`) computes zone intervals from Frigate `frame_time`, runs a deterministic visit state machine (DETECTED -> ENTERED_ZONE -> ARRIVAL_CANDIDATE -> CONFIRMED_ARRIVAL -> [IN_SERVICE] -> DEPARTING -> LEFT | PASS_THROUGH), mints its own `visitId`, stitches split tracks by IoU/time and by normalized plate, persists to SQLite and ships idempotent events (`eventId`) through an outbox. Frigate track ids are never visit ids. No LLM in the truth path.
4. **Ledger and alerts:** statenour Neon is the canonical visit ledger (JSON in `DeviceEvent.data` now; typed `vehicle_visits` / `visit_events` / `visit_zone_intervals` in Phase 3). Alerts go through Telegram edit-in-place plus the existing web-push flood control, with quiet hours. A `device-heartbeat-sentinel` cron flips silent devices OFFLINE and alerts once per transition, never for devices that have never reported.
5. **Business linkage:** nickstire exposes a read-only `vehicle_lookup_by_plate` action on the existing `nour-os/query` bridge (normalized plate -> customer -> today's booking / open work order). Matching is advisory; staff confirm; no camera event ever triggers a customer-facing message directly.
6. **Deployment:** Frigate + Mosquitto (authenticated) + visitd on a Linux mini-PC at the shop, cameras on a WAN-blocked VLAN, remote access via Tailscale ACLs only. The Windows laptop is a validation lab, not the edge box.
7. **Privacy:** no audio, no face recognition of customers, plate retention 30 days unless linked to a customer-provided plate, recordings 30/14/3 days by class, signage and a written retention policy.

## Consequences

- Positive: a pipeline that can actually receive events (P0 fix), a truth model that survives occlusion, restarts and WAN loss, standards cameras that any NVR can read, and a cost ceiling of ~$2.6k all-in (~$3.1k with the Axis LPR option).
- Negative: hardware spend and cabling; a second hand-applied migration wave in Phase 3; the V380 units become spare parts.
- Neutral: the legacy `apps/statenour/local-agent/v380_agent.py` is superseded and scheduled for deletion once edge heartbeats are live.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep V380 + V380Decoder bridge | licensing, security and maintenance risk exceed the price of a camera; does not cover the locked firmware generation reliably |
| Blue Iris + CodeProject.AI on the Windows PC | CodeProject.AI has no asserted license and its parent site is offline; Windows-only; no advantage over Frigate for this use |
| UniFi Protect cameras | RTSPS and plate data locked behind the Protect console |
| Custom YOLO + ByteTrack/BoT-SORT pipeline | AGPL exposure for a business, more moving parts, no measured need on a two-camera lot |
| Ledger in nickstire/TiDB | nickstire has no inbound device ingest; every consumer (cockpit, Telegram dedupe, brain tools) lives in statenour; would require a write lane the register rejects |
| Plate Recognizer Stream / Rekor Scout | $840+/yr recurring for two cameras before native LPR has been measured |

## Verification

- Route-level test proves the device lookup fails on the unfixed code and passes after (positive control first).
- Edge unit tests cover every state transition, the empty-`current_zones` departure, stationary promotion, split-track and plate stitching, idempotent ids and restart recovery.
- Replay-fixture run against a recorded clip before any new camera is mounted; field truth log for 14 days before alerts are enabled (gates G1-G5 in the plan).

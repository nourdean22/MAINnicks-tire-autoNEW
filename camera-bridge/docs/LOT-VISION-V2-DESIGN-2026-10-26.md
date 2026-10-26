# Lot vision v2: the car counter, rebuilt without NicksMax (design, 2026-10-26)

Status: DESIGN for Nour's review. Nothing here is built, bought or installed. Job 2026-10-26-lot-vision-v2.
Labels: FACT (read in code or production today), INFERRED (a design judgement), NOT CHECKED (an open fact).

## 1. The answer

1. **Replace the camera, not the code.** The counter is fragile because its eyes are a closed solar wifi V380 that goes
   dark every night and is read through the vendor's relay on a desktop PC (FACT: ADR-0022). The counter sees one
   lens of three, cropped from the relay's 1920x3240 stack and shrunk to 640x360 at 4 frames a second
   (FACT: `scripts/nicksmax/run-sign-crop.ps1:3-4,66`). Every layer above it
   inherits frozen frames, blackouts and restarts: about 180 health flaps a day and 0 arrivals since 10-23 19:24Z
   while it reported HEALTHY (FACT, `camera_health_events`, `vehicle_visits`). Why that zero happened is UNKNOWN: the
   edge log is on NicksMax, which is off. The design does not depend on finding out.
2. **Recommended: a wired lot appliance.** One PoE camera on the entrance, one small Linux box that does nothing
   else (Frigate 0.17.2 + our own `visitd`), on a UPS. NicksMax leaves the truth path for good.
3. **Most of the software already exists and never ran.** `visitd` turns Frigate events into visits and already posts
   the nickstire contract (`visitd/shop_mirror.py`, `visitd/main.py` shop heartbeat); the Frigate config is in
   `frigate/config.example.yml`. The 2026-09-08 master plan priced this hardware and it was never bought.
4. **Cost: about $500 to $1,340 in parts, typically about $750** (section 6). Your spend decision.
5. **Counting within days of the parts arriving** (phase 4): camera up, box up, first real arrivals on Admin > Lot.
   Phases 2 and 3 (the missing page, the box image) need no spend and start on your yes.

## 2. Outcome and proof

Every car that enters the lot is counted (arrival, departure, time in lot, already there at open); the count survives
any one machine being off; a gap is re-counted from retained video; Admin > Lot says UNKNOWN, never 0, when the
producer is silent; you are paged within minutes when it stops; the lane is rebuilt from `LOT-VISION-V2-RUNBOOK.md`
in an afternoon. A counted arrival is a car in the lot, not a job; the attribution lane joins arrivals to invoices.

## 3. Two designs that differ in kind, and the 10x option

| | A. Lot appliance (RECOMMENDED) | B. Camera counts, server is the only code |
|---|---|---|
| What | PoE camera -> Frigate 0.17.2 on a dedicated N150 box (detection, tracking, zones, 7 days of recording) -> `visitd` -> nickstire `/api/camera/visits` + `/api/camera/heartbeat` | An AI PoE camera counts a directional line on the camera and pushes each crossing over HTTPS to a new nickstire ingest route; its SD card keeps the video |
| Shop machines | camera + box | camera only |
| Arrival / departure | yes, per car | yes, as crossings |
| Time in lot per car | yes (one track id from entry to exit) | NO: crossings carry no identity, so only lot occupancy (ins minus outs) |
| Already there at open | yes (INFERRED: Frigate tracks stationary cars from start; small `visitd` change) | only as an occupancy number (Axis occupancy-in-area), not per car |
| Re-count a gap | from the box's 7 days, or the camera's SD card | from the SD card, needs a box or PC to process it |
| Our new code | small (config, installer, health rules, re-count job) | a vendor adapter route + an event-to-visit translator |
| Main risk | a new box at the shop; Frigate + `visitd` have never run on real traffic | vendor firmware is a black box we cannot pin; push often has weak auth and no buffering (pending research) |
| Kill criterion | section 8 | same thresholds; fails outright if time-in-lot is required |

Rejected: **harden the existing producer on NicksMax** (fix the portal, replace the 60 s stall kill). It keeps the
closed camera, the relay and the desktop PC in the truth path, which is what Nour ruled out on 2026-10-26.

**The 10x option, one line:** two independent witnesses on one wired camera (the camera's own line counter pushing
straight to the server, plus Frigate on the box), with billed invoices as the third check, so a silent zero cannot
hide and any gap is re-counted from 7 days of video. Build it only after A has run clean for 2 weeks, and only if the
camera bought for A can count on board (a config change, not a build). Buy A's camera with that ability.

## 4. Design A in detail

### 4.1 Hardware at the shop
1. **Camera:** one 4 to 8 MP PoE bullet, starlight sensor, WDR, IR, rated to -30 C, ONVIF + RTSP, H.265, microSD
   slot, on-board vehicle line crossing (for the 10x option later). Mounted 3 to 4 m up, 30 to 45 degrees down,
   looking along the driveway so cars drive toward or away from it; headlights not straight into the lens. No plate
   reading on this camera (a plate needs a second narrow camera and a separate privacy decision).
2. **Box:** Intel N150 mini PC, 16 GB, 512 GB SSD, Ubuntu Server 24.04 LTS. BIOS set to power on after AC loss.
3. **PoE switch** (or injector) and the box and the modem on one UPS.
4. **Wired** outdoor Cat6 to the camera. No solar, no wifi: Cleveland winter, short days and cold batteries are the
   failure we are leaving (INFERRED from the solar night window in `server/lib/solar.ts`).

### 4.2 Software on the box (all pinned, all restarting on their own)
1. Docker Compose: `mosquitto`, `frigate:0.17.2` (OpenVINO on the N150 iGPU; go2rtc inside Frigate gives the camera
   one pull per stream), `visitd`. `restart: unless-stopped` on every service.
2. `visitd` already does the truth path: deterministic visit state machine on Frigate `frame_time`, SQLite ledger and
   durable outbox, idempotent `visitId` + `seq`, shop heartbeat. Internet outages delay visits, never lose them.
3. Remote access: Tailscale (already the house tool). No port forwarding, camera never on the internet.
4. chrony for time, unattended security upgrades, images pinned by tag; updates only by a reviewed tag change.

### 4.3 What changes in the repo (phases 3 and 4)
1. `frigate/config.example.yml`: one camera, an entrance zone and a lot zone, recording 7 days (continuous for the
   entrance), the old two-camera LPR layout moved out.
2. `visitd`: mark cars already in the lot zone when the box starts or the shop opens as `preexisting` (today it
   hard-codes `preexisting: False`, `visitd/shop_mirror.py:214`).
3. A box installer and the runbook (`LOT-VISION-V2-RUNBOOK.md`): one script, one page.
4. A re-count job (section 5.3).
5. Server: the missing page (section 5.1), and the new camera's health profile (wired, no solar night). The new
   camera posts under the camera id `sign`, so `lotDataConfidence.ts`, the alerts and Admin > Lot keep treating it as
   the vehicle-truth camera without a rename; the producer id changes, which the 90 s takeover already allows. No
   schema change: `vehicle_visits` already has `sourceGeneration`,
   `dataClass`, `detectorName`, `calibrationVersion` for provenance (FACT, `drizzle/schema.ts:4724`).
6. Retire: `edge_main.py`, the V380 relay, crop and MediaMTX launchers under `scripts/nicksmax/` move to an archive
   folder only after A passes its kill criterion. Nothing is deleted before then.

## 5. When things break

### 5.1 Pages (what exists, what is new)
| Signal | Threshold | Status |
|---|---|---|
| Producer silent | heartbeat older than 120 s -> PRODUCER_OFFLINE (`server/lib/cameraHealth.ts:68`), paged by `cameraHealthAlerts.ts` | FACT: exists |
| Lot tile when silent | counts UNKNOWN unless the sign camera is HEALTHY (`shared/lotDataConfidence.ts`) | FACT: exists |
| Camera dead, box alive | Frigate `camera_fps` 0 for 2 min -> heartbeat `sourceConnected` false -> CAMERA_OFFLINE | NEW (small): today `visitd` sets `sourceConnected` from the broker and Frigate being up, and leaves frame fields None (`visitd/main.py:366`), so a dead camera behind a live Frigate reads as connected. Read Frigate's `stats` topic |
| Looking but not counting | car detections flowing and 0 arrivals for 2 open hours, or the day still 0 at 11 AM ET while invoices exist | NEW. This is the exact failure of 10-24 and 10-25. Needs a detection count in the `visitd` heartbeat (from Frigate stats) |
| Recording stopped | newest recording segment older than 5 min, or disk under 15% free | NEW (box heartbeat field). Frigate deletes the oldest footage first when the disk nears full, whatever the retention setting (Frigate record docs), so a full disk silently shortens the re-count window |

The night state changes too: a wired camera is not dark at night, so EXPECTED_SOLAR_OFFLINE stops applying to the new
camera's profile.

### 5.2 Any one machine off
| Off | What still works |
|---|---|
| NicksMax | everything (it is no longer used) |
| The box | the camera keeps recording to its SD card; the server pages PRODUCER_OFFLINE within about 2 min; Admin > Lot says UNKNOWN; the gap is re-counted when the box returns |
| The camera | the box heartbeat says CAMERA_OFFLINE; page; nothing to re-count (no video exists) and the tile says so |
| Internet or Railway | `visitd` keeps counting into its outbox and delivers in order when the link returns |
| Power | the UPS carries the switch, box and modem; after a long cut the box powers on by itself (BIOS) and Compose restarts every service |

### 5.3 Re-counting a gap
1. A gap is a window where the producer's heartbeat was missing or the "looking but not counting" page fired.
2. The re-count job on the box takes the window, pulls the video (the box's own recordings through Frigate's
   `POST /export/custom/{camera}/start/{start}/end/{end}`, with `ffmpeg_output_args` set to a plain copy because the
   default is a 25x time-lapse; or the camera's SD card over ONVIF playback when the box itself was off: NOT CHECKED
   per model), runs it through a Frigate replay camera and `visitd`'s virtual clock (`visitd/replay.py` already
   exists), and posts visits with `sourceGeneration = recount`.
3. Only windows where the live producer posted no visits are re-counted, so a re-count can never double a live visit.
4. Admin > Lot labels the window "re-counted".

### 5.4 Ground truth, without staff work
Once a week a person counts the cars in one busy hour of recorded video by hand (about 10 minutes at 4x speed). That
hour, plus the day's billed invoices, is what the counter is judged against. No tally sheet at the counter.

## 6. Hardware recommendation and cost (Nour's spend decision)

Prices are bands from the 2026-09-08 master plan (section 17) and are 7 weeks old; exact models are confirmed against
the research before anything is ordered.

| Item | Band | Note |
|---|---|---|
| PoE lot camera (spec in 4.1) | $130 to $300 | the one item that decides quality |
| N150 mini PC, 16 GB, 512 GB SSD | $180 to $260 | |
| PoE switch, 4 to 8 ports | $50 to $110 | NOT CHECKED whether the shop already has one |
| UPS 600 to 1000 VA | $90 to $150 | |
| High-endurance microSD 128 GB | about $20 | camera-side video for re-count |
| Outdoor Cat6 run | $30 cable if self-run, $150 to $500 installed | the one labour item |
| **Total** | **about $500 to $1,340; typical about $750** | software $0 (Frigate MIT, visitd ours) |

For comparison, the 2026-09-08 master plan's full builds (section 17) were Good $825 to $1,125, Better $1,730 to
$2,130 and Best $2,130 to $2,630: they add a plate camera, bay cameras and more cable runs. This design buys only the
entrance; the bay and plate cameras are separate decisions (section 11). An Axis camera with Object Analytics (the
only camera-native counter read so far) sits at the top of the camera band or above it: price NOT CHECKED.

## 7. Phase plan

| Phase | What lands | Needs |
|---|---|---|
| 1 | This design, reviewed | Nour's yes |
| 2 | Server: the "looking but not counting" page and the new camera's health profile; `visitd` replay tests for the preexisting census and the camera-dead signal | nothing (PR, no spend) |
| 3 | Box image: Compose file, Frigate config for one entrance camera, `visitd` preexisting census, installer, runbook | nothing (PR) |
| 4 | Install day: the box first runs Frigate + `visitd` on a 10-minute phone video of the lot entrance (dry run: no Docker on this dev machine, no lot footage while NicksMax is off), then the camera is mounted, the cable run, the box joined to the shop network; first arrivals on Admin > Lot | the parts (spend), someone at the shop for the mount and cable |
| 5 | Re-count job and the 7-day judgement against invoices and the hand-counted hour; then archive the NicksMax lane | 7 complete ET days of data |
| 6 (10x, optional) | The camera's own counter as a second witness, reconciled per hour by the server | A passed; the camera supports it |

## 8. Kill criteria

1. **The count is real:** over 7 complete ET days, arrivals plus cars already there at open are at least the number
   of billed invoices on every day that had invoices (they should run higher: some cars leave without a job), and the
   hand-counted hour is within 10%. Fail after one geometry fix: stop and re-plan; do not add a second witness to a
   first one that failed.
2. **No silent zero:** zero open hours with 0 arrivals and live detections that did not page.
3. **Stable:** at most 2 producer ids a day (today: 23 to 25).
4. **The pages are real:** pulling the box's power, the camera's cable and the internet each pages within 5 minutes
   in a planted test before the lane is called LIVE.
5. **The 10x option:** dropped if the two witnesses disagree by more than 10% on more than 2 days in 14 with no
   explainable cause.

## 9. Benchmarked against

Benchmarked against: Frigate 0.17 (https://docs.frigate.video/configuration/zones/, /integrations/mqtt/,
/configuration/record/, read 2026-10-26) · adopted: zone membership on the box bottom-centre, MQTT tracked-object
events, `frigate/available` online/offline (the broker publishes offline when Frigate drops), `continuous.days`
retention, the custom export endpoint for re-count, go2rtc one-pull restream · rejected: native LPR on this camera
because a wide counting view cannot read plates at night and plates need a separate privacy decision. Axis Object
Analytics (https://help.axis.com/en-us/axis-object-analytics, read 2026-10-26) · adopted for the 10x witness:
crossline counting in the arrow direction with an accumulated count kept 35 days, occupancy-in-area min/max/average
per minute (the "already there at open" number without a box), MQTT publish from camera rules · rejected: as the
only counter because crossings carry no identity (no time in lot) and firmware cannot be pinned. Hikvision AcuSense,
Dahua IVS, Reolink and UniFi webhooks: NOT CHECKED (the Perplexity run froze Chrome's renderer three times on
2026-10-26; the questions are listed in section 10). Scrypted, Blue Iris +
CodeProject.AI, ZoneMinder, Viseron, Agent DVR, Coral, Ultralytics/BoxMOT: rejected in `docs/UPSTREAMS.md`
(2026-09-08), verdicts re-read today. Prior art in this repo: `visitd/` (state machine, ledger, outbox, shop mirror),
`frigate/config.example.yml`, `docs/research/2026-09-08-camera-vision-MASTER-PLAN.md` sections 9, 15, 17,
`docs/adr/0022-camera-vision-as-built.md`, skill branch `docs/cameras-best-in-class-2026-10-26` (mechanisms table).
Council lenses used: Architect, Skeptic, Operator, Sentinel (agentic-council, 2026-10-26).

## 10. Open research before ordering (NOT CHECKED)

1. Which mainstream PoE cameras count vehicles across a directional line on the camera and push each event over
   HTTPS with a secret (Hikvision AcuSense, Dahua IVS, Reolink, UniFi Protect), with payload, auth, retry and price.
2. Whether they keep 3 to 7 days on their SD card and serve a time range over RTSP playback, ISAPI or VAPIX.
3. Measured accuracy of camera-native car counting at night, in rain and with headlights.
These decide only the camera model and the 10x witness, not design A. They go to Perplexity in Chrome once its
renderer stops freezing (three timeouts on 2026-10-26 ~14:45Z).

## 11. Not decided here

Plate reading; a bay camera; the office audio lane (separate, working, untouched; nothing in the lot lane records
audio); whether the box also replaces the front-desk PC's office lane later.

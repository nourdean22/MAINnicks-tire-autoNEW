# Camera Vision - Live POC + execution-grade deepening plan (2026-09-09)

> **What this is.** After the 2026-09-08 wave shipped the whole camera pipeline (PRs #2221 #2222 #2223 #2225 #2226 #2227 #2228 #2229), a live proof-of-concept on 2026-09-09 connected real SHOPSIGN pixels (via the V380 desktop app) to the SHIPPED visitd state machine. This document consolidates: the live POC's honest results, a 9-agent research workshop (detector stacks, the Anyka unlock, PTZ-aware architecture, plate OCR, shop intelligence, nickstire /admin, repo audit, ops/privacy/benchmarks), the operator's parallel written reports, and a local V380 desktop forensic scan. It supersedes nothing in the master plan; it is the next-stage execution plan.
>
> **One-line thesis.** The project is no longer "can we build this" (proven) - it is "can we turn cheap V380 pixels into TRUSTWORTHY shop events." The bottleneck is observation truth (detection quality + arrival evidence + PTZ egomotion), not more dashboards or bigger models.

---

## 0. Live POC - what it PROVED and what it did NOT (2026-09-09, verified in-session)

**Setup.** The V380 desktop app holds the PTZ camera's vendor P2P cloud stream, so it shows the cameras from ANY network. A Python detector (`camera-bridge/lab/live-v380-poc.py`) captures the app window off-screen (mss), and feeds Frigate-shaped events into the real `VisitTracker.handle_event(parse_event(payload)) + tick(now)`.

**PROVEN (real):** live pixels -> detections -> the shipped visitd contract/parser/state machine -> Emissions (ENTERED_ZONE -> ARRIVAL_CANDIDATE -> CONFIRMED_ARRIVAL). The architecture no longer depends on Frigate existing. Events now persist to `events.jsonl`.

**NOT proven / the P0 defect found:** the first POC run promoted cars that were ALREADY PARKED at startup to CONFIRMED_ARRIVAL - "present in the lot polygon for 45s" was wrongly equated with "arrived." Both this session and the research workshop independently confirmed the mechanism: visitd's `stationary` short-circuit reaches CONFIRMED_ARRIVAL in ~20s of a synthesized-stationary flag, and visitd is a pure function of the event stream so it CANNOT defend itself - egomotion and preexisting-object gating MUST happen at the edge.

**Fix applied + re-run (partial):** added PREEXISTING gating (startup-grace, occupancy-only, never a visit), a SceneGuard that suppresses frames where >33% of pixels change at once (PTZ pan / the V380 2/2 pane refresh), and event persistence. Re-run: 5 cars correctly held PREEXISTING (0 false confirms from them), 3 frames suppressed for camera motion. BUT MOG2 still re-spawns blobs from parked cars/shadows after the grace and mislabels some as arrivals - a time-grace cannot fix motion-detector churn. **Only a real vehicle detector (stable per-car boxes, no re-spawn) + a calibrated entry-line crossing kills the false arrivals.** That is the top-ranked next change, below.

## 0.1 V380 desktop forensics (local, benign, owner-authorized)

The V380 Windows client (`C:\Program Files (x86)\V380`, Qt5 + ffmpeg + `MQTT.dll` + `HS_Device*.dll`) reaches the cameras via vendor P2P CLOUD relays, not a direct LAN socket from this laptop: observed ESTABLISHED outbound to relay servers on `:8800` (192.81.129.138, 172.232.174.105 - Alibaba/Linode) plus MQTT alarm push `:8883` (Alibaba). The laptop was on `192.168.1.82`; the cameras on `192.168.0.x` - i.e. NOT on the camera LAN. `Documents\V380` held only empty Record/Screenshot; device IDs/credentials live in the Qt app store, not a plaintext file. **Implication:** the screen-capture lane works from anywhere (rides the app's cloud); any DIRECT stream (RTSP/ONVIF via the `ceshi.ini` unlock, or an 8800 protocol bridge) requires a machine ON the shop Wi-Fi.

## 0.2 Reconciliation with the operator's parallel reports

Strong agreement across all sources on: the PREEXISTING/entry-evidence P0 as the #1 fix; PTZ SceneGuard; a real detector via OpenVINO on the Arc iGPU/NPU; go2rtc restream; ByteTrack/OC-SORT; plate temporal consensus over per-frame OCR; the nickstire /admin surface; and a labeled shop-footage replay set as the measurement backbone. **Corrections to fold in:** (1) the "visitd 2.1.0 P0/P1 still outstanding" backlog is STALE - #2227 merged the stale-ref/dead-letter/reaper/pruning/atomic-persistence/end->DEPARTING/continuation fixes and #2229 ran authenticated Mosquitto + visitd 2.1.2 through the real Frigate 0.17.2 validator; drop that backlog from future prompts. (2) `ceshi.ini` on Nick's EXACT firmware (Hw_HsAKQQXG_WIFI_20230421) is UNVERIFIED - it is a "reversible compatibility experiment with meaningful HsAK-family evidence," not a "known permanent unlock" (a close HsAkQQVL unit reportedly lost 554/8899 again after a later power cycle). (3) Ohio HB 725 (ALPR restriction) is NOT current law as of 2026-09-09 - introduced, in committee, with a normal-business-activity exemption in the LSC analysis; internal arrival/repeat-visit/booking-link use is well within purpose-limited business activity, but keep watching it.

---

## 0.3 Corrections folded in (second-pass operator research, 2026-09-09)

Three prior claims corrected; they change the build order, not the thesis.

1. **Python 3.14 is not the blocker.** Native OpenVINO 2026 supports Windows 11 +
   Python 3.10-3.14 on Core Ultra CPU / Arc iGPU / NPU. The gap is only the separate
   `onnxruntime-openvino` wheel (documented through 3.13). So on this 3.14 box, use the
   NATIVE OpenVINO Runtime directly (it loads ONNX too); do not put
   `onnxruntime-openvino` on the critical path. Benchmark CPU, GPU and NPU explicitly --
   `AUTO` does not choose the NPU on its own.

2. **A detector COUNCIL beats picking one model.** License-clean Intel candidates:

   | Model | Role | Note |
   |---|---|---|
   | `vehicle-detection-0200` | always-on cheap detector | ~0.79 GFLOPs, 256x256, 1 vehicle class |
   | `person-vehicle-bike-detection-crossroad-1016` | stronger shop-scene detector | surveillance-trained |
   | `vehicle-reid-0001` | ambiguous-identity evidence | 512-float whole-car embedding |
   | `vehicle-attributes-recognition-barrier-0039` | color/type evidence | ~0.13 GFLOPs |
   | `vehicle-license-plate-detection-barrier-0106` | plate PROPOSAL only | front-facing/Chinese training domain |

   Run the tiny detector every cycle; escalate only ambiguous / entry-critical /
   occluded / plate-worthy frames to the stronger model. RF-DETR Nano (Apache-2.0, 384px
   ONNX) is a clean third-stage adjudicator. Do NOT vendor D-FINE pretrained weights --
   the distributed-weights license (Objects365-derived) is still unresolved as of
   2026-08-19. Keep the existing rejection of AGPL Ultralytics/BoxMOT.

3. **V380 source discipline.** Attribute the client to Guangzhou Macro-video / Guangzhou
   Hongshi (hosts the V380 Pro PC client + support), not the `v380.org` domain (now
   carries unrelated spam). A Macro-video support page (2026-05-15) documents manual NVR
   connect as ONVIF port 8899, H.264, TCP, path `/live/ch00_1` -- good TARGETS, but Nick's
   HsAK camera behavior is the deciding truth. Passive instrumentation only:
   `Get-NetTCPConnection -OwningProcess <V380 pid>` + `pktmon` filtered to 192.168.0.155
   on 8800/9800/554/8899. No credential extraction, no brute force, no firmware surgery.

---

## 1. Executive synthesis (9-agent workshop lead)


Repo verified. Writing the synthesis now. All contracts confirmed against code: the G0 route signature, the `auth:"sync"` vs `auth:"owner"` split, the visitd `VisitPolicy` defaults, and the exact CONFIRMED-arrival short-circuit line. Two corrections to the section agents fold in below (stale `origin/main` SHA; the Caffe model file actually is on disk -- the failure is the API, not the download).

---

# Camera-Vision Master Synthesis -- Execution Plan
**Nick's Tire & Auto - current hardware, zero-purchase path first - 2026-09-09**
Lead architect synthesis of 8 research/design sections. Repo verified at `C:\Users\nourd\NOURCITY` HEAD `1a77e8a` (branch `statenour/nextjs-critical-rce-advisory`); `origin/main` = `4532b711` (VERIFIED live -- this supersedes the audit section's `823fb3434`; main advanced via #2231/#2232, so the checkout is **4 behind, 0 ahead**, not 2).

---

## 1. Critical verdict on the POC + the single most important insight

**Verdict: the POC proved the *back half* of the pipeline and faked the front half.** Over 254 frames/70s it correctly drove the **shipped** visitd state machine end-to-end (8 tracks -> 8 ENTERED_ZONE -> 8 ARRIVAL_CANDIDATE -> 3 CONFIRMED_ARRIVAL). That is a real, verified integration win: `VisitTracker`/`VisitPolicy`/`CameraSpec` + `handle_event`/`tick` behaved exactly as the contract promises (VERIFIED -- `camera-bridge/visitd/state_machine.py:309/375/419`). **But every input was manufactured by MOG2 background subtraction run on a screen-capture of the V380 2x2 split-pane, on a PTZ camera.** Three of the four error sources the sections name -- shadows/clouds, the pane's timestamp/OSD motion, and PTZ egomotion -- are *indistinguishable from arrivals* to a background-subtractor. The "3 confirmed arrivals" are not trustworthy; they are the expected output of a noisy detector feeding a correct state machine.

**The single most important insight (Section 1 + confirmed in code):** on a PTZ camera, **camera motion is the dominant false-positive source, and the shipped policy has a 20-second trapdoor for it.** `state_machine.py:744` promotes ARRIVAL_CANDIDATE -> CONFIRMED_ARRIVAL when `dwell >= confirm_seconds` **OR `(stationary_in_arrival AND dwell >= stationary_confirm_seconds)`** -- i.e. a detector that reports `stationary=true` short-circuits a real 45s confirm down to **20s** (VERIFIED -- `VisitPolicy.stationary_confirm_seconds = 20.0`, `:59-60`). MOG2 during a PTZ settle produces a big, motionless-looking blob -> instant false CONFIRMED. **Therefore the highest-leverage work is not a better detector -- it is making the edge honest about two things: "is the camera moving?" and "is this blob really parked inside the driveway?"** Fix geometry + egomotion first; upgrade the detector second. A better detector on an ungated PTZ feed still lies.

Two corrections to the section inputs, for the record:
- **Caffe path:** `MobileNetSSD_deploy.caffemodel` (23 MB) and `.prototxt` **are on disk** in scratchpad (VERIFIED). The failure was **not** "no model downloaded" -- it is that **cv2 5.0 removed `readNetFromCaffe`**. The fix is the ONNX/OpenVINO path (Section 2), not re-downloading Caffe. Do not chase the Caffe file.
- **Rebase target** is `4532b711`, not `823fb3434`.

---

## 2. Highest-leverage zero-cost upgrades -- ranked by impact / effort / risk

Effort S/M/L, risk L/M/H. "Src" cites the backing section. Ranked by (impact  effort) then risk.

| # | Upgrade | Impact | Effort | Risk | Src | Why it ranks here |
|---|---------|--------|--------|------|-----|-------------------|
| 1 | **Edge egomotion gate** (phaseCorrelate + LK optical flow + `estimateAffinePartial2D` RANSAC, STILL/MOVING hysteresis) -- emit nothing and skip `tick()` while MOVING | **Very high** | M | L | 1 | Kills the #1 PTZ false-positive class at the source. Nothing downstream is trustworthy without it. |
| 2 | **Direct RTSP/H.264 stream off SHOPSIGN** (ceshi.ini unlock -> else `prsyahmi/v380` on port 8800) -> MediaMTX/go2rtc -> replaces mss/gdigrab capture | **Very high** | M | M | 3 | Removes screen-capture entirely: real frames, real timestamps, no split-pane, survives laptop-locked. The foundation every other upgrade compounds on. |
| 3 | **Gate the `stationary` flag behind camera-stability** (only set after STILL longer than confirm; never during PTZ settle) | High | S | L | 1 | Closes the 20s CONFIRMED trapdoor (`:744`). One-line-class change, removes instant false confirms. |
| 4 | **Arc-iGPU OpenVINO detector** (YOLOX-S ONNX / OMZ `vehicle-detection-0200` IR via `onnxruntime-openvino`, INT8) replacing MOG2 as the visitd event source | High | M | L | 2 | Appearance detection is egomotion-robust and CPU/NPU-cheap on the 266V/140V. Do it **after** #1 (label detection still needs the geometry invariants). |
| 5 | **Static OSD/seam mask + driveable-area arrival polygon + inward line-cross** at the home preset (PNGs beside camera config) | High | M | L | 1 | Requires centroid-in-polygon AND an entry-line crossing before a visitd `new`. Kills mid-lot blob materialization, cloud/shadow arrivals, ticking-clock phantoms. |
| 6 | **`evidence`/`reasons`/`fusedConfidence` block on every Emission** (`state_machine.py _emit` + `contract.py build_event`, pure projection) | High | M | L | 5 | The single biggest differentiator vs a generic Frigate box: explainable alerts + a confirm-queue band. No migration. |
| 7 | **eventId retry-dedupe extended to the generic `createMany` lane** (`route.ts:152-167`) + replay-twice -> one-row test | High (correctness) | S | L | 5 | Prerequisite before any new event *type* ships; an outbox replay must not double-write. |
| 8 | **fast-alpr plate sidecar** in an isolated **Py3.12 uv venv** (`fast-alpr[onnx-openvino]`, cct-xs-v2 + yolo-v9-t-384, weights pre-baked from GitHub releases) as `FastAlprReaderAdapter` in `bridge/plate_reader.py` | Med-High | M | L | 7 | Zero-hardware OCR that fixes the POC's HF 401/404 and never touches system Py3.14. Best-effort on the SHOPSIGN apron crop. |
| 9 | **nickstire.org/admin arrivals surface** (statenour sync-key `GET /api/sync/arrivals` mirroring `/api/sync/vision` -> nickstire `statenourQuery.ts` + adminProcedure reader + `CameraSection.tsx`) | High (requirement) | M | L | 4/6 | Fulfils the explicit goal: system must appear in nickstire /admin, not only statenour. `apps/nickstire/src` has **zero** camera code today (VERIFIED -- grep empty). |
| 10 | **Pre-OCR quality gate** (plate-width >=90px, Laplacian blur >=120, CLAHE) emitting a `qualityGate` reason | Med | S | L | 7 | Skip-and-explain weak frames instead of fabricating wrong plates. Cheap accuracy floor. |
| 11 | **Plate replay scorecard + `score_replay.py`** (labels.csv/json, extend `replay-fixture.ps1`, gate model/threshold changes at >=98% precision) | Med | M | L | 7/8 | Turns "did we regress?" from opinion into a gate. None of it exists in repo yet (VERIFIED). |
| 12 | **Raise `split_track_seconds` > longest PTZ tour + disable V380 auto-cruise (hold one fixed home framing)** | Med | S | L | 1 | Config-only; lets the shipped split-track rule bridge a freeze/resume so a parked car isn't double-counted after a pan. |

**Top two are confirmed as predicted:** the direct-stream unlock (#2) and the Arc/OpenVINO detector (#4) -- but **#1 (egomotion gate) and #3 (stationary gate) must land first**, because they are the correctness floor that makes #2 and #4 pay off instead of amplifying noise.

---

## 3. 24-hour execution sequence

Each step: **actor** = `[OP]` operator (physical/on-device) or `[AGENT]` coding agent. Acceptance = the check that closes the step.

**Track A -- get a clean, verified baseline (do first, in order)**

1. `[AGENT]` **Start a fresh named branch from `origin/main`** in its own worktree and carry the required changes over by explicit path. Do **not** rebase: the work sits on a branch that has already been pushed, and rewriting shared history is a protected operation (root `AGENTS.md`, Protected operations). Per NOURCITY rules: named branch, explicit paths, `npm_config_node_linker=hoisted` for gates, mirror junctions by hand.
   - **Accept:** `git rev-list --left-right --count origin/main...HEAD` shows `0 <ahead>` on the left, and `git reflog` shows no rewrite of an already-pushed commit.

2. `[OP]` **SHOPSIGN runbook Steps 0-2** (3): `arp -a`, `Get-NetTCPConnection` on the V380 process, `nmap -p 554,8800,8899,9800 192.168.0.155`, ONVIF WS-Discovery/mDNS/SSDP probe. Snapshot the benign surface **before** any change.
   - **Accept:** written record confirming only 8800/9800 respond (matches the 2026-09-08 finding); SHOPINSIDE left untouched as control.

3. `[AGENT]` **G0 dry-run against the live SHOPSIGN unit** (VERIFIED route -- `apps/statenour/app/api/devices/[id]/events/route.ts:59`):
   ```
   POST /api/devices/v380-shopsign/events?dryRun=1
   body: {"events":[{"event":"vehicle_detected", ...}]}
   ```
   The wrapper key is **`events`**, not `items`: the route does `const items = body.events || [body]` (`route.ts:52`), so an `items` wrapper is swallowed as ONE event whose `event` field is undefined and the probe returns `valid:false` — failing the gate for the wrong reason.
   - **Accept:** response `{dryRun:true, valid:true, events:[{wouldAlert:...}]}` — the report array comes back under **`events`** (`route.ts:79`), not `report` — and **zero** DB writes (the route returns before `deviceEvent.createMany`). This proves the producer contract before wiring any real source.

**Track B -- make the edge honest (correctness floor)**

4. `[AGENT]` **Commit the POC as lab-only, quarantined:** `camera-bridge/lab/screen_ingest.py` (flag-gated, UNSUPPORTED-for-prod banner), source from scratchpad `lot_watch.py`. Add a positive-controlled test: **>=1 CONFIRMED_ARRIVAL on the motion clip, 0 on a still clip.** Production visitd untouched.
   - **Accept:** `pytest camera-bridge/tests` green incl. the new still-clip-zero assertion (uses the `positive-control-first` + `empty-vs-error` discipline).

5. `[AGENT]` **Gate the `stationary` flag** (1 action #2): edge never sets `stationary=true` unless the camera has been STILL longer than `confirm_seconds`. Add a unit test that a `stationary` blob during simulated MOVING does **not** reach CONFIRMED via the `:744` short-circuit.
   - **Accept:** test proves no CONFIRMED within `stationary_confirm_seconds` while MOVING.

6. `[AGENT]` **Egomotion gate** (1 action #1) in the edge ingest: `cv2.phaseCorrelate` + `goodFeaturesToTrack`/`calcOpticalFlowPyrLK` + `estimateAffinePartial2D` RANSAC, STILL/MOVING hysteresis; while MOVING emit nothing and skip `tracker.tick()`.
   - **Accept:** replay a captured PTZ-pan clip -> **0** emissions during the pan; a real static-camera arrival clip still confirms.

**Track C -- the two big levers, started within 24h**

7. `[OP]` **ceshi.ini unlock attempt on SHOPSIGN ONLY** (3): FAT32 SD root, `[CONST_PARAM] rtsp=1 / rtsp_enable=1 / rtsp_ctrl=1 / onvif=1`, 5-min test-mode power cycle, delete file, reboot. SHOPINSIDE stays the control.
   - **Accept:** `[AGENT]` `ffprobe rtsp://<admin>@192.168.0.155:554/live/ch00_1` (and `ch00_0`) returns a stream. If 554 stays closed -> step 8.

8. `[AGENT]` **Fallback direct stream if 554 closed:** build `prsyahmi/v380` (MIT, pin commit) and pull H.264 over LAN port 8800 with the owner admin password -> `ffmpeg` -> MediaMTX/go2rtc RTSP.
   - **Accept:** `ffprobe` reads the go2rtc RTSP URL; frames are full-res single-pane (not the 2x2 capture).

9. `[OP]` **Isolate both cameras** (3/8): in the Fios router, deny WAN egress for the two camera MACs and reserve `.154/.155`. Mitigates the undisableable-telnet + plaintext-relay CVE class; streams pulled LAN-only.
   - **Accept:** cameras have no outbound internet route; LAN RTSP still works.

> After 24h you have: a rebased branch, a verified G0 contract, a quarantined POC with a still-clip-zero guard, the stationary trapdoor closed, an egomotion gate, and at least one real (non-screen-capture) stream candidate on SHOPSIGN -- the prerequisites for everything in the 7-day plan.

---

## 4. 7-day maturation to a production-quality current-hardware system

**Day 1-2 -- real detector on the real stream**
- `[AGENT]` **Isolated Py3.12 venv on the shop laptop** (2): `pip install openvino==2026.3.1 onnxruntime-openvino==1.24.1 opencv-python-headless numpy supervision "trackers[all]" fast-alpr`. Verify devices: `python -c "import openvino as ov; print(ov.Core().available_devices)"` -> expect `['CPU','GPU','NPU']`; `benchmark_app -m model.xml -d GPU` / `-d NPU` to pick the deployed device. **Accept:** device list printed; benchmark chooses a device with detector latency measured.
- `[AGENT]` **Wire OpenVINO detector -> supervision.Detections -> `trackers.ByteTrackTracker` -> visitd** (2), replacing MOG2 on the go2rtc stream. Apply the OSD mask + arrival polygon + inward line-cross (1 action #3) at the SHOPSIGN home preset. **License hygiene (2):** exclude Ultralytics (AGPL), YOLO-NAS (non-commercial), boxmot (AGPL); ship only Apache/MIT. **Accept:** replay clip shows real arrivals confirmed, phantom/cloud/mid-lot blobs rejected; commercial-license inventory documented in the PR.

**Day 2-3 -- explainability + dedupe correctness**
- `[AGENT]` **Ship `evidence`/`reasons`/`fusedConfidence`** on every Emission (5) -- projection of facts already in scope. **Accept:** contract test asserts each emission carries reasons; confirm-queue band renders.
- `[AGENT]` **Extend eventId retry-dedupe to the generic `createMany` lane** (5, `route.ts:152-167`) + replay-twice->one-row test. **Accept:** duplicate outbox replay yields exactly one row.
- `[AGENT]` **Pin day/night `VisitPolicy` profile at visit creation** (5, `_stitch`), carry `data.profile` on emissions. **Accept:** test asserts profile constant across a visit's emission history (no mid-flight threshold change).

**Day 3-5 -- plates (best-effort) + scorecard gate**
- `[AGENT]` **fast-alpr sidecar** (7) in the Py3.12 uv venv as `FastAlprReaderAdapter`, `provider='fast_alpr'`, OpenVINO EP on Arc GPU; pre-OCR quality gate (width/blur/CLAHE) -> `qualityGate` reason. **Accept:** apron crops produce plates with a quality reason; weak frames skipped-and-explained.
- `[AGENT]` **Positional per-character consensus voting** in visitd `plate_summary` (7, behind `policy.plate_char_consensus`, confusable-merged, promote to CONFIRMED on >=3 gated agreeing reads), emitting `perChar`/`votes`. No migration. **Accept:** replay shows a plate promoted only after >=3 agreeing gated reads.
- `[AGENT]` **Benchmark scorer** `camera-bridge/tools/score_replay.py` + `labels.json` + `tests/test_scorer_regression.py` (8): recall/precision/dwell-MAE/duplicate/ghost/plate-read-rate from in-process `replay()`. Gate any threshold/model/SR change at **>=98% precision**. **Accept:** scorer runs on a hand-labeled clip; regression test wired into the existing fixture suite.

**Day 4-6 -- the nickstire /admin surface (explicit requirement)**
- `[AGENT]` **statenour:** refactor `cameraArrivals` into shared `getArrivalsSnapshot()`; expose **`GET /api/sync/arrivals`** mirroring `/api/sync/vision` with **`auth:"sync"`** (VERIFIED pattern -- `sync/vision/route.ts:48`; note `cameras/route.ts` is `auth:"owner"` and is **not** the right door for cross-app reads). Return events + todayCount + cameras + pre-masked match + `dataAsOf` (6).
- `[AGENT]` **nickstire:** add `server/lib/statenourQuery.ts` (mirror `lib/nickstire/query.ts`), `server/routers/admin/camera.ts` adminProcedure reading `/api/sync/arrivals`, register in `routers.ts`; add `CameraSection.tsx` + `AdminSection` union entry + `ADMIN_REGISTRY` entry (group "Truth", `FULL_ACCESS`), reusing cockpit **empty-vs-error** handling + FreshnessChip (6). Set `STATENOUR_SYNC_URL` + `STATENOUR_SYNC_KEY` on the nickstire Railway service.
- **Tile evidence labels (6):** `todayCount` + cars-in-lot = backed now; avg-wait = "--" pending typed tables; bay-occupancy = disabled until a bay camera exists. **Render "--", never a fabricated zero** (this is the `empty-vs-error` rule). **Accept:** one `testVehicleAlert` appears in **both** statenour cockpit and nickstire /admin; sync key never reaches the browser.

**Day 5-7 -- production hardening + typed projection**
- `[AGENT]` **Prisma `VehicleVisit` model** + upsert inside `handleVehicleEvent` (keep `DeviceEvent` as append-only log); repoint `cameraArrivals`/`updateArrivalStatus` to the projection; hand-apply the migration via `POST /api/system/apply-pending-migration` per the `statenour-migration` skill (4). **Accept:** projection populates; append-only log intact.
- `[AGENT]` **Heartbeat SLOs** (8): add `detectorMs` + Frigate `/api/stats` (cameraFps, storagePct) to `heartbeat_body()` via a best-effort loopback poll. **Accept:** `detector<40ms` and `disk<80%` become measurable in the cockpit.
- `[OP]/[AGENT]` **Retention program** (8): write `docs/operations/2026-09-camera-retention-policy.md` (ORC 1354 safe-harbor: retention table, police-disclosure log template, staff-ack); add cockpit disclosure-logged export/redaction; add the `plate_retention_overdue` SQL probe (alert if >0) + a nightly planted-positive alert canary (fires in day, suppresses in quiet hours). **Accept:** overdue-plate probe reads 0; canary suppresses at night, fires by day.
- `[OP]/[AGENT]` **Nightly `ffprobe` RTSP revert-detection cron** on the edge/lab host (the ceshi.ini unlock can silently revert). **Accept:** cron alerts if 554 stops answering.

**End state (7 days):** real single-pane RTSP off SHOPSIGN, OpenVINO vehicle detection on the Arc iGPU/NPU feeding the shipped visitd machine through an egomotion + geometry gate, explainable emissions with a >=98%-precision replay gate, best-effort plates, a typed `VehicleVisit` projection, live surfaces in **both** statenour and nickstire /admin, and a written retention/observability program. All Apache/MIT, CPU/NPU-friendly, no purchase.

---

## 5. Optional hardware -- ranked by ROI (only after the free path is exhausted)

Pursue only once 3-4 are shipped and the current-hardware precision is measured on the scorecard.

| Rank | Item | ~Cost | ROI rationale | Trigger to buy |
|------|------|-------|---------------|----------------|
| 1 | **PoE overview camera (fixed, wide, real RTSP/ONVIF)** for the lot | Low-med | Removes PTZ egomotion entirely for the *counting/arrival* lane; a fixed camera is the cheapest way to make arrivals boringly reliable. Already a pending operator action. | Egomotion gate helps but PTZ tours still cost coverage. |
| 2 | **Dedicated edge box** (mini-PC / already-scaffolded broker host) so detection doesn't depend on the shop laptop being awake/unlocked | Med | Turns a lab demo into a 24/7 service; unblocks the "survives laptop-locked" requirement without screen-capture. | Once RTSP is stable and you want always-on. |
| 3 | **PTZ-with-native-RTSP-LPR camera** (or an LPR-grade fixed cam on the apron) | Med-high | Frigate native LPR + a 100px plate band beats software SR on the V380. Lets you retire the fast-alpr sidecar. | Only if plate read-rate on current hardware plateaus below target on the scorecard. |
| 4 | **Bay cameras (SHOPINSIDE bay zones)** | Med | Unlocks `bay_occupancy`/`serviceDwellSeconds`/`waitSeconds` (5 later actions) -- advisory reconciliation against `bays.currentWorkOrderId`. | Phase-2, after arrival lane is production-solid. |

Guiding rule (5/8): every new signal ships **advisory-only**, never auto-writes nickstire tables and never auto-texts a customer.

---

## 6. Top-10 risk / uncertainty register

Labels: **VERIFIED** (checked in repo/route/code this session), **LIKELY** (strong evidence, not directly reproduced here), **UNVERIFIED** (claim from a section or vendor folklore, untested).

| # | Risk / uncertainty | Label | Evidence / note | Mitigation |
|---|--------------------|-------|-----------------|------------|
| 1 | The POC's "3 confirmed arrivals" are noise-driven, not real | **VERIFIED (mechanism)** | MOG2 on PTZ split-pane; `:744` 20s stationary short-circuit exists in code (`stationary_confirm_seconds=20.0`) | Egomotion gate + stationary gate + arrival polygon before trusting any confirm |
| 2 | ceshi.ini unlock opens RTSP 554 on this Anyka HsAK build | **UNVERIFIED** | Only 8800/9800 open today; no ONVIF switch in the app build; unlock is vendor folklore for this generation | Test on SHOPSIGN only, SHOPINSIDE as control; `prsyahmi/v380` port-8800 fallback if 554 stays closed |
| 3 | `prsyahmi/v380` pulls H.264 over 8800 with owner creds on THIS firmware | **LIKELY** | MIT client targets V380 P2P; firmware `Hw_HsAKQQXG_WIFI_20230421` is in-family, not identical | Pin the commit; verify with `ffprobe`; keep screen-capture lab path as last resort |
| 4 | G0 dry-run contract + zero-write guarantee | **VERIFIED** | `route.ts:59` returns before `createMany` at `:89`; `{dryRun,valid,report[].wouldAlert}` | Use as the standing producer pre-flight before any new source |
| 5 | nickstire /admin has no camera code; sync must use `auth:"sync"` not `owner` | **VERIFIED** | grep of `apps/nickstire/src` empty; `sync/vision` = `auth:"sync"`, `cameras` = `auth:"owner"` | Build `/api/sync/arrivals` on the sync door; sync key server-side only |
| 6 | Arc 140V exposes GPU **and** NPU to OpenVINO 2026.3.1 with usable detector latency | **UNVERIFIED** | Vendor-plausible on Core Ultra 7 266V; not benchmarked here | `available_devices` + `benchmark_app` gate (Day 1) before committing a device |
| 7 | fast-alpr weights install cleanly in Py3.12 and never touch Py3.14 | **LIKELY** | Isolated uv venv is the standard fix for the POC's HF 401/404; Py3.14 cv2 5.0 dropped `readNetFromCaffe` (the real POC blocker) -- VERIFIED the Caffe file is present, so the blocker is the API not the download | Pre-bake weights from GitHub releases; pin venv; quality-gate every read |
| 8 | Camera-isolation on a Verizon Arcadyan Fios router | **LIKELY (limited)** | 8: MAC/IP WAN-egress-deny is "the only isolation a Fios router reliably gives"; no true VLAN | Deny WAN egress for both MACs; pull LAN-only; nightly revert-detection cron |
| 9 | Undisableable-telnet / plaintext-relay CVE class on these units | **UNVERIFIED (per-unit)** | 3 cites CVE-2025-25984 for the V380 family; not probed on these serials | Keep cameras off the internet (risk 8); never expose 8800/9800 to WAN |
| 10 | A signature-only (non-plate) match could mis-suppress a real customer alert | **VERIFIED (design risk)** | 5: base-rate rule; a mis-suppressed customer is P0 | Require plate OR (signature+pattern agreement) before suppressing; never act on signature-only; report signature precision beside plate precision |

---

**Bottom line for the operator + coding agent:** the free path is real and nearly complete in the back half. Spend the first 24h making the edge honest (egomotion + stationary gate + arrival geometry) and landing at least one non-screen-capture stream on SHOPSIGN; spend the 7 days swapping MOG2 for the Arc/OpenVINO detector, adding explainable emissions behind a >=98% replay gate, and surfacing arrivals in **both** cockpits. Buy hardware only when the scorecard says the current cameras have plateaued -- and buy the fixed PoE overview camera first.

**Key repo anchors (verified this session):** `camera-bridge/visitd/state_machine.py` (`:59` `stationary_confirm_seconds=20`, `:744` confirm short-circuit, `:309/375/419` tracker API); `apps/statenour/app/api/devices/[id]/events/route.ts:59` (G0 dryRun); `apps/statenour/app/api/sync/vision/route.ts:48` (`auth:"sync"` mirror pattern); `apps/statenour/app/api/cameras/route.ts:38` (`auth:"owner"` -- do not use for cross-app sync); `apps/nickstire/src` (no camera code -- greenfield); `docs/research/2026-09-08-camera-vision-MASTER-PLAN.md` + `docs/adr/0017`. Rebase target `origin/main` = `4532b711`.


---

# Appendices - detailed research sections



<a name="Live POC critique + PTZ-aware event arch"></a>

## POC critique + PTZ-aware event architecture

### 0. Ground truth I verified in the repo (not memory)
Read `camera-bridge/visitd/state_machine.py`, `frigate_events.py`, `contract.py` at `C:\Users\nourd\NOURCITY`. Load-bearing facts that drive everything below:

- **visitd is a pure function of the event stream. It has ZERO camera-motion awareness.** `_evaluate()` derives all state purely from `current_zones` / `entered_zones` / `stationary` / `box` carried in each Frigate snapshot. **Therefore PTZ egomotion MUST be suppressed at the edge, before an event is emitted -- visitd cannot defend itself.** (VERIFIED, `state_machine.py:696-748`.)
- **A false `stationary=True` flag is the single most dangerous edge output.** Transition table (VERIFIED `state_machine.py:742-746`):
  - `ENTERED_ZONE -> ARRIVAL_CANDIDATE` fires on `dwell >= candidate_seconds (10s)` **OR `stationary_in_arrival`** (instant).
  - `ARRIVAL_CANDIDATE -> CONFIRMED_ARRIVAL` fires on `dwell >= confirm_seconds (45s)` **OR (`stationary_in_arrival` and `dwell >= stationary_confirm_seconds (20s)`)**.
  - So a phantom blob that lands in the arrival zone and is flagged stationary reaches **CONFIRMED_ARRIVAL in ~20s of frozen frame_time**, not 45s. The POC literally synthesizes `stationary` from a coast timer -- in production that is a false-arrival generator.
- **`end` events are toxic under PTZ.** When an object leaves all zones (`in_zone False`, `ever_zone True`) the visit goes `DEPARTING` and, after the departure hold (`leave_grace_seconds 20s`), emits `LEFT`/`PASS_THROUGH` (VERIFIED `state_machine.py:713-731`). A PTZ pan that shoves a genuinely-parked car's box out of the zone -> spurious `DEPARTING -> LEFT`; when the pan returns and re-detects the same car -> a **brand-new visit UUID** -> the same car double-counts.
- **Split-track rescue breaks under PTZ.** Rule 1 rejoins a re-detected object only if `gap <= split_track_seconds (10s)` **and `IoU(old_box, new_box) >= 0.5`** (VERIFIED `state_machine.py:572-581`). A pan/zoom round-trip usually exceeds 10s and moves the box, so IoU fails -> no rejoin -> inflated visit count.
- Emission/contract fields the edge must populate: `id, camera, label{car,truck,motorcycle,bus}, frame_time, box, area, stationary, current_zones, entered_zones` (+ optional `frigate/tracked_object_update` LPR). Contract v2 emits `state, dwellSeconds, zoneDwell, stationary, estimated, direction` and an idempotency `eventId=sha1(visitId|state|seq)` (VERIFIED `contract.py`).

### 1. What the POC PROVES vs. does NOT
**PROVES (real, keep it):**
- End-to-end wiring is correct: a live feed -> detections -> Frigate-shaped `{type,before,after}` -> `parse_event` -> `VisitTracker.handle_event` -> `tick` -> real `Emission`s with the shipped state machine. 254 frames/70s -> 8 tracks -> 8 ENTERED_ZONE -> 8 ARRIVAL_CANDIDATE -> 3 CONFIRMED_ARRIVAL. The contract, parser, and state machine run against non-synthetic input. (VERIFIED -- I read the script and the code paths it calls.)
- The event schema visitd expects is satisfiable from a hand-rolled edge (no Frigate binary required) -- important, because the shop laptop is Windows/Py3.14 where Frigate's Docker/Coral path is awkward.

**Does NOT prove (do not claim these):**
- **Clean detection** -- MOG2 boxes are self-described as loose/noisy; no precision/recall against ground truth, no labeled arrivals.
- **Real geometry** -- `current_zones=["front_lot"]` is hard-coded on every detection; there is no homography, no calibrated arrival polygon, no pixel->lot mapping. Every moving blob is "in the lot" by fiat. The 8->3 funnel is therefore not evidence the 3 were real cars in the real lot.
- **`stationary` is fabricated**, not measured -- the coast timer invents motionless_count. The 3 CONFIRMED arrivals rode the 20s stationary short-circuit on synthetic flags.
- **Persistence / unattended run** -- 70s, foregrounded window, no ledger, no MQTT, no crash recovery, no day/night, no restart.
- **Plate reads** -- none. `recognized_license_plate` never populated; the whole LPR path is untested on this feed.
- **Egomotion handling** -- the run almost certainly caught the PTZ static; there is no camera-motion gate at all. This is the gap the rest of this section closes.

### 2. Concrete false-positive / false-track failure modes for MOG2-on-a-PTZ-split-pane, and exactly how each corrupts counts/dwell
MOG2 models each pixel's background as a mixture of Gaussians and flags pixels that deviate. Every assumption it makes is violated by a panning PTZ with an OSD overlay on a 2/2 split-pane cloud stream:

| # | Failure mode | Mechanism | How it corrupts visitd |
|---|---|---|---|
| 1 | **Camera pan/tilt (egomotion)** | Whole frame shifts; MOG2 flags ~the entire frame as foreground | Giant blobs pass area/aspect gates -> many spurious `new` -> each a new visit UUID -> **visit count explodes**; if one lands in the "lot" and is coasted -> false CONFIRMED |
| 2 | **Zoom** | Radial scale change; edges become motion everywhere | Same as pan but worse near frame edges; also resizes a real car's box -> breaks split-track IoU on the next real frame |
| 3 | **Timestamp/OSD overlay** | The clock digits change every second -> a permanent motion source at a fixed rectangle | A perpetual "stationary-ish" blob -> if inside the arrival polygon, rides the `stationary_confirm` path -> **a CONFIRMED_ARRIVAL that never leaves** (dwell grows forever, never `end`s) |
| 4 | **2/2 split-pane refresh** | The V380 app repaints two sub-panes at different times; the seam and half-frame repaints read as motion | Rectangular seam blobs -> phantom tracks straddling the divider; one physical car split across panes -> **one car -> two tracks -> two visits** |
| 5 | **Shadows / passing clouds** | MOG2 `detectShadows` is imperfect; a cloud edge sweeps luminance across the lot | Large slow-moving low-aspect blob in the lot -> passes as a "car," dwells -> **false ARRIVAL_CANDIDATE/CONFIRMED** |
| 6 | **Trees / flags / rain / snow** | High-frequency texture motion | Many small blobs; some merge past the area gate -> phantom `new`/`end` churn -> visit-count noise, and `end`s trigger spurious DEPARTING on nearby real tracks |
| 7 | **Headlights / night glare** | Specular blooms move across asphalt | Bright blob tracked as a vehicle after the car itself has left -> **dwell over-counts**, delayed/false `LEFT` |
| 8 | **One car -> many blobs** | A car crossing a shadow/pane seam fragments into pieces | Centroid tracker splits it -> multiple `new` ids -> split-track IoU may fail -> **over-count**; or rapid id churn floods events |
| 9 | **Many cars -> one blob** | Two cars parking adjacent merge into one contour | Single track -> **under-count**; when they separate, a "new" car appears mid-lot (no line cross) -> a late phantom arrival |
| 10 | **PTZ return re-frames a parked car** | After a tour the car's box is at a new pixel location | `end` fired on pan-out (mode 1) already closed the visit; re-detect mints a new UUID -> **double-count of a car that never moved** |

Net: without an egomotion gate, **every PTZ move is a burst of false arrivals and false departures**, and the OSD clock alone can pin one permanent fake CONFIRMED arrival. Counts and dwell are unusable.

### 3. PTZ-aware event architecture (the design)
Governing constraint (VERIFIED 2026-09-08 probe): **PTZ pose is NOT queryable on this V380 build** -- only TCP 8800/9800 open, no ONVIF, no WS-Discovery; Anyka firmware has an internal PTZ daemon but this app build exposes no pose API. So **egomotion must be detected visually, not from telemetry.** (If a future ONVIF cam is bought, its `GetStatus`->`Position` enables per-pose zone maps -- see 4 ROI note.)

**Core principle:** treat a **single fixed "home" framing** as the only state in which detection and visit events are allowed. Anything else is egomotion -> **freeze**. Concretely:

**(a) Egomotion gate (per frame, CPU, cv2 5.0 / Py3.14, no model download).** Two interchangeable detectors, cheapest first:
- **Phase correlation** (translation): `cv2.phaseCorrelate` on a 128x128 grayscale, Hann-windowed downscale of the frame vs. prev -> global (dx,dy) in ~0.2-0.5 ms. `|shift| > _pan (~1.5 px @128)`  egomotion. Catches pan/tilt; misses zoom.
- **Sparse LK homography** (translation + rotation + zoom): `cv2.goodFeaturesToTrack` (~200 pts on a grid, OSD/seam masked out) -> `cv2.calcOpticalFlowPyrLK` -> `cv2.estimateAffinePartial2D(prev,cur,method=RANSAC)`. From the 2x3 model read translation, rotation, and scale; `scale1`  **zoom**; inlier median flow `> `  pan/tilt. RANSAC inlier rejection ignores the real moving cars (they are the outliers) -- this is exactly the 2026 hybrid pattern in the literature ("apply background subtraction when there is no camera motion, use optical flow to detect camera motion otherwise, via simple Lucas-Kanade point tracking"). ~2-5 ms/frame at 640x360 on the Core Ultra 7 -- comfortably real-time.
- **Hysteresis / settling:** declare `MOVING` instantly on trigger; require **N consecutive still frames (~1.0-1.5s)** AND homography-vs-home ~ identity before declaring `STILL` again. This absorbs mechanical overshoot and the split-pane refresh.

**(b) Return-to-home check.** Keep a stored **home reference frame** (the calibrated framing). On settle, compute `findHomography(current, home, RANSAC)`; only if it is near-identity (small translation, scale~1) do we consider the camera "home" and re-arm. If it settled at a *different* framing (operator moved it, or an auto-tour preset), stay suppressed and raise a "camera off-home" health event -- because the arrival polygon no longer maps to reality.

**(c) MOG2 lifecycle tied to the gate.** MOG2's model is invalid the instant the camera moves. On `MOVING->`: **reset** the subtractor (`cv2.createBackgroundSubtractorMOG2(...)` or high `learningRate` flush). On `->STILL` at home: **warm up** the model for ~1-2s with detection *suppressed* (no events) so the fresh background settles before any blob is trusted.

**(d) Freeze/resume visit state across PTZ moves -- the visitd-correct part.** During `MOVING`:
- Emit **nothing** -- no `new`, no `update`, no `end`.
- **Do NOT advance the clock:** do not call `tracker.tick(now)` and do not feed new `frame_time`s. Because visit dwell is `union_seconds(intervals, at)` and DEPARTING is time-driven, freezing `at` freezes every timer -- no phantom CONFIRMED, no phantom LEFT while the camera is blind. (VERIFIED this is sufficient: `tick`/`handle_event` are the only ways `at` enters `_evaluate`.)
- **Hold object ids alive.** The genuinely-parked car keeps its id and its open `current_zones` from the last home frame; visitd still believes it is in-zone (correct -- it hasn't moved).
- On resume at home: re-acquire detections, **re-associate the parked car to its prior id** by position+appearance so its interval is continuous. Belt-and-suspenders: because the camera returns to *identical* home framing, the re-detected box overlaps the pre-move box, so `IoU >= 0.5` holds -- but the pan round-trip may exceed `split_track_seconds (10s)`. **Config lever (already in `VisitPolicy`):** raise `split_track_seconds` to exceed the longest PTZ excursion (e.g. 60-120s) so the shipped split-track rule bridges the freeze without code changes. Keep `split_track_iou` at 0.5 (valid only because home framing is identical).

**(e) Scene calibration + driveable-area masking (kills modes 3,5,6,7).**
- One-time at the home preset: draw the **arrival polygon** (lot mouth + parking apron) and a **static OSD/seam mask** (fixed rectangles for the clock and the 2/2 divider). Persist as PNGs next to the camera config.
- Per frame: `fg = MOG2 AND driveable_polygon AND NOT osd_mask`. Only detections whose **centroid is inside the polygon** are eligible. The clock, trees, sky, street, and the pane seam are excluded structurally, not by luck.

**(f) Entry-line crossing vs. polygon dwell (kills modes 8,9 mid-lot phantoms).**
- Define a **virtual entry line** across the lot mouth. Promote a blob to a visitd `new`/`entered_zones` **only when its track crosses the line inward** (sign of the cross product of motion vs. line). A blob that simply *materializes* mid-polygon (shadow, merge/split, glare) never crossed the line -> do not open a visit. `direction` (already a contract field) is set from the crossing sign.
- Dwell/CONFIRM still uses polygon presence (matches visitd's zone-dwell model), but the *gate to exist at all* is the line cross.

**(g) Temporal consensus / anti-flicker (kills id churn, modes 4,6,8).**
- Require a detection to persist **K of last N frames (e.g. 4 of 6)** and a **minimum track age (~1s)** before emitting `new`. Symmetric hangover before `end`. This is the standard debounce; it collapses split-pane and foliage churn into nothing.
- Blob sanitation: morphological close + merge boxes with `IoU>0` or centroid distance < one vehicle width (fixes one-car->many); flag `area > 1.6x median vehicle` as ambiguous and **do not split the count** (fixes many-cars->one under an explicit "ambiguous" quality flag rather than a wrong number).

### 4. Algorithm sketch -> exact visitd event mapping (what the edge must send so visitd stays correct)
Per-frame edge loop (pseudocode, maps 1:1 onto the shipped API):
```
gate = egomotion_gate(frame)          # STILL | MOVING (phaseCorr + LK-RANSAC + hysteresis)
if gate == MOVING or in_warmup:
    reset_mog2_if_needed()
    #  --- FREEZE: emit nothing, do NOT call tracker.tick(), do NOT advance frame_time ---
    continue
# camera is STILL and home-locked:
fg = mog2.apply(frame) AND driveable_polygon AND NOT osd_mask
dets = sanitize(contours(fg))         # merge/split, area+aspect gates, centroid-in-polygon
tracks = update_tracks(dets)          # centroid/IoU tracker w/ K-of-N consensus + min-age
for t in tracks:
    ev = "new"   if t.just_confirmed_by_line_cross_inward
       = "update"if t.alive
       = "end"   if t.crossed_line_outward  OR (lost while camera STILL for > hangover)
    after = { id:t.id, camera:"sign", label:"car", frame_time:t.now,
              box:t.box, area:t.area,
              stationary: t.motionless_for > CONFIRM_WINDOW,   #  <-- see invariant 4
              current_zones: zones_from_homography(t.centroid), # frozen mapping @home
              entered_zones: ["front_lot"] if ev=="new" else [] }
    emit(parse_event({"type":ev,"before":{},"after":after}) -> tracker.handle_event)
emit_all(tracker.tick(t.now))         # ONLY when STILL
```

**Invariants the edge must honor (each maps to a visitd transition I verified):**
1. **MOVING  emit nothing and freeze `at`.** Prevents spurious `new` (mode 1/2/10) and prevents time-driven `DEPARTING->LEFT` on real parked cars while blind.
2. **Never emit `end` because the PTZ moved.** `end` -> object leaves registry -> DEPARTING -> LEFT after 20s grace -> then a fresh UUID on return = double-count (mode 10). Only emit `end` on a genuine outward line cross, or track-loss *while the camera is verified STILL*.
3. **`current_zones` comes from the frozen home-preset homography.** Never recompute zones off-home. Off-home  frozen last-known (invariant 1 means we don't emit anyway).
4. **`stationary=True` only after the camera has been STILL longer than the confirm window.** Because `stationary_in_arrival` short-circuits CONFIRMED at 20s, a stationary flag set during settling = instant false arrival (mode 3). Gate `stationary` behind camera-stability, not just blob-motionless.
5. **One stable `id` per physical car for the whole visit** so `union_seconds` dwell and split-track work; re-associate on resume, and set `split_track_seconds` > longest PTZ excursion as the safety net (config-only).
6. **`tracker.tick(now)` runs only in STILL.** In MOVING it would advance estimated timers and can emit CONFIRMED/LEFT with `estimated=True` on a blind camera (VERIFIED `tick`->`_evaluate_all(estimated=True)`).

If a future **ONVIF/pose-queryable** camera is bought: replace the visual gate's "home" assumption with per-pose homographies keyed on `GetStatus.Position` (ptz space), and suppress only during the *commanded* move window -- the same freeze/resume contract, now driven by telemetry instead of optical flow.

### 5. 2026 open-source / CPU techniques (primary sources)
- **Hybrid gate (the design's backbone):** modern moving-camera pipelines "apply background subtraction when there is no camera motion, and use optical flow otherwise, with camera-motion detection using a simple Lucas-Kanade point tracker" -- exactly the STILL/MOVING switch above. ([arXiv 1811.06660](https://arxiv.org/pdf/1811.06660), moving-camera BGS survey context; [IEEE 6555538](https://ieeexplore.ieee.org/document/6555538/) optical-flow BGS for PTZ).
- **CPU cost check -- why LK/phaseCorrelate, not RAFT:** RAFT-small+MAD ties Lucas-Kanade accuracy at **55 ms/frame**; LK/FAST-based global motion gives **~25% time-efficiency improvement on low-power platforms** and phase correlation is sub-millisecond. RAFT is GPU-tier and rejected for this box. ([SMART, arXiv 2605.31551](https://arxiv.org/pdf/2605.31551); [LK camera-motion estimation, IEEE 9027696](https://ieeexplore.ieee.org/document/9027696/)).
- **Global motion compensation** via RANSAC affine/homography (`estimateAffinePartial2D`/`findHomography`) -- [Fast and Accurate GMC, ULPGC](https://accedacris.ulpgc.es/bitstream/10553/115495/1/MotionCompensation.pdf).
- **Heavier future options (GPU, note only):** multilayer online BGS for freely moving cameras ([arXiv 1709.01140](https://arxiv.org/pdf/1709.01140)); deep motion segmentation for non-static cameras ([arXiv 2102.10929](https://arxiv.org/pdf/2102.10929)).
- **Appearance detector to replace MOG2 (separate area, but the real fix):** YOLOv11n ONNX INT8 ~13 FPS / 77 ms on CPU; YOLOv5n 1.12 ms, 2.6M params -- RT-DETR is GPU-tier and *slower* on CPU, so nano-YOLO via `onnxruntime` is the CPU pick. Appearance detection is inherently egomotion-robust (it finds *cars*, not *change*), but **still needs the geometry-freeze (invariants 1-6)** because zones/dwell/`stationary` remain PTZ-sensitive. ([Ultralytics RT-DETR vs YOLO11](https://docs.ultralytics.com/compare/rtdetr-vs-yolo11); [QuantizedYOLOv11 on Pi5](https://www.researchsquare.com/article/rs-8584571/v1)).

**Bottom line for this AREA:** the POC proved the wiring; it did not prove a single true arrival. The dominant near-term risk is not detection quality but **PTZ egomotion + the OSD clock manufacturing false arrivals and false departures through the exact `stationary`/`DEPARTING`/split-track transitions in the shipped state machine.** The fix is an edge-side STILL/MOVING freeze gate plus geometry calibration, and -- critically -- it needs **no visitd code change**; it is enforced entirely by what the edge is allowed to emit, plus one config bump to `split_track_seconds`.


**Open questions:**
- Does the V380 P2P protocol on TCP 8800/9800 carry any PTZ pose telemetry that could be decoded? Verified no ONVIF, but the app-native protocol was not reverse-engineered; if pose is recoverable it upgrades the visual gate to telemetry-driven per-pose homographies.
- Is the shop camera left at a fixed home framing, or does the operator/app run an auto-tour/cruise? The entire freeze-at-home design assumes a static home preset; an active tour would keep the camera perpetually off-home and must be disabled.
- What is the real arrival-zone geometry (lot mouth, apron, bay lines) in the home framing? No homography or polygon exists yet; the POC hard-codes current_zones=['front_lot'], so no accuracy claim is possible until calibration is drawn.
- Ground-truth labels: is there any logged set of true arrivals/dwell times to measure precision/recall against? Without it the 8->3 funnel cannot be validated and thresholds cannot be tuned.
- Does the split-pane V380 layout persist in the production capture, or will the real edge pull a single-pane RTSP/stream where the seam mask is unnecessary? Affects whether seam-masking is needed at all.


<a name="Anyka HsAK / V380 direct-stream unlock ("></a>

## Anyka HsAK / V380 direct-stream unlock -- stop screen-capturing the app

**Bottom line (for SHOPSIGN `192.168.0.155`, firmware `Hw_HsAKQQXG_WIFI_20230421`):** the camera's current probe state -- **only 8800/9800 open, 554/8899 closed** -- is *exactly* what a not-yet-unlocked V380 looks like, so a `ceshi.ini` RTSP attempt is genuinely worth one shot. But the same port signature is also what the *encrypted-P2P-only* family shows after a failed unlock. The firmware prefix `Hw_HsAK*` straddles both outcomes in the field reports (see the milkboy007 SUCCESS vs. arcane47/brahmtej2009 FAIL data points below), so treat the `ceshi.ini` attempt as **~50/50** and have the P2P-client fallback (`prsyahmi/v380`, MIT, LAN-direct, port 8800) ready -- that fallback *also* eliminates screen-capture and needs only the owner admin password + LAN.

---

### 1. The `ceshi.ini` SD-card unlock -- VERIFIED mechanics, UNVERIFIED for this exact firmware

**VERIFIED (multiple independent sources: SolveSoul gist, Thorpy repo, fipz/X, shantanugoel.com):**
- **Filename:** `ceshi.ini` at the **root** of a **FAT32** microSD card (not a subdirectory). An alternate filename seen in the wild is `push_custom_params.conf` -- same section/keys.
- **Section + keys:**
  ```ini
  [CONST_PARAM]
  rtsp = 1
  rtsp_enable = 1
  rtsp_ctrl = 1
  onvif = 1
  ```
  Some firmware honors `rtsp=1`, others only `rtsp_enable=1` -- include all four keys; they are harmless together. (`rtsp_ctrl` = stream control; `onvif` = ONVIF service.)
- **Power-cycle procedure:** insert card -> power on -> camera **announces "test mode" in Chinese** (TTS) -> **wait >=5 min** -> power off -> **remove card and DELETE `ceshi.ini`** -> power on normally. May require re-pairing in the V380 app.
- **Persistence:** the setting is written to the camera's config partition and **persists across reboots** once applied; the SD file is a one-time trigger and must be deleted (leaving it re-triggers test mode and can drop the cam off the network).
- **Brick/freeze risk (LIKELY, low but real):** bad/extra keys can freeze the camera mid-apply. Reported recovery: remove lines until it boots; worst case it stays in test mode until you re-flash/remove the card. No permanent brick reported for the RTSP keys specifically. **Do not add firmware-update keys -- RTSP/ONVIF keys only.**

**On `Hw_HsAKQQXG_WIFI_20230421` specifically -- UNVERIFIED, LIKELY 50/50:**
- `HsAK` = **Anyka HsAK SoC platform (AK3918-class)** -- VERIFIED: CVE-2025-25984's model `V380E6_C1` carries hardware id `Hw_HsAKPIQp_WF_XHR` and is documented as **Anyka AK3918EV300**. So the memory-note classification "HsAK generation, Anyka, NOT Xiongmai" is **correct**; community posts that call it "Xiongmai" are conflating vendors. (LIKELY: the encrypted 3-lens variants may genuinely mix Xiongmai app layers, which is where the confusion comes from.)
- **Field data points on the `Hw_HsAK*` family (gist comments, 2026):**
  - **milkboy007 (Apr 2026): SUCCESS** -- V380 BQ8 Dual Lens, firmware `Hw_HsAkQQVL_WF_QQ_20240412`, config `rtsp=1, rtsp_enable=1, rtsp_ctrl=1` -> standard RTSP worked. (Same `Hw_HsAk*` prefix as SHOPSIGN.)
  - **arcane47 (May 2026): FAIL** -- model LS-CS7-10X, ceshi.ini read + Chinese TTS but **no new ports**; only 8800/9800 active.
  - **brahmtej2009 (Jul 2026): FAIL + explained** -- newer 3-lens: "camera reads it, announces test mode, but **opens no new ports**"; media payload **AES-128-ECB encrypted**, key hidden behind a **Qihoo 360 Jiagu packer**; old keys give entropy 8.0 (wrong key).
- **Interpretation for SHOPSIGN:** the 2023 firmware date + PTZ single-view (not the newest 3-lens) + `Hw_HsAK*` prefix put it closer to the milkboy007 success class than the newest encrypted class -- but the "only 8800/9800 open" probe means it is currently in the un-unlocked state either way. **One attempt is the correct call.**

### 2. Resulting RTSP / ONVIF endpoints (if unlock succeeds) -- VERIFIED (third-party/integrator, NOT official Macrovideo docs)

- **RTSP port 554.** Paths (test both; main-stream convention varies by report):
  - `rtsp://<user>:<pass>@192.168.0.155:554/live/ch00_1` -- **HD / main** (most common convention)
  - `rtsp://<user>:<pass>@192.168.0.155:554/live/ch00_0` -- **SD / sub**
- **ONVIF port 8899** (V380 uses **8899**, not the usual 8000). ONVIF Device Manager / go2rtc ONVIF profile can then discover it; PTZ over ONVIF works on units that expose it (`Gowresh7/V380_Python` drives PTZ on 8899).
- **Auth:** VERIFIED-inconsistent -- many units accept the RTSP pull **without credentials on the LAN** even when a password is set (this is itself the security defect below); others require the app-set user/pass. Try no-auth first, then credentials.

### 3. The P2P stack on 8800/9800 + open-source LAN clients -- the screen-capture-killer fallback

**VERIFIED:** port **8800** = the V380 media/P2P port (TCP), **9800** = companion. On the LAN a client speaks the vendor P2P handshake and pulls **H.264** directly -- no cloud relay, no screen capture. Ranked by fit:

| Repo | What it does | License | Runtime | LAN-only? | Maintenance / caveats |
|---|---|---|---|---|---|
| **`prsyahmi/v380`**  recommended | Connects direct over LAN by IP/MAC/ID (default port **8800**), streams **raw H.264 to stdout** -> pipe to `ffmpeg`/`ffplay`/`gstreamer` or `rtsp-simple-server`. PTZ via keyboard. Has discovery. | **MIT** | **C/C++** (VS2015 or Linux `make`) | **Yes** -- owner admin pass + LAN only | ~56 commits, 123. Pin commit `89b15f7...` (the girishjoshi.io writeup builds this and relays via rtsp-simple-server/MediaMTX). |
| **`dunderhay/CCTV-v380-pro`** | Security research + Python PoCs: **broadcast discovery** of the cam on-LAN, and demonstrates **RTSP on 554 without creds** once reachable. | (no explicit license -- treat as read-only reference) | Python | Yes | Research repo; findcam.py is a clean discovery script to reuse. |
| **`PyanSofyan/V380Decoder`** | Decrypts the **encrypted** stream (reversed from the V380 Pro APK). Tested on device version 31, H.264. | check repo | Python | Yes | Use **only if** the stream turns out AES-encrypted (brahmtej2009 case). |
| **`Gowresh7/V380_Python`** | RTSP on 554 + **ONVIF PTZ on 8899** helper. | check repo | Python | Yes | Assumes RTSP already enabled. |

**Deepest owner-authorized path (rank LAST -- higher effort/risk):** `ricardojlrufino/anyka_v380ipcam_experiments` roots the **Anyka AK3918** on-device (telnet patch + custom rootfs) and can run a **custom on-camera RTSP server** -- the most powerful outcome, but it needs UART/telnet foothold and firmware surgery. Do this only if both ceshi.ini and the P2P client fail.

### 4. Security history / CVEs -- VERIFIED

- **CVE-2025-25984** -- hardcoded **root password `gzhongshi`** in read-only flash on `V380E6_C1` (`Hw_HsAKPIQp_WF_XHR`, Anyka AK3918EV300). **Physical/UART only, not remotely exploitable.** Vendor gave no meaningful fix; **Telnet cannot be disabled** by the owner.
- **Plaintext-credential relay flaw** -- user creds transmitted in cleartext to the vendor relay; anyone knowing a camera ID could intercept login+stream. Est. 4-7M devices exposed. **Operational takeaway: keep these cameras off the internet / on an isolated VLAN -- pull only on the LAN.** This VLAN isolation is *independently worth doing* regardless of which stream path wins.

---

### SHOPSIGN-first runbook (benign owner interop, one camera, in order)

> All benign: LAN discovery + owner-device config on a device you own. No credential theft, no access-control bypass, no firmware flashing in steps 1-4.

**Step 0 -- Snapshot current state (while the `ceshi.ini` card is NOT inserted; test mode drops the cam off-net, so any scan with the card in is invalid).**
```powershell
# Windows (shop laptop)
arp -a | Select-String "192.168.0.15"
Get-NetNeighbor -IPAddress 192.168.0.154,192.168.0.155
# Which local process/socket the V380 app holds to the cameras (P2P endpoints):
Get-NetTCPConnection | ? RemoteAddress -match '192\.168\.0\.15[45]' |
  Select LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess
Get-Process -Id (Get-NetTCPConnection -RemoteAddress 192.168.0.155).OwningProcess
```
```bash
# Linux/WSL equivalent
arp -n | grep 192.168.0.15
sudo ss -tanp | grep -E '192\.168\.0\.15[45]'
```

**Step 1 -- Confirm the port surface on both cams (expect 8800/9800 open, 554/8899 closed today).**
```powershell
foreach ($ip in '192.168.0.154','192.168.0.155'){ foreach ($p in 554,8800,8899,9800,80,8080){
  $r = Test-NetConnection $ip -Port $p -WarningAction SilentlyContinue
  "{0}:{1} = {2}" -f $ip,$p,$r.TcpTestSucceeded }}
```
```bash
nmap -Pn -p 554,8800,8899,9800,80,8080,443 192.168.0.154 192.168.0.155
```

**Step 2 -- Passive discovery probes (ONVIF WS-Discovery, mDNS, SSDP/UPnP) -- confirms whether anything is *already* exposed.**
```bash
# ONVIF WS-Discovery (multicast 239.255.255.250:3702)
python3 -c "from wsdiscovery.discovery import ThreadedWSDiscovery as W; d=W(); d.start(); print([s.getXAddrs() for s in d.searchServices()]); d.stop()"
# mDNS + SSDP
avahi-browse -art 2>/dev/null | grep -i -E 'onvif|rtsp|camera'
# (Windows) SSDP/UPnP:  Get-Service SSDPSRV ; and use a UPnP scanner
```
Expectation (LIKELY): **no ONVIF/WS-Discovery response** (matches the memory note -- "no ONVIF WS-Discovery").

**Step 3 -- The `ceshi.ini` attempt on SHOPSIGN ONLY (leave SHOPINSIDE untouched as the control).**
1. FAT32-format a microSD; write `ceshi.ini` at root with the 4 keys from 1.
2. Insert -> power on -> wait for Chinese "test mode" TTS -> **wait 5+ minutes**.
3. Power off -> **remove card, delete `ceshi.ini`** -> power on normally -> re-pair in V380 app if needed.
4. Re-run Step 1's port scan.

**Step 4 -- Verify the result with `ffprobe` (no screen capture).**
```bash
# If 554 opened:
ffprobe -rtsp_transport tcp "rtsp://192.168.0.155:554/live/ch00_1"          # try no-auth first
ffprobe -rtsp_transport tcp "rtsp://admin:<pass>@192.168.0.155:554/live/ch00_0"
```
- **Opened + playable H.264 -> BEST.** Relay via **MediaMTX/go2rtc** and feed the RTSP into the existing Frigate->`visitd` pipeline. This replaces the mss/gdigrab capture in `scratchpad\capture\lot_watch.py` with a clean RTSP source (boxes stop being noisy -- no split-pane/PTZ-timestamp motion).
- **Opened but stream encrypted (entropy high / won't decode) ->** try `PyanSofyan/V380Decoder`.
- **554 stays closed (arcane47 case) ->** go to Step 5.

**Step 5 -- P2P-client fallback (also kills screen capture; owner creds + LAN only).**
```bash
git clone https://github.com/prsyahmi/v380 && cd v380
git reset --hard 89b15f7d45085b136c8d4ac0304ce20cf7342ae4
make    # or VS2015 on Windows
./v380 -u admin -p <owner_pass> -id <ID-on-camera-label> -addr 192.168.0.155 \
  | ffmpeg -f h264 -i - -c copy -f rtsp rtsp://127.0.0.1:8554/shopsign
# MediaMTX/go2rtc listens on 8554 -> Frigate -> visitd
```

**Repo integration note:** the shipped `visitd` consumer already accepts Frigate-shaped events (`VisitTracker`/`parse_event`/`handle_event`+`tick`, per the live PoC). Whichever of Step 4/5 wins, the change is only the *source* (RTSP/H.264 instead of screen frames) -> `go2rtc`/`MediaMTX` -> Frigate `detect` -> the unchanged event bridge -> `visitd`. Surface the resulting stream/health in **both** `nickstire.org/admin` and statenour `/system/camera` (the task's dual-surface requirement).

**Do NOT:** flash firmware, solder UART, or use the `gzhongshi` root password on a live shop camera in steps 1-5 -- those are last-resort (3 deepest path) and out of scope for the benign runbook.



**Open questions:**
- Does Hw_HsAKQQXG_WIFI_20230421 specifically open port 554 after ceshi.ini, or is its media payload AES-128-ECB encrypted like the newest 3-lens units? Only the on-camera attempt (runbook Step 3-4) resolves this - field data for the Hw_HsAK* prefix is split (milkboy007 success vs arcane47/brahmtej2009 fail).
- If the stream comes back encrypted, does PyanSofyan/V380Decoder's key work on this 2023 firmware, or is the key behind the 360 Jiagu packer (unextractable statically)? Needs an entropy check on a captured payload.
- What exact admin username/password does the V380 desktop app use for these cameras (rdean22@gmail cloud login) - prsyahmi/v380 needs the device-level admin creds + the ID printed on the camera label, which must be read off the physical unit.
- Is SHOPSIGN reachable on 8800 directly from the shop laptop's LAN segment, or does the current network only route it via the vendor P2P cloud? Step 0's Get-NetTCPConnection on the V380 process answers whether a direct-LAN socket exists.


<a name="Zero-cost CPU/Arc-friendly vehicle + pla"></a>

## Answer first: the recommended stack

**Detector:** YOLOX-S ONNX (Apache-2.0, non-gated) for general vehicles, plus Intel Open Model Zoo `vehicle-detection-0200` (Apache-2.0) as a purpose-built vehicle detector. **Runtime:** the `openvino` 2026.3.x Python package running the model on the **Arc 140V iGPU (`"GPU"`) or NPU (`"NPU"`)** -- this is the real unlock and beats any CPU YOLO. **Tracker:** `roboflow/trackers` `ByteTrackTracker` (Apache-2.0) fed `supervision.Detections` (MIT). **Plates:** `fast-alpr` (MIT) = `open-image-models` YOLOv9-t plate detector + `fast-plate-ocr`, all ONNX on the same OpenVINO runtime. **Isolation:** a standalone **Python 3.12 venv** (NOT the machine's 3.14/cv2-5.0), because ONNX Runtime and supervision do not yet ship 3.14 wheels. Nothing here touches HuggingFace-gated auth.

### Final ranking (accuracy x speed x license x install-simplicity)

| Rank | Detector | License | Arc GPU/NPU via OpenVINO | Why |
|---|---|---|---|---|
| **1** | **YOLOX-S / -Tiny / -Nano ONNX** | **Apache-2.0** | Yes (ONNX->OpenVINO) | Best accuracy-per-license; COCO 80-class so car/truck/bus/moto for free; non-gated ONNX in opencv_zoo |
| **2** | **OMZ `vehicle-detection-0200`** (SSD/MobileNetV2) | **Apache-2.0** | Yes (native IR) | Purpose-built single "vehicle" class, tiny (256x256), ships as OpenVINO IR -- fastest on NPU |
| **3** | **OMZ `vehicle-license-plate-detection-barrier-0106`** | **Apache-2.0** | Yes (native IR) | One model detects vehicle AND plate box (barrier/lot use-case = your exact scene) |
| 4 | RTMDet-tiny / NanoDet-Plus ONNX | Apache-2.0 / Apache-2.0 | Yes | Good CPU fallbacks; NanoDet in opencv_zoo is non-gated |
| 5 | **Ultralytics YOLO11/v8** | **AGPL-3.0**  | Yes | Strongest models but AGPL taints a commercial deployment at Nick's Tire unless you buy an Ultralytics license -- **avoid for the shipped product** |
| -- | YOLO-NAS | Apache **weights non-commercial**  | Yes | Deci license restricts commercial use of pretrained weights -- skip |

---

## 1. Runtime foundation -- the Arc 140V unlock (VERIFIED)

- **`openvino` on PyPI is at 2026.3.1 (released 2026-08-26), Apache-2.0, with Windows x86-64 wheels for Python 3.10-3.13 (3.14 wheels LIKELY present but treat as unverified).** [pypi.org/project/openvino]. OpenVINO **2026.0** (released 2026-02-23) specifically improved **Intel Core Ultra NPU** handling with in-toolkit compiler integration (no OEM driver dependency), and Lunar Lake + Arc 140V (Xe2) is a first-class benchmarked target [Phoronix; docs.openvino.ai/2026].
- The Arc 140V iGPU appears to OpenVINO as device **`"GPU"`** and the Lunar Lake NPU as **`"NPU"`**. Verify on the machine with `python -c "import openvino as ov; print(ov.Core().available_devices)"` -- expect `['CPU','GPU','NPU']` (VERIFIED that these are the device strings; the actual enumeration on this box is UNVERIFIED until run).
- **ONNX Runtime path (alternative):** `onnxruntime-openvino` is at **1.24.1 (2026-02-26), MIT-licensed, Windows x86-64 wheels for Python 3.11/3.12/3.13** [pypi.org/project/onnxruntime-openvino]. On Windows it uses your separately-installed `openvino` package. This lets you keep an ORT `InferenceSession` API while dispatching to the Arc GPU/NPU.
- **DirectML EP** (`onnxruntime-directml`) also runs on the Arc iGPU with zero Intel-specific setup, but Microsoft has put DirectML into "sustained engineering" (feature work moved to WinML) [onnxruntime.ai/docs]. Use it only as a fallback if OpenVINO EP misbehaves; it will not reach the NPU.
- **cv2.dnn caveat:** `cv2.dnn.readNetFromONNX` works, but its OpenVINO backend (`DNN_BACKEND_INFERENCE_ENGINE`) requires OpenCV built WITH OpenVINO. The machine's stock `cv2` 5.0 wheel is CPU-only for DNN, so **do not route Arc inference through cv2.dnn** -- use the `openvino` package or ORT-OpenVINO EP. Keep `cv2` only for capture/letterbox/NMS/draw.

**Recommended isolation (execution-grade):**

PowerShell:
```powershell
py -3.12 -m venv C:\Users\nourd\camera-vision\.venv312
C:\Users\nourd\camera-vision\.venv312\Scripts\Activate.ps1
python -m pip install -U pip
pip install openvino==2026.3.1 onnxruntime-openvino==1.24.1 opencv-python-headless numpy supervision "trackers[all]" fast-alpr
```
Linux (edge box parity):
```bash
python3.12 -m venv ~/camera-vision/.venv312 && source ~/camera-vision/.venv312/bin/activate
pip install -U pip
pip install openvino==2026.3.1 onnxruntime-openvino==1.24.1 opencv-python-headless numpy supervision "trackers[all]" fast-alpr
```
(If a package lacks a 3.12 wheel on Windows, drop `onnxruntime-openvino` and use the pure `openvino` package -- it has no such constraint.)

---

## 2. Detector models -- exact NON-GATED download URLs + class ids

**COCO vehicle class ids (VERIFIED, standard 80-class):** `person=0, bicycle=1, car=2, motorcycle=3, bus=5, truck=7`. Vehicle filter = `{2,3,5,7}` (add `1` if you want bikes).

### YOLOX-S (Apache-2.0, opencv_zoo -- public, no HF auth)
- Input **640x640**, output raw `[1,8400,85]` (needs grid/stride decode + NMS; opencv_zoo `demo.py` ships the decode).
- GitHub (git-LFS): `https://github.com/opencv/opencv_zoo/raw/main/models/object_detection_yolox/object_detection_yolox_2022nov.onnx`
- **HF public mirror (most reliable, no auth):** `https://huggingface.co/opencv/opencv_zoo/resolve/main/models/object_detection_yolox/object_detection_yolox_2022nov.onnx`
- INT8 (CPU-fast): same path with `object_detection_yolox_2022nov_int8bq.onnx`
- License: "All files in this directory are licensed under Apache 2.0" (VERIFIED from README).

### NanoDet-Plus (Apache-2.0, opencv_zoo) -- lighter CPU fallback
- `https://huggingface.co/opencv/opencv_zoo/resolve/main/models/object_detection_nanodet/object_detection_nanodet_2022nov.onnx` (416x416, COCO).

### Intel OMZ vehicle models (Apache-2.0, native OpenVINO IR -- best on NPU)
These ship as `.xml`+`.bin` IR, so they skip ONNX conversion and run straight on GPU/NPU.
- **`vehicle-detection-0200`** -- SSD/MobileNetV2, input `1x3x256x256`, single class "vehicle", output `[1,1,N,7]` = `[image_id, label, conf, x_min, y_min, x_max, y_max]` (normalized).
- **`vehicle-license-plate-detection-barrier-0106`** -- input `1x3x300x300`, classes `{1:vehicle, 2:plate}`, same 7-tuple output -- one model for both boxes.
- Direct URL pattern (LIKELY; verify the version segment): `https://storage.openvinotoolkit.org/repositories/open_model_zoo/2023.0/models_bin/1/vehicle-detection-0200/FP16/vehicle-detection-0200.xml` (+ `.bin`).
- **Reliable retrieval (VERIFIED tool):** `pip install openvino-dev` then `omz_downloader --name vehicle-detection-0200 --precisions FP16`. FP16 is ideal for GPU/NPU; use FP16-INT8 variants for extra CPU speed where offered.

---

## 3. Inference snippets

**A. Direct OpenVINO on the Arc GPU or NPU (recommended -- reaches the NPU, lowest latency):**
```python
import openvino as ov, cv2, numpy as np
core = ov.Core()                      # print(core.available_devices) -> ['CPU','GPU','NPU']
model = core.read_model("vehicle-detection-0200.xml")   # or "object_detection_yolox_2022nov.onnx"
compiled = core.compile_model(model, "GPU")             # "GPU"=Arc140V, "NPU", "CPU", "AUTO:GPU,NPU,CPU"
out_port = compiled.output(0)

def infer(bgr, size=256):             # 256 for vehicle-0200, 640 for YOLOX
    blob = cv2.resize(bgr, (size, size))[:, :, ::-1]     # BGR->RGB
    blob = blob.transpose(2,0,1)[None].astype(np.float32) # NCHW
    return compiled({0: blob})[out_port]                 # vehicle-0200: [1,1,N,7]
```
For OMZ SSD output, keep rows where `conf > 0.5`; box = `row[3:7] * [W,H,W,H]`. For YOLOX, decode grids+strides then `cv2.dnn.NMSBoxes`.

**B. ONNX Runtime with OpenVINO EP (keep ORT API, dispatch to Arc):**
```python
import onnxruntime as ort, numpy as np
sess = ort.InferenceSession(
    "object_detection_yolox_2022nov.onnx",
    providers=["OpenVINOExecutionProvider"],
    provider_options=[{"device_type": "GPU"}],   # "NPU", "GPU.0", or "AUTO:GPU,CPU"
)
name = sess.get_inputs()[0].name
outs = sess.run(None, {name: input_nchw_f32})    # then decode + NMS
```
(NB: some OpenVINO EP provider-option keys were deprecated in ORT 1.23 -- on 1.24 use `device_type`, `precision`, `num_of_threads` [github.com/microsoft/onnxruntime]. )

---

## 4. Tracking -- license-clean, CPU-fine (VERIFIED)

- **Use `roboflow/trackers` (Apache-2.0, Python >=3.10):** implements **SORT, ByteTrack, OC-SORT, BoT-SORT, C-BIoU, McByte**, all detector-agnostic with one `update(detections, frame=None)` API [github.com/roboflow/trackers]. This is the cleanest license + broadest algorithm set.
- **`supervision` (MIT)** provides `sv.ByteTrack` and the `sv.Detections` container both libraries speak. ByteTrack/OC-SORT/BoT-SORT upstream are all MIT.
-  **Avoid `boxmot`** for the shipped product: `mikel-brostrom/boxmot` is **AGPL-3.0**, and its network-copyleft clause is a liability for a commercial camera service. `roboflow/trackers` covers the same algorithms under Apache-2.0.

```python
from trackers import ByteTrackTracker
import supervision as sv
tracker = ByteTrackTracker()
# per frame: build detections from your detector output
dets = sv.Detections(xyxy=boxes_xyxy, confidence=scores, class_id=class_ids)
tracked = tracker.update(dets)        # tracked.tracker_id is now populated
```
ByteTrack is the default recommendation (no appearance model = pure-CPU cheap, robust to the loose/noisy MOG2-style boxes you saw). Switch to OC-SORT if PTZ motion on SHOPSIGN causes ID switches; BoT-SORT (with camera-motion compensation) if PTZ panning is frequent.

---

## 5. License-plate stack (MIT, ONNX, non-gated) (VERIFIED)

`fast-alpr` (MIT) composes two ONNX pieces, both auto-downloaded from public GitHub releases / public HF (no auth token):
- Detector: `open-image-models` (MIT) `yolo-v9-t-384-license-plate-end2end` (end2end = NMS baked in; also 256/416/512/640 and yolo-v9-s-608).
- OCR: `fast-plate-ocr` `cct-xs-v2-global-model`.
```python
from fast_alpr import ALPR
alpr = ALPR(detector_model="yolo-v9-t-384-license-plate-end2end",
            ocr_model="cct-xs-v2-global-model")
for r in alpr.predict(frame):
    print(r.detection.bounding_box, r.ocr.text, r.ocr.confidence)
```
For the Arc unlock, run the same ONNX weights through the OpenVINO EP (device_type `GPU`/`NPU`) instead of the default CPU provider. Plates from the V380 lot/apron view will only be legible on the PTZ SHOPSIGN camera zoomed on the apron -- treat plate OCR as a best-effort enrichment, not a guaranteed field.

---

## 6. Wiring to the shipped `visitd` (Frigate-shaped events)

Your detector+tracker replaces the MOG2 POC as the event source; the contract to `visitd` is unchanged. Per track per frame emit `parse_event({...})` with `after.id = tracker_id`, `after.label` in `{car,truck,bus,motorcycle}`, `after.box`, `after.frame_time`, `after.current_zones`/`entered_zones` from your polygon test, and `after.stationary` from box-motion variance; then `tracker.tick(now)`. Map detector class ids -> COCO label strings before building the event so `CameraSpec.arrival_zones` logic fires exactly as in the 254-frame run.

---

## 7. Caveats / verification owed on the real machine

- **Python 3.14 wheels:** `openvino` PyPI classifiers LIKELY list cp314, but `onnxruntime`, `supervision`, and `trackers` almost certainly do not yet -- hence the **3.12 venv** recommendation. UNVERIFIED that a 3.14 all-in-one install succeeds; do not attempt it for the shipped path.
- **OMZ storage URL version segment** (`2023.0` vs `2022.3`) is LIKELY-correct but unverified; prefer `omz_downloader` which resolves the path for you.
- **NPU vs GPU choice:** the NPU excels at fixed-shape INT8/FP16 small models (vehicle-0200) at low power; the Arc GPU is faster for larger dynamic models (YOLOX-640). Use `"AUTO:GPU,NPU,CPU"` and benchmark both with `benchmark_app -m model.xml -d GPU` / `-d NPU` (ships with `openvino-dev`). Actual FPS on this box is UNVERIFIED until measured.
- All model sources above are Apache-2.0 or MIT and download without HuggingFace auth -- this is the clean, commercially-safe production path, unlike the earlier YOLO/Caffe attempt that 401/404'd on gated mirrors.

**Sources:** [pypi.org/project/openvino], [pypi.org/project/onnxruntime-openvino], [phoronix.com Intel-OpenVINO-2026.0-Released], [docs.openvino.ai/2026], [github.com/opencv/opencv_zoo], [github.com/roboflow/trackers], [supervision.roboflow.com/trackers], [github.com/ankandrew/fast-alpr], [github.com/ankandrew/open-image-models], [github.com/openvinotoolkit/open_model_zoo], [onnxruntime.ai/docs/execution-providers/OpenVINO-ExecutionProvider].


<a name="License-plate capture + OCR (zero-cost p"></a>

## License-Plate Capture + OCR -- honest design for the current cameras

### 0. What the repo already ships (verified, build on it -- do not reinvent)

Grounded by reading `main` at `C:\Users\nourd\NOURCITY`:

- **visitd already does whole-string temporal consensus.** `camera-bridge/visitd/state_machine.py::plate_summary()` groups `PlateRead(text, normalized, score, source, at, known_name)` by `normalize_plate` (uppercase, strip non-alphanumeric), picks the best group by `(max score, count)`, and assigns `CONFIRMED` when `score >= plate_single_read_confirm_score (0.95)` **or** (`score >= plate_confirm_score 0.9` **and** `agreeing >= 2`), `CANDIDATE` at `>= 0.7`, else `UNREADABLE`. Plate-first identity stitching + Levenshtein veto already exist (`_find_visit_by_plate`, `_plate_veto`, `levenshtein`). **VERIFIED.**
- **The plate contract is live and permissive.** `apps/statenour/lib/services/vehicle-event-contract.ts` `PlateSchema` = `{status, text, normalizedText, state, confidence, provider, reads, knownName}` + `.passthrough()`. Emitted by `camera-bridge/visitd/contract.py` (`PLATE_PROVIDER = "frigate_lpr"`). New optional fields need **no migration**. **VERIFIED.**
- **Normalization + confusable variants + masking exist twice.** `apps/nickstire/server/lib/plate.ts` (`normalizePlate`, `plateVariants` with `O/0 I/1 B/8 S/5 Z/2`, cap 12; `maskPlate`, `maskPhone`, `bookingLinkage`) and `visitd.normalize_plate`. Downstream `vehicle_lookup_by_plate` (`apps/nickstire/server/routes/nour-os-query.ts:449`) already matches on `plateVariants`. **VERIFIED.**
- **Enrichment + retention are done.** `vehicle-customer-link.ts` (`CONFIRMED_ARRIVAL` -> `vehicle_lookup_by_plate` -> `customerRef`, stale-read guard, empty-vs-error) and `plate-retention.ts` (30-day scrub unless `customerRef.status='matched'`). **VERIFIED.**
- **The master plan's committed direction is "ALPR from Frigate native LPR, no OCR in the bridge"** (plan E8/E12; `plate_reader.py` with EasyOCR/PlateRecognizer is slated for retirement, `mock` only under `--dry-run`). **VERIFIED.**

### 1. The honest constraint (this is the whole story)

The committed production path -- Frigate 0.17 native LPR (YOLOv9 detector + PaddleOCR OCR, local, CPU AVX2, 4 GB RAM) -- **requires an RTSP stream Frigate can read**. The current V380 units expose **only TCP 8800/9800 (V-Link P2P); 554/8899/80 are closed** (VERIFIED 2026-09-08). So today Frigate has no input and there is **no plate OCR anywhere in the live path** (the screen-capture POC ran MOG2 detection only).

Two facts bound what is achievable **before any purchase**:

1. **Plate pixel width governs OCR, not the model.** Reliable OCR needs the plate roughly **>= 100-150 px wide** with **character height >= ~16-20 px**; below **~60 px** any OCR is a coin toss (LIKELY -- standard ALPR guidance, consistent with Frigate LPR docs recommending the plate fill a good fraction of frame). A wide-angle lot camera with no shutter/rolling-shutter control smears plates at distance and at any motion. **No software fixes an under-resolved, motion-smeared plate.**
2. **The two realistic interim sources both under-serve LPR:** (a) the `ceshi.ini` unlock yields an **unauthenticated RTSP lot-overview** stream -- great for detection/visit tracking, plates mostly unreadable; (b) **SHOPSIGN is PTZ** and can zoom to the apron, which is the *only* current-hardware way to land a plate in the 100 px band -- but only one lane at a time and only while parked/slow.

**Therefore the ranked plan for THIS AREA:**

| Tier | Source | Expected plate read-rate | Honesty |
|---|---|---|---|
| Now, $0 | Screen-capture pane or unlocked-RTSP lot wide-angle | **<10%** of visits | plates for the record, not for reliable matching |
| Now, $0 | **SHOPSIGN PTZ zoomed to the apron** (best-frame during park) | **30-60%** | the real interim win -- see 5 |
| ~$70 | One PoE camera aimed as a chokepoint LPR at the entrance | 60-85% | fastest hardware ROI |
| Best | Dedicated PoE LPR cam (fixed iris, IR, 1/2000 shutter) | **85-95%** | the actual answer |

The software below is designed so **the same code serves all four tiers** and improves automatically as the camera improves -- the OCR engine emits `PlateRead` into the *existing* visitd consensus, so nothing downstream changes.

### 2. The OCR engine: fast-alpr (MIT, ONNX, CPU/OpenVINO, non-gated models)

This replaces the WIP `plate_reader.py` EasyOCR path (EasyOCR pulls PyTorch -- ~2 GB, slow on CPU, and torch lags Python 3.14) and the paid PlateRecognizer cloud path. **Go beyond generic Frigate/YOLO** by running a purpose-built plate detector+OCR that is CPU-real-time and whose weights are on GitHub (fixes the POC's HF 401/404).

- **`fast-alpr`** -- MIT. Bundles detector + OCR. Default detector `yolo-v9-t-384-license-plate-end2end` (from `open-image-models`, MIT); default OCR `cct-xs-v2-global-model` (from `fast-plate-ocr` **1.1.0, 2026-03-14, MIT**, Python 3.10-3.13). **VERIFIED.**
- **Model source is non-gated GitHub release assets**, no token: OCR from `https://github.com/ankandrew/cnn-ocr-lp/releases/download/arg-plates/cct_*_v2_global.onnx` (+ `_config.yaml`); detector from `open-image-models` releases. **VERIFIED** -- this is the exact fix for the POC's HF `401/404`.
- **CPU/OpenVINO extras:** `fast-alpr[onnx]` (CPU, cross-platform), `fast-alpr[onnx-openvino]` (Intel -- targets the shop laptop's **Arc 140V iGPU** and the planned N150 mini-PC iGPU), `fast-alpr[onnx-directml]` (Windows GPU). **VERIFIED.**
- **Model ladder** (swap by name, no code change): `cct-xs-v2-global-model` (default, fastest) -> `cct-s-v2-global-model` (more accurate); detector `yolo-v9-t-256/384/512/640` and `yolo-v9-s-608` -- pick larger input only when plates are small in-frame. **VERIFIED.**

**HARD Python gotcha (VERIFIED):** onnxruntime stable **cp314 wheels are not shipped** (nightly only as of Nov 2025). The shop laptop is **Python 3.14-only**. Do **not** install onnxruntime into system 3.14 -- it will fail or pull an unsupported nightly. Run the OCR sidecar in an **isolated Python 3.12/3.13** runtime via `uv` (already the machine's package tool). This is the "isolated-runtime" the task allows.

**Install (Windows, isolated 3.12):**
```powershell
# from camera-bridge\; uv is already installed on this machine
uv venv --python 3.12 .venv-ocr
.\.venv-ocr\Scripts\Activate.ps1
uv pip install "fast-alpr[onnx-openvino]==<pin-after-resolve>"   # freeze the resolved version
python -c "from fast_alpr import ALPR; a=ALPR(detector_model='yolo-v9-t-384-license-plate-end2end', ocr_model='cct-xs-v2-global-model'); print(a.predict('assets/test_image.png'))"
```
**Install (Linux edge box / Docker -- the production home):**
```bash
uv venv --python 3.12 /opt/visitd/.venv-ocr && . /opt/visitd/.venv-ocr/bin/activate
uv pip install "fast-alpr[onnx-openvino]"
```
Pre-bake the two ONNX files into the image (offline edge) rather than downloading at boot. License note: fast-alpr / fast-plate-ocr / open-image-models are **all MIT** -- clean for commercial use, no attribution burden beyond the license file.

**New adapter** `camera-bridge/bridge/plate_reader.py::FastAlprReaderAdapter` (drop-in for the existing factory `get_plate_reader`), returning the same dict shape the WIP adapters use (`{status,text,normalizedText,state,confidence,provider}`) with `provider="fast_alpr"`, plus `detConf`, `box`, `plateWidthPx`:
```python
class FastAlprReaderAdapter(PlateReaderAdapter):
    def __init__(self, cfg):
        from fast_alpr import ALPR
        self.alpr = ALPR(detector_model=cfg.get("detector","yolo-v9-t-384-license-plate-end2end"),
                         ocr_model=cfg.get("ocr","cct-xs-v2-global-model"))
    def read_plate(self, image_bytes: bytes) -> dict:
        import cv2, numpy as np
        img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        res = self.alpr.predict(img)              # detects then OCRs; full frame OK
        if not res: return _none("fast_alpr")
        r = max(res, key=lambda x: x.ocr.confidence)
        w = int(r.detection.bounding_box.x2 - r.detection.bounding_box.x1)
        return {"status":"CANDIDATE","text":r.ocr.text,"normalizedText":_norm(r.ocr.text),
                "state":"","confidence":float(r.ocr.confidence),"provider":"fast_alpr",
                "detConf":float(r.detection.confidence),"plateWidthPx":w}
```

**Where it runs -- and the one deliberate deviation from the plan.** The plan says "no OCR in the bridge" *because it assumes Frigate is the plate source*. When Frigate cannot reach the camera (today) -- or as a fallback for the wide-angle lane -- a **fast-alpr sidecar** is the only zero-hardware way to get any plate signal. It emits `PlateRead(source="fast_alpr")` into visitd exactly like Frigate's `frigate_event`/`frigate_lpr` reads, so `plate_summary`, stitching, the contract, retention and customer-link are **untouched**. Once a real RTSP LPR camera exists, set the OCR provider to `disabled` and let Frigate own it -- one config flip. Flag this deviation to the operator; it is additive and reversible.

### 3. Quality gating BEFORE OCR (skip the coin-toss frames)

Score each candidate crop and only OCR the ones that can succeed. Cheap, CPU-only, runs per detected plate box:

- **Plate-width gate:** `plateWidthPx >= MIN_PLATE_PX` (default **90**; lower to 70 for the PTZ apron lane, raise to 120 for the dedicated cam). Below the floor -> don't OCR, emit nothing (empty-vs-error: absence of a read, not `UNREADABLE`).
- **Blur gate:** variance of Laplacian on the grayscale crop `cv2.Laplacian(crop, CV_64F).var() >= BLUR_MIN` (default **120**; calibrate on the replay set). Rejects motion smear and defocus.
- **Contrast/exposure gate:** reject crops whose 5-95 percentile luma spread `< CONTRAST_MIN` (washed-out / blown highlights from headlights), and clamp with CLAHE before OCR.
- **Emit a `qualityGate` reason** (`ok | small | blurred | low_contrast`) on the read for the cockpit, so weak cameras are *explained*, not silent.

Rationale: OCR on a smeared 50 px plate doesn't just fail, it **fabricates** a plausible plate -> wrong `customerRef`. The gate trades recall for the precision the downstream match demands (7).

### 4. Multi-frame temporal consensus -- upgrade to per-character voting

The repo already votes per **whole normalized string**. Upgrade to **positional per-character voting across the visit**, which recovers plates no single frame reads cleanly (the task's explicit ask). Implement in `visitd.state_machine.plate_summary` (Python, where reads already aggregate per visit) so the emitted contract improves everywhere at once:

1. Keep only reads passing the quality gate whose `normalized` length equals the modal length (drop stray-length reads).
2. **Right-align** on the numeric block if lengths still differ (Ohio `ABC 1234` -> align the 4-digit run).
3. For each position, tally votes weighted by `read.confidence`, **merging confusable classes** using the repo's map (`O0, I1, B8, S5, Z2`): a vote for `0` also credits `O`, then pick the *raw* character with the higher summed weight.
4. Consensus confidence = mean of winning-position weights; **status** stays on the existing thresholds but now also promotes to `CONFIRMED` when **>=3 gated reads agree per-character** even if no single read hit 0.95.
5. Emit `perChar: [{char, conf, alts}]` and `votes: N` on the plate block (passthrough -- no migration).

This is deterministic (no LLM), matches the "vote per character, confusable map already in the repo" instruction, and measurably beats best-single-frame on noisy sources (the PTZ/lot tiers). Ship it behind `policy.plate_char_consensus` (default on) so replay can A/B it.

### 5. Best-frame selection + PTZ-zoom-to-plate (the interim win)

- **Best-frame:** within a visit, retain the top-K (K=5) crops ranked by `0.6*sharpness_norm + 0.4*plateWidthPx_norm`; OCR those, not every frame. Store `bestFrameRef` (snapshot path) on the plate block so the cockpit/admin can show the operator the actual pixels behind a match.
- **PTZ scheduling (SHOPSIGN):** the PTZ head is the single biggest current-hardware lever. State-driven: on `ENTERED_ZONE`/`ARRIVAL_CANDIDATE` in the apron zone, issue a preset-zoom to the apron; hold through `CONFIRMED_ARRIVAL` + a few seconds; then return to the wide "overview" preset so the lot isn't blind. Because the V380 app exposes no ONVIF/RTSP PTZ control yet, **this is gated on the `ceshi.ini` unlock** (which is documented to open 554/8899); until then PTZ is manual. **Sequence one camera at a time** -- the head can only serve one plate lane per movement, so prioritize the apron/chokepoint over the street. Mark this **UNVERIFIED** until the unlock is done on SHOPSIGN and ONVIF PTZ (or the V380 P2P PTZ API) is confirmed reachable.

### 6. Super-resolution -- OFF by default, earn it on replay

SR helps **only** the narrow band where a plate is *sharp but under-sampled* (~60-90 px, in-focus). On motion-smeared or defocused plates it **hallucinates** characters and *lowers* precision. Recommendation:
- Default **OFF**. If enabled, use **ESPCN x4** via `cv2.dnn_superres` (opencv-contrib, tiny, CPU-cheap) on best-frame crops in the 60-90 px band only, then re-OCR and keep the SR result **only if** its OCR confidence beats the raw crop.
- **Acceptance gate:** SR ships only if it raises read-rate on the replay set **without** dropping precision below the 7 floor. Never a blind pipeline stage.
(Real-ESRGAN x4 is stronger but ~10-50x the CPU cost -- not worth it on the edge box; skip unless a GPU lane exists.)

### 7. Contract, thresholds, and how it feeds `vehicle_lookup_by_plate`

Extend the existing `plate` block (all optional, passthrough -- **no migration**):
```jsonc
"plate": { "status":"CONFIRMED|CANDIDATE|UNREADABLE|NONE",
  "text":"ABC 1234", "normalizedText":"ABC1234", "state":"OH",
  "confidence":0.94, "reads":7, "provider":"fast_alpr|frigate_lpr",
  "engine":"cct-xs-v2-global-model",                 // NEW: which OCR
  "votes":5, "perChar":[{"char":"A","conf":0.99,"alts":["4"]}, ...],  // NEW
  "plateWidthPx":112, "blurVar":180, "qualityGate":"ok",  // NEW
  "bestFrameRef":"events/<sighting>/best.jpg" }      // NEW
```
Downstream is already correct and precision-first: `maybeLinkCustomer` fires only on `CONFIRMED_ARRIVAL` with `status  {NONE, UNREADABLE}` (`vehicle-detection.ts`), `lookupPlate` -> `vehicle_lookup_by_plate` matches `plateVariants` (exact + single confusable swap, cap 12), and `vehicle-customer-link.ts` guards against a since-corrected plate winning a stale write. **Keep the match set at single-confusable only** -- do not widen it; a wrong customer is worse than no customer.

### 8. Surface in nickstire.org/admin (not only statenour)

Reuse the existing poll pattern instead of a new write lane (respects PROTECTED-CORE / "no write lane" in the plan). `apps/nickstire/server/services/cameraProxy.ts` **already polls statenour `GET /api/devices`** for snapshot metadata (VERIFIED, plan row 51). Add:
1. statenour read endpoint `GET /api/camera/arrivals?since=` (x-sync-key, read-only) returning recent `DeviceEvent` arrival cards `{visitId, state, cameraName, plate{status,text,state,confidence,bestFrameRef,qualityGate}, customerRef{status,name,phoneMasked}, at}` -- plate text masked per the same 30-day retention rule already enforced by `plate-retention.ts`.
2. Extend `cameraProxy.ts` to fetch it; add a **"Live Arrivals"** panel to `/admin` showing the card + the `bestFrameRef` thumbnail + the matched member. Read-only, advisory (mirrors the statenour cockpit at `bdnick.info/system/camera`). No customer-facing action ever triggers from a plate (root AGENTS.md protected-ops).

### 9. Acceptance metrics + replay methodology

**Metrics (per camera tier, per daypart):**
- **Read rate (recall):** `CONFIRMED plate / CONFIRMED_ARRIVAL visits`. Targets: wide-angle lot **<10%**, PTZ apron **30-60%**, PoE chokepoint **60-85%**, dedicated LPR **85-95%**.
- **Plate precision:** among `CONFIRMED` plates, exact-string-correct fraction -- **floor >= 98%** (we accept low recall to protect the match). Report **CER** (character error rate) alongside.
- **Match precision:** correct-customer fraction among `customerRef.status='matched'` -- **target 100%** via the capped variant set.
- **Latency:** best-frame OCR < **150 ms** CPU (cct-xs) / < 60 ms OpenVINO-GPU.

**Replay (deterministic, CI-style -- reuse the existing harness):**
- `scripts/replay-fixture.ps1` already replays MP4/JSONL into visitd (visitd fixture tests exist: `tests/test_replay_fixtures.py`). Extend a `plate-replay` mode that runs `FastAlprReaderAdapter` over recorded frames and feeds visitd.
- Ground truth: hand-label `camera-bridge/tests/fixtures/plates/labels.csv` (`visitId, plate, state, daypart, weather, source`). Seed it now from the **screen-capture MJPEG** (the POC already captures the pane) so we get numbers before any hardware.
- Output a scorecard (read-rate / precision / CER per daypart) and **gate config changes**: any threshold/model/SR change that drops replay precision below **98%** fails, exactly like the existing visitd fixture tests. This is how 4 consensus, 6 SR, and model swaps are proven rather than asserted.

### 10. Sources
- fast-alpr (MIT, models + backends): https://github.com/ankandrew/fast-alpr - https://ankandrew.github.io/fast-alpr/latest/
- fast-plate-ocr 1.1.0 (MIT, Py 3.10-3.13, CCT v2): https://pypi.org/project/fast-plate-ocr/ - non-gated GitHub-release weights: https://github.com/ankandrew/cnn-ocr-lp/releases
- open-image-models (MIT, YOLOv9 plate detectors): https://github.com/ankandrew/open-image-models
- onnxruntime Python 3.14 = nightly only: https://github.com/microsoft/onnxruntime/issues/26473
- Frigate 0.17 LPR (YOLOv9 + PaddleOCR, CPU AVX2, 4 GB): https://docs.frigate.video/configuration/license_plate_recognition/
- Repo (VERIFIED): `camera-bridge/visitd/state_machine.py` (`plate_summary`), `apps/statenour/lib/services/{vehicle-event-contract,vehicle-customer-link,plate-retention}.ts`, `apps/nickstire/server/lib/plate.ts`, `apps/nickstire/server/routes/nour-os-query.ts`, `docs/research/2026-09-08-camera-vision-MASTER-PLAN.md`


**Open questions:**
- Does the SHOPSIGN V380 expose any PTZ control path once ceshi.ini opens 554/8899 (ONVIF PTZ profile), or only via the V-Link P2P app? PTZ zoom-to-plate scheduling (the biggest interim lever) is UNVERIFIED until this is tested on real hardware.
- Confirm the exact fast-alpr release version to pin -- fast-plate-ocr 1.1.0 is VERIFIED but fast-alpr's own current version/date was not nailed down; freeze whatever uv resolves and record it.
- onnxruntime stable cp314 (Python 3.14) wheels are not yet shipped (nightly only as of Nov 2025) -- re-check before assuming the edge box or laptop can run OCR on system 3.14; plan stays on an isolated 3.12/3.13 uv venv until then.
- What real plate-width distribution does the unlocked-RTSP lot stream and the PTZ apron actually produce? The <10% / 30-60% read-rate tiers are LIKELY estimates pending the replay scorecard on labeled shop footage.
- Ohio DPPA/ORC 4501.27 bars plate-to-registered-owner lookups; confirm the plate->customer match is only ever against plates customers themselves gave us (memberships.vehiclePlate), never an external registry -- the current code is compliant, keep it that way.


<a name="Shop-workflow vision intelligence: concr"></a>

## Shop-workflow intelligence -- concrete visitd events + statenour/nickstire data

**Grounding (VERIFIED against the repo at `1a77e8aaf`, branch `statenour/nextjs-critical-rce-advisory`):**
- Truth path is a **pure** per-visit state machine: `camera-bridge/visitd/state_machine.py` (`VisitTracker`, `Emission`) -> `contract.py:build_event` renders `Emission` to the wire payload. States/rank: `DETECTED 0 - ENTERED_ZONE 1 - ARRIVAL_CANDIDATE 2 - CONFIRMED_ARRIVAL 3 - IN_SERVICE 4`, plus `DEPARTING/LEFT/PASS_THROUGH` (`state_machine.py:19-30`). `bay_zones` and `IN_SERVICE` already exist (`_evaluate` line 746) but are unused -- `config.example.yaml` ships `bayZones: []`.
- Wire idempotency: `eventId = sha1(visitId|state|seq)` (`contract.py:17`). `seq` increments on every `_emit` (`state_machine.py:785`). Alert posture: `priority "high"` on `CONFIRMED_ARRIVAL`; cloud pages only on `ALERT_STATES = {CONFIRMED_ARRIVAL, ENTERED_ZONE}` (`vehicle-event-contract.ts:60`).
- Cloud ingest `POST /api/devices/:id/events` (`app/api/devices/[id]/events/route.ts`): `event === "vehicle_detected"` -> `handleVehicleEvent` (visit dedupe on `visitId` 12h / `trackId` 10min, eventId retry-dedupe 90d). **Every other `event` name -> generic `prisma.deviceEvent.createMany` with NO dedupe** (route lines 88-99). The zod `DataSchema` is `.passthrough()` (`vehicle-event-contract.ts:46`) so **any new `data.*` field is stored verbatim with no schema migration** -- this is the whole reason Phase 1-2 adds fields, not tables.
- Plate->customer is cloud-side and advisory: `vehicle-customer-link.ts` calls the nickstire bridge `vehicle_lookup_by_plate` (`apps/nickstire/server/routes/nour-os-query.ts:449`), writes `data.customerRef`. nickstire has real `bays` (`currentWorkOrderId, currentTechId, type, hasLift`) and `workOrders.assignedBay` (plan 2.1); `customer_vehicles` has **no** plate column yet (Phase 3).

**Design principle that beats a generic Frigate/YOLO box:** a generic system says *"car in zone front_lot, 82%"*. This design binds every detection to (a) a **deterministic, explainable evidence block**, (b) **business objects** (bayworkOrder, platememberbooking), and (c) **shop economics** (queue seconds, wait->bay, no-show). Nothing below uses an LLM in the truth path; every field is copied or computed from facts the state machine already holds (`frame_time`, zone intervals, boxes, reads).

---

### 0. Two transport lanes (architectural decision -- do this first)

Keep `vehicle_detected` for the **per-visit** lifecycle (one row per visit, updated in place). Route **facility-state** signals (bay occupancy, lot/queue snapshot, line crossings) through **new event names** so they hit the generic `createMany` lane -- one immutable row each, indexed by `(event, timestamp)` (Prisma `@@index([event, timestamp])`, `schema.prisma:1359`).

**Correctness prerequisite (VERIFIED gap):** the generic lane does **not** dedupe, but the edge outbox replays by `eventId` after a WAN outage (`config.example.yaml outboxMaxAttempts`). A replayed `bay_occupancy` would create a duplicate row. **Before shipping any new event type, lift the `eventId` retry-dedupe in `handleVehicleEvent` (route path 152-167) to cover all events** -- cheapest fix: in the route, before `createMany`, filter `otherEvents` against existing `data.eventId` in a 90d window (mirror `EVENT_ID_WINDOW_MS`). Acceptance: replay a captured `bay_occupancy` twice -> exactly one row.

---

### 1. Explainable evidence + confidence fusion (rides EVERY `vehicle_detected` emission)

The single highest-leverage differentiator. Add one block to `Emission` (`state_machine.py:190`), populate it in `_emit` (line 782) from facts already in scope, render it in `build_event` under `data.evidence` and `data.reasons`.

New `Emission` fields -> `data.evidence` and `data.reasons`:

```jsonc
"evidence": {
  "fusedConfidence": 0.91,          // deterministic weighted score, see formula
  "detectorScore": 0.86,            // = round(sighting.best_score,4) (already computed)
  "trackStability": 0.80,           // = 1 - split_joins_for_this_visit / max(1, sightings)
  "zoneDwellRatio": 1.05,           // = dwell / policy.confirm_seconds (>=1 means threshold met on dwell)
  "stationaryHeld": true,           // stationary path fired (state_machine _zone_facts)
  "plateScore": 0.94,               // = plate.confidence
  "stitchRule": "plate",            // "new"|"split"|"plate"|"topology"|"max_age_continuation"
  "sightings": 2,                   // len(visit.sightings)
  "cameras": ["sign"]               // distinct cameras this visit touched
},
"reasons": [
  "front_lot dwell 47.2s >= confirmSeconds 45.0",
  "stationary in front_lot for 22.0s",
  "plate CONFIRMED ABC1234 (0.94, 2 agreeing reads)"
]
```

**Fusion formula (available NOW, not the Phase-3 appearance model):** `fusedConfidence = 0.45*detectorScore + 0.30*plateComponent + 0.15*zoneDwellClamped + 0.10*trackStability`, where `plateComponent = plate.confidence` if a read exists else `0.5`, `zoneDwellClamped = min(1, dwell/confirm_seconds)`. Weights sum to 1; store the components so a later calibration set can re-fit (mirrors plan 6.5 `S` formula but with only fields we hold today).

**State-machine correctness:** `evidence`/`reasons` are *derived read-only projections* computed at emit time from the same `union_seconds`/`_zone_facts` the transition used -- they change no transition logic, so the deterministic table (`_evaluate`, lines 705-748) is untouched. `reasons` must be generated in the same `if` branch that emits, so the justification can never disagree with the transition.

**Drives:** alert priority (page only when `fusedConfidence >= 0.75`), and the Phase-3 confirm queue (0.45-0.75 band, plan 6.3 rule 4). **Acceptance:** on the 100-visit truth log (plan 11), `reasons[0]` names the correct firing condition >=99% of emissions (assert against the state each transition recorded); `fusedConfidence` AUC vs the truth-log arrival/ghost labels >= 0.85.

---

### 2. Bay occupancy + bay-entry/exit (SHOPINSIDE bays -- Phase 2)

Two outputs. **(a)** Keep the per-visit `IN_SERVICE` state, enrich it with which bay. **(b)** Emit a separate `bay_occupancy` event stream (generic lane) so occupancy is queryable independent of visit identity and reconcilable against nickstire `bays`.

**(a)** On the `vehicle_detected` emission, add:

```jsonc
"activeBay": "bay_2",               // the open bay-zone interval (null if none)
"bayEnteredAt": "2026-09-09T13:14:07.200Z",
"serviceDwellSeconds": 612.4,       // union_seconds over bay-zone intervals only
"bayHistory": ["bay_2"]             // ordered distinct bays this visit occupied
```

`serviceDwellSeconds` is `union_seconds([iv for iv in visit.intervals() if iv.zone in bay_zones], at)` -- the same primitive already used for arrival dwell (`_emit` line 804), just filtered to bay zones. `zoneDwell` (already emitted) carries per-bay seconds automatically once `bayZones` is configured, because `_emit` builds `zone_dwell` over **all** intervals (lines 799-803). So per-bay dwell needs zero new code beyond configuring `bayZones: [bay_1, bay_2]`.

**(b)** New event type, one row per transition:

```jsonc
{ "schemaVersion": 2, "event": "bay_occupancy", "eventId": "<sha1(bayId|transition|frameTime)>",
  "source": "frigate", "timestamp": "2026-09-09T13:14:07.200Z",
  "data": { "cameraId": "v380-shopinside", "bay": "bay_2", "bayName": "Bay 2",
            "transition": "occupied",           // "occupied" | "vacated"
            "visitId": "3af1...", "label": "car",
            "occupiedSeconds": 612.4,           // on "vacated" only
            "plate": { "status": "CONFIRMED", "text": "ABC1234", "normalizedText": "ABC1234" } } }
```

**State-machine correctness:** bay transitions must be emitted from the **same interval open/close** that `_apply_snapshot` already computes (lines 640-649) so occupancy can never disagree with `IN_SERVICE`/`zoneDwell`. Emit `occupied` when a bay `ZoneInterval` opens, `vacated` when it closes (including the `_force_end`/max-age paths, flagged `estimated:true`). `IN_SERVICE` stays rank-monotonic (`_RANK[IN_SERVICE]=4`), so a car that pulls out of a bay to DEPARTING and re-enters does **not** regress -- but `bay_occupancy` still records both transitions, which is exactly the finer signal the visit state can't carry.

**nickstire binding:** statenour maps `bay_occupancy` -> a read `GET /api/bays/live`; nickstire's `cameraProxy` (already polls statenour `GET /api/devices`, plan 2.1) reconciles it **advisory-only** against `bays.currentWorkOrderId`. Mismatch (camera says bay_2 occupied, `bays` says free, or vice-versa) -> a cockpit flag, never an auto-write (protected op: nickstire DB writes need operator approval). **Acceptance:** bay-occupancy precision/recall >=0.95 vs a one-shift manual bay log; `serviceDwellSeconds` MAE < 30s.

---

### 3. Service-lane funneling, queue length & wait-time (arrival -> first bay)

**Per-visit wait** -- when a visit first reaches `IN_SERVICE`, compute and carry:

```jsonc
"waitSeconds": 372.0,               // first bay-interval start  MINUS  visit.confirmed_at
"queuePositionAtArrival": 2         // # of other visits in CONFIRMED_ARRIVAL-and-not-yet-IN_SERVICE when this one confirmed
```

`confirmed_at` already exists on `Visit` (line 162); the bay start is the earliest bay `ZoneInterval.start`. Both are `frame_time` stamps -> deterministic, no wall clock. `queuePositionAtArrival` is a count over `self._visits` at confirm time (VisitTracker owns all open visits) -- a pure read.

**Lot/queue snapshot** -- emit a `lot_state` event on the housekeeping tick (`tickSeconds: 5`), throttled to change-or-every-60s:

```jsonc
{ "event": "lot_state", "eventId": "<sha1(lot|snapshot|bucketedFrameTime)>",
  "data": { "cameraId": "v380-shopinside",
            "vehiclesInArrival": 3, "confirmedWaiting": 2,
            "oldestWaitSeconds": 410.0, "baysOccupied": 1, "baysTotal": 2,
            "estWaitForNewArrivalSeconds": 300 } }   // rolling median of last 20 waitSeconds
```

`estWaitForNewArrivalSeconds` is the current-state answer to "if a car arrives now, how long till a bay?" -- the number a generic camera can't produce because it has no bay model and no visit economics. It is a rolling median maintained in the ledger, not an LLM guess.

**Correctness:** `lot_state` is a projection of `VisitTracker.open_visits()` at tick time; it introduces no transition and is idempotent per 60s bucket. **Acceptance:** `waitSeconds` MAE < 45s vs stopwatch on 20 visits; `estWaitForNewArrivalSeconds` within 3 min of realized wait on 80% of arrivals.

---

### 4. Dwell-time per visit (total, arrival, service -- already 90% shipped)

`dwellSeconds` (arrival-zone union) and `zoneDwell` (per-zone map) already ship on every emission. Add on `LEFT`/`PASS_THROUGH`:

```jsonc
"totalDwellSeconds": 934.7,         // visit.left_at - visit.created_at
"arrivalDwellSeconds": 47.2,        // = existing dwellSeconds (alias for clarity in analytics)
"serviceDwellSeconds": 612.4,       // 2 bay union
"idleSeconds": 275.1                // totalDwell - arrivalDwell - serviceDwell (lot-loiter after confirm, before/after bay)
```

`idleSeconds` surfaces the "confirmed but not being worked" gap -- the operational waste a shop wants and a generic counter never computes. **Acceptance:** `totalDwellSeconds` MAE < 20s (plan 11 target is <15s for arrival dwell; total is looser).

---

### 5. Repeat-visit detection (plate-normalized, or non-biometric signature)

Two keys, both non-biometric. Plate is authoritative when present; a **deterministic vehicle signature** covers plate-less/unreadable visits without any face/person biometric.

visitd carries the signature on every emission:

```jsonc
"vehicleSignature": {
  "key": "car|silver|mid",          // label | dominantColorBucket | sizeBucket
  "colorBucket": "silver",          // from Frigate custom color classification (plan 6.5 "C")
  "sizeBucket": "mid",              // coarse bucket of median box area / frame area: small|mid|large
  "bodyType": "car",               // Frigate label (car/truck/suv-via-classifier)
  "stable": true                    // >=3 sightings agreed on the bucket triple
}
```

statenour owns the **recall** (visitd has no history): a rolling `known_signature` read keyed by `normalizedPlate` first, else `vehicleSignature.key + coarse arrival hour`. On `CONFIRMED_ARRIVAL`, statenour annotates:

```jsonc
"repeatVisit": {
  "matchedBy": "plate",             // "plate" | "signature" | "none"
  "priorVisits": 4,
  "lastSeenDaysAgo": 12,
  "confidence": 0.9                 // 0.9 plate-exact, 0.6 signature, decays with bucket instability
}
```

**Correctness / honesty:** signature match is coarse (color+size+body) and will collide across identical common cars -- mark `matchedBy:"signature"` at `confidence 0.6` and **never** use it to suppress a page or drive a customer-facing action; it is a hint that upgrades to certainty only when a plate agrees. This is deliberately weaker than the Phase-3 512-d re-ID embedding (plan 6.5) and must not be conflated with it. **Acceptance:** plate-keyed repeat precision >=0.98; signature-keyed repeat precision >=0.70 on the truth log (report both -- base-rate rule).

---

### 6. Employee / known-shop-vehicle suppression (NON-biometric only)

Three non-biometric cues, combined; **no face recognition, ever** (plan 14, ORC). statenour holds an owner-labeled `known_vehicles` allowlist:

```jsonc
// statenour config/table (owner-editable in cockpit):
{ "plate": "STAFF01", "signatureKey": "truck|black|large",
  "role": "employee", "typicalArrivalWindowET": ["06:45","08:15"],
  "typicalParkZone": "staff_row", "typicalDwellHours": [6,11] }
```

On `CONFIRMED_ARRIVAL`, statenour sets `data.classification` and, when it resolves to staff, a suppression reason on the alert path (the mechanism already exists: `alertSuppressedReason`, `vehicle-detection.ts:287`):

```jsonc
"classification": {
  "kind": "staff",                  // "customer" | "staff" | "known_vendor" | "unknown"
  "matchedBy": ["plate"],           // any of: plate | signature | pattern
  "patternScore": 0.8,              // (in-window arrival) + (staff parking zone) + (all-day dwell) each 0/1, /3
  "suppressedPage": true
}
```

**Pattern cue (learned, non-biometric):** a vehicle whose last N confirmed arrivals were all 06:45-08:15 ET, parked in the staff zone, dwelled >6h -> `patternScore` high even with no plate. Suppress the page but **still store the visit** (ledger completeness) with `alertSuppressedReason:"known_vehicle"` so the cockpit shows the silence (empty-vs-error discipline). **Correctness:** suppression is a cloud alert-gating decision, not a state-machine change -- the visit still transitions normally. **Acceptance:** staff false-page rate < 5% of staff arrivals; **zero** customer visits mis-suppressed (a suppressed customer is a lost lead -- treat as P0; require plate OR signature+pattern agreement before suppressing).

---

### 7. Direction / speed / entry-line crossing

`metadata.direction` (entering/leaving) already ships. Add real motion, computed from `first_box`/`last_box`/interval boxes already stored (`Sighting`, lines 128-130):

```jsonc
"motion": {
  "speedPxPerSec": 34.0,            // centroid displacement / frame_time delta across the sighting
  "headingDeg": 118,                // atan2 of centroid delta
  "approaching": true,              // box area growing => moving toward camera/lot
  "peakSpeedPxPerSec": 51.2
}
```

**Entry-line crossing** -- a configured virtual segment on the lot camera; emit a `line_crossing` event (generic lane) when a tracked centroid crosses between consecutive frames:

```jsonc
{ "event": "line_crossing", "eventId": "<sha1(trackId|line|frameTime)>",
  "data": { "cameraId":"v380-shopinside","line":"street_entrance","direction":"in",
            "trackId":"1699","speedPxPerSec":34.0,"label":"car" } }
```

**Why it beats generic:** line crossings give a raw **traffic count** (cars passing / entering the apron) decoupled from *visits* (cars that stay) -- the numerator/denominator for "drive-by capture rate", a marketing-grade metric. Speed also disambiguates `PASS_THROUGH` (fast, no dwell) from a slow hunter looking for parking. **Correctness:** line crossing is per-*track* (raw), not per-visit -- deliberately, so it counts vehicles Frigate never promoted to a visit. **Acceptance:** crossing count within 5% of a manual count over one hour.

---

### 8. No-show / early / late vs booking (via the plate bridge)

Extend `vehicle_lookup_by_plate` (`nour-os-query.ts:449`) to return the booking **time** (today it returns `preferredDate` + status only). Then statenour computes, on the `customerRef` write:

```jsonc
"bookingMatch": {
  "status": "early",                // on_time | early | late | walk_in | no_booking
  "bookingId": "bk_123",
  "scheduledET": "2026-09-09T09:00",
  "arrivedET": "2026-09-09T08:52",
  "deltaMinutes": -8,               // negative = early
  "linkage": "phone+name"           // reuse existing bridge linkage guard (nour-os-query.ts:491)
}
```

**Reverse direction (no-show):** a statenour cron reads nickstire bookings with `preferredDate=today, status in (new,confirmed), scheduledTime < now-15min` and **no** matched arrival visit -> emits an internal `no_show_candidate` (advisory; feeds the existing opportunity/win-back lane, never an auto-text). **Correctness:** booking match rides `customerRef` and is subject to the same stale-plate guard (`vehicle-customer-link.ts:99-106`) -- an obsolete lookup for a since-corrected plate must not win. **Acceptance:** >=80% of plate-read visits with a customer-provided plate match the right booking (plan G5); no-show candidate precision >=0.85 (a car that arrived but parked out of frame is the main false-positive -- bound it with the line-crossing count).

---

### 9. Plate-capture scheduling (best angle / best frame)

visitd already keeps the best read by score (`plate_summary`, `contract.py`... `state_machine.py:277`). Add the **provenance of the best frame** so the cloud can pull the exact snapshot for staff confirmation:

```jsonc
"plate": {
  "status": "CANDIDATE", "text": "ABC1234", "normalizedText": "ABC1234",
  "confidence": 0.74, "reads": 3, "provider": "frigate_lpr",
  "bestFrameTime": 1757423647.2,    // frame_time of the highest-score read
  "bestBox": [412,300,548,360],     // box at that frame, for a targeted crop
  "captureAdvice": "await_closer"   // "ok" | "await_closer" | "unreadable_angle"
}
```

`captureAdvice = "await_closer"` when the vehicle is `approaching` (7) and box area is still growing and plate is not yet CONFIRMED -- i.e. *don't* burn the confirm on a far frame; the best plate frame is imminent. **PTZ auto-zoom is UNVERIFIED and likely blocked:** the V380 exposes only P2P (TCP 8800/9800 open, 554/ONVIF closed per the 2026-09-08 probe); active PTZ steering needs the RTSP/ONVIF unlock (plan 3.3 `ceshi.ini`) which is unproven. So scope this to **best-frame selection** (deterministic, works today off screen-capture/Frigate) and mark PTZ-driven capture as blocked-on-unlock. **Acceptance:** plate read-rate on confirmed visits >= the plan G target once a real stream exists; measure share of CONFIRMED plates whose `bestFrameTime` is within the last 30% of the arrival interval (proves the "wait for the close frame" logic helps).

---

### 10. Day / night parameter profiles

`VisitPolicy` is a frozen dataclass consumed by `VisitTracker` (`state_machine.py:55`). Add two profiles in config and a selector:

```yaml
visit:
  dayProfile:   { confirmSeconds: 45, candidateSeconds: 10, minBoxAreaFrac: 0.010 }
  nightProfile: { confirmSeconds: 60, candidateSeconds: 15, minBoxAreaFrac: 0.020, plateCandidateScore: 0.75 }
  profileSwitch: { mode: "fixedET", dayStartHour: 7, nightStartHour: 20 }   # or "sunrise" later
```

Night raises dwell thresholds and min box size (headlight glare and IR noise inflate false detections) and the plate candidate floor.

**State-machine correctness (the trap):** the machine takes `policy` as a constructor arg and reads it throughout a visit's life. **Pin the profile at visit creation** (`_stitch`, line 522) and keep using it for that visit even if the clock crosses the day/night boundary mid-visit -- otherwise a car that arrives at 19:58 and confirms at 20:01 would have its threshold change under it, producing a non-deterministic promotion. Carry `data.profile: "day"|"night"` on the emission so analytics can segment. **Acceptance:** night ghost-rate <= day ghost-rate + 2pp; no visit shows a threshold flip in its emission history (assert `profile` constant across a visit's emissions).

---

### 11. Canonical enriched `vehicle_detected` payload (CONFIRMED_ARRIVAL)

Every field below is either shipped today or added per 1-10; all live on `data.*` (passthrough -- no migration):

```jsonc
{
  "schemaVersion": 2, "event": "vehicle_detected",
  "eventId": "b3c9...",                 // sha1(visitId|state|seq) -- unchanged
  "source": "frigate", "timestamp": "2026-09-09T13:07:27.200Z",
  "data": {
    "cameraId": "v380-shopinside", "cameraName": "Front Lot",
    "visitId": "3af1c2e0-...", "sightingId": "1699", "trackId": "1699",
    "zone": "front_lot", "zoneName": "Front Lot",
    "state": "CONFIRMED_ARRIVAL", "priority": "high",
    "label": "car", "confidence": 0.86,
    "dwellSeconds": 47.2, "zoneDwell": { "front_lot": 47.2, "bay_entrance": 0 },
    "stationary": true, "estimated": false,
    "plate": { "status": "CONFIRMED", "text": "ABC1234", "normalizedText": "ABC1234",
               "confidence": 0.94, "reads": 3, "provider": "frigate_lpr",
               "bestFrameTime": 1757423240.1, "bestBox": [412,300,548,360], "captureAdvice": "ok" },
    "evidence": { "fusedConfidence": 0.91, "detectorScore": 0.86, "trackStability": 0.80,
                  "zoneDwellRatio": 1.05, "stationaryHeld": true, "plateScore": 0.94,
                  "stitchRule": "plate", "sightings": 2, "cameras": ["lot"] },
    "reasons": ["front_lot dwell 47.2s >= confirmSeconds 45.0",
                "stationary in front_lot for 22.0s",
                "plate CONFIRMED ABC1234 (0.94, 2 agreeing reads)"],
    "vehicleSignature": { "key": "car|silver|mid", "colorBucket": "silver",
                          "sizeBucket": "mid", "bodyType": "car", "stable": true },
    "motion": { "speedPxPerSec": 6.0, "headingDeg": 100, "approaching": false },
    "queuePositionAtArrival": 1, "profile": "day",
    "metadata": { "direction": "entering", "frigateStartTime": 1757423190.0,
                  "frigateEndTime": null, "snapshotRef": "events/1699/snapshot.jpg",
                  "bridgeVersion": "2.1.2", "frigateVersion": "0.17.2" },
    // ---- added cloud-side (statenour), advisory ----
    "customerRef": { "checkedAt": "2026-09-09T13:07:28Z", "plate": "ABC1234",
                     "status": "matched", "normalized": "ABC1234",
                     "matches": [{ "source":"memberships","name":"Jane D.","phoneMasked":"***-4021",
                                   "plate":"ABC1234","exact":true,"membershipStatus":"active",
                                   "bookingsToday":[{ "id":"bk_123","status":"confirmed",
                                                      "linkage":"phone+name","service":"4 tire install" }] }] },
    "repeatVisit": { "matchedBy": "plate", "priorVisits": 4, "lastSeenDaysAgo": 12, "confidence": 0.9 },
    "bookingMatch": { "status": "early", "bookingId": "bk_123", "scheduledET": "2026-09-09T09:00",
                      "arrivedET": "2026-09-09T08:52", "deltaMinutes": -8, "linkage": "phone+name" },
    "classification": { "kind": "customer", "matchedBy": ["plate"], "patternScore": 0.0, "suppressedPage": false }
  }
}
```

The Telegram alert this produces: *"Jane D. (***-4021), member, booked 9:00 -- arrived 8:52 early, 4-tire install. 4th visit. Bay 2 free. [Open Camera]"* -- versus a generic *"car detected 86%"*.

---

### 12. Surfacing in nickstire.org/admin (required)

No statenour->nickstire **write** lane exists and none is created (UPSTREAMS rows 87/88; plan 5). Pattern: statenour exposes reads; nickstire's existing `server/services/cameraProxy.ts` (already polls statenour `GET /api/devices`) polls them and renders through the admin **registry** (`client/src/pages/admin/registry.tsx` -- the single source of truth; edit the registry, not four files).

- statenour `GET /api/visits/today` (visits + states + dwell + customerRef + bookingMatch) and `GET /api/bays/live` (from 2 `bay_occupancy`), both `auth:"sync"`.
- nickstire adds one admin section "Live Lot" via `registry.tsx` + a `cameraProxy` poll (mirrors the planned arrival tile, plan 8.4). Bay reconciliation is **advisory** -- it flags `bays.currentWorkOrderId` vs camera occupancy mismatches; it never writes (protected op).
- **Honesty gate:** a failed poll must render "camera feed unreachable", never an empty/green "0 cars" (empty-vs-error skill). Carry the statenour `dataAsOf`/staleness like the bridge's `getMirrorFreshness` already does (`nour-os-query.ts:51`).

---

### 13. Acceptance metrics roll-up (extends plan 11-12 gates)

| Feature | Metric | Target |
|---|---|---|
| Evidence/fusion | `reasons[0]` matches firing condition | >=99% |
| Fusion score | AUC vs truth-log arrival/ghost | >=0.85 |
| Bay occupancy | precision/recall vs manual bay log | >=0.95 |
| Service dwell | MAE | <30s |
| Wait (arrival->bay) | MAE | <45s |
| Repeat (plate) | precision | >=0.98 |
| Repeat (signature) | precision (reported beside plate) | >=0.70 |
| Staff suppression | staff false-page rate / customer mis-suppress | <5% / **0** |
| Line crossing | count error over 1h | 5% |
| Booking match | correct booking on plate-read visits | >=80% (plan G5) |
| No-show candidate | precision | >=0.85 |
| Facility events idempotency | duplicate rows on outbox replay | **0** |

Every metric is computed on the edge against the field truth log (plan 11) and reported to the cockpit; none require an LLM, and each new field is a deterministic projection of facts the shipped state machine already holds.

**Files this design touches (for the implementing session):** `camera-bridge/visitd/state_machine.py` (Emission fields + `_emit` derivations + per-bay/motion/signature computation + policy pinning), `camera-bridge/visitd/contract.py` (`build_event` new `data.*` + new event builders for `bay_occupancy`/`lot_state`/`line_crossing`), `camera-bridge/config.example.yaml` (bayZones, day/night profiles, line config), `apps/statenour/lib/services/vehicle-detection.ts` (classification/repeat/bookingMatch enrichment + suppression), `apps/statenour/app/api/devices/[id]/events/route.ts` (extend eventId dedupe to all event types), `apps/statenour/lib/services/vehicle-customer-link.ts` (bookingMatch), new statenour `GET /api/visits/today` + `/api/bays/live`, `apps/nickstire/server/routes/nour-os-query.ts` (`vehicle_lookup_by_plate` add scheduled time), `apps/nickstire/client/src/pages/admin/registry.tsx` (Live Lot section). Phase-3 typed ledger (plan 7.2) absorbs these fields as typed columns later; today they ride `DeviceEvent.data` JSON.


<a name="Camera/arrival intelligence in nickstire"></a>

## Camera arrivals in nickstire /admin -- leastcoupling data path

**Answer first:** nickstire /admin should **pull the arrival snapshot from statenour over a new readonly, synckey HTTP endpoint**, surfaced to the browser through an `adminProcedure` tRPC router. Do **not** dualingest camera events into nickstire, and do **not** iframeembed the statenour cockpit. This is the mirror image of the bridge that already exists, reuses a direction and a shared secret that are already wired, and creates **no** statenour->nickstire write lane (the thing ADR0017 / UPSTREAMS rows 8788 forbid).

### What the repo actually shows (VERIFIED, with evidence)

- **Canonical arrival ledger lives only in statenour/Neon.** `DeviceEvent` rows (`event:"vehicle_detected"`, state machine in `data`) are served by `cameraArrivals` at `apps/statenour/lib/trpc/routers/system/devices.ts:201`; ingest is `POST /api/devices/[id]/events` (`auth:"sync"`). The cockpit page is `apps/statenour/app/(mastery)/system/camera/page.tsx` (operatorgated, polls 5 s). VERIFIED.
- **A statenour->nickstire READ bridge already exists** (statenour is the client): `queryNick()` in `apps/statenour/lib/nickstire/query.ts` POSTs `nickstire.org/api/nour-os/query` with header `x-sync-key`. nickstire hosts 40 `QUERY_HANDLERS` in `apps/nickstire/server/routes/nour-os-query.ts`; `vehicle_lookup_by_plate` (line 449) is the one the arrival pipeline uses (`apps/statenour/lib/services/vehicle-customer-link.ts`) to resolve plate->customer. Auth check at line 1716 uses `STATENOUR_SYNC_KEY`. VERIFIED.
- **The REVERSE direction (nickstire->statenour) is also already wired, with the same key.** `apps/nickstire/server/cron/jobs/statenourSync.ts` POSTs to `${STATENOUR_SYNC_URL}/api/sync/business` with `STATENOUR_SYNC_KEY`. And statenour already exposes **synckeyauthed GET reads for dashboard display**: `GET /api/sync/vision` (`apps/statenour/app/api/sync/vision/route.ts`, `auth:"sync"`). So the exact pattern I recommend is already blessed inrepo. VERIFIED.
- **There is precedent for moving an operatorintelligence surface INTO nickstire /admin.** `apps/nickstire/server/routers/admin/market.ts` (registered `market: marketAdminRouter` in `apps/nickstire/server/routers.ts:133`) reads the bridge's `master_report` handler via `adminProcedure` so "StateNour's Nick and this page read ONE report." Same move, one hop further (arrivals data is across the wire, not inprocess). VERIFIED.
- **`/api/sync/vision` is the LEGACY lane and must NOT back the new page.** It writes a separate `visionEvent` table fed by the old PowerShell `v380_agent.py` watcher that ADR0017 schedules for deletion. The canonical ledger is `DeviceEvent`. Hang the new page off `DeviceEvent`, not `visionEvent`. VERIFIED.

### Why Option A (nickstire pulls from statenour) beats the alternatives

| Option | Verdict | Reason |
|---|---|---|
| **A. nickstire reads statenour** (new synckey GET + `queryStatenour` client + `adminProcedure` router) | **RECOMMENDED** | Reuses existing nickstire->statenour direction + shared key + the `/api/sync/vision` GET pattern. No write into nickstire, no statenour->nickstire write -- rows 87/88 untouched. Plate->customer join stays on the statenour side where it already happens. |
| B. Camera events ALSO land in nickstire (dual ingest) | **REJECT** | ADR0017: "nickstire has no inbound device ingest... would require a write lane the register rejects." Forks the truth ledger, puts a devicekey ingest on a business DB, duplicates visitd's dedupe/outbox. |
| C. Admin page iframeembeds statenour cockpit | **REJECT as primary** (OK only as a 1day stopgap) | Separate auth origin (statenour operator gate vs nickstire admin RBAC/MFA), crossorigin cookie + CSP friction, no nickstire role gate, breaks the unified admin shell, and iframes misbehave in the iOS standalone PWA. |

### Exact contract for the new statenour read endpoint

Refactor the body of `cameraArrivals` (`devices.ts:201`) into a shared `getArrivalsSnapshot()` and expose it from **both** the existing operator tRPC (unchanged cockpit) **and** a new synckey HTTP route, so the two surfaces can never disagree:

```
GET https://statenour-web-production.up.railway.app/api/sync/arrivals
Header: x-sync-key: <STATENOUR_SYNC_KEY>          // { auth: "sync" }, same as /api/sync/vision
200 -> {
  events: Array<{ id, deviceId, cameraName, timestamp, createdAt, data }>,  // data = visit state machine payload
  todayCount: number,                              // ET-day, via startOfDayET()
  cameras: Array<{ id, name, platform, status, lastSeenAt }>,  // status  ONLINE|OFFLINE|ERROR|UNKNOWN
  match?: { masked customer/booking already resolved by vehicle-customer-link.ts },
  dataAsOf: string                                 // for a FreshnessChip + empty-vs-error
}
```

- **Auth:** `{ auth: "sync" }` on the statenour route (mirror `/api/sync/vision`). The `STATENOUR_SYNC_KEY` **never reaches the browser** -- it lives only in the nickstire server calling out.
- **Plate->customer match** is resolved **on the statenour side** (statenour already calls `vehicle_lookup_by_plate` back into nickstire) and returned **premasked**, so the nickstire page never reimplements the join or unmasks PII. Keeps the existing `maskPlate`/`maskPhone` redaction authoritative.
- **Readonly:** operator actions that MUTATE (acknowledge, falsepositive, plate correction -- today `updateArrivalStatus`/`testVehicleAlert`, both `operatorProcedure`) stay in the statenour cockpit for now. If nickstire /admin must acknowledge, add a **narrow POST action on the SAME bridge** (`POST /api/sync/arrivals/ack {eventId,state}`) -- that is nickstire->statenour, still not a forbidden statenour->nickstire write.

### Exact nickstire files to add / change

1. **`apps/nickstire/server/lib/statenourQuery.ts`** (NEW) -- mirror of `apps/statenour/lib/nickstire/query.ts`: `queryStatenour(path, {timeoutMs})` with `STATENOUR_SYNC_URL` + `STATENOUR_SYNC_KEY`, 3x exponential backoff, and an emptyvserror return (`{error}` never coerced to an empty snapshot -- see the repo's `empty-vs-error` skill).
2. **`apps/nickstire/server/routers/admin/camera.ts`** (NEW) -- `adminProcedure` router: `snapshot: adminProcedure.query(() => queryStatenour("/api/sync/arrivals"))`. `adminProcedure` (`apps/nickstire/server/_core/trpc.ts:267`) already enforces admin identity + fresh MFA + perpath permission, so the page inherits the nickstire admin gate for free.
3. **`apps/nickstire/server/routers.ts`** -- register `camera: cameraAdminRouter` alongside `market:` (line 133).
4. **`apps/nickstire/client/src/pages/admin/shared/types.ts`** -- add `| "camera"` to the `AdminSection` union.
5. **`apps/nickstire/client/src/pages/admin/CameraSection.tsx`** (NEW) -- `trpc.camera.snapshot.useQuery(undefined,{refetchInterval:5000})`; render the tiles/feed below. Reuse the cockpit's emptyvserror handling (`isError` -> headline `--` + banner, never "0 arrivals").
6. **`apps/nickstire/client/src/pages/admin/registry.tsx`** -- one `ADMIN_REGISTRY` entry: `{ id:"camera", label:"Cameras", icon:<Camera/>, component:CameraSection, group:"Truth", priority:<n>, showInSidebar:true, allowedRoles:FULL_ACCESS, keywords:["arrivals","lot","plate","vehicle","alpr"] }`. (`adminRegistryTruth.test.ts` will force the union + registry to stay in sync.)
7. **Env:** set `STATENOUR_SYNC_URL` + `STATENOUR_SYNC_KEY` on the nickstire Railway service (the sync key already exists; `statenourSync` uses it).

### Wireframe (CameraSection)

- **Top tile row (KPIs), each with a `FreshnessChip` off `dataAsOf`:**
  - **Today's arrivals** -- `todayCount`. **VERIFIED backed** (real read today).
  - **Cars in lot now** -- count of open visits (`state  CONFIRMED_ARRIVAL/IN_SERVICE`, not yet `LEFT/PASS_THROUGH`). **LIKELY** derivable from `data.state` on recent events; expose it explicitly from `getArrivalsSnapshot()` rather than deriving in the browser.
  - **Avg wait / dwell** -- from visitd zone intervals. **UNVERIFIED today** -- visitd emits dwell but the typed `visit_zone_intervals` table is Phase3 (ADR0017 4). Render "--" + "pending visitd Phase 3", never a fabricated number.
  - **Bay occupancy** -- **UNVERIFIED / not yet sensed.** No bay camera exists yet (the PoE bay/overview cameras are the ranked purchase). Show a disabled tile labeled "needs bay camera," not a zero.
- **Camera health strip:** one chip per `cameras[]` -- name, `status` (ONLINE/OFFLINE/ERROR/UNKNOWN), `lastSeenAt` relative time. Drives operator trust; ties to the `device-heartbeat-sentinel` cron.
- **Live event feed:** reversechron `events[]` -- camera, state badge (DETECTED->...->LEFT), dwell, plate (masked), confidence. Filters: camera, state, plate search (same controls as the cockpit).
- **Plate->customer match card** (when `match` present): masked name/phone, membership status, **today's booking** (from `vehicle_lookup_by_plate`), with an "advisory -- staff confirm" label (ADR0017 5: matching never automessages a customer).
- **iOSPWA constraint:** the operator runs both apps as standalone PWAs where `window.confirm/alert/prompt` are **silently suppressed**. Any acknowledge / falsepositive / platecorrect control must use an **inDOM twotap confirm**, not a native dialog (repo skill `nickstire-ios-pwa-primitives`). Readonly tiles/feed have no such control and are safe.

### Guardrails to honor while building (repo skills)
- `empty-vs-error`: a failed crosswire read must render as an error state, never a confident 0. The bridge helper returns `{error}`; the section shows a banner.
- `assert-the-consumer` / `prior-art-grep`: the new `/api/sync/arrivals` writer needs a proven reader (the tRPC router) before "done"; grep first so this isn't a second arrivals surface diverging from the cockpit -- hence the shared `getArrivalsSnapshot()`.
- `nickstire-tidb-ddl`: **not triggered** -- this design adds **no** nickstire table (arrivals stay in Neon). That is the point.


<a name="Repo audit: shipped camera-vision system"></a>

## Repo audit -- camera vision (VERIFIED against `C:\Users\nourd\NOURCITY`, 2026-09-09)

### 1. Git state
- **Local checkout HEAD:** `1a77e8aafb208f2b615dec7b491588efc5249dac` -- `fix - camera-bridge - Frigate required_zones per camera (validator receipt) + Docker lab smoke + runbook rows (#2229)`, on branch **`statenour/nextjs-critical-rce-advisory`** (a working branch, NOT main).
- **`origin/main` HEAD:** `823fb3434` -- `fix - nickstire - a reel parked on paid repair no longer darks the channel (#2231)`. The local checkout is ~2 commits behind main; both branches carry identical camera-bridge (last camera PR to land is #2229; #2231 is a nickstire reel fix). VERIFIED.
- Working tree has unrelated modifications (`proc-census.json`, `next-env.d.ts`, `graphify-out/...`) and many untracked `.agents/skills/` dirs -- none touch `camera-bridge/` or camera code.

### 2. visitd presence & version -- VERIFIED
- `camera-bridge/visitd/` **present on both working tree and `origin/main`**. `camera-bridge/visitd/__init__.py` -> `__version__ = "2.1.2"` on both (`git show origin/main:.../__init__.py` confirms 2.1.2).
- **All 2.1.x fixes are committed on `origin/main`** (not just working tree):
  - `_apply_snapshot` re-resolution -> `state_machine.py:394,628` + README row 1 + `test_stitching.py`.
  - `max_age_fired` (fires once per track, persisted) -> `state_machine.py:126,478`, `ledger.py:248`, `test_state_machine.py:290`.
  - `dead_letter` table (poison payload after `outboxMaxAttempts`) -> `cloud_client.py`, `test_cloud_client.py:88`, README row 3, `deadLetterDepth` in heartbeat.
  - `prune_terminal_visits` (90-day cascade, idempotent) -> `test_ledger.py:151-167`.
  - `consume_inbox` (drains queue in receipt order, capped `inboxBatchMax`=500) -> `main.py`, `test_main.py:235,248,261`.
  - `continuesVisitId` (max-age continuation without re-alert) -> `contract.py:45,60`, `test_main.py:313`, `test_state_machine.py`, `test_ledger.py` restart test.
  - `git show origin/main:.../state_machine.py | grep -c` returns 11 matches for the snapshot/max-age fixes -> confirmed on main.
- Provenance: **#2225** `f3a631adc` (v2 edge service, SQLite ledger/outbox, Frigate 0.17.2), **#2227** `c6d839fee` (2.1.0 round-2: plate-merge crash, stuck-visit reaper, dead-letter, pruning, atomic step), **#2229** `1a77e8aaf` (required_zones per camera + Docker lab smoke). The "2.1.1/2.1.2" bumps live inside these PRs; the version file reads 2.1.2.

### 3. `camera-bridge/visitd/state_machine.py` public API -- VERIFIED (line-cited)
- **`class VisitTracker`** (`:309`): `__init__(...)` (`:312`), `open_visits() -> List[Visit]` (`:341`), `handle_event(ev: FrigateEvent) -> List[Emission]` (`:375`), `tick(now: float) -> List[Emission]` (`:419`).
- **`VisitPolicy`** frozen dataclass (`:55`) -- defaults: `candidate_seconds=10.0`, `confirm_seconds=45.0`, `stationary_confirm_seconds=20.0`, `leave_grace_seconds=20.0`, `split_track_seconds=10.0`, `split_track_iou=0.5`, `plate_reattach_minutes=30.0`, `plate_confirm_score=0.9`, `plate_candidate_score=0.7`, `plate_single_read_confirm_score=0.95`, `max_sighting_seconds=43200.0`, `topology=()`. (Matches the POC's observed defaults.)
- **`CameraSpec`** frozen dataclass (`:73`): `name`, `arrival_zones: frozenset`, `bay_zones: frozenset`, plus `.zones` property (= arrival  bay).
- **`Emission`** frozen dataclass (`:190`) -- **21 fields** (the POC only used 4): `visit_id, state, seq, at, estimated, sighting_id, camera, zone, priority, label, confidence, dwell_seconds, zone_dwell, stationary, plate, direction, frigate_start_time, frigate_end_time, merged_into=None, continues_visit_id=None`.
- Other exported dataclasses: `TopologyLink` (`:45`), `ZoneInterval` (`:90`), `PlateRead` (`:104`), `Sighting` (`:116`), `Visit` (`:142`). Helpers: `normalize_plate`, `levenshtein`, `iou`, `union_seconds`, `snapshot_reads`, `plate_summary`, `visit_to_dict` (`:852`), `visit_from_dict` (`:900`).
- **`parse_event(payload) -> FrigateEvent` lives in `frigate_events.py:151`** (not state_machine.py).
- Emitted state vocabulary (grep of state_machine.py): `DETECTED, ENTERED_ZONE, ARRIVAL_CANDIDATE, CONFIRMED_ARRIVAL, IN_SERVICE, DEPARTING, LEFT, PASS_THROUGH` (+ plate statuses `CANDIDATE/CONFIRMED/UNREADABLE`).

### 4. Tests -- VERIFIED
- **10 `tests/test_*.py` files, 95 test functions total.** Counts: `test_state_machine.py` 21, `test_stitching.py` 15, `test_ledger.py` 13, `test_main.py` 11, `test_cloud_client.py` 9, `test_contract.py` 8, `test_frigate_events.py` 7, `test_config.py` 5, `test_replay_fixtures.py` 4, `test_mqtt_client.py` 2. Plus `tests/helpers.py` and JSONL fixtures (`arrival_and_leave.jsonl`, `pass_through.jsonl`, `split_track.jsonl`, `make_fixtures.py`).
- Coverage spans the whole edge: state machine + stitching (split-track/plate/max-age), SQLite ledger/outbox/dead-letter/pruning, MQTT client, cloud client retry/dead-letter, config, Frigate event parsing, contract shape, and fixture replay.

### 5. POC `lot_watch.py` -- NOT committed anywhere (VERIFIED)
- `git ls-files` shows **no** `lot_watch`/`lot-watch`/screen-capture/`mss`/`gdigrab`/`mog2` file. It exists only at `scratchpad\capture\lot_watch.py`.
- `git grep "VisitTracker("` returns only `visitd/main.py` and `tests/helpers.py` (production/test usage) -- the POC's `VisitTracker(...)` construction is not in-tree.

### 6. statenour camera surfaces -- VERIFIED
- **Cockpit page:** `apps/statenour/app/(mastery)/system/camera/page.tsx` -- tRPC `system.cameraArrivals` (read), `system.testVehicleAlert` (sim), `system.updateArrivalStatus` (Acknowledge/False-Positive/LEFT). Has explicit empty-vs-error handling ("a failed read is its own state, not '0 arrivals'").
- **tRPC router:** `apps/statenour/lib/trpc/routers/system/devices.ts:201` `cameraArrivals` (reads `prisma.deviceEvent` where `event="vehicle_detected"`, ET-day count via `startOfDayET()`), `:260` `testVehicleAlert`, `:315` `updateArrivalStatus`.
- **Ingest + G0 probe:** `apps/statenour/app/api/devices/[id]/events/route.ts` -- `POST` resolves device by cuid or `platformDeviceId`; **`?dryRun=1` or header `x-dry-run: 1`** validates via `VehicleEventSchema`, reports `wouldAlert`, and **writes NOTHING** (no DeviceEvent, no ONLINE flip, no alert) -- this is the Gate G0 probe. Real path routes `vehicle_detected` -> `handleVehicleEvent`, others -> `deviceEvent.createMany`, then flips `SmartDevice.lastSeenAt/status=ONLINE`.
- **Core service:** `apps/statenour/lib/services/vehicle-detection.ts` -- `handleVehicleEvent(deviceId, payload)` (`:115`): validates, idempotency by `eventId` (window), finds existing row by `data.visitId` then `data.trackId`, Telegram/push alert gated on `ALERT_STATES`, feature flag `NICK_ARRIVAL_INTELLIGENCE` (test-panel bypass). `isQuietHoursET` (`:72`).
- **Contract:** `apps/statenour/lib/services/vehicle-event-contract.ts` -- `VehicleEventSchema` (`:48`, passthrough), `ALERT_STATES = {CONFIRMED_ARRIVAL, ENTERED_ZONE}` (`:60`).
- **Customer link:** `apps/statenour/lib/services/vehicle-customer-link.ts` -- `lookupPlate(plate)` (`:44`, calls nickstire), `renderCustomerLine` (`:79`), `linkVisitToCustomer` (`:93`).
- Also: `lib/brain/camera-intelligence.ts`, `lib/ai/agent-actions/camera-actions.ts`, `app/api/cameras/route.ts` (GET device list + snapshots), `app/api/cron/device-heartbeat-sentinel/route.ts` (+ its test). Tests: `tests/cron/device-heartbeat-sentinel.test.ts`, `tests/lib/camera-intelligence.test.ts`, `tests/services/vehicle-customer-link.test.ts`, `tests/services/vehicle-detection.test.ts`.
- **Edge->cloud contract (visitd side):** `cloud_client.py:44` `events_url` = `POST {baseUrl}/api/devices/{cloudDeviceId}/events` with header `x-sync-key`; `device_url` PATCH heartbeat; `main.py:194` builds the payload per emission via `contract.py build_event`. The edge already targets exactly the statenour route above.

### 7. Persistence reality -- KEY GAP
- Prisma has **`model SmartDevice` (schema.prisma:1323)** and **`model DeviceEvent` (schema.prisma:1348)** only -- **there is NO first-class `VehicleVisit` table.** A "visit" is reconstructed at read time by JSON-path queries (`data.visitId` / `data.trackId`) over the append-only `DeviceEvent` log (`vehicle-detection.ts` windowed `findFirst`, `devices.ts` `cameraArrivals` `findMany take:50`). This works but has no durable per-visit row, no visit-level index, and dwell/plate/state are re-derived per query.

### 8. nickstire surfaces -- thin, and the admin-surface requirement is UNMET
- `apps/nickstire/server/routes/nour-os-query.ts:449` -- **`vehicle_lookup_by_plate`** action (read-only/advisory; source = `memberships.vehiclePlate`; OCR-confusable variants; masked logging). Documented in `apps/nickstire/docs/NICKSTIRE-QUERY-CONTRACT.md:508` (ADR-0017, v11.10). **Its consumer is statenour** `vehicle-customer-link.ts` after a CONFIRMED_ARRIVAL -- i.e. the data flows nickstire->statenour, not the reverse.
- **No camera-detected arrival feed exists in nickstire /admin.** `apps/nickstire/client/src/pages/admin/today/ArrivalLoadStrip.tsx` shows *expected* arrivals (customer-said-coming + bookings whose `preferredDate`=ET-today), NOT camera visits. `apps/nickstire/server/routers/vehicleData.ts` is VIN-decode + recalls only. The goal "surface in nickstire.org/admin, not only statenour" is a genuine build gap: the visit data lives in statenour's Neon DB; nickstire (TiDB) has no reader for it.

---

## Exact next changes to build ON the shipped system (not restart)

**A. Commit the POC as a supported edge *lab* tool (do NOT wire it into production `visitd`).**
- New file `camera-bridge/lab/screen_ingest.py` (rename from `lot_watch.py`), sibling to the existing `camera-bridge/lab/lab_publish.py` / `lab-compose.yml`. Keep the MOG2->centroid->`parse_event`->`VisitTracker.handle_event`/`tick` pipeline, but make it emit through the **same paths the lab already uses**: either publish Frigate-shaped MQTT (mirror `lab_publish.py`) or POST to `events_url(...)` with `x-sync-key`. Gate it behind an explicit `--source screen` flag and a loud "UNSUPPORTED for production; screen-capture is a bridge of last resort" banner in `camera-bridge/README.md` (add a row to its runbook table).
- Test: `camera-bridge/tests/test_lab_screen_ingest.py` -- feed a short recorded clip fixture (or a synthetic frame generator) through the detector and assert `>=1 CONFIRMED_ARRIVAL` emission, mirroring `tests/test_replay_fixtures.py`. Positive-control it first (per repo `positive-control-first` skill): run against a no-motion clip -> assert **zero** CONFIRMED_ARRIVAL.
- Acceptance gate: `python -m visitd --version` and existing 95 tests unchanged; new lab tool importable and green; `requirements.txt` gains `mss`/`opencv` under a clearly-marked `[lab]` extra so production install is unaffected.

**B. Wire durable per-visit persistence (projection over the shipped log).**
- Add `model VehicleVisit` to `apps/statenour/prisma/schema.prisma` (keys: `visitId @unique`, `deviceId`, `camera`, `firstState`, `lastState`, `confirmedAt`, `leftAt`, `dwellSeconds`, `plateText`, `plateStatus`, `customerRef` json, `linkedMembershipId`, timestamps + index on `(deviceId, confirmedAt)`). Keep `DeviceEvent` as the append-only source of truth.
- In `apps/statenour/lib/services/vehicle-detection.ts::handleVehicleEvent`, after the existing DeviceEvent write, **upsert VehicleVisit by `visitId`** (fallback `trackId` for v1). Point `cameraArrivals` (`devices.ts:201`) and `updateArrivalStatus` (`:315`) at the projection so reads stop doing JSON-path scans.
- Migration is hand-applied -- follow the `statenour-migration` skill (pgvector-safe flags); apply via the shipped `POST /api/system/apply-pending-migration` pattern in MEMORY, not a raw prod write.
- Tests: extend `apps/statenour/tests/services/vehicle-detection.test.ts` -- assert idempotent upsert (same `eventId`/`visitId` twice -> one VehicleVisit row, state advances), and empty-vs-error (a failed read renders as error state, never "0"). Positive-control the migration.

**C. Surface camera arrivals in nickstire /admin (close the stated gap).**
- statenour side: add `GET /api/cameras/arrivals` (or reuse `app/api/cameras/route.ts` with an `?arrivals=1` arm) returning the VehicleVisit projection, auth'd with the same `x-sync-key` the edge uses.
- nickstire side: new server route `apps/nickstire/server/routes/` (or a `vehicleArrivals` tRPC procedure in a new `apps/nickstire/server/routers/cameraArrivals.ts`) that fetches statenour `bdnick.info` with the sync key (cross-app read; nickstire's TiDB does not hold the visits). Add a nickstire admin panel `apps/nickstire/client/src/pages/admin/today/` (next to `ArrivalLoadStrip.tsx`) rendering the live CONFIRMED_ARRIVAL feed with plate/customer line. Reuse `nour-os-query`'s `vehicle_lookup_by_plate` for the customer join so no second plate-matcher is created (repo `prior-art-grep` / "no second implementation" rule).
- Acceptance gate: a `testVehicleAlert` CONFIRMED_ARRIVAL fired in statenour appears in **both** `/system/camera` (statenour) and `/admin` (nickstire) within the poll window; iOS-PWA confirms use in-DOM two-tap (repo `nickstire-ios-pwa-primitives`, `window.confirm` is suppressed in standalone PWA).

**D. First real-hardware gate (already teed up in MEMORY):** run the G0 dry-run against a live unit -- `POST /api/devices/v380-shopsign/events?dryRun=1` with a `vehicle_detected` body -> expect `{dryRun:true, valid:true, events:[{state, wouldAlert}]}` and zero DB writes -- before pointing the (screen-ingest or edge) producer at the real endpoint.

### Caveats / labels
- All repo-state claims above are **VERIFIED** by `git`/`grep`/`sed` against the checkout. The camera-hardware facts (V380 ports, Anyka generation) are inherited from the task brief and were **not** re-probed here.
- Screen-capture ingest (step A) is explicitly a **fallback**, kept out of the production `visitd` supported surface; the production path remains Frigate->MQTT/HTTP->`visitd`->statenour events endpoint, which is already shipped.
- Local checkout is on a side branch 2 commits behind `origin/main`; do any of this work from a fresh worktree off `origin/main` and follow the shared-main push protocol (branch, explicit paths, no `--no-verify`).


**Open questions:**
- Should durable persistence be a new VehicleVisit projection table (recommended, low-churn on the shipped DeviceEvent log) or a heavier refactor that makes VehicleVisit the source of truth? The shipped design deliberately uses DeviceEvent + JSON-path windowing.
- For the nickstire admin surface, is a cross-app fetch from nickstire to statenour (bdnick.info, x-sync-key) acceptable, or should camera visits be mirrored into nickstire TiDB? Visits currently live only in statenour Neon.
- Is screen-capture ingest wanted as a committed lab tool at all, or should effort go straight to real Frigate-on-edge (the supported production path) now that the V380 RTSP/ceshi.ini unlock is still pending on hardware?
- The V380 hardware facts (only 8800/9800 open, Anyka generation, no ONVIF) came from the task brief and were not re-probed in this audit; should a fresh LAN/RTSP probe gate the ingest decision?


<a name="Production hardening for the current-har"></a>

## Production Hardening -- current-hardware path

Evidence classes: **VERIFIED** = read in the repo at working SHA `1a77e8aaf` (branch `statenour/nextjs-critical-rce-advisory`) or a first-party statute/vendor doc; **LIKELY** = strong inference from shipped code/config; **UNVERIFIED** = claimed in plan but no implementing code found.

### 0. What is already shipped (so we harden the gaps, not re-pave)

VERIFIED in repo:
- `camera-bridge/visitd/` emits **28 Prometheus series** on loopback `127.0.0.1:9090` (`visitd_open_visits`, `visitd_outbox_depth`, `visitd_outbox_dead_lettered_total`, `visitd_mqtt_connect_failures_total`, `visitd_tracker_force_ended_total`, `visitd_transitions_total`, `visitd_parse_errors_total`, `visitd_pipeline_errors_total`, `visitd_cloud_events_total{result}`, ...) and folds `metrics.snapshot()` into the 60 s heartbeat `currentState` (`visitd/main.py:267-283`).
- `camera-bridge/visitd/replay.py` -- deterministic JSONL replay with virtual-clock ticks (replay evaluates timers identically to production).
- Plate retention: `apps/statenour/lib/services/plate-retention.ts` (`PLATE_RETENTION_DAYS = 30`, indexed raw-SQL UPDATE nulling `plate.text`/`plate.normalizedText` unless `customerRef.status='matched'`, stamps `plateScrubbedAt`), wired into `apps/statenour/app/api/cron/data-cleanup/route.ts`; DeviceEvent row lives to 90 d (`config/retention.ts`).
- Heartbeat sentinel: `apps/statenour/app/api/cron/device-heartbeat-sentinel/route.ts` -- `STALE_AFTER_MS = 20*60_000`, worker-fired every 15 min, alerts once per ONLINE->OFFLINE transition, birth-registry guard (never-seen device never pages), 3 h alert-retry ceiling.
- Compose port hygiene: `docker-compose.yml` binds MQTT 1883, Frigate API 5000, go2rtc 8554/8555, visitd 9090 to `127.0.0.1` only; **only 8971 (authed JWT UI) is LAN-exposed**, documented Tailscale-ACL-only.
- Ingest auth: `POST /api/devices/[id]/events` is `{ auth: "sync" }` (timing-safe `x-sync-key`) with a non-writing `?dryRun=1` G0 path.
- Ohio/federal legal analysis: plan 14.2 (ORC 2907.08, 2933.52, 4501.27 / DPPA 18 USC 2721, FTC v. Rite Aid, ORC 1354 safe harbor).

**Four verified gaps this section closes:**
1. **No benchmark scorer.** Plan 11 specifies `camera-bridge/tests/fixtures/<clip>.labels.json` + a nightly precision/recall/dwell-MAE scorer -- **neither exists** (`find` returns nothing; only 3 hand-assert fixtures in `tests/`).
2. **No threshold auto-calibration** anywhere in `camera-bridge/` (no calibrate/score/bench script).
3. **Heartbeat carries no `detectorMs` and no Frigate `/api/stats`** (CPU/disk/fps). `heartbeat_body()` ships `mqttConnected/frigateAvailable/outboxDepth/deadLetterDepth/lastEventAt/openVisits/metrics`. So the Ops-SLO receipts "detector < 40 ms" and "disk < 80 %" (plan 12) have **no data source** -- a promised control that is unimplemented.
4. **nickstire.org/admin has zero camera surface** (grep for `camera|vehicle_detected|visit|plate|shopsign` in `apps/nickstire/src` = empty). The task explicitly requires it.

Also: the **live screen-capture POC (`scratchpad/capture/lot_watch.py`) is uncommitted and carries none of the hardening below** -- no metrics, no reconnect, no auth, no retention. Treat it as a lab throwaway; do not run it as a production source without the 3.1 wrapper.

---

### 1. SECURITY / NETWORK (execution-grade)

**1.1 If RTSP unlocks on SHOPSIGN (`ceshi.ini` branch).** The V380 talks to the vendor P2P cloud by default (LIKELY, from firmware `AppKN_VACL4`); an unlocked RTSP endpoint must never reach the WAN. Fios/Arcadyan routers cannot do real 802.1Q VLANs, so isolate at the host, not the router:

- **Frigate reads RTSP over loopback only.** Point go2rtc at the camera IP but never expose the restream: keep `- "127.0.0.1:8554:8554"` (already VERIFIED in compose). Never rebind 8554/8555 to `0.0.0.0`.
- **Block the camera's cloud egress at the router** (Fios GUI -> Firewall -> Access Control): deny outbound WAN for the camera's MAC/IP, allow only LAN + NTP. VERIFIED-plan 14.1. This is the only isolation a Fios router reliably gives.
- **Nightly RTSP health + revert detection** (the unlock can silently revert to locked). Linux cron / Windows Task:
  ```bash
  # /etc/cron.daily/rtsp-check  (Linux edge box)
  ffprobe -v error -rtsp_transport tcp -timeout 5000000 \
    -i "rtsp://192.168.0.155:554/live/ch00_1" -show_entries stream=codec_type -of csv 2>&1 \
    | grep -q video || curl -fsS -X PATCH https://bdnick.info/api/devices/v380-shopsign \
        -H "x-sync-key: $STATENOUR_SYNC_KEY" -H 'content-type: application/json' \
        -d '{"status":"DEGRADED","currentState":{"rtspProbe":"failed"}}'
  ```
  ```powershell
  # Windows lab equivalent
  $ok = & ffprobe -v error -rtsp_transport tcp -timeout 5000000 -i "rtsp://192.168.0.155:554/live/ch00_1" -show_entries stream=codec_type -of csv 2>&1
  if ($ok -notmatch 'video') { Write-Warning 'RTSP reverted -- re-run ceshi.ini unlock' }
  ```

**1.2 Keep everything loopback/Tailscale-only.** VERIFIED compose is already correct. Production checklist:
- Edge box joins Tailscale as a subnet router, **no port-forwarding** (plan 4). Frigate 8971 reachable only via Tailscale ACL; add an ACL that grants the operator's tailnet node `tcp:8971` and denies all else.
- `x-sync-key` is the only cloud credential on the wire and it is timing-safe compared (VERIFIED `{auth:"sync"}`). Rotate it in Railway if the edge box is ever re-imaged.

**1.3 Mosquitto auth.** VERIFIED `mosquitto/mosquitto.conf` exists (589 B) with `allow_anonymous false`. Bootstrap the password file before first `up` (README 5):
```bash
docker run --rm -v "${PWD}/mosquitto:/work" eclipse-mosquitto:2.0 sh -c \
  "mosquitto_passwd -c -b /work/passwd frigate '<FRIGATE_MQTT_PASSWORD>' && \
   mosquitto_passwd -b /work/passwd visitd '<MQTT_PASSWORD>' && chmod 0700 /work/passwd"
```
Rotate by re-running and `docker compose restart mqtt`. Never commit `mosquitto/passwd` or `.env` (confirm both are gitignored before first push).

**1.4 No cloud egress from cameras.** Two-layer: router MAC egress-deny (1.1) + the camera never being addressable from outside the LAN (loopback restream). The V380 P2P relay is the residual risk (the app still phones home); accept it for the interim lot-overview lane, **never for the LPR camera** -- that is why the plan buys a PoE ONVIF camera for LPR (no vendor cloud).

**1.5 Screen-capture fallback exposure (the POC).** `lot_watch.py` reads the V380 desktop window, which is logged into `rdean22@gmail` over the vendor P2P cloud -- so that path *does* depend on cloud egress and a desktop session. Exposure to document: (a) frames transit the vendor cloud; (b) anyone at the shop laptop sees the same window; (c) no auth on the local capture. Mitigations if it must ship as a bridge: run it as a dedicated non-admin Windows service (never SYSTEM), post to statenour with the same `x-sync-key`, and treat it as `DEGRADED`-quality (loose MOG2 boxes) -- feed it into the same visitd contract so the ledger/retention/redaction apply uniformly.

---

### 2. PRIVACY / RETENTION / REDACTION (execution-grade)

**2.1 Legal controls to enforce in config** (VERIFIED plan 14.2; statutes are first-party D-class):
| Control | Enforcement point | Status |
|---|---|---|
| Audio off (ORC 2933.52 -- disable despite one-party) | Frigate `audio: {enabled: false}` on every camera **and** at the camera | set in `frigate/config.example.yml` (verify before deploy) |
| No restroom/changing-area coverage (ORC 2907.08) | physical aim + `motion.mask` | placement survey, plan 10 |
| No face recognition (FTC v. Rite Aid) | Frigate `face_recognition: {enabled: false}`; person = presence only | verify flag off |
| Plate->owner barred (DPPA/ORC 4501.27) | only join to customer-provided plates (`memberships.vehiclePlate`) | VERIFIED `vehicle-detection.ts` looks up nickstire, idempotent per plate text |
| Signage "video surveillance in use" | operator TODO at entrance + counter | **operator action, not code** |
| Written retention + police-disclosure log | `docs/operations/` one-pager | **not yet written -- create it (2.4)** |

**2.2 Plate-text retention (30 d).** VERIFIED shipped and wired. Add a **verification probe** to prove it actually runs (the cron is Sunday 3am UTC; a silent failure would retain plates indefinitely). Via Neon MCP or an authed admin fetch:
```sql
-- rows still holding plate text past the 30-day line = MUST be 0 after a cron run
SELECT count(*) FROM device_events
WHERE event='vehicle_detected' AND created_at < now() - interval '30 days'
  AND jsonb_typeof(data->'plate'->'text')='string'
  AND coalesce(data->'customerRef'->>'status','') <> 'matched';
```
Wire this count into the cockpit as `plate_retention_overdue` and alert if > 0.

**2.3 Recording retention (edge, Frigate).** Plan 14.2: recordings 30 d (alerts) / 14 d (detections) / 3 d (motion). Set in `frigate/config.yml` `record.retain` + `record.alerts.retain.days` / `record.detections.retain.days`; verify `du -sh storage/media` stays under the disk SLO. This is edge-side and independent of the 30 d plate scrub (which is cloud-side).

**2.4 Admin redaction/export policy (new, execution-grade).** Two things to build:
1. `docs/operations/2026-09-camera-retention-policy.md` -- the ORC 1354 safe-harbor written program (retention windows table, disclosure log template, staff-ack line). This is the cheapest, highest-legal-value artifact and it is currently missing.
2. A cockpit **export + on-demand redaction** action: a `/system/camera` control that (a) exports a single visit's clip + rows for an insurance/police request and **logs the disclosure** (who/when/what) to `AuditEvent`, and (b) force-scrubs a plate on request (GDPR-style erasure even though Ohio doesn't require it) by calling `scrubExpiredPlates`-style targeted UPDATE by `visitId`. Police voluntary disclosure is lawful but **every disclosure must be logged** (plan 14.2).

---

### 3. OBSERVABILITY (execution-grade)

**3.1 Self-healing reconnect -- RTSP + screen-capture sources.** Frigate handles RTSP reconnect natively (go2rtc). The screen-capture source does not; if it ships, wrap it:
- Watchdog: if no frame for N seconds -> re-acquire the window handle (mss/gdigrab), increment a `capture_reconnects_total` counter, and if it can't re-acquire within 60 s, PATCH the device `DEGRADED`.
- visitd already reconnects MQTT with backoff (VERIFIED `visitd_mqtt_connect_failures_total`, `visitd_mqtt_disconnects_total`) and drains the outbox in order on WAN return (plan 15).
- Supervisor: systemd on Linux (`Restart=always`), Task Scheduler on the lab laptop (`install-windows-service.ps1` exists). On restart, visitd reloads open visits and resumes tick timers (VERIFIED plan 15).

**3.2 Close the `detectorMs` / Frigate-stats gap (the real missing metric).** `heartbeat_body()` (`visitd/main.py:267`) does **not** carry detector latency, camera fps, or disk -- so the Ops SLOs in 12 are unmeasurable today. Fix: add an optional Frigate `/api/stats` poll in visitd's housekeeping pass (loopback `http://127.0.0.1:5000/api/stats`, best-effort, never blocks the state machine), and extend `currentState`:
```python
# visitd/main.py heartbeat_body(), add under "metrics":
"detectorMs": self._frigate_stat("detectors","inference_speed"),   # ms
"cameraFps": self._frigate_stat("cameras","<cam>","camera_fps"),
"storagePct": self._frigate_stat("service","storage","/media","used_pct"),
```
Then the sentinel/cockpit can enforce `detector < 40 ms` and `disk < 80 %`. Until this lands, mark those two SLOs UNVERIFIED and do not claim G2/Ops pass on them.

**3.3 Metrics catalog to surface** (the churn/precision KPIs the task asks for):
| KPI | Source (VERIFIED unless noted) | Where |
|---|---|---|
| detector fps / inference ms | Frigate `/api/stats` (needs 3.2) | heartbeat -> cockpit |
| tracker id-churn | `visitd_tracker_force_ended_total` + duplicate rate from scorer (4) | edge scorer |
| visit precision/recall | scorer vs labels (4, **new**) | nightly JSON |
| plate read rate | share of confirmed visits with >=0.9 read -- compute in scorer | nightly JSON |
| source uptime | heartbeat gaps -> sentinel (VERIFIED) | `/system/camera` |
| outbox depth / dead-letter | `visitd_outbox_depth`, `visitd_outbox_dead_lettered_total` (VERIFIED) | heartbeat |

**3.4 Alerting.** VERIFIED sentinel: Telegram + tagged push once per OFFLINE transition, flood-control tag cooldown (`push_suppressed` rows), birth-registry (never-seen  page). Add: a **planted positive control** (`source:"test-panel"` synthetic event nightly) that must produce a suppressed-in-quiet-hours row and a real alert in the day -- proves the alert path end-to-end (plan 11.6 "mutation canaries", 13 "silent-instrument rule"). This is a test to write, currently absent.

**3.5 Surface in nickstire.org/admin (required, currently absent).** statenour is the system of record; nickstire needs a **read-only mirror tile**. Lowest-coupling path: a nickstire admin page that calls statenour `GET /api/devices/:id/events?limit=50` with the sync key server-side (never expose the key to the browser) and renders last-visit / bridge-age / outbox-depth / plate-read-rate. This reuses the VERIFIED GET route -- no new statenour surface needed. Gate it behind the existing `/admin` auth.

---

### 4. BENCHMARK / REPLAY (execution-grade -- this is net-new build)

The plan specifies it; **none of it is built.** Concrete deliverables:

**4.1 Record real shop footage.** From the lab laptop against the V380 desktop window, or once RTSP unlocks:
```powershell
# 30-min clip from the unlocked RTSP (preferred, clean frames)
ffmpeg -rtsp_transport tcp -i "rtsp://192.168.0.155:554/live/ch00_1" -t 1800 -c copy `
  camera-bridge/fixtures/sign-2026-09-09.mp4
# screen-capture fallback (gdigrab) if RTSP still locked
ffmpeg -f gdigrab -framerate 6 -i title="V380" -t 1800 camera-bridge/fixtures/sign-screen.mp4
```
Loop it through Frigate with the commented `replay` camera (plan 9: `input_args: -re -stream_loop -1`) so the whole edge stack runs with no live camera.

**4.2 Ground-truth label set.** Hand-label each clip once into `camera-bridge/tests/fixtures/<clip>.labels.json` (the schema the plan names):
```json
{"clip":"sign-2026-09-09.mp4","visits":[
  {"plate":"ABC1234","enter_ts":12.4,"confirm_ts":58.1,"leave_ts":214.0},
  {"plate":null,"enter_ts":300.0,"confirm_ts":null,"leave_ts":304.0}   // pass-through
]}```

**4.3 Scorer (`camera-bridge/tools/score_replay.py`, new).** Replay the recorded MQTT JSONL through `VisitTracker`, match emissions to labels by time-overlap (greedy nearest within a tolerance window), compute the five metrics the acceptance gate needs:
```
arrival_recall  = matched_arrivals / labeled_arrivals
arrival_precision = matched_arrivals / emitted_confirmed_arrivals
dwell_MAE       = mean(|emitted_dwell - (leave_ts-enter_ts)|)   over matched
duplicate_rate  = (emitted_visits - physical_visits) / physical_visits   # >1 visitId per car
ghost_rate      = unmatched_emitted_visits / emitted_visits              # visit, no labeled car
plate_read_rate = confirmed_with_read_ge_0.9 / confirmed_visits
```
Emit one JSON blob to stdout + `camera-bridge/data/score-<date>.json`. Run:
```bash
python -m visitd.main --config config.example.yaml --replay data/sign-<date>.jsonl --ledger data/bench.sqlite --emit-jsonl data/emissions.jsonl
python tools/score_replay.py --emissions data/emissions.jsonl --labels tests/fixtures/sign-<date>.labels.json
```
(You may need a small `--emit-jsonl` flag on `main.py` to dump emissions; replay already returns them in-process, so the scorer can alternatively import `replay()` directly -- cleaner, no new flag.)

**4.4 Regression gate.** Add `tests/test_scorer_regression.py`: replay the labeled fixtures, assert the metrics clear the G1/G2 thresholds. Run it in CI alongside the existing `python -m unittest discover -s tests` (VERIFIED < 1 s, deterministic, no network). Positive-control-first: run each new assertion against unfixed thresholds first and record the failure shape (repo rule).

---

### 5. AUTOMATIC THRESHOLD CALIBRATION (execution-grade)

The tunable thresholds are VERIFIED in `config.example.yaml`: `candidateSeconds:10`, `confirmSeconds:45`, `stationaryConfirmSeconds:20`, `leaveGraceSeconds:20`, `splitTrackSeconds:10`, `splitTrackIou:0.5`, `plate.confirmScore:0.9`, `plate.candidateScore:0.7`, `maxSightingSeconds:43200`.

**5.1 Grid/coordinate search over recorded footage (`tools/calibrate.py`, new).** Because replay is deterministic and virtual-clocked (VERIFIED `replay.py`), the same JSONL scored under different configs is a pure function -- ideal for offline search:
```python
# pseudocode: sweep confirmSeconds x leaveGraceSeconds x splitTrackIou against the label set,
# maximize (recall>=0.95 AND precision>=0.90) then minimize dwell_MAE, tie-break min duplicate_rate.
for cfg in grid({confirmSeconds:[30,45,60], leaveGraceSeconds:[15,20,30], splitTrackIou:[0.4,0.5,0.6]}):
    r = replay(VisitTracker(policy_from(cfg), cameras), records)   # in-process, no I/O
    m = score(r.emissions, labels)
    keep best feasible m
```
```bash
python tools/calibrate.py --records data/sign-<date>.jsonl --labels tests/fixtures/sign-<date>.labels.json \
  --out config.calibrated.yaml
```
Output a diff against the live config; **never auto-apply** -- the operator reviews the diff, and any change re-runs 4.4 before deploy. Calibration needs >=100 labeled visits (plan 11.3 field-truth log via a phone shortcut) before it is trustworthy; on a single 30-min clip it only sanity-tunes, it does not certify.

**5.2 Guardrails.** Freeze `plate.confirmScore` (0.9) and `singleReadConfirmScore` (0.95) -- those are accuracy floors, not throughput knobs; tuning them down to raise read-rate would violate G4's 95 % accuracy bar. Only tune the timing/IoU thresholds.

---

### 6. Acceptance-gate table (production-hardening view)

| Gate | Criterion | Command / receipt | Status |
|---|---|---|---|
| H0 secrets | `.env`, `mosquitto/passwd` gitignored; sync-key never in browser bundle | `git check-ignore .env mosquitto/passwd`; grep client bundle | verify before push |
| H1 network | only 8971 LAN-exposed; camera WAN-egress denied at router; nightly ffprobe revert check live | `docker compose config \| grep 0.0.0.0`; router ACL screenshot; cron installed | compose VERIFIED; router + cron = operator |
| H2 retention | `plate_retention_overdue` count = 0 after data-cleanup; recordings within 30/14/3 d | SQL probe 2.2; `du -sh storage/media` | scrub VERIFIED; probe = new |
| H3 redaction/policy | `docs/operations/...retention-policy.md` exists; disclosure logs to AuditEvent; signage up | file + cockpit export action | **not built** |
| H4 observability | heartbeat carries detectorMs + storagePct; planted-positive alert canary green nightly | `curl 127.0.0.1:9090/metrics`; Telegram test row | metrics VERIFIED; detectorMs + canary = new |
| H5 nickstire surface | `/admin` shows bridge age / last visit / read-rate | render check | **not built** |
| H6 benchmark | scorer runs in CI; recall >=0.95, precision >=0.90, dwell MAE <15 s, dup <5 %, ghost <3 % on labeled clip | `python tools/score_replay.py ...` | **not built** |
| H7 calibration | `calibrate.py` produces a reviewed config diff from >=100 labeled visits | `python tools/calibrate.py ...` | **not built** |

Existing plan gates G0/G-lab (DONE), G1-G5, Ops SLOs remain as in 12 -- but Ops SLO "detector < 40 ms / disk < 80 %" is **blocked on H4** (no data source until 3.2 ships).


**Open questions:**
- Did the ceshi.ini unlock on SHOPSIGN (.155) actually succeed and does rtsp://192.168.0.155:554/live/ch00_1 open? All RTSP-path hardening (loopback restream, revert cron) is conditional on this; unverified as of this session.
- Will the screen-capture POC (lot_watch.py) be promoted to a real bridge, or is it strictly a lab throwaway? If promoted it needs the full 3.1 wrapper (watchdog reconnect, metrics, non-admin service, same x-sync-key) before it can be a production source.
- Is Frigate's /api/stats reachable from visitd on the production edge box (does visitd share the compose network with Frigate's 5000)? The detectorMs fix (3.2) assumes a loopback poll works there.
- How should the nickstire/admin camera tile authenticate to statenour long-term -- a shared service token, or should statenour expose a narrower read-only camera-summary endpoint rather than reusing the full events route?
- Confirm audio.enabled:false and face_recognition.enabled:false are actually set in frigate/config.example.yml before any real deploy (legal controls; I inferred from plan 14.2 but did not open the Frigate config file in this session).
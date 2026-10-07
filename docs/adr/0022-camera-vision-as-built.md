# ADR-0022 · Camera / vision intelligence as built (supersedes ADR-0017 on five of seven decisions)

> **Status**: Accepted (2026-10-07) · supersedes [ADR-0017](./0017-camera-vision-architecture.md) decisions 1, 2, 4 (in part), 6 and 7; decisions 3 and 5 stand.
> **Date**: 2026-10-07
> **Evidence**: [`docs/agent-audit/CAMERA-INTELLIGENCE-AUDIT-2026-10-07.md`](../agent-audit/CAMERA-INTELLIGENCE-AUDIT-2026-10-07.md) (live NicksMax, Railway and Neon receipts), `apps/nickstire/docs/CURRENT-TRUTH.md` (NicksMax sections), `docs/operations/NICKSMAX-CAMERA-HOST-2026-09-28.md`.
> **Decision drivers**:
> 1. ADR-0017 was accepted on 2026-09-08 and never amended. By 2026-10-07 production ran a different camera path, a different detector, a second ledger and a different host, and the office camera recorded audio and sent stills to a cloud model -- none of which the ADR allows. A reader of the ADR would be wrong about every physical layer.
> 2. The operator made the two gating decisions ADR-0017 deferred: the recording policy for the office counter (cleared 2026-09-29, capture enabled on NicksMax) and the decoder (large-v3-turbo on 2026-10-03). Decisions made on a Windows task-scheduler box need a record a future session can find.
> 3. The 2026-10-07 audit found the as-built system produced untrustworthy counts while every health surface read HEALTHY. The fixes shipped with this ADR (PR #2920) assume the as-built architecture; a document that still describes Frigate and PoE cameras cannot explain them.

---

## Context

Between 2026-09-08 and 2026-09-28 the plan in ADR-0017 met the shop's hardware. The V380 units never exposed RTSP through the app or the SD-card unlock, no PoE cameras were bought, and the Windows PC at the shop (NicksMax, a 2-core i5-5350U with 8 GB) became the only machine on the camera LAN that could run continuously. The team built around that: the vendor's own relay, a lightweight OpenVINO detector, and the visit state machine from ADR-0017 running on top. On 2026-09-28 NicksMax became the production authority for the `sign` camera; on 2026-09-29 the operator cleared the recording-policy gate and the office counter capture went live; on 2026-10-02 the office camera began sending stills to a vision model ("watch"). ADR-0017 was not updated at any of those points.

## Decisions as built

1. **Cameras: the two V380 units stay, consumed through the vendor's native relay, not replaced and not unlocked.** Production path for the vehicle-truth camera: V380 relay on `:8554`/`:8080` -> FFmpeg SHOPSIGN middle-lens crop -> MediaMTX `rtsp://127.0.0.1:8555/sign` -> `camera-bridge/edge_main.py`. ADR-0017's unlock-then-replace path was not taken; the PoE purchase is not scheduled. The relay is a closed vendor component the box depends on (ADR-0017 rejected "reverse-engineered V380 protocol bridges"; this is the vendor's own relay, which is a different risk: it is maintained by the vendor and opaque to us). Recorded, not re-litigated.
2. **Detection and tracking: OpenVINO on the CPU, no Frigate.** `edge_main.py` runs a detector council (motion gate + OpenVINO vehicle detector), `vision/pipeline.py` (frame health, scene lock, track graph, pre-existing census, entry portal, bay latch, evidence packets) and visitd's `VisitTracker` state machine. Frigate, go2rtc restream and native LPR from ADR-0017 decision 2 are not in production; `camera-bridge/README.md` describes that Frigate lane as the lab/legacy path. No ALPR runs; identity counters on the Lot page are zero by construction.
3. **Visit truth (ADR-0017 decision 3): stands.** Deterministic state machine, edge-minted `visitId`, idempotent `eventId`, SQLite ledger and outbox, no LLM in the truth path. Amended 2026-10-07 by the zone-hysteresis and terminal-disarm rules in `vision/pipeline.py` (one parked car is one visit; a closed visit's track cannot re-arrive without leaving the lot).
4. **Ledger: two lanes, each canonical for its surface.** StateNour Neon `device_events` remains the owner-surface ledger and alert source (ADR-0017 decision 4), hardened 2026-10-07 with a per-device unique eventId index (pending apply), row-before-page ordering and a 7-day visit window. nickstire TiDB `vehicle_visits` + `camera_runtime` (migrations 0119-0143) is the shop-operations ledger behind Admin > Lot, the camera health lattice and the owner alerts. ADR-0017 rejected a TiDB ledger because nickstire had no inbound device ingest; `POST /api/camera/visits` and `/api/camera/heartbeat` now exist with their own key, so the rejection's premise is gone. The product boundary from ADR-0017 holds: shop operations in nickstire, owner summaries and anomalies in StateNour.
5. **Business linkage (ADR-0017 decision 5): stands**, unexercised. No plate reader produces input for it.
6. **Deployment: a Windows host with a SYSTEM scheduled supervisor, not a Linux mini-PC.** NicksMax runs the relay, FFmpeg, MediaMTX, the edge, the office worker, the Eufy bridge and agent under `camera-bridge/scripts/nicksmax/nicksmax-camera-supervisor.ps1`, a SYSTEM task (`NicksMaxCameraSupervisorSystem`) on a ~30 s loop that restarts children, reclaims orphans, dedupes agents, enforces a disk floor and escalates when restarts do not converge (hardened 2026-10-07). Remote access is Tailscale. Known cost: the box is also used as a desktop and was measured at 113 MB free disk and 100 % CPU on 2026-10-07; moving the desktop AI agents off it is an operator action, not an engineering one.
7. **Privacy and audio: office counter audio is captured; vehicles are never identified.** Operator decision 2026-09-29: the Eufy T8410 (NICKS EUCLID) `/record` lane captures counter audio on wake triggers; transcription runs locally on NicksMax (whisper) and only text, facts and a gist are posted to StateNour (`conversation_episodes`). Stills from the office camera are sent to a cloud vision model (Ollama Cloud, Google fallback) for a one-line description with an on-box person count. So the ADR-0017 sentence "no audio" is withdrawn and "audio never leaves this machine" is true only of the audio; stills do leave. No face recognition, no cross-day person tracking, no plate retention (nothing reads plates). The decoder is `large-v3-turbo` since 2026-10-03; the audit measured that choice at about 8 % listening coverage because transcription runs longer than capture, and the worker was decoupled on 2026-10-07 so capture no longer waits on transcription. Reverting the decoder to `base.en` is the operator's call and is listed as such.

## Consequences

- Positive: a lane that runs on hardware the shop already owns, a shop-side admin that reads the same visits the owner is paged about, and a health lattice with a plausibility canary that can now say "the detector is running and seeing nothing" instead of HEALTHY.
- Negative: a vendor relay and a desktop-class Windows box in the truth path; two ledgers to keep in step (the bridge contract and the heartbeat contract tests pin the shared fields); a counter-audio lane whose coverage depends on CPU the box does not have to spare.
- Neutral: ADR-0017's cost ceiling and PoE plan are parked, not rejected. Reopen trigger: the N150-class upgrade or the plausibility canary firing for a reason the relay cannot fix.

## What this ADR does not decide

Whether to buy PoE cameras, whether to move off the Windows box, and whether to revert the decoder are operator decisions recorded in the audit's section 14. This ADR records what runs, so the next session starts from the shop as it is.

## Verification

- `camera-bridge/tests/test_phantom_rearrival.py`, `test_edge_windows.py`, `test_nicksmax_supervisor.py`, `vision/tests/test_officewake_runtime.py` (behaviour, with mutation controls recorded in the commits).
- `apps/nickstire/server/lib/cameraHealth.test.ts` (plausibility canary), `cameraHealthAlerts.test.ts` (per-episode paging), `shared/lotDataConfidence.test.ts`.
- `apps/statenour/tests/services/vehicle-detection.test.ts` (row before page, unique eventId, weekend visit) and `tests/api/apply-pending-migration.test.ts` (the pending index is registered statement for statement).
- Live proof still owed: a signed-in Admin > Lot walkthrough, the 0143 and 20261007120000 applies, and the first business day of the canary on the deployed code.

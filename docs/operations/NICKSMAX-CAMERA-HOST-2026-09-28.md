# NicksMax camera production cutover — 2026-09-28

This is the durable current-truth receipt for the NicksMax `sign` camera edge. Live production
receipts outrank this document if they later disagree.

## Production authority

NicksMax is the production authority for camera `sign`.

Verified runtime contract:

- source type: `rtsp`
- producer instance: `nicksmax-sign-rtsp-v1`
- production input: `rtsp://127.0.0.1:8555/sign`
- calibration: `sha256:67f719cc875d`
- detector: DetectorCouncil / OpenVINO `vehicle-detection-0200` on CPU
- edge metrics: `127.0.0.1:9095`
- final observed `camera_runtime.sign`: `HEALTHY`
- retired WGC tasks on NicksMax are disabled and must not be enabled alongside production

The production lane is explicitly armed by machine-local audit state:
`data/nicksmax-camera-authority.mode=production` plus
`data/NICKSMAX-SIGN-PRODUCTION-ARMED`.

## Direct camera chain

```text
SHOPSIGN V380 camera
  -> V380 cloud/P2P transport
  -> NicksMax local cloud decoder
  -> rtsp://127.0.0.1:8554/live      # 1920x3240; 3 stacked lenses
  -> FFmpeg middle-lens crop
       crop=1920:1080:0:1080
       scale=640:360
       fps=4
  -> MediaMTX loopback broker
  -> rtsp://127.0.0.1:8555/sign
  -> camera-bridge edge_main.py
  -> StateNour + Nick shop mirror
```

Measured cloud-composite lens order:

1. top: shop-left / building frontage
2. middle: shop-right / side lot — production `sign` lens
3. bottom: front/Euclid/PTZ view

The V380 desktop GUI is no longer required for this production path. The direct cloud relay
continued while the V380 desktop application was closed.

## Real event proof

A real vehicle visit on 2026-09-28 progressed through:

```text
ENTERED_ZONE -> ARRIVAL_CANDIDATE -> CONFIRMED_ARRIVAL -> LEFT
```

StateNour delivery returned HTTP 200. The Nick shop mirror reported one successful delivery
and had no durable backlog:

- `visitd_shop_delivered_total 1`
- `visitd_shop_outbox_depth 0`
- `visitd_outbox_depth 0`
- no dead-letter backlog

The shop route itself returns success only after its guarded `vehicle_visits` upsert succeeds
and returns 502 when all database writes fail. A separate NicksMax Railway/TiDB helper query
did not observe the visit row; treat that as a read-path/environment reconciliation item, not
as evidence that the 2xx shop mirror delivery failed.

## Calibration

Production calibration is machine-local:

- file: `camera-bridge/data/calib-nicksmax-sign-rtsp.json`
- canonical frame: 640x360
- fixed-lens camera
- calibration version: `sha256:67f719cc875d`

The older shop-PC/WGC calibration hash is not reused because the direct RTSP crop has a
different coordinate system.

## Recovery behavior

The source copy of the production supervisor is now versioned at:

- `camera-bridge/scripts/nicksmax/nicksmax-camera-supervisor.ps1`
- `camera-bridge/scripts/nicksmax/nicksmax-camera-supervisor-loop.ps1`

It owns one authority and keeps the retired WGC tasks disabled.

A measured RTSP recovery exposed a race where open ports did not guarantee decodable frames.
The supervisor was hardened to:

1. decode one real frame from `rtsp://127.0.0.1:8555/sign` before launching production,
2. refuse early starts when decode proof fails, and
3. throttle production starts with a durable 30-second marker.

Observed fail-closed receipt:
`WAIT production RTSP decode proof failed; refusing early edge start`.

Once the cropped stream was decodable, the authoritative edge returned to HEALTHY.

## SYSTEM supervision / login independence

A SYSTEM scheduled supervisor was successfully created on NicksMax with the receipt:

- user: `SYSTEM`
- logon: `ServiceAccount`
- run level: `Highest`
- state: `Running`
- result: `0x00041301`
- receipt timestamp: 2026-09-28T14:08:09-04:00

The SYSTEM task was created as a recurring one-minute task so it does not depend on the
interactive `nourd` session. A non-admin query later returned Access Denied for that
SYSTEM-owned task; that must not be misreported as task absence.

The source installer/verifier are versioned at:

- `camera-bridge/scripts/nicksmax/register-camera-system-task.ps1`
- `camera-bridge/scripts/nicksmax/verify-camera-system-task.ps1`

A literal full-machine power-cycle/cold-reboot test is still a distinct proof and was not
performed during this cutover. SYSTEM scheduling and runtime self-heal were proven; do not
inflate that into a physical power-loss receipt.

## Security / external dependency boundary

Camera, Nick-ingest and StateNour keys remain DPAPI-protected on NicksMax. Secret values are
not committed.

The local V380 cloud decoder used during this cutover is an external lab/runtime dependency
whose current fork does not publish a software license. Its source is **not vendored** into
the monorepo. Prefer a licensed/native replacement when one is available.

## Power / resource posture

NicksMax remains configured as an AC appliance:

- AC sleep: never
- AC hibernate: never
- lid-close on AC: do nothing

Final closeout disk receipt was approximately 3.76 GB free after cleaning disposable build
artifacts. Keep evidence budgets intentionally small on this host.

## Legacy shop-PC lane

The historical shop-PC/WGC runbook remains a fallback and historical receipt. It is no longer
the primary `sign` authority. Never run the shop-PC/WGC `sign` producer concurrently with
the NicksMax production producer because `camera_runtime` is one row per camera and competing
writers can overwrite each other's health state.

# NicksMax camera authority — 2026-09-28

NicksMax is a lean Windows operations/recovery node **and the production edge host for Nick's
`sign` camera**.

Current camera truth:

- authority: NicksMax direct V380 cloud/P2P -> local RTSP
- source: `rtsp://127.0.0.1:8555/sign`
- calibration: `sha256:67f719cc875d`
- producer: `nicksmax-sign-rtsp-v1`
- latest closeout state: `HEALTHY`
- V380 desktop GUI is not required for the direct lane
- WGC producer tasks are retired/disabled
- supervisor requires decoded-frame proof before starting production and throttles starts
- SYSTEM supervisor receipt proved `SYSTEM / ServiceAccount / Highest / Running`
- a physical cold-reboot/power-loss proof is still separate and was not performed
- one real visit reached `CONFIRMED_ARRIVAL`; StateNour returned 200 and the shop mirror
  reports one delivered event with empty durable queues
- a NicksMax Railway/TiDB helper query did not observe the shop row; reconcile that read path
  before using it as canonical persistence evidence
- local V380 decoder is an unlicensed external runtime and is not vendored

Durable source/runbook:
`docs/operations/NICKSMAX-CAMERA-HOST-2026-09-28.md`.

NicksMax remains unsuitable for Docker/LLM/Frigate-heavy general compute. Camera edge is an
intentional exception because the measured OpenVINO/RTSP workload fits this host and removes
dependence on NattyNour/shop-PC GUI capture.

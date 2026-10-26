# Ranked upgrades for Nick's lanes (2026-10-26)

PR numbers are as of 2026-10-26; read the PR's state before trusting a status. Ranked by what it returns to Nour (cars counted right, conversations heard, minutes of his attention saved) per hour of work.
Status words: BUILT (merged), OPEN (PR open), READY (no protected step, build next), PARKED (needs Nour: a paste on a shop PC,
spend, a production write or a credential), REJECTED. Update the status here in the PR that changes it.

| # | Upgrade | Lane | Mechanism row | Status | Needs | Kill criterion |
|---|---|---|---|---|---|---|
| 1 | Page and show a worker stuck in one recording | office ears, Admin > Lot | Progress watchdog | OPEN: PR 3297 | nothing | No silence over 15 min in open hours without a page |
| 2 | Bound each capture so a hang cannot freeze the lane | office ears | Progress watchdog | OPEN: PR 3298, then PARKED for install | Nour's paste on the front-desk PC | `capture_hung` rows stay rare (under 1 a day) |
| 3 | ffmpeg RTSP `-timeout` on every office read, after checking `ffmpeg -h demuxer=rtsp` on the installed build | office ears | Reader timeout | PARKED | the build check runs on the front-desk PC (Nour's paste) | A hung read ends inside 15 s |
| 4 | Find why the portal counted 0 crossings on 10-24 and 10-25 while detections flowed, then judge the existing rules (edge portal in `camera-bridge/edge_main.py`, visitd dwell machine in `camera-bridge/README.md` section 8) against billed jobs before writing any new one; replay fixtures already exist in `camera-bridge/tests/fixtures/` | car counter | Count an arrival | READY (read-only diagnosis + a replay test) | the lot PC for any install | Arrivals within 20% of billed jobs over 7 complete ET days |
| 5 | Replace the launcher's 60 s stall kill with in-process reopen plus a 300 s exit (`--stall-reopen-attempts 40 --stall-exit-seconds 300`, proposed 10-22) | car counter | Supervisor | PARKED | Nour's paste on the lot PC | Distinct producer ids per day under 5 |
| 6 | One RTSP session per camera through a restreamer (MediaMTX is ADOPT-CANDIDATE; go2rtc has no verdict row and ships inside Frigate) | all cameras | Live view | PARKED | install on a shop PC | Each camera shows one session at the source |
| 7 | Silero VAD as the speech gate, replacing the 5 s / 15 s probe plus the whisper probe | office ears | Speech gate, Chunking | READY to bench offline on clips inside the 6 h retention; install PARKED (needs an UPSTREAMS verdict row first) | Nour's paste to install | Missed-speech under 10% on a labelled hour; CPU under 30% |
| 8 | One persistent whisper worker (whisper.cpp `whisper-server` or faster-whisper) instead of a process per clip | office ears | ASR worker | READY to bench offline; install PARKED (UPSTREAMS verdict row first for faster-whisper) | Nour's paste to install | Probe-to-text p95 under 2 s |
| 9 | Owner controls in Admin > Lot (lane on/off, quiet hours, gate sensitivity) read by the worker from the server instead of machine env vars | office ears, counter | Controls | READY server side; worker side PARKED | Nour's paste for the worker read | Owner changes a setting without a paste |
| 10 | Plate reading on arrivals | car counter | Plates | PARKED | a camera with plate detail on the entry, likely a purchase (price first) | Plates on 50% of daytime arrivals |
| 11 | Bay camera feed | bay | Live view | PARKED (memory: the bay V380 has no RTSP; a second relay on the lot PC needs Nour's device password typed by him) | his password | A bay visit row per billed job |
| 12 | Counter mic as a second ears source | counter mic | Speech gate | PARKED (no source configured; `counter-mic` has never posted) | hardware choice and a paste | Intelligible words at counter distance |
| - | Frigate as the whole stack on a dedicated Linux box | all | all rows | PARKED as the 10x option: one documented system for zones, tracking, LPR, review, go2rtc, audio events | a mini PC (spend) and Nour's go; UPSTREAMS pins 0.17.2 | Beats our counter's billed-job match within 2 weeks or is removed |
| - | Scrypted NVR, ZoneMinder, Viseron, CodeProject.AI, Agent DVR | - | - | REJECTED in `docs/UPSTREAMS.md` (2026-09-08) | - | - |
| - | Live diarization in the capture path | office ears | Diarization | REJECTED here: runs after capture only | - | - |

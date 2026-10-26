# Mechanisms the best stacks use, and our gap

Source: two Perplexity Pro research passes run in Chrome on 2026-10-26 (07:45 ET, 77 sources: camera stacks; 07:46 ET, 52
sources: audio capture and watchdogs), checked against `docs/UPSTREAMS.md` and this repo's lanes. VERIFIED = stated by the
official doc linked in the row. INFERRED = a design recommendation, not a product feature. Re-check a doc against the pinned
release before copying config: Frigate's GenAI and LPR config changed across releases.

## Counting and timing cars

| Job | Best mechanism | Doc | Our gap | Kill criterion |
|---|---|---|---|---|
| Count an arrival | INFERRED: track each vehicle, accept an ordered approach-zone then inside-lot transition (or a stable side change across a directed line segment through the bottom-centre of the box) as ONE entry per track, with reverse-motion and retrack guards. VERIFIED: Frigate zones test the bottom-centre of the box; its MQTT `frigate/events` carry the tracked id, boxes, `current_zones`, `entered_zones`; `entered_zones` is membership, not order, so keep the sequence yourself | https://docs.frigate.video/configuration/zones/ , https://docs.frigate.video/integrations/mqtt/ | The edge counts from a middle-lens crop of the sign camera with no written entry rule; 8 arrivals vs 33 billed (10-15..10-21), 0 vs 6 billed on 10-24 | Arrivals within 20% of billed jobs over 7 complete ET days, or the rule is wrong |
| Separate a pass-through from a visit | INFERRED: count the crossing first, then classify a visit by queue dwell or a check-in signal; never drop the entry because it failed the visit rule | Frigate zones `loitering_time` | `PASS_THROUGH` state exists; the rule behind it is not written down | Pass-through share stable week to week |
| Customer wait | INFERRED: name the metric. Lot dwell (entry to exit), arrival-to-bay (entry to bay zone), check-in-to-service (needs a staff or system signal). Publish arrival-to-bay as a camera proxy; call it customer wait only with a check-in and a service-start signal. A lost track is not a departure; an outage is not zero cars | Frigate review docs warn a stationary object stops keeping a review item alive | Waits are computed from visits whose rule is unwritten; no check-in signal | A wait shown without its start and end signal is withdrawn |
| Masks | VERIFIED: motion masks only steer where detection runs; object-filter masks drop a class whose box bottom-centre lands in the mask. Over-masking breaks tracking | https://docs.frigate.video/configuration/masks/ | Crop only, no per-class masks | Fewer false arrivals on the street lane with no drop in billed match |
| Plates | VERIFIED: Frigate LPR reads plates on the detect stream after a vehicle detection, refines across frames; needs 4 GB RAM and AVX2; a low-res substream can lack plate detail. A plate read is not an arrival; a repeat plate can be a real second visit | https://docs.frigate.video/configuration/license_plate_recognition/ | No plate read (`plateText` empty on every visit) | Plates on at least 50% of daytime arrivals before any customer join is built |
| Event descriptions | VERIFIED: Frigate GenAI sends several frames of a tracked object to a vision model for text; CPU-only local GenAI is discouraged | https://docs.frigate.video/configuration/genai/genai_objects/ | Office stills get a summary; lot visits get none | Owner reads them; drop if never opened in 2 weeks |

## Live view and controls

| Job | Best mechanism | Doc | Our gap | Kill criterion |
|---|---|---|---|---|
| Live view | VERIFIED: go2rtc restreams one camera connection to many viewers over MSE/WebRTC with audio; stream names match camera names | https://docs.frigate.video/configuration/go2rtc/ , https://docs.frigate.video/configuration/live/ | No live view in Admin; each reader opens its own RTSP session on cameras that serve few | One RTSP session per camera at the source |
| Owner dashboard | VERIFIED: Advanced Camera Card shows live, clips, review items and backend entities; the counter lives in the backend, never in the card | https://card.camera/ | Admin > Lot already is the dashboard; no clip or still per visit | Owner opens the Lot tab daily |
| Controls | INFERRED: the controls that matter are per-lane on/off, quiet hours, sensitivity (energy pre-gate, speech gate), retention, and "restart this lane"; each change audited | Frigate config reference | Every setting is a machine env var on a shop PC, changed only by a paste | Owner changes a setting without a paste |

## Office ears

| Job | Best mechanism | Doc | Our gap | Kill criterion |
|---|---|---|---|---|
| Speech gate | VERIFIED: an RMS energy gate is a pre-gate (Frigate `min_volume`); a learned VAD (Silero, 8/16 kHz, under 1 ms per 30 ms chunk on one thread per its repo) decides speech. whisper.cpp `whisper-stream` VAD is `vad_simple`, a relative-energy heuristic; whisper-cli has real Silero VAD via `--vad` and a model | https://github.com/snakers4/silero-vad , https://github.com/ggml-org/whisper.cpp , https://docs.frigate.video/configuration/audio_detectors/ | Probe every 30 s, energy AND peak thresholds, then a whisper run on the probe (speech gate since 10-22) | Missed-speech rate on a labelled hour under 10%, CPU under 30% on the front-desk PC |
| Chunking | INFERRED starting points: 16 kHz mono s16; pre-roll 300-500 ms; endpoint after 600-1000 ms of non-speech; split at 15-25 s with 300-500 ms overlap; one ASR worker; partials off; keep original time offsets and record reconnect gaps | faster-whisper README | Fixed 120 s window after a probe wake; the start of each conversation is lost to the 30 s probe gap | First words of a conversation present in the transcript |
| ASR worker | INFERRED: one persistent worker (faster-whisper INT8 on CPU, or whisper.cpp `whisper-server`), fed a bounded queue with a disk spool; capture never waits on ASR; utilisation ~= speech duty cycle x RTF | https://github.com/SYSTRAN/faster-whisper | A new whisper-cli process per clip and per probe (start-up cost each time; probe latency up to 7 s on 10-22) | Probe latency under 2 s at p95 |
| Diarization | VERIFIED: pyannote Community-1 runs on CPU but needs a Hugging Face token and model terms; diart is online but pins old deps. Both belong after capture, on finished clips | https://github.com/pyannote/pyannote-audio | `speakerCount` NULL (not attempted) | Only if the owner needs "who said it"; never in the capture path |

## Keeping lanes alive

| Job | Best mechanism | Doc | Our gap | Kill criterion |
|---|---|---|---|---|
| Reader timeout | VERIFIED: ffmpeg RTSP demuxer `-timeout <microseconds>` before `-i` is the socket I/O timeout; `-rw_timeout` is reported unreliable for RTSP; `-stimeout` is the legacy name; `-reconnect*` is HTTP only. Check the installed build with `ffmpeg -h demuxer=rtsp` | https://ffmpeg.org/ffmpeg-protocols.html | No read timeout on any office ffmpeg call; subprocess timeouts only | A hung read ends inside 15 s |
| Progress watchdog | VERIFIED pattern: a reader thread drains stdout and stamps `last_pcm_received` on a monotonic clock; a separate monitor kills and reaps the reader after a startup allowance (20-30 s) or a stall (10-15 s); quiet PCM is healthy; never check the deadline after a blocking read in the same thread; drain stderr | research 2026-10-26 (audio thread) | Heartbeat thread beside the work (the 10-22 hang). PR 3298 bounds each capture; PR 3297 pages a stuck one | No lane silent for over 15 min in open hours without a page |
| Supervisor | VERIFIED: WinSW restarts on nonzero exit with listed delays and a reset window (XML in the repo); NSSM restarts on exit by default and kills the process tree; Task Scheduler restart-on-failure needs Count and Interval and does nothing for a hang | https://github.com/winsw/winsw , https://nssm.cc/usage , https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-restartonfailure | Office runs as a scheduled task; the lot edge's launcher kills on a 60 s stall (20-73 restarts a day) | Restarts per day under 5 with no lost minutes |
| Acceptance tests | VERIFIED list (research): camera reboot, network loss, silence, quiet speech, TV or music, continuous talk, killed worker, disk full, PC restart and sleep, a long run for thermal throttling | research 2026-10-26 | None scripted | Each lane passes the list once before it is called LIVE+PROVEN |

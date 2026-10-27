# Baseline: shop-camera-best-in-class

recorded: 2026-10-26

Question: what fails when a shop camera or office-audio lane is designed or upgraded WITHOUT the mechanisms the best open-source stacks use?

## Tasks run without the skill

| task | what happened | evidence |
|---|---|---|
| T1: office conversation lane on the front-desk PC, built 2026-10-17 to 10-22 by agent sessions (recorded incident, one occurrence) | Liveness was a heartbeat thread beside the capture thread. One capture never returned on 10-22 17:51Z; the worker stayed CAPTURING, the probe loop skips while CAPTURING, and the lane heard nothing for four days while the heartbeat stayed fresh. The server's not-posting rule read a 4-day-old capture as a quiet office and paged nothing. Task Scheduler restart-on-failure was configured but never fires for a process that hangs instead of exiting. | prod SELECT 2026-10-26 11:32Z: camera_runtime.office state CAPTURING, lastConversationCaptureAt 2026-10-22 17:51:58Z, heartbeat seq 11470; PR 3297 and PR 3298 |
| T2: this session's own first fix for T1, written before any research (one fresh run, 2026-10-26) | Bounded the capture with asyncio.wait_for and abandoned the hung thread. It recovers the loop but leaves the hung ffmpeg holding its RTSP session (the camera serves few sessions) and adds no read timeout to ffmpeg itself; the research pass then named the layer it missed: ffmpeg's RTSP -timeout in microseconds before -i, plus a PCM-progress watchdog that kills and reaps the reader. | PR 3298 diff; Perplexity thread 2026-10-26 07:46 ET (52 sources) |
| T3: sign-camera car counter on the lot PC, 2026-10-15 to 10-25 (recorded incident, a rate) | The launcher kills the edge on a 60 s stall (20 to 73 restarts a day; 23 to 25 producer ids a day on 10-24 and 10-25) while the counter reported 8 arrivals against 33 billed jobs over 10-15..10-21 and 0 arrivals on 10-24 and 10-25 against 6 billed on 10-24. Counting rides one middle-lens crop with no ordered-zone or directed-line rule written down, so nobody could say which rule misses cars. | prod SELECT 2026-10-26: camera_health_events producers per ET day, vehicle_visits vs invoices per ET day; memory shop-eyes-ears-2026-10-21 |

## Failure shape

Without a written reference, each lane was built from scratch and each missed a mechanism the mature stacks treat as basic:
liveness measured by real media progress rather than a sibling heartbeat, a reader timeout inside ffmpeg, a supervisor that
restarts a hung process rather than only an exited one, and a counting rule (ordered zones or a directed line on tracked
objects) stated before the counter is judged. The skill must make the designer read the mechanism table, pick the matching
mechanism and its kill criterion, and record what was benchmarked, before writing lane code.

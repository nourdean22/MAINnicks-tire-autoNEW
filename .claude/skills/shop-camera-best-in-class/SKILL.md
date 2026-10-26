---
name: shop-camera-best-in-class
description: "Use when designing, upgrading or judging a shop camera or office-audio lane: the car counter, customer wait time, the office ears (capture, speech gate, transcription), live view, plates, owner controls or watchdogs, or when Nour asks what the best camera or audio setup out there is, to reverse engineer one, or which features and controls are still missing. Gives the mechanisms the best open-source stacks use (Frigate, go2rtc, Silero VAD, faster-whisper, whisper.cpp, WinSW), the matching gap in our lanes, and a kill criterion for each upgrade. Not for: adding or swapping one camera (camera-onboard-rtsp), a lane that is down or reads zero right now (systematic-debugging, production-health-report), running commands on a shop PC (shop-pc-remote-session), or a library adoption verdict (docs/UPSTREAMS.md, find-skill)."
---

# Shop cameras and ears: copy the mechanism, not the product

Answer first: before writing code for any camera or audio lane, find the row in
[references/mechanisms.md](references/mechanisms.md) for what you are building, take its mechanism and its kill criterion, and
check [references/upgrade-list.md](references/upgrade-list.md) for whether it is already ranked, built or parked. Then build the
smallest version that carries the mechanism, and end the PR body with a `Benchmarked against:` line naming the row.

Why: three lanes were built from scratch and each missed a basic the mature stacks have (`evals/baseline.md`). The office worker
hung for four days behind a fresh heartbeat (2026-10-22 to 10-26); the counter restarts 20 to 73 times a day and counts with no
written rule; the first fix for the hang left ffmpeg without its own read timeout.

## Procedure

1. **Name the lane and the job.** Lanes: office ears (front-desk PC), sign camera and car counter (lot PC), bay camera, counter
   mic, Admin > Lot (server and client). Job: count, time, hear, see, control, or keep alive.
2. **Read the row.** Each row in `mechanisms.md` gives what the best stack does, its doc link, our gap, and the kill criterion.
   Facts from the research are marked VERIFIED with a source; designs are marked INFERRED. Do not upgrade an INFERRED design to a
   fact in a PR body.
3. **Check the verdict.** `docs/UPSTREAMS.md` rules on adopting a product (Frigate is ADOPT-CANDIDATE pinned 0.17.2; Scrypted
   NVR, ZoneMinder, Viseron, CodeProject.AI, Agent DVR are REJECT; MediaMTX is ADOPT-CANDIDATE). This skill copies mechanisms
   into our code; adopting a product is that register's call and needs Nour's go when it costs money or touches a shop PC.
4. **Keep the hard rules.** Raw audio is never kept (crew consent exists at hiring; do not widen retention). Nothing
   customer-facing. No shop-PC change except through Nour's paste (`shop-pc-remote-session`). No production write without his go.
   No hardware purchase without the price in the ask.
5. **Build the smallest carrier** of the mechanism, with a test that breaks it first (`positive-control-first`), and judge the
   car counter only against billed jobs over complete ET days (a counter invoice is a closed job).
6. **State the kill criterion** from the row in the PR body, with the date it will be read.

## Liveness, the rule behind every lane

A lane is alive only when its real output moves: PCM bytes for audio, decoded frames for video, posted episodes or visits for
the server. A heartbeat thread beside the work proves the process exists, nothing more. Every lane needs three layers
(VERIFIED, research 2026-10-26): a reader timeout inside ffmpeg (`-timeout` in microseconds before `-i` for RTSP; `-rw_timeout`
is unreliable for RTSP, `-reconnect` is HTTP only), a progress watchdog that kills and reaps a stalled reader, and a supervisor
that restarts a process that exits nonzero. Task Scheduler restart-on-failure does not fire for a process that hangs.

## Never

- Count arrivals from zone occupancy or from "entered both zones": that is membership, not an ordered crossing.
- Use a review-item or alarm duration as a customer's wait: a parked car stops producing motion.
- Put diarization, GenAI descriptions or plate reading in the capture path; they run after capture, on finished clips.
- Read a quiet lane as a healthy one without its progress counter (`empty-vs-error`).

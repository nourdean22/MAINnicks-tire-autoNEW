# Lot vision v2: the car counter, rebuilt without NicksMax (design, 2026-10-26)

Status: APPROVED by Nour 2026-10-26 15:04Z, verbatim: "Yes to design Z and to keeping the V380Decoder-class relay as an
accepted risk. Start phase 2". Phase 2 (the silent-zero page, the cloud host, the dormant standby) rides in the same PR as
this design; the named dark window on Admin > Lot is not built yet. Nothing is installed or bought. Job 2026-10-26-lot-vision-v2.
Re-planned 2026-10-26 after Nour's ruling: zero hardware spend, use what the shop owns, run it over the cloud,
nothing manual for him. Labels: FACT (read in code, docs or production today), STRONG INFERENCE, INFERRED,
NOT CHECKED. Perplexity lines are CLAIM until their primary page is read; the ones used here were read.

## 1. The answer

1. **Recommended: the front-desk PC counts, the cloud stands by.** The counter runs on the front-desk PC MECHANICS
   (always on, 7 days, already running the office lane as a SYSTEM task). A dormant copy waits in Railway and takes
   over by itself if the PC goes quiet for 90 seconds. NicksMax is never needed.
2. **Why it can run anywhere:** the sign camera's video reaches the counter from the V380 *cloud*, not from the shop
   network. Today a .NET relay on NicksMax logs in to the V380 cloud and serves the stream as RTSP on `:8554/live`
   (FACT: `scripts/nicksmax/nicksmax-camera-supervisor.ps1:841-868`, `run-sign-crop.ps1:64`). So any host with
   internet can read it, including the front-desk PC and a Railway container.
3. **The failover lease is already built.** The server ranks producers p1 > p2 > p3 and hands the camera to a lower
   one after 90 s of silence (FACT: `apps/nickstire/server/routes/cameraProducerAuthority.ts`); `edge_main.py` already
   runs as a standby and is promoted by that lease (FACT: `edge_main.py:57-59`, `957-1018`).
4. **Cost:** $0 hardware. The dormant cloud copy costs roughly $1 to $3 a month while idle and about $10 to $30 a
   month only while it is actually counting (INFERRED from Railway's published rates, section 6).
5. **Your hands, honestly:** "nothing" is not reachable. Three things stay yours by house rule:
   - type the V380 password once for the new hosts (the old secret is locked to NicksMax by Windows DPAPI, FACT:
     `nicksmax-camera-supervisor.ps1:52`; agents never type or store a password);
   - say yes to running the relay below, because it overrules a house rejection (section 2);
   - name the front-desk install in your own words ("install the lot counter on the front-desk PC"), then either an
     agent drives it over Chrome Remote Desktop, or you paste one hash-pinned block into the Claude app on that PC
     (skill `shop-pc-remote-session`: a change on a shop PC needs your words naming it, and the Claude app there is
     driven by you, not by another session).
   Everything else is agents: code by PR, the Railway service from the repo, receipts read from production.

## 2. Two things you must know first

1. **The relay is a reverse-engineered open-source bridge, not a vendor program (STRONG INFERENCE).** Its defaults
   match V380Decoder exactly: .NET, RTSP `:8554/live`, web/API `:8080`, cloud login with device id and password
   (https://github.com/PyanSofyan/V380Decoder and its three-lens fork https://github.com/felipemarques/camera-v380decoder,
   READMEs read 2026-10-26). ADR-0022 calls it "the vendor's own relay"; `docs/UPSTREAMS.md` rejected exactly these
   bridges for production on 2026-09-08 (reverse-engineered keys, no licence file). Production has depended on it
   since 2026-09-28. Risks: the vendor can change its protocol and break it overnight; neither repo shows a licence,
   so we run it as-is for our own camera and never copy its code into this public repo. Confirming which build runs
   needs one look at NicksMax's relay folder (NOT CHECKED).
   Two house rules say no to it: the `docs/UPSTREAMS.md` row "V380 protocol bridges" (REJECT for production) and the
   stop line in skill `camera-onboard-rtsp` ("no cloud-relay bridges, no protocol bridges for closed camera apps").
   Design Z therefore needs your explicit yes, recorded in the build PR, which also changes that UPSTREAMS row to
   "accepted risk, own camera and account, 2026-10-26" and corrects ADR-0022. Without that yes, zero spend leaves no
   way to count from this camera: the SD-card unlock (alternative L) is blocked by the same skill, and design A costs
   money.
2. **The solar camera is asleep for part of every open day.** It is dark from civil dusk until about 2 hours after
   sunrise (FACT: `server/lib/solar.ts`); the shop opens at 8 AM (FACT: `shared/business.ts`). Roughly 8 to 10 AM is
   uncounted every day, and the last open hour in winter. Cars already there at open are estimated at first light.
   Admin > Lot will say "camera asleep until about 10:05", never 0. No software fixes this; only power to the camera
   does (section 11).

A likely cause of the 3-day zero, for the record (INFERRED, testable): the three-lens fork's README warns that these
cameras deliver clean, decodable frames only at the camera's keyframe cadence. At 4 fps with frozen or repeated
frames (DEGRADED "frozen or looping" about 40 times a day, FACT `camera_health_events`), a car may never form a track
on both sides of the portal line. The acceptance audit in section 8 tests exactly this before anything is called LIVE.

## 3. Designs that differ in kind

| | Z. Cloud bridge, shop PC primary, cloud standby (RECOMMENDED) | L. Local RTSP unlock, no bridge | A. Buy a wired camera and a box |
|---|---|---|---|
| How the video is read | V380Decoder-class relay logging in to the V380 cloud | the camera's own RTSP on the shop network after the `ceshi.ini` SD-card unlock | a PoE camera's own RTSP |
| Hardware spend | $0 | $0 (an SD card the shop owns) | about $500 to $1,340, typically about $750 |
| Manual steps | the V380 password once | someone opens the camera, inserts and later removes the card, three cold reboots | mounting, cabling |
| Depends on | the vendor cloud and a reverse-engineered bridge | an unverified firmware trick: no report for firmware `Hw_HsAKQQXG_WIFI_20230421`; three-lens owners report 554 staying closed; can reset the camera; RTSP may be unauthenticated (gist https://gist.github.com/SolveSoul/9be5d9599c8b4b59f7cfa4cd0ce79c9c, read via research) | nothing closed |
| Dark mornings | yes | yes | no |
| Verdict | build | park: house skill `camera-onboard-rtsp` forbids running unlock tools, and it needs hands at the shop | your spend call, kept as the fallback |

Within Z, the cloud-first variant (Railway primary, shop PC standby) is the same code with the priorities swapped. It
survives a shop PC crash with no 90 s gap but costs about $10 to $30 a month all the time instead of only during a
failover. Rejected for now because you said no new spend; one config line flips it later.

Also rejected: Frigate on the front-desk PC (Frigate does not officially support Windows; a WSL2 VM on a staff PC,
https://docs.frigate.video/frigate/installation/, read via research), and any change that depends on NicksMax.

**The 10x option, one line:** the counter is a cloud-managed service with two hosts and a lease the server already
enforces, so no single machine can silence it, and the server compares the day's count with billed invoices so a
silent zero pages the same day.

## 4. Design Z in detail

### 4.1 One package, two hosts
1. A pinned build of the relay (source pinned by commit, built in CI or on the host, never vendored into this public
   repo) -> FFmpeg crop of the side-lot lens to 640x360 at 4 fps (today's command, `run-sign-crop.ps1:66`) ->
   MediaMTX -> `edge_main.py --source rtsp`. Same parts as NicksMax, minus the PowerShell supervisor loop.
2. **Front-desk PC (primary, `p1-shop-sign-*`):** installed, once you name it, like the office lane
   (`scripts/install-office-capture.ps1` pattern): SYSTEM scheduled tasks at below-normal priority; relay and counter
   as separate tasks so each restarts alone; a watchdog that restarts on stale decoded frames, not only on exit.
   The office lane is untouched.
3. **Railway (standby, `p3-cloud-*`):** one container from a Dockerfile like `camera-bridge/visitd.Dockerfile`.
   Dormant: it sends a heartbeat every 30 s and does not open the camera until the heartbeat reply says
   `authoritative` (the field exists, `server/routes/cameraVisitsRoutes.ts` around line 777). Then it starts the
   relay and counts until the PC is back and reclaims the lease.
4. **One camera session at a time.** Whether the V380 cloud serves two sessions to one device is UNKNOWN, so the
   standby never opens the stream while the primary holds the lease.
5. **Calibration** re-made from a fresh still with `vision/scenelocator.py` and committed without addresses or
   secrets, so it no longer lives on one PC (today it exists only on NicksMax, FACT: not in git).
6. **Recording for re-count:** the primary writes the cropped stream as 10-minute segments, 3 days, to its own disk
   (INFERRED about 1 to 2 GB a day of daylight at this resolution). The cloud copy records only while it is counting
   (Railway's Hobby volume limit is 5 GB, https://docs.railway.com/pricing/plans, read via research).

### 4.2 Code changes
1. `edge_main.py`: a `cloud` host at p3, and a dormant mode (heartbeat only, stream closed until authoritative).
2. A frame-progress watchdog for the relay and counter tasks (stale decoded frames -> restart), replacing the
   NicksMax launcher's 60 s stall kill that churned 23 to 25 producer ids a day.
3. Server: **the missing page**: frames flowing and 0 arrivals for 2 awake hours, or still 0 at noon ET while invoices
   exist (the exact 10-24 and 10-25 failure). Admin > Lot names the dark window.
4. A re-count job (section 5.1). No schema change: `vehicle_visits` already has `sourceGeneration`, `dataClass`,
   `detectorName`, `calibrationVersion` (FACT, `drizzle/schema.ts:4724`).

## 5. When things break

| Off or broken | What happens |
|---|---|
| NicksMax | nothing; it is not used |
| Front-desk PC | after 90 s of silence the cloud copy takes the lease and counts; INFERRED: no PRODUCER_OFFLINE page, because the row turns over before its 120 s offline threshold (`server/lib/cameraHealth.ts:68`); the planted test in section 8 proves or refutes this |
| Railway | nothing while the PC counts; the standby's own heartbeat ages out and Admin > Lot shows "standby offline" |
| The V380 cloud, the camera or the shop's internet | both hosts lose frames together (the camera reaches the V380 cloud over the shop's wifi); daylight CAMERA_OFFLINE pages; night reads as asleep; no video exists to re-count |
| Frames flow but nothing is counted | the new page fires within 2 awake hours |

### 5.1 Re-counting a gap
1. A gap is a window where no visits posted while the camera was awake.
2. A one-shot job publishes that window's segments as a stream through MediaMTX and runs the same `edge_main.py`
   over it, posting visits with `sourceGeneration = recount`; only windows with no live visits, so nothing doubles.
3. Admin > Lot labels re-counted windows.

### 5.2 Ground truth without staff work
Before LIVE and then once a week, a person counts one busy hour of retained video at 4x (about 15 minutes). That
hour and the day's billed invoices are what the counter is judged against.

## 6. What it costs

| Item | Cost |
|---|---|
| Hardware | $0 |
| Railway standby, idle (heartbeat only) | INFERRED about $1 to $3 a month (Railway lists $20 per vCPU-month, $10 per GB RAM-month, $0.15 per GB-month of volume; a sleeping Python process uses a sliver of each) |
| Railway while counting (failover only) | INFERRED $10 to $30 a month pro rata (Perplexity sizing, 0.25 to 1 vCPU and 0.5 to 1.25 GB) |
| Front-desk PC | electricity it already uses; CPU share NOT CHECKED until the acceptance run |

A new Railway service is a deploy-config change: it needs your go (`AGENTS.md` protected operations). Whether the
account's included usage covers it is NOT CHECKED.

## 7. Phase plan

| Phase | What lands | Needs |
|---|---|---|
| 1 | This design | your yes, and your yes to running the reverse-engineered relay |
| 2 | Server: the silent-zero page and the named dark window. Edge: the cloud host, the dormant standby, the frame-progress watchdog. Tests, red first | nothing (PR) |
| 3 | The relay pinned: confirm which build NicksMax ran (one look at its folder if you switch it on for 30 minutes; otherwise pin the three-lens fork by commit). It is proven on the live stream in phase 4 | your call on NicksMax |
| 4 | Front-desk PC install (agent over Chrome Remote Desktop, or your paste of one hash-pinned block into the Claude app there), new calibration, first arrivals on Admin > Lot | your words naming the install, and the V380 password typed by you |
| 5 | Railway standby service from the repo; planted failover test (stop the PC task, watch the cloud take over) | your go on the service |
| 6 | Acceptance audit and 7-day judgement; then NicksMax's sign lane is archived | 7 complete ET days |

## 8. Kill criteria

1. **The count is real:** a hand-labelled audit of at least 100 entrance passages in awake hours (cars, pickups,
   vans; stops on the line, reversing, tailgating) finds at least 90% of entries and no more than 5% false entries,
   and over 7 complete ET days awake-hour arrivals are at least 80% of billed invoices opened after the camera woke
   (INFERRED proxy). Fail after one calibration fix: stop and put design A to you with its price. The research
   suggests 98% as a target for a good camera (CLAIM); 90% is set for this one.
2. **No silent zero:** zero awake hours with frames flowing and 0 arrivals that did not page.
3. **Stable:** at most 3 producer ids a day across both hosts (today 23 to 25 on NicksMax alone).
4. **Failover is real:** stopping the PC task hands the lease to the cloud copy and counting resumes within 5 minutes,
   and the PC reclaims it on return, in a planted test before LIVE.
5. **The relay:** if the pinned build cannot hold a stream for a full awake day on either host, Z stops and the
   choice between L and A goes to you.

## 9. If you ever spend: design A

One wired PoE starlight camera on the entrance, one N150 mini PC running Frigate 0.17.2 + `visitd` (built, never
run), a PoE switch and a UPS; 7 days of recordings; no dark mornings and no reverse-engineered bridge. Parts about
$500 to $1,340, typically about $750 (camera $130 to $300, N150 box $180 to $260, PoE switch $50 to $110, UPS $90 to
$150, microSD about $20, Cat6 $30 self-run or $150 to $500 installed). The 2026-09-08 master plan priced fuller builds
at $825 to $2,630 (section 17). A camera with Axis-class on-board crossline counting adds a second witness later.

## 10. Benchmarked against

Benchmarked against: V380Decoder (https://github.com/PyanSofyan/V380Decoder) and camera-v380decoder
(https://github.com/felipemarques/camera-v380decoder), READMEs read 2026-10-26 · adopted: cloud mode, one upstream
session fanned out locally, Docker on Linux for the standby · rejected: vendoring their code (no licence file) ·
Frigate 0.17 (https://docs.frigate.video/configuration/record/, /integrations/mqtt/, read 2026-10-26) · adopted:
rolling retention with oldest-first cleanup, time-range re-count, an availability signal the broker flips on a crash
(our heartbeat lease is the same idea) · rejected: Frigate itself on a staff Windows PC · Roboflow Supervision
LineZone + ByteTrack (MIT; research: ByteTrack moves to `trackers` from 0.28) · rejected for now: our portal counter
already exists and is judged first; Supervision is the swap if kill criterion 1 fails on tracking, not on the camera ·
WinSW and NSSM (research) · adopted: restart on stale frames, not only on exit · the office lane on MECHANICS
(`docs/adr/0022-camera-vision-as-built.md`, update 2026-10-18) · adopted: SYSTEM task install, heartbeat as liveness,
hash-pinned agent install. Research: Perplexity Pro thread b3bbfa8a (2026-10-26, 51 sources). In-repo verdicts
re-read: `docs/UPSTREAMS.md` rows for V380 bridges, Frigate, MediaMTX, OpenVINO, Scrypted and others. Council lenses
used: Architect, Skeptic, Operator, Sentinel (agentic-council, 2026-10-26).

## 11. Open, and adjacent

1. Which relay build NicksMax ran (NOT CHECKED; one look at `C:\Users\nourd\NicksMax\lab\v380-cloud-relay`).
2. Whether the V380 cloud allows two sessions per device (UNKNOWN; the design avoids needing it).
3. Railway's real bill for an idle and a counting standby (NOT CHECKED).
4. Whether the sign camera has a USB power input: a cable to an outlet would end the dark mornings (a hands-on step).
5. Adjacent rot: ADR-0022 decision 1 and `docs/UPSTREAMS.md` disagree about this relay; the build PR fixes both in
   words once phase 3 confirms the build.

Not decided here: plate reading; the bay V380 (needs its own relay session and device password); the office audio
lane (separate and working; nothing in the lot lane records audio).

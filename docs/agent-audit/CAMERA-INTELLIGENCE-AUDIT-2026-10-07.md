# Camera Intelligence -- Current-System Audit (2026-10-07)

**Verdict in one sentence:** the architecture is right and most of the two pasted reports describe it
accurately, but the production vehicle lane has been reporting roughly one tenth of the arrivals it reported
before the 2026-09-28 NicksMax cutover while every health surface said HEALTHY, the Office lane is listening
about 8% of the business day, and the sensor box is out of disk and CPU -- so the next work is integrity and
load, not features.

Operator-facing summary: [`#1 Answer first`](#1-answer-first). Implementation plan with files:
[`#13 What I will implement`](#13-what-i-will-implement). Everything else is evidence.

Evidence classes used below: VERIFIED (I read the line or the live value), MEASURED (production data read
this session), STRONG INFERENCE, CLAIM (a doc or ledger says so), UNKNOWN.

---

## 0. Evidence baseline

| Item | Value | Class |
|---|---|---|
| `origin/main` at audit start / end | `560386df` (13:26 ET) / `ba7b308f` (17:41Z, prerender refresh only) | VERIFIED |
| Production nickstire deploy | commit `560386df`, deployment `87a77a09`, `/api/health` healthy at 17:43:41Z | VERIFIED |
| Camera PR chain, all merged Oct 2-3 | #2896 -> #2898 -> #2899 -> #2900 -> #2901 -> #2902 -> #2903 -> #2904 -> #2909; nothing camera-related merged after #2909 (10:08 ET Oct 3); #2916-#2918 touched only the web-experiment ledger entry | VERIFIED |
| Open PRs | #2915 (dependabot), #2882 (statenour Perplexity draft). No open camera PR. | VERIFIED |
| Live NicksMax probes | 13:53-14:10 ET Oct 7, read-only, via Desktop Commander at **Medium integrity** (not elevated) | VERIFIED |
| Production data read | Railway deploy + HTTP logs (nickstire, statenour-web); Neon `device_events` (StateNour vehicle lane); public `shopStatus.getState` | MEASURED |
| Not reachable this session | TiDB `vehicle_visits` / `conversation_episodes` / `camera_runtime` rows (admin-only); the machine-local launchers and `calib-nicksmax-sign-rtsp.json`; an elevated task query | UNKNOWN |

Six parallel read-only code audits (vehicle pipeline, visitd/outbox, Lot UI + health, Office audio/visual,
supervisor + doc drift, service-truth joins) were run against `ba7b308f`; their file:line findings are folded
in below. Skills applied: `answer-first`, `plan-gate` (the always-on meta-skills named in
`CLAUDE-OPERATING-PROFILE.md` are machine-local and absent in this cloud session).

---

## 1. Answer first

1. **Both pasted reports are directionally right about the architecture and wrong about the state of the
   data.** They inspected code and docs; the production evidence says the system is currently producing
   untrustworthy vehicle counts and almost no Office coverage. Accuracy tables: [#2](#2-accuracy-check-of-the-two-pasted-reports).
2. **Vehicle truth regressed at the Sep 28 cutover and nobody could see it.** Pre-cutover (Sep 17-27, old
   capture lane): 255 visits, 254 in business hours. Post-cutover (Sep 28-Oct 7, NicksMax RTSP lane): 92
   visits, **38 in business hours, 54 while the shop was closed**. Monday Oct 5: sign HEALTHY 08:04-17:46 ET
   with two sub-2-minute blips, **zero** visit updates in either lane from open until 16:30. ([#4.1](#41-the-vehicle-lane-is-blind-while-healthy))
3. **The "new visit requires entry evidence" invariant is violated in production.** One track (`sign-188`)
   minted **35 LEFT visits between 23:41 and 07:27** on a closed-shop night (dwell 0-730 s, confidence
   0.99), and the nickstire lane applied >=200 updates for it. Those are "Arrivals today" on the Lot page
   before the shop opened. ([#4.2](#42-phantom-arrivals-from-zone-flicker))
4. **The Office lane hears ~8% of the day.** The Oct 3 switch to `large-v3-turbo` makes each 120 s capture
   take 226-600 s to transcribe (two 600 s timeouts), the worker is serial, the fallback wake fires on
   essentially every probe, and the supervisor killed the worker mid-transcription 7 times in 4 days for a
   stale heartbeat. The worker card says READY, failures 0. ([#4.3](#43-office-listening-coverage))
5. **The supervisor's restart primitive orphans children.** That single defect explains the Eufy-bridge
   restart storm (24-28 restarts/hour for 46 hours, `EADDRINUSE 127.0.0.1:3000`), the **two** Eufy agents on
   `:3601` since Oct 5 16:52, and the two interleaved `office` heartbeat owners in Railway, both
   `authoritative=true`. ([#4.4](#44-supervisor-orphans-and-duplicate-producers))
6. **NicksMax is out of resources.** 113 MB free of 40 GB, CPU load 100% on a 2-core i5-5350U, 2.0 GB RAM
   free of 8, and the production sensor host is also running ChatGPT desktop (743 MB), Claude desktop (~780
   MB), Codex CUA and a V380 desktop client burning ~36% of a core. ([#4.5](#45-nicksmax-resources))
7. **Alerts are noisy by construction.** Every midnight ET the owner is paged "Office PTZ degraded"
   (permanent `UNVERIFIED_CAPABILITIES` because control is intentionally disabled) and "Shop sign recovered"
   (day-key reset), while a camera that fails, recovers and fails again inside one day is silent.
8. **What is genuinely good and must not be rebuilt:** the vehicle_truth / interaction_ptz authority split,
   the FrameHealth -> SceneLock -> DetectorCouncil -> TrackGraph -> PreexistingCensus -> EntryPortal gate
   chain, the seq-guarded `vehicle_visits` upsert with the scrubbed-plate guard, the role-aware health
   lattice, transcript-cited facts with uncitable camera context, the 0-vs-null person count, and the
   solar login-refusal throttle. All verified at file:line in [#5](#5-architecture-as-verified)-[#9](#9-service-truth-and-prior-art).
9. **Plan-gate result on the two reports' recommendations:** roughly 35% already built, 15% refuted by the
   code or the data, 50% genuinely new. The new half is almost entirely integrity, coverage and operator
   truth -- not new AI. ([#11](#11-plan-gate-split))

---

## 2. Accuracy check of the two pasted reports

### 2.1 Report A ("Nick's Camera Intelligence Audit", code + docs, no live access)

| Claim | Verdict | Evidence |
|---|---|---|
| Main SHA `560386df`, PR chain ends at #2909 | TRUE at the time | git log; nothing camera-related merged since |
| Signal path sign -> V380 cloud -> relay :8554 -> crop -> MediaMTX :8555 -> OpenVINO edge :9095 | TRUE for the hops the repo can see; crop geometry / fps / model are doc CLAIMs | `nicksmax-camera-supervisor.ps1:276,299,308,326`; live `netstat`: 8554/8080 (dotnet relay pid 19256), 8555 (mediamtx 51772), 9095 (python 20352). Launchers live in `C:\Users\nourd\NicksMax\lab\...`, not in git |
| FrameHealth / SceneLock / census / portal invariants "structurally enforced" | TRUE in code, **violated in production for long-lived tracks** | `vision/pipeline.py:252-293, 333-343, 374-409`; but visitd reopens a visit for a track that re-enters the arrival zone without a new portal crossing -- see [#4.2](#42-phantom-arrivals-from-zone-flicker) |
| "Detector skip is not an empty lot; tracks held" | TRUE | `pipeline.py:321-326` |
| EpisodeStitcher is shadow-only; `arrivals` vs `arrivals_after_stitch` | TRUE, incomplete | The carried `arrived_at` never reaches the shop row (`pipeline.py:414-420` in-memory only; shop `arrivedAt` = new track `born_ts`, `shop_mirror.py:249-252`); the stitcher cannot recover the common parked-car split (adopt only on a portal crossing) |
| "No vehicle fingerprints, appearance stitching inactive" | TRUE | `compare_fn` never set (`pipeline.py:130,171`); `AppearanceBank`/`ReidEmbedder` have no non-test constructors |
| visitd is "a pure consumer" | PARTIAL | visitd has its own dwell timers, split/plate/topology joins and drops zones not in config (`visitd/state_machine.py:546-574, 683`) |
| Persistence "DEPLOYED BUT UNPROVEN"; equal-seq retry could restore scrubbed plates | Over-cautious for nickstire, under-cautious for StateNour | nickstire: per-column `IF(VALUES(seq) >= seq, ...)` upsert, `UNIQUE visitId`, `plateText` guarded by `plateStatus='SCRUBBED'` (`cameraVisitsRoutes.ts:207-220`, `drizzle/0119:91`). StateNour: no unique key, `findFirst` then `create` after the alert awaits (`vehicle-detection.ts:153-166, 300-337`) -- MEASURED 3 duplicate `visitId` rows and 4 non-terminal rows older than a day |
| "Cold boot: neither safe to repeat" | Fair; now two receipts exist | Oct 2 09:15 reboot (docs) and **Oct 3 13:56:58** boot (`Win32_OperatingSystem`); supervisor log shows the full chain back by 13:58:52 under SYSTEM. Railway-side confirmation of the Oct 3 boot not fetched |
| Office visual watch LIVE+VERIFIED; person count LIVE | TRUE and still live | Railway `office visual stored` DONE on every framed episode Oct 3-6, `onBoxPeople` 0-2 |
| Right/Wrong loop deployed, consumption unproven | TRUE, with a new fact | 5 `lot.reviewConversationVisual` POSTs (200) from an iPhone 2026-10-02 23:38:34-23:39:21Z -- reviews **were** collected; nothing records which reviews a later vision call used, so the loop is still unprovable |
| "15 episodes, 0 facts" as the current state | STALE | Oct 5-6 episodes extracted 1-4 facts when transcripts were coherent (`conversation extracted ... facts 4 coverage 0.874`); the binding constraint is now latency/coverage |
| "Bay 1/3 service, 2 tire machines, 4 stock" | Operator statement, not calibration | `routers/lot.ts:122-126`; polygons are in machine-local `data/calib-nicksmax-sign-rtsp.json`; `config.example.yaml:52` has `bayZones: []`; no bay zone name appears in any StateNour event (`zoneDwell` only ever has `bay_entrance`) -- whether production ever sets `bayEnteredAt` is UNKNOWN |
| "Visit-to-ticket one-tap link" as #1 move | REFUTED as stated | There is no live ticket to link to: ALG is read at 3 AM / 8 PM only (every read logs Moe out), walk-ins do not use nickstire work orders, and `workOrders.advanceStatus` / `booking.updateStage` text the customer. The join columns exist with no writer (`conversation_episodes.vehicleVisitId/workOrderId`, `schema.ts:5017-5019`). The right shape is an operator **mark on the visit** ([#13 N1](#13-what-i-will-implement)) |
| "Add coverage %, solar states, attention reasons" | Genuinely new | No implementation exists; `lot.ts:99-121` already names the service-start gap |
| "Fleet aggregation shows UNKNOWN at parent" | Already built | `shared/cameraFleetHealth.ts:52-55` |
| Frigate / Scrypted / NVR / face / emotion: SKIP | Consistent with the register | `docs/UPSTREAMS.md:50,69`; Frigate is ADOPT-CANDIDATE-never-run, not the production path |
| Ohio one-party consent paragraph | Not verified here | Keep as "counsel review" |

### 2.2 Report B ("Current-System Research Report", with a live NicksMax read)

| Claim | Verdict | Evidence |
|---|---|---|
| `C:` free ~0.10 GB | TRUE | `wmic logicaldisk`: 113,037,312 free of 43,121,635,328 bytes at 13:53 ET; supervisor `WARN disk free below 2 GB: 0.10 GB` every ~30 s |
| Listeners 1984/3000/3601/8080/8554/8555/8654/8655/9095 | TRUE, incomplete | `:3601` has **two** listeners (python 9768 and 32744) |
| Eufy bridge ~24 restarts/hour, task Ready, last result 1 | TRUE; root cause found | `bridge.stderr.log`: `listen EADDRINUSE 127.0.0.1:3000`; node 20928 (started 00:52:49 ET Oct 7, parent gone) owns the port; `Kick-Task` stops the wrapper task, not the child (`supervisor.ps1:158-167`); storm since Oct 5 16:07 ET, ESCALATE every hour since |
| "Task-authority drift: supervisor and office tasks absent" | REFUTED as drift | The inspecting shell is Medium integrity (`whoami /groups`), so SYSTEM-registered tasks are invisible to it. The SYSTEM supervisor restarted the office task by name at 04:15:45 today with no `start FAILED`, and the worker's python chain started 04:15:45. Real residual: repo scripts register/verify `NicksMaxCameraSupervisor` while the live task is `NicksMaxCameraSupervisorSystem` (`register-camera-system-task.ps1:2,10` vs `supervisor.ps1:2-3`) |
| Sign `EXIT rc=3` / START cycles | TRUE | ESCALATE `sign-edge restarted 7-10 times in an hour` Oct 3 19:37, 21:19; Oct 4 00:04, 01:06, 02:07 |
| Fallback wake needs mean + peak | TRUE, misses the consequence | Thresholds -50 / -34 dBFS; measured probes -30..-47 / -6..-29 -> the fallback fires on essentially every probe; zero semantic (`motion`/`personDetected`) wakes in the last 110 receipts |
| "Whisper quality is the weakest component" | PARTIAL | Since the Oct 3 10:12 switch to `ggml-large-v3-turbo-q5_0` (`WhisperCpp/switch-to-turbo.log`) the binding constraint is latency: 226-600 s per 120 s capture, two 600 s timeouts |
| Stills <=640 px, ~30 s cadence, not retained | TRUE | `officeframes.py:26, 99-126` |
| Health thresholds 30/60/120/15/60 s | TRUE | `server/lib/cameraHealth.ts:39-44` |
| "Fleet health now prevents false-green parents" | PARTIAL | A NULL/stale conversation worker passes (bad-list, `cameraFleetHealth.ts:71-75`); the badge keeps the word "Live" when the degraded camera is `sign` (`LotSection.tsx:1285-1288`); counters and "All bays clear." never consult sign health (`lot.ts` has no health join) |
| ERROR -> LOADING -> UNKNOWN -> EMPTY -> DATA "foundational" | Intent present, violated in >=5 places | [#7](#7-lot-ui-health-lattice-alerts) |
| Floor board longest-first, server-side timers | TRUE, incomplete | Fed by the 50 newest rows of any state (`lot.ts:779-782`), so it drops the longest-waiting cars when busy; "preexisting at startup" panel is structurally 0 |
| Keep OpenVINO; don't migrate to Frigate; MediaMTX stays | Consistent with the register | `UPSTREAMS.md:55,50,63` |
| "YOLO26 shadow benchmark" | Already dispositioned | `UPSTREAMS.md:52` REJECTs Ultralytics (AGPL) and `:62` WATCHes `roboflow/trackers`; do not re-propose |
| OwnTracks presence | Out of camera scope | No register row; a StateNour idea for LATER, not part of this audit |
| Oct 2 cold boot | TRUE; add Oct 3 | See 2.1 |

---

## 3. Live state at 14:01 ET, 2026-10-07 (receipts)

| Surface | Observation | Class |
|---|---|---|
| NicksMax | Boot 10/03 13:56:58; uptime 4.0 d; `Intel i5-5350U` load 100%; RAM 2,031 MB free of 8,094; `C:` 0.10 GB free of 40.16 | MEASURED |
| Disk by directory | `C:\Windows` 17.39 GB (WinSxS 8.09, System32 3.78, servicing 1.52); `Users\nourd` 11.64 (AppData\Local 6.05: npm-cache 2.20, StateNour 1.43, Packages 0.72, OpenAI 0.63; `.cache` 1.97: codex-runtimes 1.29, puppeteer 0.69; NicksMax 2.51; .codex 0.85); `Program Files (x86)\Microsoft` 5.06; `pagefile.sys` 3.47 GB; no `hiberfil.sys` | MEASURED |
| Scheduled tasks visible to a Medium-integrity query | `NicksMaxCalibrationProposal` Ready; `NicksMaxCameraCommissioningCheck` Ready; `NicksMaxCameraSupervisorUser` Disabled; `StateNour-Eufy-Agent-NicksMax` Running (last run 10/5 16:52:52); `StateNour-Eufy-Bridge-NicksMax` Ready/Running flapping, last result 1; `StateNour-Eufy-Watchdog-NicksMax` Running every ~5 min | MEASURED |
| Supervisor | SYSTEM powershell loop alive (Services session, pids 2656/20236/44420/26208/31696); log 13,882 lines, never rotated; restart ledger: eufy-bridge 24 restarts in the last hour, escalated | MEASURED |
| Eufy bridge / agents | node `server.mjs` pid 20928 owns 127.0.0.1:3000 (started 00:52:49, parent dead); python `agent.py --eufy-only` pids 9768 (since Oct 3 13:57:53) **and** 32744 (since Oct 5 16:52:15) both on :3601 | MEASURED |
| Office worker | status JSON 17:53:50Z: READY, workerOk true, queue 0, failuresToday 0, engine whisper-cli.exe; restarted by the supervisor 7x in 4 days for "heartbeat 10-11 min old" and 2x for code change | MEASURED |
| Office receipts (officewake.jsonl) | `stt_latency_ms` on 120 s captures: 226,515 / 239,095 / 240,846 / 261,423 / 268,336 / 269,539 / 273,413 / 273,695 / 292,463 / 348,811 / 457,294 / 457,412 / 484,643 / 509,109 / **600,485** / **600,663**; all recent wakes are `audio_fallback_wake` | MEASURED |
| Railway nickstire | sign heartbeat HEALTHY seq 510-522 owner `24c9a7b7fa001a88`; office heartbeats from two owners (`p2-nicksmax-afbc85f4...` seq 4514-4524 and `p2-nicksmax-01c62bc7...` seq 9764-9773), both `authoritative=true`, state `UNVERIFIED_CAPABILITIES`; `[camera-visits] 1 applied, 0 stale, 0 failed` on every visit POST seen | MEASURED |
| Railway statenour-web | `/api/devices/v380-shopsign/events` 200 on every POST seen; `/api/sync/nour-os` and `/api/devices/queue` from NicksMax every few seconds | MEASURED |
| Neon `device_events` (StateNour lane) | 353 rows total; 3 duplicate `visitId`; 4 non-terminal rows older than 1 day; 0 rows with plate text; every vehicle event in 30 days `alertSuppressedReason=flag_off` (`NICK_ARRIVAL_INTELLIGENCE` is off, so StateNour arrival alerts have never fired) | MEASURED |
| Public `shopStatus.getState` | 17:43:44Z: `lot: steady, sensorHealth fresh, "2 vehicles on lot (camera aggregate)"`, `capacity: 3/4 bays open (bookings)` | MEASURED |
| Camera-health pages (Railway `camera health alert fired`) | Oct 4-7 at 04:03-04:05Z daily: `office UNVERIFIED_CAPABILITIES` + `Camera recovered -- Shop sign`; real sign pages: PRODUCER_OFFLINE Oct 4 04:33Z, Oct 6 12:34Z, Oct 7 10:44Z; CAMERA_OFFLINE Oct 6 06:49Z, Oct 7 04:34Z | MEASURED |

---

## 4. The findings that change the priorities

### 4.1 The vehicle lane is blind while HEALTHY

MEASURED from `device_events` (ET-corrected; one row per visit, state overwritten in place):

| Day | Visits | In 08:00-16:00 | Notes |
|---|---:|---:|---|
| Fri Sep 18 | 69 | 51 | old capture lane |
| Tue Sep 22 | 108 | 93 | old lane; 17 of 111 nickstire rows were PASS_THROUGH that day (`lot.ts:638-642`) |
| Wed Sep 23 | 30 | 30 | last visit 10:08 |
| Thu Sep 24 | 29 | 29 | last visit 12:41; nothing Fri Sep 25 or Sat Sep 26 |
| Mon Sep 28 | 6 | 1 | **NicksMax RTSP lane goes live** (`CURRENT-TRUTH.md:82-92`) |
| Wed Sep 30 | 3 | 3 | nickstire lane: 9 visit updates in 10 business hours |
| Thu Oct 1 | 1 | 1 | nickstire lane: 4 updates, all 10:43-10:47 |
| Fri Oct 2 | 1 | 1 | reboot day |
| **Mon Oct 5** | 24 | **0** | all 24 after 16:36; nickstire lane: **zero** updates 08:00-16:30; sign HEALTHY 08:04-14:40 and 14:41-17:46 ET (blips 06:35, 08:03 for <2 min) |
| Tue Oct 6 | 42 | 9 | 33 of 42 between 00:14 and 08:00 -- see 4.2 |
| Wed Oct 7 | 9 (to 14:10) | 9 | sign offline 06:39-09:23 ET (relay / solar) |

Totals: pre-cutover 255 visits / 254 business-hours / 1 off-hours over 7 days; post-cutover 92 / 38 / **54**
over 10 days. The pre-cutover shape (99.6% business hours) is what real shop traffic looks like.

STRONG INFERENCE: the 640x360 / 4 fps RTSP crop with the Sep 28 calibration detects a small fraction of real
arrivals, and health cannot see it because `HEALTHY` means "frames decode, pose valid, outbox empty", not
"the lot is being observed". Candidate mechanisms, in the order I would test them: (1) the portal or lot
polygon on the crop does not straddle the actual driveway (`assert_portal_straddles` runs only in
`run_live.py:808`, never in `edge_main.py`; the same failure shape was recorded on 2026-09-16); (2) the
45 px/s path-speed cap wipes fast entries at 4 fps (`track.py:198-207`, a constant measured on other
geometries); (3) CPU starvation drops frames (4.5); (4) the MOG2 motion gate hides entries because
`entry_critical` is never passed (`pipeline.py:306`). The decisive test is in [#13 B5](#13-what-i-will-implement).

### 4.2 Phantom arrivals from zone flicker

MEASURED: between Mon 23:41 and Tue 07:27 ET (Oct 5-6) the StateNour lane holds **35 LEFT visits, all
`trackId sign-188`**, roughly every 12 minutes, dwell 0-730 s, confidence 0.988-0.997, `estimated=true` on
34 of 35. The nickstire lane applied >=200 `[camera-visits]` updates between 01:13 and 07:27 ET (query capped
at 200). The Oct 5 evening shows the same pattern on `sign-184`, `sign-188`, `sign-207` (visit ids cycling
ENTERED_ZONE -> ARRIVAL_CANDIDATE -> CONFIRMED_ARRIVAL -> LEFT every few minutes).

Mechanism (VERIFIED in code, inferred as the cause): the portal gate protects only a track's **first**
emission (`pipeline.py:396-409`). Afterwards the track's per-frame zone membership flows to visitd; a parked
car whose ground point jitters across the `bay_entrance` polygon edge closes its open zone interval, the
visit goes DEPARTING -> LEFT after the 20 s grace, and the next inside sample opens a **new** visit for the
same object (`state_machine.py:515-530, 780-823`). The split-track join only covers gaps <= 10 s
(`:615-627`). Consequences today: "Arrivals today" is inflated before the shop opens, "Left without a bay"
is inflated, the public lot band counts phantoms, and the time-to-bay sample is polluted.

### 4.3 Office listening coverage

MEASURED from `officewake.jsonl` on Oct 6 14:06-18:00 ET: 9 captures x 120 s = 18 minutes of audio in 234
minutes (**7.7%**). Each capture is followed by 226-600 s of transcription plus posting on one serial runner
(`officewake.py:736`); captures that arrive meanwhile are queued or dropped. Two captures hit the 600 s
whisper timeout (coverages `[0.0, 1.0]`). The supervisor's 10-minute heartbeat rule then kills the worker
mid-transcription: the capture started 14:06:54 on Oct 5 never finished because the worker was restarted at
14:18:25 ("running but heartbeat 11 min old"). After the 14:34 restart nothing was captured until the
18:56 restart.

The model is `ggml-large-v3-turbo-q5_0` since Oct 3 10:12 ET (`switch-to-turbo.log`; the ledger benchmarked
it at ~82 s per 15 s clip on this CPU). The fallback wake fires on essentially every 15 s probe (mean
-30..-47 dBFS against a -50 threshold; peak -6..-29 against -34), so the worker is never idle. Semantic Eufy
wakes (`motion`, `personDetected`) do not appear in the last 110 receipts at all. Through all of this the
status JSON reports `READY, failuresToday 0` because a transcript error is not counted as a failure
(`officewake.py:553-601, 769-787`).

Facts are being extracted when transcripts are coherent (Oct 6: 4 facts at coverage 0.874, 2 facts at 1.0,
1 fact at 0.727). The "0 facts" picture from Oct 3 is stale; the picture now is "good extraction on the
8% we hear".

### 4.4 Supervisor orphans and duplicate producers

VERIFIED: `Kick-Task` (`nicksmax-camera-supervisor.ps1:158-167`) does `Stop-ScheduledTask` then
`Start-ScheduledTask`. The task actions are PowerShell wrappers that `Start-Process ... -Wait` the real
process (`start-bridge-nicksmax.ps1:41-42`). Stopping the task kills the wrapper; the node/python child
survives. Then:

- **Bridge:** the surviving node keeps 127.0.0.1:3000; every new start exits 1 with `EADDRINUSE`
  (`bridge.stderr.log`); the task returns to Ready; the supervisor restarts it 2-3 minutes later. 24-28
  restarts per hour, ESCALATE every hour from Oct 5 17:07 to Oct 7 13:57 ET. The bridge itself has been
  serving the whole time (office frames and audio flowed), so this is pure churn.
- **Agent:** the Oct 3 13:57:53 agent survived its wrapper; the task showed Ready; the supervisor started
  it again Oct 5 16:52 -> two agents. Python's `HTTPServer` sets `SO_REUSEADDR`, so both bind :3601. Both
  post office heartbeats (Railway shows two owners, seq 4524 and 9773, both accepted as authoritative, each
  heartbeat logged as a state transition) and both drive the Eufy event stream. CPU: 19,257 + 10,203
  cumulative CPU-seconds, the two largest user-visible consumers on the box.
- The separate `StateNour-Eufy-Watchdog-NicksMax` task (every 5 min, as `nourd`) is a second authority over
  the same two tasks (`watchdog-nicksmax.ps1`); it is benign today but it is the "single source" promise of
  #2896 not yet kept.

### 4.5 NicksMax resources

MEASURED at 14:01 ET: CPU load 100%, 2,031 MB RAM free, 113 MB disk free. Cumulative CPU-seconds (user
processes only; SYSTEM processes such as whisper, the edge and ffmpeg are not readable from a non-elevated
shell): python 9768 19,257 s; `explorer.exe` 12,530 s; python 32744 10,203 s; `remoting_host` 6,459 s;
`V380.exe` 6,017 s since 09:25 (~36% of one core, the supervisor explicitly treats it as not infrastructure);
node bridge 1,819 s; ChatGPT desktop 1,584 + 558 + 262 + 256 s (743 MB working set); Claude desktop 769 +
585 + 461 s (~780 MB). The box that runs the production edge is also the AI-agent workstation. On a 2-core
i5-5350U that is the most plausible contributor to dropped frames and to every "heartbeat 11 min old" kill.

Disk: the safely reclaimable set is npm-cache 2.20 GB, puppeteer 0.69, codex-runtimes 1.29 (if Codex is not
needed on this host), OpenAI 0.63, plus a WinSxS component cleanup (typically 1-3 GB of the 8.09). No
camera data needs deleting. The supervisor only WARNs below 2 GB (`supervisor.ps1:365`); it has no floor action.

---

## 5. Architecture as verified

The gate chain and its verdicts (VERIFIED at the cited lines; the production launcher, its yaml and the
calibration JSON are machine-local, so every value they set is UNKNOWN):

| Stage | Receives -> emits | Authority | Verified behaviour |
|---|---|---|---|
| Window gate | frame -> suppressed if `window_verified` is not True | gate | `pipeline.py:252-257`; `RtspSource` always stamps True (`capture.py:769`), so inert in production |
| FrameHealth | frame -> ok / frozen / looping / fps | gate | returns before detection; tracks degraded not killed (`:260-268`); frozen = >=8 byte-identical frames **and** >=3 s (`framehealth.py:230-235`); `max_age` never effective because `now` equals the frame time (`:260-261`, `edge_main.py:728`) |
| Re-arm | first healthy frame -> census re-armed once | -- | `:269-274`; unverified frames set the same flag |
| SceneLock | frame -> `may_create_visits` | gate | suppresses update/end/tick entirely while untrusted (`:279-284`); reference is the first settled frame after each start (no calibrated home on the RTSP lane, `run_live.py:492`) |
| DetectorCouncil | pixels -> detections + `can_confirm` | gate | motion-only boxes cannot confirm (`detector.py:270-288`); no-motion skip holds tracks (`:321-326`); `entry_critical` escalation never wired (`:306`) |
| TrackGraph | detections -> born / died | authoritative | birth >=0.55, IoU 0.25/0.15, max_misses 12, parked after 25 s -> 150 misses, path speed cap 45 px/s (`track.py:92-99, 198-207`) |
| PreexistingCensus | birth time -> preexisting / candidate | authoritative | 8 s startup / 6 s reconnect grace (`census.py:16`); a preexisting track that later crosses records `PREEXISTING_DISAGREEMENT`, increments `preexisting_crossed`, never promoted (`:374-396`) |
| EntryPortal | ground-point path -> crossed | the only door to a new visit | >=2 cumulative outside, then >=2 consecutive inside, portal hit if a portal exists (`geometry.py:83-106`); with no portal **any** boundary crossing counts (`edge_main.py:1731`) |
| BayLatch | zones -> occupied bays | advisory | enter after 1 observation, release after 15 clear (`baylatch.py:38`); **nothing reads it** |
| EpisodeStitcher | arrival/death -> episode | shadow | 60 s / 45 px/s / 40 px slack (`stitch.py:88-98`); only `episodeId`/`memberTrackIds` reach shop rows |
| EvidencePacket | events -> JSONL | audit | appends to memory even when disabled (`evidence.py:103-104`); `save_frame` has no caller |
| visitd | synthetic Frigate payloads -> visit states | own state machine | candidate 10 s, confirm 45 s (stationary 20 s), leave grace 20 s, split <=10 s/IoU 0.5, max sighting 12 h (`visitd/config.py:189-199`); seq +1 per emission, `eventId = sha1(visitId|state|seq)` (`contract.py:17-19`) |

State machine (visitd): DETECTED -> ENTERED_ZONE -> ARRIVAL_CANDIDATE -> CONFIRMED_ARRIVAL -> IN_SERVICE
(bay) -> DEPARTING (internal, never emitted) -> LEFT (if a candidate was reached) or PASS_THROUGH. A
zone re-entry while DEPARTING silently restores the previous state; a tick-driven promotion is re-emitted
non-estimated on the next real event (`state_machine.py:439-441`).

Restart/durability: the per-camera SQLite ledger holds visits, sightings, zone intervals and both outboxes
(committed on every emission and every 2 s); tracks, census, BayLatch, stitch fragments and the SceneLock
reference are memory only. After a restart every visible car is PREEXISTING (invisible to the shop until it
leaves and re-enters) and the pre-restart visits close as LEFT at the restart moment.

CPU benchmark on file (`vision/benchmark-2026-09-09.json`): `vehicle-detection-0200`, OpenVINO 2026.3.1,
CPU 2.79 ms mean per inference on 1024x665 frames -- model call only, not on NicksMax, pre-cutover.

---

## 6. Delivery and persistence

| Mode | nickstire lane (`POST /api/camera/visits`) | StateNour lane (`POST /api/devices/{id}/events`) |
|---|---|---|
| Duplicate visit | prevented: `UNIQUE uq_vehicle_visits_visitId` + upsert | **not prevented**: `findFirst` on `data.eventId`, then `create` after Telegram/push awaits (`vehicle-detection.ts:153-166, 300-337`); MEASURED 3 duplicates |
| Older event regressing newer | prevented per column: `IF(VALUES(seq) >= seq, VALUES(col), col)` (`cameraVisitsRoutes.ts:210-220`) | no seq guard; `{...existingData, ...data}` unconditional (`:223-234`) |
| Equal-seq retry restoring a scrubbed plate | prevented: `plateText = IF(plateStatus='SCRUBBED', plateText, ...)` (`:207,216-217`) | `customerRef.plate` not scrubbed; `data-cleanup` cron kill-switched since 2026-09-08 (`config/crons.ts:51-53`) |
| 4xx on delivery | n/a | **event deleted**, not dead-lettered (`cloud_client.py:174` -> `ledger.py:481-482`), contradicting the comment at `:168-170` |
| Local retention | `housekeeping` (90 d visits, 7 d dead letters) is called only from visitd's `LiveLoop` (`main.py:455`); **`edge_main.py` never calls it** | -- |
| Crash between commit and ack | single transaction, idempotent resend; `synchronous=NORMAL` can reuse a seq after power loss (`ledger.py:142`) | -- |
| Poison | shop batch is always the oldest 25; >=25 permanently rejected rows starve newer ones (`ledger.py:542`) | -- |
| Timestamp validation | parse only (`cameraVisitsRoutes.ts:66-77`) | `z.string()` |

Heartbeat seq after restart: a new producer id is minted per process (Railway shows `owner=...` changing and
`seq=1` accepted on every restart), so the "fixed id blocks heartbeats for hours" inference from the code
read does **not** apply in production.

ALPR: no camera reads plates in production. The synthetic payload carries no plate fields
(`pipeline.py:182-201`); `handle_lpr` is reachable only via Frigate MQTT, which the edge does not run;
`PlateLab` is imported only by tests. MEASURED: 0 of 353 StateNour rows carry plate text. The "552 visits,
0 plateText" line is a code comment at `schema.ts:4970-4971`, consistent with "by design", not a defect.
The Lot identity tiles are therefore structurally zero; `customerMatch` has no writer (`shop_mirror.py:203`).

---

## 7. Lot UI, health lattice, alerts

Health lattice: all 14 states exist (`cameraHealth.ts:18-33`). fixed_geometry precedence NEVER_INGESTED ->
PRODUCER_OFFLINE -> STALE -> CAMERA_OFFLINE -> CALIBRATION_INVALID -> DEGRADED_VISION -> CLOUD_BACKLOG ->
UNVERIFIED_CAPABILITIES -> HEALTHY (`:249-307`); interaction_ptz adds AUTH/EVENTS/CONTROL/MEDIA/PTZ_HOME
(`:156-214`). Thresholds: heartbeat 30 s declared, stale >60 s, offline >120 s, frame stale >15 s, backlog
>60 s or any dead letter (`:39-44`). Asymmetry: cloud `unknown` blocks HEALTHY for fixed cameras but not PTZ
(`:202`). Because control is intentionally disabled on the office camera, `controlPlaneOk`/`ptzHomeOk` are
NULL -> permanent `UNVERIFIED_CAPABILITIES` -> a permanent "1 camera issue" badge and a daily page.

Ranked false-certainty defects (file:line in the UI audit; all VERIFIED):

1. Alert dedupe is per camera/state/**ET day** (`cameraHealthAlerts.ts:49-63`): fail -> recover -> fail again
   in one day is silent, and every midnight re-pages "recovered" plus the permanent office state (MEASURED
   Oct 4-7).
2. "steady today" cannot see producer outages: `camera_health_events` is written only by ingest at age 0
   (`cameraVisitsRoutes.ts:608-624`), so PRODUCER_OFFLINE/STALE never appear in the stability SQL (`lot.ts:910-913`).
3. Floor board drops the longest waits: fed by the 50 newest rows of any state (`lot.ts:779-782`); warns only
   when it shows zero (`LotSection.tsx:1395-1406`).
4. Counters and "All bays clear." never consult sign health (`LotSection.tsx:1495`; no health join in `lot.ts`).
5. Office panel colours facets with no producer-alive check (`:914-945`); worker pill green from
   `workerOk===true` alone (`:869-881`); cached `health.data` rendered after a thrown refetch (`:1295-1297`).
6. Two "Arrivals today": the counter includes PASS_THROUGH (`lot.ts:503-508`), the chart excludes it (`:655-656`).
7. Fleet passes an unknown worker (bad-list, `cameraFleetHealth.ts:71-75`).
8. "Already on the lot at startup" is structurally 0: both producers hardcode `preexisting: False`
   (`run_live.py:153`, `shop_mirror.py:211`).
9. Overnight arrivals skew time-to-bay P90 (`lot.ts:533`).
10. "Stale Nm" measures row silence, not liveness (`lot.ts:519`), and outranks the fleet verdict (`LotSection.tsx:1283-1285`).
11. Header reads only `now` + `health`; a `lot.now` failure hides the floor board (`:1318`); loading = green "Live" (`:1289`).
12. Abandoned commissioning run never expires (`cameraVisitsRoutes.ts:765-768`).
13. 14 rendered lines carry mojibake (`LotSection.tsx:894-1214`, bytes `e2 94 ac e2 95 96`).

Public surface: `shopStatus.ts:66-101` counts website bookings in active stages with no recency bound and
renders "N/4 bays open" -- a likely false claim about bay occupancy (`shared/shopState.ts:274`).

---

## 8. Office pipeline (NICKS EUCLID)

Components (all VERIFIED): T8410 -> `ha-eufy-sdk-bridge 0.3.0` + overlay on 127.0.0.1:3000 ->
`officewake.py` (SYSTEM task) -> `/record` 120 s WAV (`officeaudio.py:229-234`) + `/snapshot` stills every
30 s, <=6 per capture, <=640 px, JPEG q70 (`officeframes.py:26, 52-72, 99-126`) + `person-detection-0200`
count (int, or null when not measured; `:158-249`) -> `whisper-cli -mc 0`, 600 s timeout
(`officepost.py:90-117`) -> `POST /api/conversation-episodes` -> Ollama Cloud `gemma4:31b` then Gemini,
40 s per lane (`officeVisual.ts:157-177`) -> facts cite transcript spans only; camera context is "NOT a
transcript segment and must never be cited" (`conversationFacts.ts:324-326, 352, 372-379`) -> gist needs one
existing cited segment -> Admin -> Lot.

Gates: coverage <0.65 or mean <-55 dBFS caps confidence at 0.6; a fact needs >=0.7 and a cited segment;
loop refusal when one normalized line fills >=50% of >=3 segments (`conversationFacts.ts:183-197`), stored
as DONE with gist null. Diarization absent (`speakerCount` always NULL). Retention: WAVs and whisper JSON up
to ~7 h on NicksMax (`officewake.py:381-443`); transcripts, facts, gist, visual descriptions and review notes
have **no deletion job**; `audioRef` is never nulled despite the 0128 comment.

Right/Wrong loop as built: `lot.reviewConversationVisual` writes `JSON_SET(visual,'$.review', ...)`
(`lot.ts:442-470`); calibration picks the 40 most recent reviewed rows, up to 6 "wrong" then 2 "correct",
cap 8 (`officeVisual.ts:280-299`); 5-minute in-process cache; no prompt or model version on the review; no
record of which reviews a call used. MEASURED: 5 reviews submitted Oct 2 23:38Z. Live proof requires one
code change (store `calibrationFrom` ids on the resulting visual and in the `office visual stored` log).

Difficult cases, as the code behaves: impact-wrench noise above -35 dB is "speech"; clipping never reaches
the server (`maxVolumeDb` measured but not posted); TV/radio is undetectable; a customer entering mid-capture
waits for whisper and the post to finish; employee-only talk is captured and stored indefinitely.

---

## 9. Service truth and prior art

What already exists for "waiting / service started / pickup pending":

| Capability | State | Where |
|---|---|---|
| Outside-service classifier (person + mechanical cue, >=3 hits over >=6 s, outside every bay) | shadow-only by design, local JSONL only | `vision/service_shadow.py:89-216` |
| Offline review worker (Grounding-DINO tiny) + installer + doctor | built, **not installed** on NicksMax (PR #2703) | `vision/service_review_worker.py`, `scripts/install-service-review-worker.ps1` |
| `NO_BAY_ACTIVITY_REVIEW` clip trigger | needs `--hard-cases`; production flag UNKNOWN | `edge_main.py:1364-1415` |
| Visit <-> conversation / work-order link columns | built, **unwired** (no writer) | `schema.ts:5017-5019`; `conversationRoutes.ts:210-225` |
| Arrival <-> invoice reconciliation | live, phone + 3-day window, **no camera use**; `arrivedAt = NOW()` at reconcile time | `expectedArrivals.ts:219-293` |
| Work orders with started/completed/picked_up | built; walk-ins do not use them; status changes text the customer | `schema.ts:2233-2235`, `workOrderService.ts:290-330` |
| Phone-tap truth with server clock | live inside commissioning only; reusable pattern | `lot.recordTruth` (`lot.ts:1198-1232`) |
| Plate -> customer (EXACT only auto-binds) | unit-tested, no input | `lib/plate.ts:92-150`, `cameraVisitsRoutes.ts:289-292` |

Join matrix today: call -> expected arrival (exact: call id + phone); expected arrival -> invoice (exact:
phone + window, one invoice per arrival since migration 0126); invoice -> review request (exact). Every
camera join is time-window only. StateNour has its **own** vehicle stream (`DeviceEvent`) and a second Lot
view at `/system/camera` that writes only to `DeviceEvent.data`; `analyzeCameraData` (long-wait, after-hours,
daily insight) is explicitly not scheduled (`lib/brain/camera-intelligence.ts:56-63`).

Inside camera: V380 at 192.168.0.154, P2P port 8800 only, OFFLINE since 2026-04-14 in StateNour's device
table, deliberately the untouched control during the `ceshi.ini` unlock; no note anywhere on what its view
covers (`shared/cameras.ts:32-39`, `MASTER-PLAN.md:136`). Commission it only after a labelled corpus of
ambiguous bay transitions shows the sign view is inadequate.

---

## 10. Documentation drift and ADR-0017

| Stale statement | Where | Current truth (source) |
|---|---|---|
| "Office camera listens; does not watch" | `apps/statenour/docs/CURRENT-TRUTH.md:10` | Watches since #2898; live DONE rows daily (Railway) |
| "Office watch not built / waiting on operator choice A or B" | `apps/statenour/docs/RECONCILIATION.md:68`; `.remember/now.md:27` | Both shipped (#2898, #2901) |
| Cold boot never proven | `apps/nickstire/docs/CURRENT-TRUTH.md:91,135`; `docs/00-current-truth/connection-hardening-2026-09-27.md:54,71`; `NICKSMAX-CAMERA-HOST:125-127`; `NICKSMAX-WORKSTATION:255,331-334,343,359-361`; both `.remember/nicksmax.md`, both `.remember/now.md` | Session-0 startup observed Oct 2 09:15 and Oct 3 13:56:58 (chain back by 13:58:52); login-free Railway heartbeat proof still not recorded |
| Supervisor task `NicksMaxCameraSupervisor`, one-minute | `NICKSMAX-CAMERA-HOST:113,122-123`; `register-camera-system-task.ps1:2,10`; `verify-camera-system-task.ps1:2` | Live task `NicksMaxCameraSupervisorSystem`, ~30 s loop (`supervisor.ps1:2-3`) |
| "Neither producer runs against a live camera; Lot stays empty" | `apps/nickstire/docs/CURRENT-TRUTH.md:290-293`; `schema.ts:4690` | Sign producer live since Sep 28 |
| Migration 0141 / "Heard:" not applied | ledger `office-visual-watch-20261002` blocker | Applied 10-03 01:24Z; `gist true` stored on most Oct 5-6 episodes (Railway) |
| Right/Wrong reviews never exercised | same ledger entry | 5 reviews written 2026-10-02 23:38Z; consumption still unproven |
| "No stable office audio source; DirectShow not installed" | ledger `counter-conversation-cockpit` | Eufy `/record` is the live source since Sep 29; the cockpit entry says `unit_verified`, no live runs, while its own Oct 3 blocker counts 15 live episodes |
| "T8410 control/media not proven" | ledger `camera-role-aware-health` | Media proven (Sep 29 probe, Oct 2 `/snapshot` 200); control still unproven |
| Office mode=SHADOW | same ledger liveRuns | PRODUCTION since Sep 28 |
| Whisper `base.en-q5_1` in use | ledger `counter-conversation-cockpit` (Oct 3) | `large-v3-turbo-q5_0` since Oct 3 10:12 ET (`switch-to-turbo.log`) |
| "Audio never leaves this machine" | `camera-bridge/docs/SHOP-PC-RUNBOOK.md:299-300` | Audio stays local; stills go to Ollama Cloud and Google |
| Frigate + PoE described as the architecture | `camera-bridge/README.md:3-22` | OpenVINO `edge_main.py` over the V380 relay |
| 1002 = bad credentials | only in commit `91fd5fbf` body | Offline-or-credential; no battery telemetry exists; throttle text always says "expected overnight" whatever the hour (`supervisor.ps1:288`) |

ADR-0017 (Accepted 2026-09-08, never amended) has diverged on 5 of 7 decisions: V380s kept via the rejected
bridge class, no Frigate, TiDB mirror added, Windows host instead of Linux mini-PC, office audio and cloud
vision added. It needs a superseding ADR recording the operator's recording-policy and decoder decisions.

---

## 11. Plan-gate split

- **Already built** (~35% of the two reports' asks): fleet UNKNOWN at parent; coverage-gated facts and
  withheld summaries; loop refusal; seq-guarded upsert with plate scrub guard; solar throttle; office visual
  watch; on-box person count; Right/Wrong capture; evidence packets; health lattice and 5-minute alerts;
  outside-service classifier (shadow) and review worker (uninstalled); visit/work-order link columns.
- **Refuted** (~15%): "one-tap visit-to-ticket link" (no live ticket exists; must be a mark on the visit);
  "task-authority drift" (non-elevated visibility); "persistence unproven" for the nickstire lane (it is the
  well-guarded one); "Whisper accuracy is the bottleneck" (latency/coverage is); "the invariants hold"
  (violated for long-lived tracks); "15 episodes 0 facts" as current.
- **Genuinely new** (~50%): observation-coverage and plausibility canaries; phantom re-arrival fix; office
  worker decoupling and honest state; supervisor child-process fix; alert dedupe per episode; solar-aware
  expected-offline state; operator visit marks; calibration consumption receipt; health timeline; Lot trust
  strip and board completeness; docs reconciliation.

Register check (`docs/UPSTREAMS.md`): Frigate ADOPT-CANDIDATE-never-run (:50); Ultralytics/BoxMOT REJECT
(AGPL, :52); `roboflow/trackers` WATCH (:62); MediaMTX ADOPT-CANDIDATE (:63); OpenVINO + OMZ
`vehicle-detection-0200` ADOPT-CANDIDATE (:55-56); anomalib WATCH for capture integrity (:64); Scrypted /
Blue Iris / ZoneMinder / Viseron / Agent DVR REJECT (:69); Coral REJECT (:67). Report B's YOLO26 is covered
by the Ultralytics row. OwnTracks has no row and is out of camera scope.

---

## 12. What not to build

Frigate/Scrypted/Viseron migration, a new NVR, a second event bus or database, face or emotion recognition,
cross-day person tracking, a VLM on every frame, a GPU, YOLO26, another Lot dashboard (StateNour already has
one too many), ALPR work before a plate reader exists, fine-tuning on reviewed frames. Reasons are in the
register rows above and in [#9](#9-service-truth-and-prior-art).

---

## 13. What I will implement

Order is dependency order. Each item names the files, the mechanism, and the receipt that proves it worked.
Items marked **OPERATOR** touch the shop PC or production and need the operator's go; I will prepare the
exact scripts and runbook lines but not execute them from here.

### NOW -- restore the sensor (this week)

**A1. Disk floor on NicksMax (OPERATOR, scripted by me).** Reclaim >=5 GB with no camera data touched:
npm cache clean (2.20 GB), remove `.cache\puppeteer` (0.69) and, if Codex is not needed on this host,
`.cache\codex-runtimes` (1.29), `AppData\Local\OpenAI` (0.63), then a WinSxS component cleanup via DISM.
Then in `nicksmax-camera-supervisor.ps1` add a floor action under 1 GB: prune `OfficeIntelligence\audio`
beyond 2 h and rotate the supervisor log (never rotated, 13,882 lines). Receipt: `WARN disk free` lines stop;
`C:` free >= 5 GB in `wmic logicaldisk`.

**A2. Fix the restart primitive (`camera-bridge/scripts/nicksmax/nicksmax-camera-supervisor.ps1`).**
`Kick-Task` stops the real child by command line (`server.mjs` under the Eufy bridge dir, `agent.py --eufy-only`,
`vision.officewake`) before starting the task; bridge and agent health use port + protocol (`GET /` on
:3000, `/health` on :3601) as primary and task state only as a hint; never start the agent task while an
`agent.py` process exists; make the Eufy watchdog task a no-op or retire it so there is one authority.
Tests: a Pester-free unit harness already exists for the supervisor? No -- I will add a PowerShell test
script under `camera-bridge/tests/` that stubs `Get-CimInstance` and asserts the stop order and the
single-agent rule (positive control: the current code fails it). Receipt after `git pull` on NicksMax:
ESCALATE `eufy-bridge` lines stop; exactly one `agent.py`; Railway office heartbeats from one owner.

**A3. Kill the duplicate Eufy agent now (OPERATOR).** Stop the Oct 3 orphan (pid 9768 chain) and keep the
task-owned one; A2 prevents recurrence. Receipt: one `:3601` listener; one office heartbeat owner.

**A4. Office worker: revert the model and make the worker honest (`camera-bridge/vision/officewake.py`,
`officepost.py`; model switch is OPERATOR).** Revert `OFFICE_WHISPER_MODEL` to `small.en-q5_1` (or
`base.en` if small still exceeds real time on this CPU) until a benchmark on real shop clips says otherwise.
Code: heartbeat written from its own thread so a long transcription cannot look like a hang; count a
transcript error or timeout as a failure and set `DEGRADED`; post `maxVolumeDb` and a rolling
`listeningCoverage` (captured seconds / elapsed seconds, last 60 min) in the status JSON and through
`eufy_agent.py`'s allow-list (`eufy_agent.py:749-766`); raise the fallback thresholds to the measured room
(mean -40 / peak -20 dBFS) or require two consecutive probes. Tests: `vision/tests/test_officewake.py`
additions with the current behaviour as the red control. Receipt: `stt_latency_ms` < 120,000 on 120 s
captures; zero "heartbeat N min old" restarts for 48 h; coverage field visible in `camera_runtime`.

**A5. Decouple capture from transcription (`officewake.py`).** A capture queue and a transcribe/post worker
so the office records continuously during business hours and transcribes behind. Receipt: listening coverage
>= 70% over a business day in the new status field.

**A6. Move the AI desktop agents off NicksMax (OPERATOR).** Close ChatGPT desktop, Claude desktop, Codex CUA
and `V380.exe` on the shop PC; keep Desktop Commander only if it is needed for remote ops; use NattyNour for
agent work. Receipt: CPU load < 60% at idle with the edge and office worker running; RAM free > 4 GB.

### NOW -- restore trust in the counts

**B1. Phantom re-arrival fix (`camera-bridge/vision/pipeline.py`, `visitd/state_machine.py`).** Zone
membership gets hysteresis (enter after N consecutive inside samples, exit after M consecutive outside,
mirroring BayLatch's clear-run); a track that already produced a visit cannot open another without a new
portal crossing; cap re-visits per track per hour and flag the rest `estimated`. Test: a replay fixture built
from the Oct 5-6 `sign-188` sequence (positive control: 35 visits before, 1 after). Receipt: off-hours visit
share drops from 59% toward the pre-cutover 0.4%; nickstire `[camera-visits]` lines overnight fall to near zero.

**B2. Plausibility canary (`apps/nickstire/server/lib/vehicleTruthPlausibility.ts`, `routers/lot.ts`,
`lib/cameraHealth.ts`, heartbeat payload in `edge_main.py`).** The edge reports `detectionsLast10m` and
`portalCrossingsLast60m` in its heartbeat; the server derives `DEGRADED_VISION` when frames are fine but
detections are zero for >60 min inside business hours, and computes a daily "lot data confidence" from
off-hours share, business-hour rate vs same-weekday baseline, and sign HEALTHY minutes. Fail closed: UNKNOWN
below 10 visits. Receipt: Monday-Oct-5-shaped days render LOW confidence instead of "steady".

**B3. Edge housekeeping (`camera-bridge/edge_main.py:797`).** Call `pipeline.housekeeping` from
`_run_timers`. Receipt: ledger file size stops growing week over week.

**B4. StateNour lane hardening (`apps/statenour/lib/services/vehicle-detection.ts`, `prisma/`,
`camera-bridge/visitd/cloud_client.py`).** Create the row before alerting; unique index on
`(device_id, (data->>'eventId'))` via a hand-applied migration (`statenour-migration` skill); drop the 12 h
visit window; route 4xx to `outbox_dead_letter` instead of deleting. Receipt: duplicate `visitId` count stays
at 3 (historical) and never grows; dead-letter rows appear on a forced 404 in a test.

**B5. Calibration ground truth (OPERATOR + me).** Export `data/calib-nicksmax-sign-rtsp.json` and 20
daytime frames; add `assert_portal_straddles` to `edge_main.py` startup (heartbeat `CALIBRATION_INVALID` if
the portal does not straddle the lot boundary); count arrivals by hand for two business hours against the
lane's output. This decides whether 4.1 is geometry, fps, or CPU, and it is the gate for anything else on
the vehicle side. Receipt: measured recall for those two hours, written into the ledger.

### NOW -- make the operator surfaces tell the truth

**C1. Lot trust strip (`client/src/pages/admin/LotSection.tsx`, `routers/lot.ts`).** Top of page: sign
state in words, lot data confidence (B2), "showing X of Y on the lot", office listening coverage (A4), and
the newest qualified event age. Never the word "Live" when `sign` is not HEALTHY.
**C2. Floor board completeness.** Open-only query; never truncate the oldest; "N more" indicator.
**C3. Counters.** Exclude PASS_THROUGH and flagged phantoms from "Arrivals today"; count distinct
`COALESCE(episodeId, visitId)`; when sign is not HEALTHY stamp "as of last healthy frame" and never render
"All bays clear."; hide the always-zero preexisting and customer-identity tiles until a writer exists.
**C4. Office panel.** Worker UNKNOWN when the producer is not alive or the worker age > 120 s; show
listening coverage; persist and show `dropped` reasons; fix the 14 mojibake lines.
**C5. Alerts (`services/cameraHealthAlerts.ts`, `cameraHealthAlertPolicy.ts`, `lib/cameraHealth.ts`).**
Dedupe per outage episode (`stateSince`) instead of per ET day; an intentionally disabled control plane
reports `not_required`, not `unknown`, so the office camera can be HEALTHY on events + media; no midnight
"recovered" re-pages; page `summarizeCameraFleet().problems` so alerts and the badge agree.
Receipts: Railway shows no 04:0xZ pages for a stable state; a fail/recover/fail sequence inside one day pages twice.

**D. Truth reconciliation (docs PR, same branch as this file).** Update both `CURRENT-TRUTH.md` camera
sections, the three ledger entries (cockpit -> live with receipts; office-visual-watch blockers -> 0141 applied,
5 reviews collected, consumption unproven; role-aware-health -> media proven, control unproven), the cold-boot
timeline (Oct 2 + Oct 3), the NicksMax host doc (task name, 30 s loop), `camera-bridge/README.md`, a
superseding ADR for 0017, and `UPSTREAMS.md` rows for YOLO26 (covered) and OwnTracks (WATCH, StateNour).

### NEXT

**N1. Operator visit marks.** `vehicle_visit_marks(visitId, mark VARCHAR, markedAt, markedBy, note)` via a
hand-applied TiDB migration (`nickstire-tidb-ddl`: VARCHAR, never ENUM); `lot.markVisit` admin mutation
reusing the `recordTruth` pattern (server clock, refuse after terminal); two-tap 48 px buttons on the floor
board (`nickstire-ios-pwa-primitives`): CUSTOMER_WAITING / SERVICE_STARTED / SERVICE_DONE / NOT_A_JOB.
`lot.now` derives service start = min(bayEnteredAt, mark), service duration, pickup pending, pickup wait; an
unmarked car stays UNKNOWN and "On lot, not in a bay" keeps its honest label. Report the marked share.
Marks also become the ground truth the shadow outside-service classifier needs before the review worker is
installed. No auto-binding to phone, customer or invoice by time window; never call the customer-texting
work-order or booking mutations.

**N2. Observation coverage %** per business hour (sign HEALTHY and detections plausible) on the Lot and in
every daily comparison; comparisons withheld below 80%.

**N3. Solar-aware expected-offline state.** Local sunrise/sunset computation (no external service); sign
`EXPECTED_SOLAR_OFFLINE` between civil dusk and dawn + the measured recovery percentile (Oct 4: offline
03:16-09:15 ET; Oct 7: 06:39-09:23 ET, two hours after sunrise); page only daytime loss. Keep the 30-minute
login-refusal throttle; fix its message so it does not say "expected overnight" at noon.

**N4. StateNour owner brief** over qualified nickstire events (three material events, traffic vs same-weekday
baseline gated by coverage, long-dwell anomalies, lot traffic with few tickets). Reads `vehicle_visits`
through a bridge query; does not duplicate the Lot; retire or demote `/system/camera`.

**N5. Right/Wrong consumption receipt.** `loadVisualCalibration` returns source episode ids; store
`calibrationFrom` on the resulting visual and in the `office visual stored` log; one live proof against a
real Wrong review.

**N6. Health timeline** (state + duration, including liveness transitions logged from the 5-minute pass)
replacing "steady today".

### LATER / EXPERIMENT

Install the Grounding-DINO review worker once N1 yields a labelled set; benchmark `small.en` vs `base.en` vs
server-side transcription on 30 real shop clips with human-rated intelligibility; corroborate bay transitions
with the inside camera only if the labelled corpus shows the sign view is inadequate; OwnTracks presence on
the StateNour side.

### Five smallest changes, largest benefit (if this were my shop)

1. A1-A6: stop the self-inflicted load and churn on the sensor box. Nothing else is measurable until then.
2. B1 + B2: stop phantom arrivals and show lot data confidence. The counts become trustworthy again.
3. A4 + A5: honest worker state and continuous capture. Office intelligence goes from 8% to most of the day.
4. C1-C5: trust strip, complete floor board, honest counters, alerts that page on real transitions.
5. N1: operator marks. Waiting, service started and pickup pending become real without more vision.

---

## 14. Operator-only actions (I cannot or should not do these from here)

1. Approve and run the disk reclaim (A1) and the DISM cleanup; confirm free space afterwards.
2. Stop the orphan Eufy agent (A3) and close the desktop AI apps and `V380.exe` on NicksMax (A6).
3. Switch `OFFICE_WHISPER_MODEL` back (elevated shell + restart of `StateNour-OfficeIntelligence-NicksMax`).
4. Run one elevated `Get-ScheduledTask` to close the task-name question for the record, and export
   `data/calib-nicksmax-sign-rtsp.json` plus 20 daytime frames for B5.
5. Decide whether `NICK_ARRIVAL_INTELLIGENCE` (StateNour Telegram arrival alerts, off for 30 days) should
   stay off; if yes, say so in CURRENT-TRUTH so the lane is not mistaken for live.

## 15. Still unknown

Production `vehicle_visits` counts, `bayEnteredAt` frequency and `camera_runtime` rows (TiDB not reachable
here); the production launcher flags (`--hard-cases`, `--evidence`, fps); the calibration polygons; whether
the Oct 3 reboot produced Railway heartbeats before any desktop login; SYSTEM-process CPU split (whisper vs
edge vs ffmpeg); whether the Lot page is opened daily (tRPC batching hides it from the HTTP log; the only
hard evidence is the five Right/Wrong taps on Oct 2).

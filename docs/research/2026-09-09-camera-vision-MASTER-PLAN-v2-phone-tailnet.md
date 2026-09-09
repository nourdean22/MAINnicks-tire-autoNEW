# Camera vision master plan v2 — phone + tailnet + runtime truth

**Date:** 2026-09-09 · **Supersedes** the operational parts of `2026-09-08-camera-vision-MASTER-PLAN.md` §3–§11 (the camera-unlock procedure in that file still stands). ADR-0017 unchanged.

**Evidence labels used throughout:** `IMPLEMENTED` (on `main` or in an open PR named here) · `UNIT-PROVEN` · `REPLAY-PROVEN` · `REAL-FEED-MEASURED` (against live V380 pixels from this laptop) · `CONTROLLED-FIELD-PROVEN` (a known car, on site, with a witness) · `OBSERVED-FIELD-PROVEN` (real customers, production rows) · `LONG-HORIZON-UNPROVEN` (needs 30+ days) · `VERIFIED` / `LIKELY` / `UNVERIFIED` for external claims, with the source.

---

## 0 · Verdict in five sentences

The cloud read plane, schema, admin and vision invariants are real; what was missing was the **infrastructure fact** (is the producer alive?) and a way to run a test drive that is not a customer arrival — both landed today in #2251. **There is no always-on shop machine**: the "Core Ultra shop PC" both pasted plans assumed is *this laptop*, which was the probe host at the shop yesterday (`192.168.0.174`) and is at home today (`192.168.1.x`) — so "make the shop PC the subnet router" is not a same-day action. The S25 FE is on the tailnet and online (it was offline 111 days until this session) but is **at home right now** (`192.168.1.180`, same LAN as the laptop) and advertises no routes; it becomes the bridge to the cameras only when it is at the shop, plugged in, advertising two `/32` host routes. Nothing — no VMS, no Frigate, no RTSP tooling — can read these two V380 units until the `ceshi.ini` unlock is proven, so **WGC on Windows is the production pixel source** and the repo now says so. The next physical session is scripted below to produce the first `CONTROLLED-FIELD-PROVEN` visit with the phone as the out-of-band witness.

---

## 1 · New repo-grounded findings (this session)

| # | Finding | Evidence | Status |
|---|---|---|---|
| 1 | `lot.health` inferred camera existence from `vehicle_visits` → a healthy producer on a quiet lot rendered `cameras: []` | `server/routers/lot.ts` (pre-#2251) | **FIXED** #2251 |
| 2 | No data class → the first test drive would be "today's arrival" | schema 0119 had no such column | **FIXED** #2251 (`dataClass`, `commissioningRunId`) |
| 3 | 0119 provenance columns were sent as `None` by `ShopMirror` | `shop_mirror.py:112-115` | **FIXED** #2251 (per-camera config provenance) |
| 4 | visitd already heartbeats **StateNour** (`PATCH /api/devices/{id}`), never nickstire — the gap was one side, not "no heartbeat" | `cloud_client.py:168`, `main.py:351` | **FIXED** #2251 |
| 5 | The minimised-window self-heal was dead code on the documented default path (`--hwnd` omitted) | Codex P1 on #2250 | **FIXED** #2250 |
| 6 | One duplicated WGC sample flipped `looping` and re-armed the preexisting census | Codex P1 on #2250 | **FIXED** #2250 |
| 7 | "On lot, not in a bay" undercounted cars back out of a bay | Codex P2 on #2250 | **FIXED** #2250 |
| 8 | `camera-bridge/README.md` said "nothing on Windows is production" while WGC-on-Windows is the only field-proven pixel source | README:150 | **FIXED** #2250 |
| 9 | Frigate UI published on `0.0.0.0:8971` under a comment promising Tailscale-only | `docker-compose.yml:39` | **FIXED** #2250 (loopback + Serve) |
| 10 | statenour doc called Tailscale **Funnel** a private transport (it is public-internet) | `KNOWLEDGE-ENGINES.md:70` | **FIXED** #2250 |
| 11 | `run_live.py` is the lab lane: direct HTTP sink, no durable outbox; visitd owns durability but never sees WGC pixels | `run_live.py:42`, `README` | **OPEN** → PR 2 |
| 12 | `ShopMirror` is explicitly best-effort: a terminal event lost while nickstire is unreachable leaves a car on the board forever | `shop_mirror.py` docstring | **OPEN** → PR 3 |
| 13 | `install-windows-service.ps1` supervises visitd only; nothing supervises V380, WGC, or run_live | script header | **OPEN** → PR 4 |
| 14 | `RtspSource` + `CaptureMux` exist; `run_live` hard-wires WGC/V380 | `capture.py`, `run_live.py:109-114` | **OPEN** → PR 5 |
| 15 | statenour already has **web push** (VAPID) and **Telegram** alerting on vehicle events — a phone channel exists and is unused by the shop side | `lib/notifications/push.ts`, `lib/services/vehicle-detection.ts` | reuse, do not rebuild |
| 16 | `v380_agent.py`'s `_on_shop_subnet()` tests interface membership, not reachability — but it is the legacy lane ADR-0017 schedules for deletion; ChatGPT's "excludes 100.x" claim is false (`_all_local_ips` drops only `127.*`) | `v380_agent.py:194-218`, plan line 426 | apply the *principle* to new probe code; do not fix the corpse |
| 17 | The old shop PC (`192.168.0.157`) is not on the LAN; the "shop laptop" is `nattynour` | MASTER-PLAN lines 69–71 | topology fact that reshapes §4 |

What both pasted plans got wrong: a permanent Windows shop PC (none exists); "add a heartbeat" (half existed); fixing the legacy agent first (it is being deleted); and — mine — assuming the phone could bridge to the cameras today (it is at home).

---

## 2 · The S25 FE's roles — decided

| Role | Verdict | Why (with source) |
|---|---|---|
| **A · Commissioning / maintenance console** (PWA over tailnet) | **PRIMARY** | Highest leverage; no shell, no camera secrets on the phone |
| **A · Ground-truth witness** during a known-car run | **PRIMARY** | The one thing a camera cannot do for itself |
| **A · Health / evidence / correction UI** | **PRIMARY** | The admin already exists; it needs the tailnet route + a phone layout |
| **B · Out-of-band reference camera** (IP Webcam → RTSP over tailnet) | OPTIONAL | Only for calibration / plate-readability benchmarks |
| **C · Temporary subnet router** at the shop, plugged in | **BREAK-GLASS, and today the ONLY bridge** | Android can advertise routes (Tailscale kb/1019, `VERIFIED`); "significantly impacts battery… intended for devices connected to power" |
| **C · Emergency WAN via USB tether** | OPTIONAL | Standard Windows interface-metric preference; keep Wi-Fi on the cameras |
| **D · Permanent subnet router** | **NO** | Battery + doze; the edge box owns this when it exists |
| **D · Production vision inference** | **NO** | Adds fragility for nothing; the laptop's GPU does it in 1.5 ms |
| **D · Canonical visit store** | **NO** | Edge SQLite is the truth |
| **D · Holder of V380 / ingest credentials** | **AVOID** | Give the phone *capabilities*, never secrets |
| **D · Tailnet Lock signing node** | **CANNOT** | "You cannot use an Android device as a signing node" (kb/1226, `VERIFIED`) |

---

## 3 · Ideal edge / event architecture

```
CAMERA PIXELS (V380 app window today · RTSP after unlock · PoE later)
   │  CaptureMux  rtsp → wgc → replay   (source generation = "<lane>.<restores>")
   ▼
FrameHealth → SceneLock/pose → DetectorCouncil → tracks → PreexistingCensus → EntryPortal + BayLatch
   ▼  normalized sighting events (Frigate-shaped)          ← already what VisionPipeline._emit() produces
┌──────────────── visitd DURABILITY BOUNDARY (one VisitTracker, one SQLite WAL) ────────────────┐
│ ledger (visits, outbox, dead_letter)  +  NEW shop_outbox (PR 3)  +  NEW heartbeat_log (local) │
└──────────────┬──────────────────────────────────────────────────┬─────────────────────────────┘
               ▼ ordered, retried                                 ▼ ordered, retried (PR 3)
        StateNour /api/devices/{id}/events            nickstire /api/camera/visits + /heartbeat
               ▼                                                  ▼
        owner brief / anomalies                        Lot admin · Cameras panel · commissioning
```

Rules: one state machine (never a second `VisitTracker` beside visitd); every cloud target is a **projection** with its own outbox row; a track path never crosses a source generation; idempotency keys are `visitId+seq` for visits and `(producerInstanceId, heartbeatSeq)` for heartbeats (both `IMPLEMENTED`); commissioning rows carry `dataClass`.

---

## 4 · Exact topology today, and the two futures

**Today (`VERIFIED` by `tailscale status --json`, `tailscale ping`, MASTER-PLAN §probe):**

```
tailnet tailae7855.ts.net (2 devices, no routes, no tags, no grants beyond default)
  nattynour     100.118.151.61  Windows  — this laptop; producer (WGC); at HOME (192.168.1.x)
  nicks-s25-fe  100.68.169.85   Android  — ONLINE; at HOME (192.168.1.180); PrimaryRoutes = none
shop LAN 192.168.0.0/24 — Fios gateway .1; SHOPINSIDE .154 (1C:4E:A2:C2:CE:37); SHOPSIGN .155 (1C:4E:A2:C2:F0:6D)
                           both: TCP 8800/9800 only (P2P), no 554/8899 until the unlock; no shop PC on the LAN
```

**Future 1 — next shop session (zero cost):** phone plugged in on shop Wi-Fi advertises **`192.168.0.154/32, 192.168.0.155/32`** (host routes, not the `/24`); approved once in the admin console; laptop at home reaches the cameras through it for non-destructive probes and, after the unlock, for `ffprobe`.

**Future 2 — an always-on box at the shop** (the laptop left there, or an N150 mini-PC): it joins as `tag:nicks-edge`, advertises the same two `/32`s (Windows supports it; enable IP forwarding — the cmdlet is `LIKELY` `Set-NetIPInterface -InterfaceAlias Tailscale -Forwarding Enabled`, the doc only says forwarding is required), key expiry disabled (tagged devices default to that — kb/1085 `VERIFIED`), runs the Edge Control API on `127.0.0.1:8791` published with `tailscale serve --bg 8791`. Tailscale SSH server is **Linux/macOS only** (kb/1193 `VERIFIED`) — so on Windows the phone gets the API, never a shell.

**Grants (deny-by-default), the whole policy:**
```jsonc
{ "tagOwners": { "tag:nicks-edge": ["autogroup:admin"], "tag:phone": ["autogroup:admin"] },
  "grants": [
    { "src": ["autogroup:member"], "dst": ["tag:nicks-edge"], "ip": ["tcp:443", "tcp:8791"] },
    { "src": ["autogroup:member"], "dst": ["192.168.0.154/32", "192.168.0.155/32"],
      "ip": ["tcp:554", "tcp:8899", "tcp:8800", "icmp:*"], "via": ["tag:nicks-edge"] }
  ] }
```
`via` (grants reference, `VERIFIED`) means the cameras are reachable **only through the edge router**, never through a phone that happens to advertise them later. Security posture now: **device approval** (all plans, `VERIFIED`) + grants; Tailnet Lock deferred (Android cannot sign; the "mutually exclusive with device approval" claim is `UNVERIFIED`).

---

## 5 · Phone commissioning / control UI

A mobile-first admin route, **`/admin/lot/commission`**, in the existing nickstire PWA (owner/manager RBAC already exists) — no native app, no new login. Reached over the tailnet when the shop PC exists; over the public site until then (it is the same admin you already use from the phone). Screens:

1. **Run** — `Start run` mints `C-YYYYMMDD-NNN`, records the phone's clock offset by five round-trips to `/api/camera/clock` (RTT, jitter, offset), and shows a live Cameras strip (state pill + facets) — you do not start a run against a `PRODUCER_OFFLINE` camera.
2. **Truth** — six thumb-sized buttons `OUTSIDE · ENTERING · INSIDE LOT · IN BAY · EXITING · OUTSIDE`; each tap stores `{runId, event, phoneWall, phoneMono, serverReceipt}` in `commissioning_truth_events`. Optional photo per tap (goes to evidence, retention 30 d).
3. **Report** — auto-generated on `End run`: human vs machine timeline (Δ per transition), source generations during the run, health states during the run, cloud ingest lag, admin visibility lag, duplicates/misses, verdict PASS/FAIL. A FAIL packages the run as a replay fixture (§10).
4. **Review** — the active-learning queue (§10): clips flagged by disagreement; five labels.

Everything the phone can *do* is a capability on an API; the phone never holds the ingest key (the PWA is authenticated by the admin session, the server holds the key).

---

## 6 · First-ingestion runbook (next physical session, in order)

Gate A — **first commissioning ingest** (no customer data touched):

1. Before leaving home: merge #2251, apply 0120 from the admin (Run migrations), confirm the Cameras panel shows **`never ingested`** for `sign` and **`not commissioned yet`** for `inside` (not `cameras: []`).
2. Still at home: run `python -m vision.run_live --post-to https://nickstire.org/api/camera/visits --mode shadow --seconds 300` against the V380 window (cloud relay works from home). **Accept:** the `sign` card turns `CALIBRATION_INVALID · census mode` within 30 s, then `HEALTHY` when re-run with `--calibration scratchpad/shopsign_calibration.json`. This is the first infrastructure fact ingested — before anyone drives anywhere.
3. At the shop, phone plugged in: Tailscale → Settings → Subnet routing → Add route `192.168.0.155/32`, then `.154/32`; approve in the admin console; from the laptop `Test-NetConnection 192.168.0.155 -Port 8800` (expect True), `-Port 554` and `-Port 8899` (expect False until the unlock). Record all three in the run.
4. Run the `ceshi.ini` unlock on SHOPSIGN exactly as MASTER-PLAN §3.3 (non-destructive, one camera, never with port/password keys). Re-test 554/8899 through the phone route. Either outcome is a result; WGC stays the source regardless.
5. Laptop at the shop on shop Wi-Fi: save a reference frame, confirm the calibration polygons still match (pose delta < threshold), start `run_live --post-to … --commissioning-run C-20260910-001 --calibration …`.
6. Confirm every already-parked car is `PREEXISTING` (occupancy, never an arrival) for 5 minutes — 0 arrivals.
7. Known car, starting fully outside the portal; you on the phone tapping the six truth buttons; car enters, pauses, enters bay 1 or 3, exits.
8. **Accept:** exactly 1 `vehicle_visits` row with `dataClass=COMMISSIONING`, state sequence matches truth within ≤ 2 s per transition, zero rows for parked cars, `camera_health_events` shows no unexpected transitions.
9. Idempotency: resend the same `visitId+seq` (0 new rows), send an older seq (no regression), restart `run_live` (new `producerInstanceId`, heartbeat accepted at seq 1), replay the evidence packet.
10. End run → report → if PASS, the run is `CONTROLLED-FIELD-PROVEN`; if FAIL, it is a fixture.

Gate B — **first production visit**: only after PR 2 (durable lane) and PR 3 (durable projection) merge, restart-recovery is proven on site, and Gate A passed twice.

---

## 7 · Health lattice and SLOs (`IMPLEMENTED` #2251)

Six facets → one state, precedence `NEVER_INGESTED > PRODUCER_OFFLINE > STALE > CAMERA_OFFLINE > CALIBRATION_INVALID > DEGRADED_VISION > CLOUD_BACKLOG > HEALTHY`. Initial thresholds (proposed, not yet measured over 30 days): heartbeat 30 s · STALE > 60 s · PRODUCER_OFFLINE > 120 s · healthy-frame age > 15 s on the producer's clock → CAMERA_OFFLINE · backlog warn > 60 s. **A quiet lot is HEALTHY.** Alert suppression: alert on *transitions* (the events table), never on state; one alert per camera per state per 30 min; nothing alerts overnight for CLOUD_BACKLOG under 5 min. Channel: statenour web push / Telegram (exists) — wire in PR 7.

---

## 8 · Self-healing and Windows deployment (PR 4)

Two execution modes: **headless** (RTSP; a Scheduled Task at boot, no session) and **interactive** (WGC; an AtLogOn task under a dedicated restricted account, because WGC needs a desktop session and Session 0 has none). One supervisor, two watchdog layers: the OS restarts a dead process; the application watchdog restarts a *live* process whose heartbeat, frames, or outbox stop progressing (exponential backoff with jitter, restart budget, never thrash). `doctor-edge-runtime.ps1` checks Python, deps, model digest (`fetch_models.PINNED`), config, calibration, DPAPI secret, disk, source, heartbeat. Secrets: DPAPI per-user (`Export-Clixml` of a `SecureString`), never a plaintext `.env` on the shop machine. Measure, don't assume, lock-screen survival for WGC.

---

## 9 · Camera / source / calibration strategy

- Identity by **MAC + DHCP reservation** (Fios: Advanced → DHCP reservation), never by IP; probe order: last-known IP → ARP → 8800/9800 fingerprint → 8899 ONVIF → 554 RTSP validate.
- **Dual-source same-camera validator** when RTSP lands: perceptual hash + timing offset between RTSP and WGC; a failover source must prove *same camera*, not "returns pixels".
- **Source generation** `<lane>.<restores>` (`IMPLEMENTED` in the heartbeat); on change: invalidate candidate paths, re-arm census, hold confirmed visits as visibility-degraded.
- **Pose**: SceneLock changed-fraction (`IMPLEMENTED`); tier 2 = ORB + RANSAC homography with reprojection error; small drift may re-map zones, large drift = `CALIBRATION_INVALID`, never auto-recalibrate a different scene.
- V380/Anyka claims: WGC capture `VERIFIED`; the `ceshi.ini` family unlock `LIKELY` (2026 community reports, other HsAk firmware); this exact `Hw_HsAKQQXG_WIFI_20230421` build honouring it `UNVERIFIED`; flashing **rejected**.
- Milestone/VMS: XProtect Essential+ is free for up to 8 cameras and Windows-only (`VERIFIED`, [milestonesys.com](https://www.milestonesys.com/products/software/xprotect/essential/)); Agent DVR is free for personal use, business needs a subscription ([ispyconnect.com](https://www.ispyconnect.com/)). **Neither can see a P2P-only V380 today**, so no VMS is adopted now. What we steal instead: **evidence lock** → a `pinned` flag on evidence packets exempt from retention; **bookmarks** → commissioning truth events + operator corrections as first-class annotations; **failover recording server** → CaptureMux generations; **device packs** → the expected-camera registry; **system monitor thresholds** → the lattice. Revisit Essential+ only for the PoE camera as a recorder, if recording is ever wanted.

---

## 10 · Evidence, replay and the active-learning loop (PR 6/7)

- Every emission already writes an `EvidencePacket`; add `pinned` + `retention_until`; retention: raw observation 7 d, evidence frames 14 d, commissioning 30 d, pinned = never.
- **Every failed commissioning run and every operator correction becomes a fixture** under `camera-bridge/tests/fixtures/field/<runId>/` with a generated `test_<runId>.py`; the suite grows by real defects only.
- Review queue triggers: council disagreement, portal crossing within 10 % of threshold, pose marginal, frame health borderline, track split, plate candidates conflict, operator correction. Labels: real arrival · drive-by · preexisting · false track · camera moved. Sync only the flagged clips; never bulk footage.

## 11 · Visit / identity / customer / RO model

Visit = immutable presence episode (`IMPLEMENTED`). Plate = evidence, never identity. Add `visit_links (visitId, entityType VEHICLE|CUSTOMER|REPAIR_ORDER|APPOINTMENT, linkClass EXACT|CONFUSABLE|AMBIGUOUS|MANUAL|INFERRED, confidence, evidenceRef, correctedBy/At)`; only EXACT or MANUAL is actionable. Repeat-vehicle token = HMAC(key_version, normalized plate), key rotated; readable plate text keeps short operational retention only. Corrections are additive audit events, never row surgery.

## 12 · Operational intelligence (after visits flow)

Rules, each with a suppression window and a "why" the operator can open: arrived-but-no-RO after 10 min · ready-but-still-on-property · open-RO-but-camera-says-departed · closing reconciliation ("7 remain: 4 open ROs, 1 overnight, 1 shop vehicle, 1 unmatched") · unexpected overnight movement · same vehicle back within 14 d of a completed RO (a *review signal*, never an accusation) · appointment ↔ visit matching · tow/vendor/employee/shop-vehicle suppression · drop-off vs waiter as a probability. **No technician ranking from camera dwell** — ever.

## 13 · Security / privacy

Dedicated `CAMERA_INGEST_KEY` on Railway, then remove the `STATENOUR_SYNC_KEY` fallback the route documents; DPAPI on the edge; loopback-only services behind Serve (`Tailscale-User-Login` headers trusted only from localhost — kb/1312 `VERIFIED`); Funnel never; device approval + grants + `via`; phone loss = revoke the node in the admin console (nothing secret is on it); evidence retention as §10; plate minimization as §11. Ohio ALPR bill status: `UNVERIFIED` here — architect for minimum retention regardless.

## 14 · 30 / 90 / 365-day failure modes

30 d: reboot/logon recovery, V380 freezes, Wi-Fi drops, dusk transitions, someone minimising the app (now counted: `restores`), dead letters. 90 d: DHCP churn (reserve now), V380 app layout changes breaking the crop, lens dirt/spiders/glare, calibration aging, key rotation, WAL growth (checkpoint starvation — monitor `sqliteWalBytes`), model upgrades. 365 d: a replaced camera inheriting an old calibration, KPI definitions drifting unversioned, fixtures no longer representative, operators learning workarounds. Rule: **everything important has an identity, version, timestamp, provenance, freshness threshold, retention policy and replay path.**

## 15 · Prioritized PR sequence (files)

**Status as of 2026-09-09 ~22:00 ET.** Everything through PR 4 has landed or is in review;
the plan below was written before any of it and is kept honest by marking what changed.

| PR | Scope | Status |
|---|---|---|
| #2250 | pose gate · self-heal by title · loop detector · on-lot count · README/compose/Funnel corrections | **MERGED** `151316793` |
| #2251 | runtime truth: heartbeats, 6-facet lattice, commissioning class, Cameras panel | **MERGED** `b3dc22a84`; migration 0120 **APPLIED** |
| #2252 | this plan | **MERGED** `28a5f108b` |
| #2253 | durable shop projection (`shop_outbox`) + the tracker-injection fix | **MERGED** `7019dc571` |
| #2255 | edge runtime · commissioning · 24/7 supervision · 2 guard defects | **OPEN**; migration 0121 to apply after merge |
| PR 5 | source policy config (`sources: [rtsp, wgc, replay]`) + same-camera validator | not started |
| PR 7 | evidence pin/retention, review queue, push/Telegram alerts on transitions | not started |
| PR 8 | Edge Control API (`127.0.0.1:8791`) + Serve + grants + app caps | not started |
| PR 9 | ops intelligence rules + `visit_links` | not started |

**Two corrections to §3 and §15, from building it.** The plan said "do not build a second
`VisitTracker` beside visitd" — there never was one: `vision/pipeline.py` already imported
visitd's. What was missing was only PERSISTENCE, so the join (`camera-bridge/edge_main.py`)
was far smaller than PR 2 estimated. And the `tracker=` parameter that join depends on was
BROKEN and had never run: injecting a tracker set `_parse_event = None`, so a real
`VisitTracker` was handed raw dicts and died on `ev.time` at the first emission. The only
test covering it injected a dict-accepting stub — the wiring was proven to call *something*,
never to call the right thing.

## 16 · Same-day, no-purchase actions

1. Merge #2251 when CI is green (everything but the known `security` red) → apply 0120 (operator: admin → Run migrations) → confirm the Cameras panel.
2. From home: `run_live --post-to … --mode shadow` for 5 minutes → the first HEALTHY/CALIBRATION_INVALID heartbeat in production. No shop trip needed.
3. Phone: Samsung Settings → Battery → Background usage limits → **Never sleeping apps** → add Tailscale (`LIKELY` exact menu path; the setting itself exists). Leave Tailscale connected.
4. Admin console: turn on **device approval**; create `tag:nicks-edge` / `tag:phone`; paste the §4 grants.
5. Provision `CAMERA_INGEST_KEY` on Railway (operator; names-only check below says whether it exists).
6. Prepare the commissioning kit for the next visit: laptop, phone charger, the calibration JSON, `Test-NetConnection` one-liners, the `ceshi.ini` SD card.

## 17 · Purchases only after measured triggers

Nothing now. A fixed PoE ONVIF driveway camera **only if** after 30 measured days WGC availability is below business-hours SLO for session/app reasons, or SHOPSIGN must be re-posed so often that calibration availability is poor, or the unlock never holds across power cycles. A plate camera only if a labelled benchmark shows plate geometry (size/angle/blur/glare) is the limit. Storage only when measured retention + backlog crosses a ceiling after tuning. The detector is 1.5 ms — no accelerator.

## 18 · Rejected / deferred

Reject: any VMS or Frigate as a *prerequisite* (P2P blocks them); plate as identity; auto customer binding from confusable OCR; raw video upload; a green/red camera dot; rewriting visitd durability; running V380 as LocalSystem; firmware flashing; applying `ceshi.ini` to SHOPINSIDE before SHOPSIGN is proven; the phone as a permanent router; Tailnet Lock now. Defer: LPR until driveway geometry says plates are readable; employee analytics indefinitely; natural-language answers until evidence lineage is first-class.

## 19 · Quantitative acceptance gates

Commissioning: 0 false arrivals across restart/preexisting/freeze/PTZ cases; exactly 1 visit per controlled entry; 1 TiDB row per `visitId` after replay; older seq cannot regress; every row carries source/calibration/model provenance; `dataClass=COMMISSIONING`; health never HEALTHY with stale frames. Performance: ≥ 4 fps analysed, healthy-frame age < 3 s, inference p95 < 30 ms, local transition < 1 s, cloud ingest p95 < 5 s, admin visibility < 20 s. Recovery: crash → restarted < 2 min; logon → WGC sensing < 2 min; source failure → fallback < 15 s; WAN recovery → backlog drained < 2 min. Accuracy before operational trust (after labelled real visits): arrival precision ≥ 99 %, recall ≥ 95 %, departure precision ≥ 99 %, bay occupancy ≥ 98 % — precision over recall: inventing an arrival corrupts the model, missing one is a nuisance.

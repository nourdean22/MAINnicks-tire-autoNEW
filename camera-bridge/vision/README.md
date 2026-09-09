# camera-bridge/vision — the vision operating layer

Turns cheap V380 pixels into **trustworthy** shop events, sitting immediately upstream
of the shipped `visitd` state machine. `visitd` is untouched: it stays a pure function
of the event stream it is fed. The entire point of this package is to feed it an
**honest** stream.

## The defect this exists to kill

The 2026-09-09 live proof-of-concept connected real SHOPSIGN pixels to `visitd` and
promoted cars that were **already parked** to `CONFIRMED_ARRIVAL`. "Present in the lot
for 45 seconds" is not "arrived". `visitd` cannot defend itself against that — it is a
pure function of its input — so preexisting-object, camera-motion and capture-integrity
gating **must** happen at the edge. That is this package.

## Invariants (each asserted by a test that fails if it regresses)

1. A vehicle present at startup or right after a reconnect is **PREEXISTING**: it counts
   toward occupancy and never reaches `visitd`.
2. While the camera is moving or its pose is untrusted, **no visit is created**. Open
   visits survive, marked degraded.
3. A new visit requires **explicit entry evidence** — an outside→inside portal crossing
   on the vehicle's ground contact point. Dwell never invents an arrival.
4. **Motion alone can never confirm an arrival.** With no neural detector present the
   pipeline reports occupancy and refuses to create visits.
5. A frozen, stale, or **unverified** capture cannot mint arrivals. Recovery counts as a
   reconnect, which re-arms the preexisting census.

## Measured on this machine, 2026-09-09

Intel Core Ultra 7 266V / Arc 140V, Windows 11 26200, Python 3.14.4, OpenVINO 2026.3.1.

**Detector latency**, Intel `vehicle-detection-0200` FP16, 40 real captured frames:

| Device | mean | p95 | throughput |
|---|---|---|---|
| GPU (Arc 140V) | 1.54 ms | 1.68 ms | 488 fps |
| NPU | 1.90 ms | 2.02 ms | 404 fps |
| CPU | 2.79 ms | 3.29 ms | 315 fps |

All three devices are available and all three run the model. `AUTO` does not select the
NPU on its own, so each is compiled explicitly. Reproduce with
`python -m vision.benchmark_openvino --model <ir.xml> --frames <dir> --devices CPU,GPU,NPU`.

**Detection quality** on a real SHOPSIGN frame: every parked vehicle boxed tightly
(silver SUV 1.00, red car 0.94, part-occluded car at the frame edge 0.88; white pickup
1.00 and dark SUV 1.00 in the lot pane) with **no false positives on the empty apron** —
the exact surface where MOG2 fired continuously on shadows and pavement texture.

**Desktop capture lanes**, all three measured against the V380 client:

| Lane | Result |
|---|---|
| `WgcWindowSource` (Windows Graphics Capture) | **Adopted.** 180 frames in 13.9 s (12.9 fps) at 1280x720 from a fully occluded window. No raising, no resizing. |
| `V380WindowSource` (`mss` screen region) | Fallback only. Captures SCREEN pixels: with another window in front it returned a browser screenshot, which the detector scored as one whole-frame "vehicle" at every threshold. Correct only when the window is unoccluded. |
| `PrintWindow` incl. `PW_RENDERFULLCONTENT` | **Rejected with evidence.** Returns app chrome plus a stale video surface — across 10 samples only ~399 pixels ever changed (the burned-in clock), never the scene. |

Two further traps, both measured: the V380 app publishes **more than one top-level window
with the same title**, so `FindWindowW` returns an arbitrary one; and "pick the largest"
then selects a blank window. `find_window` scores candidates by pixel standard deviation
and caches the winner.

## Components

| Module | Role |
|---|---|
| `capture.py` | `CaptureMux` + WGC / mss / RTSP / Replay / Synthetic sources behind one `Frame` interface |
| `framehealth.py` | FPS, frame age, dHash duplicate ratio, frozen-pane detection |
| `scenelock.py` | Global-motion detection; freezes visit creation during a PTZ pan |
| `census.py` | PREEXISTING classification at startup and reconnect |
| `detector.py` | `DetectorCouncil`: motion gate → tiny vehicle detector → adjudicator |
| `track.py` | `TrackGraph`, ByteTrack-style two-stage association |
| `geometry.py` | Zones, `EntryPortal` crossing, optional ground-plane homography |
| `baylatch.py` | Latched bay occupancy + visit timings that keep unknowns unknown |
| `fingerprint.py` | `VehicleFingerprint` evidence/contradictions + keyed-HMAC `PrivacyToken` |
| `platelab.py` | Frame-quality scoring, temporal OCR consensus, EXACT/CONFUSABLE/AMBIGUOUS lookup |
| `evidence.py` | `EvidencePacket`: why the system said a car arrived |
| `pipeline.py` | Wires it all into `visitd` |
| `replaylab.py` | Virtual-time replay + deterministic fault injection |

## Run

```
python -m pytest vision/tests/test_vision.py -q
python -m vision.run_live --seconds 120 --model <ir.xml> --device GPU --save-frame lot.png
python -m vision.run_live --seconds 600 --model <ir.xml> --calibration lot.json --evidence out/
```

Without `--calibration`, `run_live` runs in **census mode**: vehicles, occupancy, health
and PTZ state only. It refuses to claim arrivals, because an entry line is meaningless
until someone has drawn where the driveway actually is.

## Claim states — do not merge these

- **Implementation-complete**: every component above, 26 tests green.
- **Simulation-proven**: the five invariants, via synthetic scenarios and fault injection
  driving the real `visitd` tracker.
- **Controlled-field-proven**: detector latency and detection quality on real SHOPSIGN
  frames. Nothing else yet.
- **Long-horizon-unproven**: false-arrival rate, plate accuracy, bay precision/recall,
  and every reliability number over days. These require recorded shop footage and
  controlled drive-throughs, and no number should be quoted for them until then.

## Licensing

OpenVINO and Intel Open Model Zoo IR models are Apache-2.0. AGPL Ultralytics/BoxMOT
remain rejected. D-FINE pretrained weights are **not** vendored: the distributed-weights
licence (Objects365-derived) was still unresolved as of 2026-08-19 — repository licence
is not weight licence.

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
4. **Motion alone can never confirm an arrival.** Enforced by reading each detector's
   `can_confirm` flag, not by convention: a non-confirming detector wired as the
   *primary* is refused arrival authority just as one wired as the motion gate is.
   Injected detections must declare their own authority, and a track's authority follows
   the current frame rather than latching on first sight.
5. A frozen, **looping**, stale, or **unverified** capture cannot mint arrivals. The
   verification check fails CLOSED, so a source that never sets the flag is refused
   rather than trusted. Recovery counts as a reconnect, which re-arms the census.

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

**Read that alongside the model's own numbers, not instead of them.** Intel's model card
gives `vehicle-detection-0200` as 0.786 GFLOPs, 1.817M parameters, one class, 256x256 BGR
in `B,C,H,W`, scoring **AP 0.254 @ IoU 0.50:0.95 on Intel's internal test set**. That is a
deliberately cheap detector, not an accurate one. One good frame at Nick's is not a
detection rate, and the modest AP is exactly why the design is a *council*: this model is
the always-on first stage, and ambiguous or entry-critical frames escalate to a stronger
one. Treating it as the final word would repeat the MOG2 mistake with a bigger model.

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

## What is NOT deployed by this package

**`docker-compose.yml` still runs `visitd` against raw Frigate MQTT events.** This package
does not replace that consumer, so the deployed stack retains the presence-equals-arrival
behaviour until it is wired in. Saying the false-arrival defect is "fixed" without that
sentence would be fixing it in a lane nothing consumes.

What exists today: `run_live` drives the pipeline and, with `--post-to`, POSTs visits to
the nickstire ingest endpoint (`POST /api/camera/visits`) that backs the Lot admin
section. That is the lab lane, end to end and honest about being a lab lane. Replacing
the compose consumer is the next PR, and it is deliberately separate: swapping the
production event source deserves its own reversible change with its own gates.

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

## What an independent review found

An adversarial review of this package on 2026-09-09 found, and this version fixes, a
defect that mattered: **`can_confirm` was a dead flag.** Every detector declared it and
`DetectorCouncil.run` never read it, so invariant 4 held only because MOG2 is
conventionally wired as the motion gate. Wired as the *primary*, a motion detector was
granted arrival authority and emitted a real visit. The test covering that invariant would
have passed with the flag deleted, because it exercised the `primary is None` branch
instead. Both are fixed, and the new test is red-green verified: it fails when the defect
is re-introduced.

Four related fail-open paths went with it: injected detections hardcoded arrival
authority; a track's `confirmable` latched True forever and survived a detector outage; a
frame *missing* `window_verified` passed the gate that an explicit `False` failed; and a
3-frame cached loop passed frame health because it never produces consecutive duplicates.

Two honesty fixes: `PlateLab` reported canonical agreement of 1.00 for reads whose raw
strings disagreed, which `fingerprint.compare` would call a hard contradiction, so raw
disagreement now caps the verdict at CANDIDATE and both numbers are reported; and
`score_crop` had no caller, leaving the "reject junk before spending OCR" gate off in
practice.

## Claim states — do not merge these

- **Implementation-complete**: every component above, **36 tests green** (including the real OpenVINO detector on the GPU), with every new canary red-green verified against the defect it guards.
- **Simulation-proven**: the five invariants, via synthetic scenarios and fault injection
  driving the real `visitd` tracker.
- **Controlled-field-proven**: detector latency and detection quality on real SHOPSIGN
  frames. Nothing else yet.
- **Long-horizon-unproven**: false-arrival rate, plate accuracy, bay precision/recall,
  and every reliability number over days. These require recorded shop footage and
  controlled drive-throughs, and no number should be quoted for them until then.

## Licensing

Verified 2026-09-09 against primary sources, stating repository licence and weight
licence separately, because they are not the same question:

- **`open_model_zoo`** — the repository `LICENSE` is Apache-2.0 and contains no clause
  carving out model weights, trained models or datasets as distinct from source. The
  `vehicle-detection-0200` model card states no licence of its own. The honest position is
  therefore "Apache-2.0, with no separate weight terms asserted", not "the weights are
  definitively Apache-2.0".
- **`windows-capture`** — MIT per PyPI metadata; 2.0.1, `requires_python >=3.9`.
- **AGPL Ultralytics / BoxMOT** — remain rejected. See `docs/UPSTREAMS.md`.
- **D-FINE pretrained weights** are **not** vendored: the distributed-weights licence
  (Objects365-derived) was unresolved as of 2026-08-19. Repository licence is not weight
  licence, which is why this list separates the two.


## Outside-service recognition: shadow evidence before authority

Nick's can legitimately service a vehicle outside the indoor bays (for example tire, plug, or
jack work). The deterministic geometry layer can prove that a vehicle arrived, entered a
calibrated bay, exited it, or departed. It **cannot** infer that a stationary no-bay vehicle is
"waiting" or "being serviced" from geometry alone.

The first production-safe layer therefore does two separate things:

1. **NO_BAY_ACTIVITY_REVIEW** — when a confirmed arrival has remained *observably stationary*
   outside every calibrated bay for `--service-review-seconds` (30s default), the existing
   bounded hard-case recorder saves one pre/post clip. This label means only "ambiguous and
   worth review." It intentionally gathers both waiting/parking negatives and real outside-
   service positives.
2. **OutsideServiceShadow** — `vision/service_shadow.py` accepts auxiliary cues from an
   open-vocabulary detector or video reasoner and emits `OUTSIDE_SERVICE_CANDIDATE` only
   after all of these persist around the same vehicle: no bay, stationary dwell, nearby
   person/technician, nearby mechanical cue, and temporal repetition.

The returned `evidence_support` is a deterministic sorting score, **not a probability**.
`ServiceEvidenceLedger` writes candidate metadata as `authority=shadow_only`. Neither the
shadow scorer nor its ledger imports or mutates VisitTracker/BayLatch/shop state.

This split is deliberate: local hard-case clips become the test set that a future Grounded
SAM 2 / video-MLLM sidecar must pass. A model earns authority from measured precision on
Nick's actual camera/weather/work patterns; installing a newer model does not grant it truth.

Operational corpus sampling can be disabled with:

```text
--service-review-seconds 0
```

or tuned with `EDGE_SERVICE_REVIEW_SECONDS`. This changes only when a review clip is sampled,
not any customer/visit/service classification.

### Offline service-review sidecar

`NO_BAY_ACTIVITY_REVIEW` clips now carry two pieces of provenance the reviewer must never
guess: the canonical vehicle box at the trigger and the exact timestamp of every saved frame.
`vision/service_review_worker.py` consumes only those saved clips. It does **not** run in the
live frame loop.

The first detector adapter is the official Hugging Face Transformers representation of
`IDEA-Research/grounding-dino-tiny`, pinned to a model-repository revision. It grounds
person/mechanic plus jack/tire/wheel/tool/hood cues, then passes them through the already
conservative `OutsideServiceShadow` temporal/proximity rules. The detector itself never gets
visit authority.

Recommended Windows isolation:

```powershell
cd camera-bridge
py -3.12 -m venv .venv-service-review
.\.venv-service-review\Scripts\python.exe -m pip install --upgrade pip

# Install the PyTorch build appropriate for THIS machine from:
# https://pytorch.org/get-started/locally/
.\.venv-service-review\Scripts\python.exe -m pip install -r requirements-service-review.txt

.\.venv-service-review\Scripts\python.exe -m vision.service_review_worker \
  --cases-dir ".\data\hard-cases" \
  --ledger ".\data\hard-cases\service-evidence.jsonl"
```

Once that isolated environment passes a manual one-shot, install the unattended shadow
consumer separately from the live edge producer:

```powershell
powershell -File scripts/install-service-review-worker.ps1 \
  -PythonPath ".\.venv-service-review\Scripts\python.exe" \
  -CasesDir ".\data\hard-cases"

Start-ScheduledTask -TaskName "NickOutsideServiceReview"
powershell -File scripts/doctor-service-review-worker.ps1 \
  -PythonPath ".\.venv-service-review\Scripts\python.exe"
```

The scheduled worker is intentionally a batch sidecar, not another camera daemon. It runs
every 15 minutes by default, refuses intervals below five minutes, uses
`MultipleInstances=IgnoreNew`, and never passes `--force`. A failed or slow review run
therefore cannot block or restart the live vehicle-truth producer. The doctor reports task
state, overlap protection, ML-environment readiness, pending review clips, case-local errors,
and whether every durable candidate row still says `authority=shadow_only`.

Outputs:
- each processed clip gets `service-review.json` with the analyzer identity and shadow result;
- a clip that accumulates sufficient person + mechanical + temporal evidence adds one row to
  `service-evidence.jsonl` with `authority=shadow_only`;
- `episodes=replace` clips are read back from their verified MCAP episode after numbered JPEG
  duplicates are removed; timestamps must match the exact `case.json` provenance;
- old clips that lack exact `frameTimestamps` or `vehicleBox` are skipped rather than
  backfilled from guesses;
- model/inference failure is case-local and visible in that clip's receipt.

The default model is pinned to repository revision
`a2bb814dd30d776dcf7e30523b00659f4f141c71`, which contains `model.safetensors`.
The loader sets `use_safetensors=True`; it must not silently fall back to the legacy
`pytorch_model.bin` pickle artifact.

The default Grounding-DINO model source is Apache-2.0:
https://huggingface.co/IDEA-Research/grounding-dino-tiny

Transformers' Grounding-DINO contract:
https://huggingface.co/docs/transformers/model_doc/grounding-dino

This is still a **measurement lane**, not production classification. Promotion requires a
Nick's-specific labelled corpus with measured false-positive performance across weather,
occlusion, customer waiting, employee walk-bys, and simultaneous vehicles. A newer model or
a higher detector score does not waive that requirement.

For hard clips that object grounding cannot resolve, VideoChat3 4B is a current research
candidate for a second-stage temporal adjudicator; it is intentionally not installed or
claimed live here:
https://github.com/OpenGVLab/VideoChat-Flash


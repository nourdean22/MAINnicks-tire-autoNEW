# Camera vision — measured results, 2026-09-09

Companion to `2026-09-09-camera-vision-live-poc-execution-plan.md`. That document is the
research compendium; **this one contains only things that were measured on the actual
machine and the actual camera feed today**, plus what those measurements change.

Every number below was produced in-session and is reproducible with the command given.
Where something could not be measured, it says so instead of estimating.

---

## 1. Executive truth

**Proven today (controlled-field):**

- Native OpenVINO 2026.3.1 runs on this Python 3.14.4 box and exposes **CPU, GPU and
  NPU**. Intel `vehicle-detection-0200` runs on all three.
- A real vehicle detector produces **tight, correct boxes on real SHOPSIGN pixels**, with
  **no false positives on the empty apron** — the exact surface where MOG2 fired
  continuously.
- Windows Graphics Capture reads the V380 window **while it is fully occluded**, at
  12.9 fps, without raising or resizing the operator's app.
- The `camera-bridge/vision/` pipeline enforces five arrival-truth invariants against the
  **real shipped `visitd`**: 26 tests green.

**Proven today (simulation only):** the five invariants, under synthetic scenarios and
deterministic fault injection. This is not field evidence.

**Not proven, and not claimable:** false-arrival rate, plate accuracy, bay
precision/recall, timestamp error, and every reliability figure over days. These need
recorded shop footage and controlled drive-throughs. No number should be quoted for them.

**Newly blocked:** every direct-stream avenue. See §4.

---

## 2. Corrections to prior assumptions

| Prior claim | Measured reality |
|---|---|
| Python 3.14 blocks the detector stack | **Wrong.** Native OpenVINO 2026.3.1 installs and runs on 3.14.4. Only the separate `onnxruntime-openvino` wheel lags, so it is simply not on the critical path. |
| `AUTO` will pick the best device | **Wrong.** `AUTO` does not select the NPU. Each device must be compiled explicitly, which is why all three are benchmarked. |
| Screen capture of the V380 window is fine | **Dangerously wrong.** `mss` grabs SCREEN pixels; with any window in front it returned a *browser screenshot*, and the detector scored that as one whole-frame "vehicle" at every confidence threshold. |
| `FindWindowW("V380")` finds the video window | **Wrong.** The app publishes several top-level windows sharing that title; "pick the largest" selects a **blank** one. Windows are now scored by pixel variance. |
| The cameras are on the shop LAN we can reach | **Not from this machine.** See §4. |

---

## 3. Measured numbers

### 3.1 Detector latency

Core Ultra 7 266V / Arc 140V, Windows 11 26200, Python 3.14.4, OpenVINO 2026.3.1,
Intel `vehicle-detection-0200` FP16, 40 real captured frames, 40 iterations, post-warmup.

| Device | mean | median | p95 | throughput |
|---|---|---|---|---|
| **GPU (Arc 140V)** | **1.54 ms** | 1.55 ms | 1.68 ms | 488 fps |
| NPU | 1.90 ms | 1.90 ms | 2.02 ms | 404 fps |
| CPU | 2.79 ms | 2.78 ms | 3.29 ms | 315 fps |

```
python -m vision.benchmark_openvino --model <ir.xml> --frames <dir> --devices CPU,GPU,NPU
```

**Reading:** detection is not the bottleneck and never will be at shop scale. A 4 fps
pipeline uses roughly 0.6 % of one device. There is ample headroom for the
DetectorCouncil's heavier second stage, for plate OCR, and for a second camera — on
hardware already owned. **No accelerator purchase is justified by any measurement.**

### 3.2 Detection quality on real SHOPSIGN pixels

Main shop-front pane, 678x381, confidence ≥ 0.30:

| Score | What it is |
|---|---|
| 1.00 | silver SUV, parked |
| 0.94 | red car, parked |
| 0.88 | car at the frame edge, part-occluded |
| 0.31 | white car further back (correctly low) |

Lot pane, 340x193: white pickup **1.00**, dark SUV **1.00**, two distant cars 0.94 / 0.87.

**Zero detections on the empty apron and pavement.** This is the whole case for replacing
MOG2: the same surface generated continuous spurious blobs from shadows and texture.

### 3.3 Desktop capture lanes

| Lane | Verdict | Evidence |
|---|---|---|
| **Windows Graphics Capture** (`windows-capture`) | **Adopted** | 180 frames in 13.9 s = **12.9 fps** at 1280x720 from a fully occluded window. No raising, no resizing. |
| `mss` screen region | Fallback only | Captures screen pixels; returned a browser screenshot when covered. Correct only while unoccluded. |
| `PrintWindow` + `PW_RENDERFULLCONTENT` | **Rejected** | Returns chrome plus a **stale** video surface: across 10 samples only ~399 px ever changed (the burned-in clock), never the scene. |

`windows-capture` and `dxcam` both install on Python 3.14.

### 3.4 Feed liveness

Over 14 s of WGC capture the first and last frames were **byte-identical at every
threshold** and the camera's burned-in clock never advanced: the app's live view was
paused. This is exactly the condition `FrameHealth` exists to catch, and it caught it.

---

## 4. The blocker that outranks everything else

**This machine cannot reach the cameras.**

| Fact | Value |
|---|---|
| This machine's Wi-Fi address | `192.168.1.82/24`, gateway `192.168.1.254` |
| Cameras | `192.168.0.155` (SHOPSIGN), `192.168.0.154` (SHOPINSIDE) |
| ICMP to both | no reply |
| TCP 554 / 8899 / 8800 / 9800 / 80 on `.155` | all closed/unroutable |
| ARP table | contains no `192.168.0.x` host at all |
| V380 app's actual connections | `172.238.45.192:8800` (vendor P2P relay) and `114.55.111.213:8883` (MQTT push) |

So the desktop app is showing the cameras **entirely through the vendor cloud**, not over
the LAN. Consequences, stated plainly:

1. **The `ceshi.ini` unlock, RTSP probing, ONVIF discovery and V380Decoder cannot be
   attempted from here.** They all require a machine on the shop Wi-Fi. This is a
   location problem, not a technical one, and no amount of local work removes it.
2. **The WGC capture lane is not a stopgap** — it is the only lane that works from off
   site, because it rides the same cloud path the app already uses.
3. `Documents\V380` holds only empty `Record` and `Screenshot` folders; there is no local
   device-metadata cache to mine. The app is Qt with bundled FFmpeg at
   `C:\Program Files (x86)\V380`.

---

## 5. What to do next, in order

**On the shop Wi-Fi (operator, on site) — nothing else unblocks this:**

1. Capture before changing anything: device info, firmware/hardware string, device ID,
   IP/MAC, encoding, PTZ presets, and whether an ONVIF toggle exists. Screenshots without
   passwords. Do not reset, update or flash.
2. Probe from a machine on `192.168.0.x`: `Test-NetConnection 192.168.0.155 -Port 554`,
   then `8899`, `8800`, `9800`, `80`.
3. Only then the reversible `ceshi.ini` experiment on **SHOPSIGN only**, and verify with
   `ffprobe rtsp://192.168.0.155:554/live/ch00_1`. Remove the card afterwards. Leave
   SHOPINSIDE alone until SHOPSIGN is understood.

**Off site (no shop access needed):**

4. **Un-pause the V380 live view** and ideally fullscreen SHOPSIGN as a single pane. That
   alone converts the working capture path into a live one.
5. Record 20–30 minutes of real footage during business hours. Everything unproven in §1
   is gated on having footage, not on more code.
6. Draw the lot and driveway polygons on one saved frame (`run_live --save-frame`) and
   pass them as `--calibration`. Until that exists, `run_live` deliberately refuses to
   claim arrivals.

**Purchases:** none are justified. §3.1 shows detection consuming under 1 % of available
compute. Revisit only if measured plate accuracy on real footage proves the PTZ camera's
optics inadequate — which is a lens/placement question, not a compute one.

---

## 6. Acceptance gates and their current status

| Gate | Status |
|---|---|
| Pixel transport runs continuously; alternate source hot-swaps | **Met** (WGC + mss behind `CaptureMux`) |
| Frozen / duplicate pane detected | **Met** (caught a real paused feed) |
| Existing parked cars create zero new arrivals | **Met, simulation** |
| Camera movement creates zero new visits | **Met, simulation** |
| MOG2 alone can no longer confirm an arrival | **Met, structural** |
| Every new visit has explicit entry evidence | **Met, simulation** |
| Contradictory high-confidence plates never merge | **Met, unit** |
| Stationary bay vehicle stays occupied | **Met, unit** |
| Every arrival reconstructable | **Met** (`EvidencePacket`) |
| Recorded shop scenarios reproduce deterministically | **Met** (`ReplayLab`) |
| Detection quality on real pixels | **Met, single frame.** Needs footage for a rate. |
| False-arrival rate on real footage | **Not met — no footage yet** |
| Plate accuracy | **Not met — no footage, no OCR backend wired** |
| Native RTSP / ONVIF | **Blocked — requires shop Wi-Fi** |

---

## 7. Honest limits of this document

Single-frame detection quality is not a detection *rate*. Simulation-proven invariants
are not field-proven ones. A paused feed means today produced **no** live multi-vehicle
tracking run, and none is claimed. The next real increment is footage, not code.

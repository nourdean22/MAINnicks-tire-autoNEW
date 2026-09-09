# Live V380 -> visitd proof-of-concept (runbook)

**What it is.** `live-v380-poc.py` captures the V380 desktop app window off-screen
(the app already holds the PTZ camera's vendor P2P cloud stream, so it works from any
network) and feeds Frigate-shaped events into the SHIPPED `visitd` VisitTracker. It
proves the whole pipeline runs on real SHOPSIGN pixels with no Docker, no model
download, and no purchases.

## Run

```
py -3 camera-bridge/lab/live-v380-poc.py [seconds]
```

Deps (use an isolated venv; do NOT touch a global cv2):

```
pip install opencv-python-headless numpy mss
```

Set `V380_WINDOW_TITLE` if the app window is not titled `V380`. Outputs land next to
the script: `proof.png`, `live_annotated.png`, `events.jsonl`.

## What it PROVES

Live pixels -> detections -> the real `parse_event` + `VisitTracker.handle_event` +
`tick` -> Emissions (ENTERED_ZONE / ARRIVAL_CANDIDATE / CONFIRMED_ARRIVAL / DEPARTING).
The architecture does not depend on Frigate existing.

## What it does NOT prove (read before trusting a number)

- Detection is MOG2 background subtraction: it fires on ANY foreground change --
  shadows, the V380 2/2 pane refresh, the OSD clock, trees, re-detected parked cars.
  A track count is NOT a car count.
- `stationary` fed to visitd is SYNTHESIZED from a coast timer.
- Arrival "evidence" here is a startup-grace + after-grace-appearance PROXY, not a
  calibrated entry-line crossing. It correctly holds cars parked at startup as
  PREEXISTING (they never create a visit), and SceneGuard suppresses frames where
  >33% of pixels change at once (PTZ pan / pane refresh). But MOG2 re-spawns blobs
  from parked cars/shadows after the grace and still mislabels some as arrivals.

**A time-grace cannot fix motion-detector churn.** Only a real vehicle detector
(stable per-car boxes, no re-spawn) plus a calibrated entry-line crossing removes the
false arrivals. That is the `camera-bridge/vision/` platform (DetectorCouncil +
entry-evidence), which supersedes this POC for anything past "the wiring works".

## Where the data goes

`events.jsonl` (one JSON object per emission) next to the script. The POC does not
write to SQLite or the cloud; the production path is `visitd`'s SQLite ledger +
outbox -> the statenour cloud endpoint. See
`docs/research/2026-09-09-camera-vision-live-poc-execution-plan.md`.

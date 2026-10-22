# NicksMax sign counter: choosing the lens and recalibrating

Added 2026-10-21 (counter prep). Nothing here changes the live counter until someone at NicksMax runs it.

The relay serves a 1920x3240 stack of three 1920x1080 lenses on `rtsp://127.0.0.1:8554/live`
(top = shop-left / building frontage, middle = shop-right / side lot, bottom = front / Euclid / PTZ).
`run-sign-crop.ps1` republishes one lens at 640x360, 4 fps on `rtsp://127.0.0.1:8555/sign`, and the
production edge counts cars on it. Today that is the middle lens. Which lens actually sees the
driveway entrance has not been checked by a person.

## 1. Take the stills (read-only, about 10 seconds)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\nourd\NicksMax\repos\NOURCITY\camera-bridge\scripts\nicksmax\grab-sign-lens-stills.ps1
```

It prints `STILLS <folder>` with `stack.jpg`, `top.jpg`, `middle.jpg`, `bottom.jpg`. It never touches
the crop, port 8555, the relay or the edge. `REFUSED: the relay is not serving` means 8554 is down;
`FAILED` in the dark means the solar sign camera has no picture yet. Run it in daylight.

## 2. Pick the lens

The right lens shows a car crossing from the street INTO the lot, with the crossing line fully in frame.
If the middle lens already does, stop here: nothing changes.

## 3. Recalibrate on the new lens (needed before any switch)

The calibration (`data\calib-nicksmax-sign-rtsp.json`, machine-local) is in 640x360 pixels of the
middle lens; on another lens its polygons point at the wrong ground.

1. Make a 640x360 screenshot of the chosen lens (scale `top.jpg` / `bottom.jpg` to 640x360).
2. Copy the current file to `data\calib-nicksmax-sign-<lens>.json` and redraw by hand over that
   screenshot: `lot` (the lot, approach left outside it), `portal` (a band across the entrance that
   straddles the lot edge), `canonical: [640, 360]`.
3. Check it before use: `edge_main.load_calibration` refuses a portal that does not straddle the lot
   (census mode, `calibrationVersion` null). The version is the file's sha256 prefix.
4. Later, `python -m vision.trajectory --store <trajectories.sqlite> --calibration <file>` proposes a
   measured lot polygon, but only from trajectories recorded on that same lens.

## 4. Switch the crop (Nour's go; the counter is live)

1. Back up `C:\Users\nourd\NicksMax\lab\v380-cloud-relay\run-sign-crop.ps1` and `data\calib-nicksmax-sign-rtsp.json`.
2. The supervisor starts the crop with no arguments, so the lens is the script's default. Change
   `[string]$Lens = "middle"` in the repo (a one-line PR, so the daily drift check stays quiet), then
   install it with `install-nicksmax-supervisor-host.ps1`.
3. Put the new calibration at `data\calib-nicksmax-sign-rtsp.json`.
4. End the old crop and the edge; the supervisor restarts both on its next tick.
5. Receipts: `sign-crop-status.log` says `START top-lens crop proxy`, the edge log names the new
   calibration version, and the shop's portal crossings rise above 0 within a busy hour.

Rollback: put both backups back and end the crop and the edge again.

## Edge restarts (finding, 2026-10-21)

The RTSP reader already reopens in-process (`vision/capture.py` `RtspSource._reconnect`), but the
production launcher passes `--stall-exit-seconds 60` (`scripts/nicksmax/run-sign-rtsp-production.ps1`),
so an 8555 outage longer than a minute ends the edge even while its reader is reopening. The
supervisor also kills an edge whose progress lease is over 90 s old (`nicksmax-camera-supervisor.ps1`
sign-edge phase). `--stall-reopen-attempts N` (default 0 = today) keeps the edge and its tracker
while its own reader is still trying. Proposed, not applied: add
`"--stall-reopen-attempts","40"` and raise `--stall-exit-seconds` to 300 in the production launcher,
then compare distinct producerInstanceId per day before and after.

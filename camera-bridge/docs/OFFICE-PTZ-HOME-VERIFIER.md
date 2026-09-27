# Office PTZ home-view verification

The office camera is allowed to pan for interaction intelligence. Its PTZ motor receipt is
**not** absolute-position evidence: Eufy's T8410 event surface tells us that movement occurred,
not what pixels the lens ended on.

This verifier closes that gap with the same measured registration primitive already used by
the fixed-camera `SceneLock`.

## Evidence chain

A home claim is valid only when all of these are true:

1. the office camera produced a fresh `ptzNotify`;
2. a current frame was captured **after** that receipt;
3. that frame registered against the exact operator-approved home reference;
4. source-space shift is within the measured SceneLock threshold (default 6 px);
5. changed-pixel fraction stays below the home-verifier bound;
6. the receipt names the office serial and the exact approved reference SHA-256;
7. the receipt is still within its TTL when StateNour builds the next heartbeat.

Any later PTZ motor receipt invalidates the old home claim. An uncorrelated receipt (for
example a move from the Eufy app) also invalidates it.

## Why this is outside StateNour's Python environment

`apps/statenour/local-agent` deliberately remains dependency-light. NumPy/OpenCV already live
in `camera-bridge`, where SceneLock is tested and measured.

StateNour launches one bounded verifier process only when `ptzHomeOk` is unknown after a
motor receipt. It does not run computer vision every heartbeat.

## One-shot CLI

From any working directory:

```powershell
python C:\path\to\camera-bridge\scripts\verify_home_pose.py `
  --serial T8410P522517180B `
  --reference C:\StateNour\Eufy\office-home.png `
  --current C:\StateNour\Eufy\current.png `
  --receipt C:\StateNour\Eufy\receipts\office-home.json
```

Exit meanings:

- `0`: visually verified home;
- `1`: valid current frame, visually away from home;
- `2`: no trustworthy verdict (capture/decode/config/registration failure).

A valid away verdict is written. Infrastructure failure leaves the prior receipt untouched so
the consumer can reject it by timestamp rather than replacing evidence with a guess.

For live media, prefer the local go2rtc URL and keep it out of the process command line:

```powershell
$env:EUFY_HOME_MEDIA_URL = "rtsp://127.0.0.1:8554/<local-stream-name>"
python C:\path\to\camera-bridge\scripts\verify_home_pose.py `
  --serial T8410P522517180B `
  --reference C:\StateNour\Eufy\office-home.png `
  --rtsp-env EUFY_HOME_MEDIA_URL `
  --receipt C:\StateNour\Eufy\receipts\office-home.json
```

## StateNour configuration

The automatic one-shot launcher stays inert unless every value below exists:

```text
EUFY_HOME_VERIFY_PYTHON=<python from camera-bridge runtime>
EUFY_HOME_VERIFY_SCRIPT=<...\camera-bridge\scripts\verify_home_pose.py>
EUFY_HOME_REFERENCE=<operator-approved home image>
EUFY_HOME_MEDIA_URL=<local RTSP/go2rtc URL>
EUFY_HOME_POSE_RECEIPT=<local receipt JSON path>
EUFY_HOME_REFERENCE_SHA256=<referenceSha256 from the approved reference>
```

Optional controls:

```text
EUFY_HOME_POSE_MAX_AGE_SECONDS=300
EUFY_HOME_VERIFY_TIMEOUT_SECONDS=25
EUFY_HOME_VERIFY_COOLDOWN_SECONDS=60
```

The reference SHA is the verifier's decoded-pixel SHA-256, not a filename or trust-by-path
shortcut. If the configured SHA is absent or different, StateNour refuses the receipt.

## Commissioning the approved reference

Do this only after the office media path is live on the shop-side host.

1. Put the camera on the intended permanent home view.
2. Capture a fresh frame from the same media lane the verifier will use.
3. Save that frame as the immutable home-reference file.
4. Run the verifier once using that file as both `--reference` and `--current`.
5. Record the emitted `referenceSha256` as `EUFY_HOME_REFERENCE_SHA256`.
6. Move the camera away and prove exit 1.
7. Return to home, wait for `ptzNotify`, and prove exit 0.
8. Only then let the production heartbeat surface `ptzHomeOk=true`.

## Current live truth

As of 2026-09-27:
- the verifier is code/test/CLI proven;
- the comparison T8410 has physical PTZ + media proof;
- the office T8410 remains `MEDIA_DEGRADED` because its P2P/media path is unreachable from
  the current NattyNour-hosted bridge;
- therefore no office home reference is promoted and no live office-home claim is made.

The intended next host is the Windows machine on the office/shop camera LAN. Moving the Eufy-only
runtime there is the prerequisite for live reference capture and home-pose commissioning.

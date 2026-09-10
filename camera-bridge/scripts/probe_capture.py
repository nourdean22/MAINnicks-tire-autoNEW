"""Sample the capture window and report whether the producer would call it a LIVE FEED.

WHY THIS EXISTS. The doctor used to check only that a window TITLED "V380" existed, and it
passed happily for hours while that window showed a menu pane with nothing usable on it --
a false green in the one tool whose entire job is catching false greens. "The app is open"
and "the producer can see a camera" are different claims and the doctor only made the first.

Observed 2026-09-09: `capture window PASS 'V380' (pid 19564)` while the pane was static and
the producer's own FrameHealth was rejecting every frame. The operator had no way to see
that from the preflight.

Prints ONE line of `key=value` pairs for the PowerShell caller to parse, and exits:
  0  live feed
  1  a window, but its frames are not usable (frozen / looping / too slow)
  2  could not capture at all
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main() -> int:
    title = sys.argv[1] if len(sys.argv) > 1 else "V380"
    samples = int(sys.argv[2]) if len(sys.argv) > 2 else 32
    try:
        from vision.framehealth import FrameHealth
        from vision.run_live import build_source
    except Exception as exc:  # noqa: BLE001 - the doctor must report, never traceback
        print(f"error=import status=unavailable detail={type(exc).__name__}")
        return 2

    # CROP LIKE THE PRODUCER DOES. `edge_main` defaults to the measured main pane
    # (`SHOPSIGN_MAIN_PANE`) and only captures the whole window under an explicit
    # `--no-crop`. This probe passed `crop=False`, so it was sampling the V380 app's
    # sidebar, device list, toolbar and preview strip -- static furniture that is not the
    # camera. A preflight that measures a DIFFERENT REGION than the runtime cannot certify
    # the runtime: the chrome drags `distinct` down and makes a live pane look static.
    crop = os.environ.get("PROBE_NO_CROP", "") == ""
    try:
        src = build_source("wgc", None, title, crop)
    except Exception as exc:  # noqa: BLE001
        print(f"error=source status=unavailable detail={type(exc).__name__}")
        return 2

    fh = FrameHealth()
    state = None
    got = 0
    for _ in range(samples):
        try:
            frame = src.read()
        except Exception:  # noqa: BLE001 - a read failure is data, not a crash
            frame = None
        if frame is not None:
            got += 1
            fh.update(frame.ts, frame.image)
            state = fh.state(frame.ts)
        time.sleep(0.25)

    if state is None or got == 0:
        print(f"error=noframes status=unavailable read={got}")
        return 2

    # The producer's OWN verdict, not a re-implementation of it: whatever `ok` means to
    # `VisionPipeline` is exactly what the preflight must report, or the two can disagree.
    if state.ok:
        verdict = "live"
    elif state.frozen:
        verdict = "frozen"
    elif state.looping:
        verdict = "looping"
    else:
        verdict = "slow"

    print(
        f"status={verdict} read={got} fps={state.fps:.2f} distinct={state.distinct} "
        f"dup_ratio={state.dup_ratio:.2f} frozen={str(state.frozen).lower()} "
        f"looping={str(state.looping).lower()} crop={str(crop).lower()}"
    )
    return 0 if state.ok else 1


if __name__ == "__main__":
    code = main()
    # HARD EXIT, deliberately. The WGC capture holds a native thread whose teardown crashes
    # the interpreter AFTER main() has printed its verdict -- "Fatal Python error:" on a
    # clean run, with the exit code still 0. That is harmless to the measurement and fatal
    # to anything reading the last line of output, which is exactly what the doctor did:
    # it reported `live feed PASS  Fatal Python error:`, a false green inside the check
    # built to catch false greens. Flush, then leave without running destructors.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)

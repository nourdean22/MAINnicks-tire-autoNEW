"""Can the producer's scene be located in the V380 window RIGHT NOW?

`probe_capture.py` answers "is there a live feed". This answers the next question, and it is
the one that was got wrong by hand: the app can be showing a perfectly live feed of a
DIFFERENT channel arrangement, in which the camera a producer was installed for is not on
screen at all. Starting it then leaves it retrying forever against a layout that does not
contain its lens, with the task reading `Running`.

Prints ONE line for the PowerShell caller and exits:
  0  FOUND    — with the quad, inlier count and reprojection error
  1  NOT FOUND — the scene is not in this window
  2  could not capture at all

Read-only. Opens no ledger, posts nothing, writes nothing.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

#: Samples taken before calling it. See the comment in `main` -- the region detector, not the
#: matcher, is what varies between them.
ATTEMPTS = 5


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: locate_scene.py <scene-id>")
        return 2
    want = argv[0]

    from vision.capture import WgcWindowSource
    from vision.scenelocator import SceneNotLocated, load_atlas, locate

    refs = [r for r in load_atlas("data/scene-atlas") if r.scene_id == want]
    if not refs:
        print(f"NO REFERENCE — '{want}' is not in data/scene-atlas")
        return 2

    src = WgcWindowSource(window_title="V380")

    # BEST OF SEVERAL, because one reading is not a verdict here. Measured on the live
    # window: the same stationary scene locates at 38-49 inliers across consecutive samples
    # and occasionally fails outright -- and the failing sample reports a 691x439 frame while
    # every succeeding one reports ~780x438. So the instability is UPSTREAM of the matcher:
    # `detect_live_region` intermittently picks a different region, and the camera genuinely
    # is not inside it. (That same 691x439 is what the overnight revalidation failure cited.)
    #
    # A single-sample gate inherits that and blocks a startup at random, which would train
    # whoever runs this to re-run it until it passes -- the worst possible habit to build
    # around the check that decides whether geometry is trustworthy.
    best = None
    last_error = "no frame"
    last_shape = None
    for _ in range(ATTEMPTS):
        frame = src.read()
        image = getattr(frame, "image", None) if frame is not None else None
        if image is None:
            continue
        last_shape = f"{image.shape[1]}x{image.shape[0]}"
        try:
            found = locate(image, refs)
        except SceneNotLocated as exc:
            last_error = str(exc)[:120]
            continue
        if best is None or found.inliers > best.inliers:
            best = found

    if best is None:
        print(f"NOT FOUND in {last_shape or 'no capture'} after {ATTEMPTS} attempts — {last_error}")
        return 1 if last_shape else 2
    found = best

    xs = [p[0] for p in found.quad]
    ys = [p[1] for p in found.quad]
    print(f"FOUND {int(max(xs) - min(xs))}x{int(max(ys) - min(ys))} "
          f"at {int(min(xs))},{int(min(ys))} inliers={found.inliers} "
          f"ratio={found.inlier_ratio:.2f} reproj={found.reprojection_error:.2f}px")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

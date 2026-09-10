"""Find a KNOWN camera scene anywhere in the capture, and prove which camera it is.

WHY THIS EXISTS, AND WHY IT REPLACES A CROP AS THE AUTHORITY.

`panedetect` answers "where is live video in this window?" by a real signal: chrome is
byte-identical frame to frame and video never is. That is a good signal and it stays --
but it answers the wrong question. It finds *a* rectangle. It cannot say *which camera*
that rectangle shows, and the whole calibration story depends on the answer:

    the lot polygon, the entry portal and the bay boxes are pixel coordinates. They mean
    something only while they sit over the ground they were drawn on. If the operator
    re-orders the panes in the app, `panedetect` still returns three perfectly correct
    rectangles -- and the producer silently binds the left approach's geometry to the
    right approach's pixels. Every arrival after that is attributed to the wrong side of
    the shop, with healthy frames, healthy heartbeats and confident detections.

Nothing in a temporal-variance signal can catch that, because nothing about it is wrong:
the pixels really are live video. What is wrong is the IDENTITY, and identity has to come
from appearance.

THE REFORMULATION. Instead of "where are this app's panes?", ask "where in these pixels is
the scene I already have a calibrated reference for?". That is a solved problem in the
classical literature -- match local features from a known reference into a larger scene,
fit a robust homography, project the reference's border into the observed image -- and it
collapses every layout into ONE problem. 1-up, 2x2, a three-pane device, panes reordered,
the window resized, fullscreen: all the same question, all the same answer.

AND THE HOMOGRAPHY DOES THREE JOBS AT ONCE. It locates the pane, it proves the identity
(a wrong scene does not produce inliers), and it maps the observed pixels back to the
canonical frame the calibration was drawn in. So the geometry stops caring about layout
entirely -- which is the actual goal, not a better crop.

WHAT THIS DELIBERATELY REFUSES TO DO. Every failure returns None or raises. A locator that
fell back to "probably the usual place" would reintroduce exactly the silent mis-binding it
exists to prevent, and it would do it at the one moment the operator had most reason to
trust it. Ambiguity between two scenes is also a refusal, not a coin flip.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

#: A pane in a desktop app is an axis-aligned rectangle: the app scales the video, it does
#: not project it. So a correct match yields a near-rectangular quad, and a skewed one is a
#: bad fit dressed up as an observation. Fraction of the quad's own size that opposite
#: sides may differ by before the match is rejected as degenerate.
MAX_SIDE_IMBALANCE = 0.18
#: How far an edge may tilt from its axis before the quad is not a scaled pane. A truly
#: axis-aligned match sits under 1 degree; 6 leaves room for estimation noise on a small
#: pane without admitting a perspective warp. MEASURED across four genuine layouts
#: (fullscreen, a 338x190 tile, a 677x381 pane, a 500x281 float): worst edge tilt 0.60
#: degrees, worst opposite-edge divergence 0.70 -- an 8.5x margin, so this is calibrated
#: against real estimates rather than fitted to whichever test had to fail.
MAX_EDGE_TILT_DEG = 6.0
#: The shortest side a real video pane may have. Below this there is nothing to detect a
#: vehicle in, so a quad this thin is a failed fit, not an observation.
MIN_SIDE_PX = 24.0
#: Absolute minimum inliers. Below this a homography is fitting noise, whatever its ratio.
MIN_INLIERS = 18
#: Inliers as a fraction of matches. A low ratio with a high count is a repeated texture
#: matching itself all over the window -- common in UI chrome, which is full of repeats.
MIN_INLIER_RATIO = 0.30
#: Reprojection error is REPORTED, not gated, and that is deliberate. A cap here would be
#: unreachable: the robust estimator only admits a point as an inlier when its reprojection
#: is under its OWN threshold (3.0px), so the mean over inliers cannot exceed it, and a 4px
#: cap would sit in the code advertising a protection it could never provide. A mutation
#: sweep proved exactly that -- deleting the cap changed no test, because nothing it would
#: reject ever reaches it. What actually keeps bad fits out is the inlier COUNT, the inlier
#: RATIO and the quad-sanity rules, each of which a mutation does break. The number stays in
#: `Located` because an operator reading a log wants to see how tight the fit was.
RANSAC_THRESHOLD_PX = 3.0
#: How much better the best scene must be than the best DIFFERENT scene before identity is
#: called. Two views of the same forecourt can genuinely look alike; a near-tie is a
#: refusal, because binding calibrated geometry to the wrong one is unrecoverable.
AMBIGUITY_MARGIN = 1.35
#: Quad corner movement, in window pixels, that counts as the layout having actually moved
#: rather than the estimate jittering. Below it the binding is held, so the epoch is stable.
EPOCH_MOVE_PX = 6.0


class SceneNotLocated(RuntimeError):
    """The known scene could not be found, or could not be told apart from another."""


@dataclass(frozen=True)
class SceneReference:
    """One calibrated appearance of one camera, with its canonical pixel size.

    `variant` exists because one reference image eventually betrays you: the same forecourt
    at noon, at dusk, under sodium light and under snow does not share enough gradient
    structure for one descriptor set to cover. Several variants of the SAME `scene_id` all
    map into the SAME canonical frame, so which one matched is a diagnostic, never a
    difference in geometry.

    `mask` restricts features to STATIC LANDMARKS -- roofline, bay framing, poles, curb,
    permanent signage -- and away from road surface, parked-car bays, tree canopy, sky and
    the camera's own OSD timestamp. Features on a parked car locate the car, not the shop,
    and the car leaves.
    """

    scene_id: str
    variant: str
    width: int
    height: int
    keypoints: tuple
    descriptors: np.ndarray

    @property
    def canonical_corners(self) -> np.ndarray:
        return np.float32([[0, 0], [self.width, 0],
                           [self.width, self.height], [0, self.height]]).reshape(-1, 1, 2)


@dataclass(frozen=True)
class Located:
    """A scene found in a frame, with the evidence for believing it."""

    scene_id: str
    variant: str
    quad: Tuple[Tuple[float, float], ...]
    homography: np.ndarray          #: canonical -> window
    inliers: int
    inlier_ratio: float
    reprojection_error: float
    runner_up: Optional[str] = None
    margin: float = float("inf")

    @property
    def homography_id(self) -> str:
        """A stable name for THIS geometry, so a stored observation can be checked against
        the mapping that produced it instead of being assumed still valid."""
        rounded = np.round(np.asarray(self.homography, dtype=np.float64), 3)
        return "h:" + hashlib.sha256(rounded.tobytes()).hexdigest()[:12]

    def describe(self) -> str:
        x = [p[0] for p in self.quad]
        y = [p[1] for p in self.quad]
        return (f"scene={self.scene_id} variant={self.variant} "
                f"box={int(min(x))},{int(min(y))} {int(max(x) - min(x))}x{int(max(y) - min(y))} "
                f"inliers={self.inliers} ratio={self.inlier_ratio:.2f} "
                f"reproj={self.reprojection_error:.2f}px margin={self.margin:.2f} "
                f"{self.homography_id}")


def _orb():
    import cv2
    # nfeatures is generous because the scene may occupy a small fraction of a large
    # window: a 338x190 pane inside 1280x720 is 7% of the pixels, so a budget tuned for a
    # full-frame match would spend almost all of it on chrome.
    return cv2.ORB_create(nfeatures=4000, scaleFactor=1.2, nlevels=10, fastThreshold=7)


def build_reference(image: np.ndarray, scene_id: str, variant: str = "default",
                    mask: Optional[np.ndarray] = None) -> SceneReference:
    """Compute the descriptors for one calibrated view. Raises if the view has no structure.

    A reference with almost no features is not a reference -- it is a blank wall that will
    match anything or nothing, unpredictably. Refusing here is much cheaper than discovering
    it at 2am when the locator binds geometry to a snowdrift.
    """
    import cv2

    grey = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    kps, desc = _orb().detectAndCompute(grey, mask)
    if desc is None or len(kps) < MIN_INLIERS * 2:
        raise SceneNotLocated(
            f"reference {scene_id}/{variant} yielded only {0 if desc is None else len(kps)} "
            f"features, which is too few to locate anything. Point it at a view with static "
            f"structure -- roofline, bay framing, poles -- not at sky, tarmac or a blank wall."
        )
    return SceneReference(scene_id=scene_id, variant=variant,
                          width=int(image.shape[1]), height=int(image.shape[0]),
                          keypoints=tuple(kps), descriptors=desc)


def _quad_is_sane(quad: np.ndarray, window: Tuple[int, int],
                  require_axis_aligned: bool) -> Optional[str]:
    """Degeneracy checks. Returns a REASON when the quad is not believable, else None.

    A homography from a bad match is not usually absurd-looking in its numbers -- it is a
    thin sliver, a bow-tie, or a quad the size of the whole desktop. Each of those is a
    specific, cheap thing to test, and each has been the shape of a real false match in the
    feature-matching literature for twenty years.
    """
    pts = quad.reshape(4, 2).astype(np.float64)
    height, width = window

    xs, ys = pts[:, 0], pts[:, 1]
    if not (np.isfinite(pts).all()):
        return "the homography produced non-finite corners"

    area = 0.5 * abs(float(np.dot(xs, np.roll(ys, -1)) - np.dot(ys, np.roll(xs, -1))))
    if area < 400:
        return f"the projected quad has an area of {area:.0f}px, which is a sliver not a pane"
    # AREA IS NOT ENOUGH, and a direct unit test of this function is what proved it: a
    # 590x2 strip has an area of 1180 and sailed straight through the check above. A long
    # thin sliver is the shape a homography takes when it collapses one dimension, so the
    # rule has to be about the SHORTEST SIDE, not the product of the sides.
    sides = [float(np.linalg.norm(pts[(i + 1) % 4] - pts[i])) for i in range(4)]
    if min(sides) < MIN_SIDE_PX:
        return (f"the projected quad's shortest side is {min(sides):.0f}px, which is a "
                f"collapsed sliver rather than a video pane")
    if area > width * height * 1.05:
        return "the projected quad is larger than the window it was found in"

    # CONVEXITY. A bow-tie quad has a sign flip in its cross products, and it is the classic
    # signature of a homography fitted to mismatches. It cannot be a rectangle seen by a
    # camera, so it cannot be a pane.
    signs = []
    for i in range(4):
        a, b, c = pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4]
        u, v = b - a, c - b
        signs.append(np.sign(u[0] * v[1] - u[1] * v[0]))
    if len(set(s for s in signs if s != 0)) > 1:
        return "the projected quad is self-intersecting, so it is not a rectangle"

    if require_axis_aligned:
        # A desktop app SCALES a video pane; it does not project it. So a correct match is
        # an AXIS-ALIGNED rectangle, and the test has to say that directly.
        #
        # Comparing opposite side LENGTHS does not say it. A sheared parallelogram has
        # equal opposite sides by construction, so a genuinely skewed quad sailed through
        # an earlier version of this check at a 0.4% imbalance -- the check's name claimed
        # more than its arithmetic delivered, which is the exact defect shape this module
        # exists to refuse. Measure the ANGLES.
        tilts = {}
        for name, (i, j), axis in (("top", (0, 1), 0), ("bottom", (3, 2), 0),
                                   ("left", (0, 3), 1), ("right", (1, 2), 1)):
            edge = pts[j] - pts[i]
            if not np.any(edge):
                return f"the quad has a zero-length {name} edge"
            along, across = (edge[0], edge[1]) if axis == 0 else (edge[1], edge[0])
            tilts[name] = float(np.degrees(np.arctan2(across, abs(along))))
            if abs(tilts[name]) > MAX_EDGE_TILT_DEG:
                return (f"the quad's {name} edge is tilted {abs(tilts[name]):.1f} degrees, so "
                        f"this is a projection, not a scaled pane")
        # PARALLELISM is the signature that absolute tilt misses. A perspective warp makes
        # opposite edges CONVERGE -- that is what perspective is -- while a scaled pane
        # keeps them parallel however the whole quad sits. A trapezoid whose top tilts 5
        # degrees one way and whose bottom tilts 2 the other passes an absolute-tilt test
        # at any sane threshold and is still unmistakably a projection.
        for name, a, b in (("horizontal", "top", "bottom"), ("vertical", "left", "right")):
            divergence = abs(tilts[a] - tilts[b])
            if divergence > MAX_EDGE_TILT_DEG:
                return (f"the quad's {name} edges converge by {divergence:.1f} degrees, so "
                        f"this is a perspective view, not a scaled pane")
        top = np.linalg.norm(pts[1] - pts[0])
        bottom = np.linalg.norm(pts[2] - pts[3])
        left = np.linalg.norm(pts[3] - pts[0])
        right = np.linalg.norm(pts[2] - pts[1])
        for name, p, q in (("horizontal", top, bottom), ("vertical", left, right)):
            if abs(p - q) / max(p, q, 1e-6) > MAX_SIDE_IMBALANCE:
                return (f"the quad's {name} sides differ by "
                        f"{abs(p - q) / max(p, q):.0%}, so this is a skew, not a scaled pane")
    return None


def _match_one(frame_kps, frame_desc, ref: SceneReference, window: Tuple[int, int],
               require_axis_aligned: bool):
    import cv2

    if frame_desc is None or len(frame_kps) < 4 or ref.descriptors is None:
        return None
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    pairs = matcher.knnMatch(ref.descriptors, frame_desc, k=2)
    # Lowe's ratio test. Without it, UI chrome -- which is full of repeated widgets, borders
    # and identical glyphs -- supplies enormous numbers of equally-good matches, and the
    # homography happily fits them.
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(good) < MIN_INLIERS:
        return None

    src = np.float32([ref.keypoints[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([frame_kps[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    method = getattr(cv2, "USAC_MAGSAC", cv2.RANSAC)
    H, mask = cv2.findHomography(src, dst, method, RANSAC_THRESHOLD_PX,
                                 maxIters=5000, confidence=0.999)
    if H is None or mask is None:
        return None

    inliers = int(mask.sum())
    ratio = inliers / float(len(good))
    if inliers < MIN_INLIERS or ratio < MIN_INLIER_RATIO:
        return None

    kept = mask.ravel().astype(bool)
    projected = cv2.perspectiveTransform(src[kept], H)
    reproj = float(np.mean(np.linalg.norm(projected - dst[kept], axis=2)))
    if not np.isfinite(reproj):
        return None

    quad = cv2.perspectiveTransform(ref.canonical_corners, H)
    reason = _quad_is_sane(quad, window, require_axis_aligned)
    if reason:
        return None
    corners = tuple((float(p[0][0]), float(p[0][1])) for p in quad)
    return ref, corners, H, inliers, ratio, reproj


def locate(frame: np.ndarray, references: Sequence[SceneReference],
           require_axis_aligned: bool = True) -> Located:
    """Find the best-supported known scene in `frame`. Raises rather than guessing.

    Every reference is tried, not just the first that clears the bar, because the decision
    that matters is not "does this look like scene X" but "does it look like X MORE than
    like anything else". A locator that returned the first acceptable match would bind
    geometry to whichever reference happened to be listed first.
    """
    import cv2

    if not references:
        raise SceneNotLocated("no references were supplied, so no scene can be identified")
    grey = frame if frame.ndim == 2 else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    kps, desc = _orb().detectAndCompute(grey, None)
    window = (int(frame.shape[0]), int(frame.shape[1]))

    scored = [r for r in (_match_one(kps, desc, ref, window, require_axis_aligned)
                          for ref in references) if r is not None]
    if not scored:
        raise SceneNotLocated(
            f"none of the {len(references)} known scenes could be located in this "
            f"{window[1]}x{window[0]} frame. The app may be showing a different camera, a "
            "menu, or a view no reference covers -- add a variant rather than lowering a "
            "threshold."
        )
    scored.sort(key=lambda r: (r[3], -r[5]), reverse=True)
    best = scored[0]
    other = next((r for r in scored[1:] if r[0].scene_id != best[0].scene_id), None)

    margin = float("inf")
    if other is not None:
        margin = best[3] / max(1.0, float(other[3]))
        if margin < AMBIGUITY_MARGIN:
            raise SceneNotLocated(
                f"{best[0].scene_id} ({best[3]} inliers) could not be told apart from "
                f"{other[0].scene_id} ({other[3]} inliers) -- a margin of {margin:.2f} "
                f"against the {AMBIGUITY_MARGIN} required. Refusing to bind calibrated "
                "geometry to a coin flip; give the two scenes references that differ."
            )
    return Located(scene_id=best[0].scene_id, variant=best[0].variant, quad=best[1],
                   homography=best[2], inliers=best[3], inlier_ratio=best[4],
                   reprojection_error=best[5],
                   runner_up=other[0].scene_id if other else None, margin=margin)


def _boxes_overlap(a, b, limit: float = 0.30) -> bool:
    ax0, ax1 = min(p[0] for p in a), max(p[0] for p in a)
    ay0, ay1 = min(p[1] for p in a), max(p[1] for p in a)
    bx0, bx1 = min(p[0] for p in b), max(p[0] for p in b)
    by0, by1 = min(p[1] for p in b), max(p[1] for p in b)
    ix = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    iy = max(0.0, min(ay1, by1) - max(ay0, by0))
    inter = ix * iy
    smaller = min((ax1 - ax0) * (ay1 - ay0), (bx1 - bx0) * (by1 - by0))
    return smaller > 0 and inter / smaller > limit


def locate_all(frame: np.ndarray, references: Sequence[SceneReference],
               require_axis_aligned: bool = True) -> List[Located]:
    """EVERY known scene present in the frame, strongest first. Never raises; may be empty.

    WHY THIS EXISTS SEPARATELY FROM `locate`. A 3-in-1 device puts three cameras on screen
    at once, so "which scene is this window?" is the wrong question for it -- there are
    three right answers and `locate` returns only the strongest. Proving that against the
    real window is what surfaced this: the full V380 window resolved to the large pane with
    a margin of 3.51, which is correct and also silently discards the two small lenses that
    cover the left and right approaches.

    Two rules keep the answer honest. A `scene_id` appears at most ONCE, because a camera is
    in one place. And accepted quads may not overlap: two different cameras cannot occupy
    the same rectangle, so an overlapping second match is the same pixels explained twice,
    not a second camera.

    Ambiguity is handled by OMISSION rather than by raising, which is the right shape here:
    one unreadable pane in a four-up must not blind the producer to the other three.
    """
    import cv2

    if not references:
        return []
    grey = frame if frame.ndim == 2 else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    kps, desc = _orb().detectAndCompute(grey, None)
    window = (int(frame.shape[0]), int(frame.shape[1]))
    scored = [r for r in (_match_one(kps, desc, ref, window, require_axis_aligned)
                          for ref in references) if r is not None]
    scored.sort(key=lambda r: (r[3], -r[5]), reverse=True)

    out: List[Located] = []
    for ref, corners, H, inliers, ratio, reproj in scored:
        if any(o.scene_id == ref.scene_id for o in out):
            continue
        if any(_boxes_overlap(corners, o.quad) for o in out):
            continue
        out.append(Located(scene_id=ref.scene_id, variant=ref.variant, quad=corners,
                           homography=H, inliers=inliers, inlier_ratio=ratio,
                           reprojection_error=reproj))
    return out


def canonicalise(frame: np.ndarray, located: Located, size: Tuple[int, int]) -> np.ndarray:
    """Warp the observed pane back into the canonical frame the calibration was drawn in.

    THIS is what makes the geometry layout-blind. After this call the lot polygon, the entry
    portal and the bay boxes describe the same ground whether the pane was fullscreen, a
    corner of a 2x2, or the middle of a three-up -- so the layout stops being an input to
    any decision downstream.
    """
    import cv2

    width, height = size
    return cv2.warpPerspective(frame, np.linalg.inv(located.homography), (width, height),
                               flags=cv2.INTER_LINEAR)


@dataclass(frozen=True)
class SceneBinding:
    """What the producer currently believes it is looking at, and since when.

    `epoch` is the point. Observations are only ever comparable WITHIN an epoch: a track at
    x=650 before a layout change and a detection at x=650 after it are not the same place,
    and stitching them would manufacture a trajectory that crosses the entry portal without
    any car ever having moved. So the epoch increments whenever the binding materially
    changes, and the caller is expected to terminate tracks and re-run the pre-existing
    census at the boundary rather than carry state across it.
    """

    scene_id: str
    epoch: int
    quad: Tuple[Tuple[float, float], ...]
    homography_id: str

    def same_place_as(self, located: Located, move_px: float = EPOCH_MOVE_PX) -> bool:
        if located.scene_id != self.scene_id:
            return False
        return all(abs(a[0] - b[0]) <= move_px and abs(a[1] - b[1]) <= move_px
                   for a, b in zip(self.quad, located.quad))


def advance(previous: Optional[SceneBinding], located: Located,
            move_px: float = EPOCH_MOVE_PX) -> Tuple[SceneBinding, bool]:
    """Fold a fresh location into the running binding. Returns `(binding, epoch_changed)`.

    Holding the epoch across estimation jitter is as important as advancing it across a real
    move: an epoch that ticked every frame would terminate every track continuously, and a
    system that never keeps a track cannot detect an arrival at all.
    """
    if previous is not None and previous.same_place_as(located, move_px):
        return previous, False
    epoch = 1 if previous is None else previous.epoch + 1
    return SceneBinding(scene_id=located.scene_id, epoch=epoch, quad=located.quad,
                        homography_id=located.homography_id), True

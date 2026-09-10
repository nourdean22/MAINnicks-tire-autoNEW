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
import os
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
#: Largest condition number the homography's linear part may have. A scaled, axis-aligned
#: pane maps to ~1.0 (uniform scale); anything past this has collapsed a dimension.
MAX_CONDITION = 8.0
#: How much a located quad must overlap a detected live pane before geometry may be bound
#: to it. 0.6 accepts the few-pixel disagreement between an appearance match and a
#: temporal-variance one; it rejects the measured PTZ false positive, whose quad sat 623px
#: from the real pane.
MIN_PANE_IOU = 0.6
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


def _linear_is_sane(H) -> Optional[str]:
    """Is the homography's linear part a plausible scale, or has it collapsed? Reason or None.

    MEASURED, because the first version of this check asserted something false. It rejected
    a non-positive determinant on the stated grounds that "a negative determinant means the
    fit mirrored the scene" -- and a deliberately mirrored scene produces a determinant of
    +0.14. The sign never goes negative here, so that branch could not fire and its comment
    was simply wrong. It is gone.

    CONDITIONING is the part that carries real information. The same measurement: a genuine
    axis-aligned pane match gives a condition number of 1.01, and the degenerate fit from
    the mirrored frame gives 204.68 -- a 200x separation, which is a signal, not a hunch.

    Stated honestly, this is DEFENCE IN DEPTH and not the rule doing the work today: the
    inlier floor rejects that mirrored frame first (4 inliers against a floor of 18), so
    removing this check does not turn any end-to-end test red. It earns its place by
    covering the case the inlier floor cannot -- enough points agreeing on a transform that
    has flattened one dimension -- and it is unit-tested directly rather than left as a
    guard nobody can prove fires.
    """
    linear = np.asarray(H, dtype=np.float64)[:2, :2]
    if not np.isfinite(linear).all():
        return "the homography's linear part is not finite"
    singular = np.linalg.svd(linear, compute_uv=False)
    if singular[-1] <= 1e-9:
        return "the homography is singular: it maps the pane onto a line"
    condition = float(singular[0] / singular[-1])
    if condition > MAX_CONDITION:
        return (f"the homography's condition number is {condition:.1f}, so it has flattened "
                f"one dimension rather than scaling a pane")
    return None


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

    if _linear_is_sane(H) is not None:
        return None

    quad = cv2.perspectiveTransform(ref.canonical_corners, H)
    reason = _quad_is_sane(quad, window, require_axis_aligned)
    if reason:
        return None
    corners = tuple((float(p[0][0]), float(p[0][1])) for p in quad)
    return ref, corners, H, inliers, ratio, reproj


#: Frame scales tried, in order, when searching for a scene. 1.0 first: it is both the
#: common case and the cheapest.
#:
#: WHY THIS EXISTS, measured on the real window rather than guessed. ORB is scale-invariant
#: across its own pyramid, but correspondences thin out badly when the live instance is much
#: LARGER than the stored reference -- which is exactly what happens the moment an operator
#: puts the app fullscreen. Measured across a 2.3x jump (1280x720 windowed to 2304x1464
#: fullscreen), with the references unchanged:
#:
#:     scale 1.00   shop-left 5 inliers   shop-right 7    shop-ptz 27
#:     scale 0.43   shop-left 10          shop-right 71   shop-ptz 43
#:
#: A control reference built from the fullscreen frame itself matched at 2020 inliers, ratio
#: 0.93, which proves the machinery was never the problem -- only the scale gap was.
#:
#: The fix is to bring the instance back toward the reference's scale. It is NOT to lower the
#: inlier floor: that would have made this case "pass" while admitting precisely the thin,
#: low-ratio fits (0.37-0.40) the floor exists to reject.
SEARCH_SCALES = (1.0, 0.6, 0.43, 0.3)


def _scaled(frame: np.ndarray, scale: float) -> np.ndarray:
    if scale == 1.0:
        return frame
    import cv2

    height, width = frame.shape[:2]
    return cv2.resize(frame, (max(1, int(width * scale)), max(1, int(height * scale))),
                      interpolation=cv2.INTER_AREA)


def _unscale(H: np.ndarray, scale: float) -> np.ndarray:
    """Lift a homography found on a downscaled frame back into full-frame coordinates."""
    if scale == 1.0:
        return np.asarray(H, dtype=np.float64)
    return np.diag([1.0 / scale, 1.0 / scale, 1.0]) @ np.asarray(H, dtype=np.float64)


def locate(frame: np.ndarray, references: Sequence[SceneReference],
           require_axis_aligned: bool = True,
           panes: Optional[Sequence[Tuple[int, int, int, int]]] = None) -> Located:
    """Find the best-supported known scene in `frame`. Raises rather than guessing.

    Every reference is tried, not just the first that clears the bar, because the decision
    that matters is not "does this look like scene X" but "does it look like X MORE than
    like anything else". A locator that returned the first acceptable match would bind
    geometry to whichever reference happened to be listed first.
    """
    import cv2

    if not references:
        raise SceneNotLocated("no references were supplied, so no scene can be identified")
    scored: List[tuple] = []
    for scale in SEARCH_SCALES:
        view = _scaled(frame, scale)
        grey = view if view.ndim == 2 else cv2.cvtColor(view, cv2.COLOR_BGR2GRAY)
        kps, desc = _orb().detectAndCompute(grey, None)
        window = (int(view.shape[0]), int(view.shape[1]))
        hits = [r for r in (_match_one(kps, desc, ref, window, require_axis_aligned)
                            for ref in references) if r is not None]
        hits = [h for h in hits
                if lands_on_a_pane(tuple((x / scale, y / scale) for x, y in h[1]), panes)]
        if hits:
            # Lift every result back into FULL-FRAME coordinates before it leaves this loop.
            # A quad left in downscaled pixels is a silently wrong rectangle downstream --
            # exactly the class of error this module exists to remove.
            scored = [(ref, tuple((x / scale, y / scale) for x, y in corners),
                       _unscale(H, scale), inl, ratio, reproj)
                      for ref, corners, H, inl, ratio, reproj in hits]
            break
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


def load_atlas(directory: str) -> List[SceneReference]:
    """Load an operator-curated set of reference views from `<scene_id>__<variant>.png`.

    WHY AN ATLAS RATHER THAN ONE REFERENCE IMAGE. One image eventually betrays you. The
    same forecourt at noon, at dusk, under sodium light, in rain and under snow does not
    share enough gradient structure for a single descriptor set to cover -- the match simply
    stops finding inliers one evening, and a locator that refuses is a producer that stops.
    Several variants of the SAME `scene_id` all map into the SAME canonical frame, so which
    variant matched is a diagnostic and never a difference in geometry.

    A sibling `<scene_id>__<variant>.mask.png` restricts features to STATIC LANDMARKS --
    roofline, bay framing, poles, curb, permanent signage. This matters more than it looks:
    features found on a parked car locate the CAR, and the car leaves. Masking is how the
    atlas learns the bones of the building rather than today's arrangement of vehicles.

    Raises on an empty or unreadable directory rather than returning an empty list, because
    an empty atlas would make every later `locate` fail with a confusing message about zero
    references instead of the real problem, which is here.
    """
    import cv2

    if not os.path.isdir(directory):
        raise SceneNotLocated(f"scene atlas directory {directory!r} does not exist")
    refs: List[SceneReference] = []
    for name in sorted(os.listdir(directory)):
        stem, ext = os.path.splitext(name)
        if ext.lower() not in (".png", ".jpg", ".jpeg") or stem.endswith(".mask"):
            continue
        image = cv2.imread(os.path.join(directory, name), cv2.IMREAD_COLOR)
        if image is None:
            raise SceneNotLocated(f"atlas entry {name!r} could not be decoded as an image")
        scene_id, _, variant = stem.partition("__")
        mask_path = os.path.join(directory, f"{stem}.mask.png")
        mask = None
        if os.path.exists(mask_path):
            mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
            if mask is None or mask.shape[:2] != image.shape[:2]:
                raise SceneNotLocated(
                    f"the mask for {name!r} is unreadable or a different size than the "
                    f"reference, so it would mask the wrong pixels"
                )
        refs.append(build_reference(image, scene_id, variant or "default", mask))
    if not refs:
        raise SceneNotLocated(
            f"no reference images in {directory!r}. Name them '<scene_id>__<variant>.png' "
            "-- for example 'shopsign-left__day-clear.png'."
        )
    return refs


def _bbox(quad) -> Tuple[float, float, float, float]:
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    return min(xs), min(ys), max(xs), max(ys)


def _iou(a, b) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    iy = max(0.0, min(ay1, by1) - max(ay0, by0))
    inter = ix * iy
    union = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter
    return 0.0 if union <= 0 else inter / union


def lands_on_a_pane(quad, panes: Optional[Sequence[Tuple[int, int, int, int]]],
                    min_iou: float = MIN_PANE_IOU) -> bool:
    """Does this located quad actually sit on a live video pane?

    THE FALSE POSITIVE THIS KILLS, measured on the real window. After the operator nudged the
    PTZ, its stored reference still matched at 158 inliers with a 0.81 inlier ratio, a sane
    quad and a 1.33px reprojection error -- every gate green -- and placed the pane at x=1120
    when the pane is actually at x=497. Nothing was broken: the lens had panned, so the old
    view's CONTENT genuinely does sit somewhere else now, and the homography faithfully
    reported where. The answer is faithful and useless, because the rectangle it describes is
    not where that camera's pixels are.

    No amount of match quality can catch this, which is the point: it is a confident, correct
    fit to a scene that has moved. What catches it is an INDEPENDENT signal -- `panedetect`
    finds live video by temporal variance, which knows nothing about appearance -- and the
    two must agree about where the pane is before geometry may be bound to it.

    `panes=None` means the caller has no independent opinion, and then this cannot judge:
    it returns True rather than inventing a verdict.
    """
    if not panes:
        return True
    box = _bbox(quad)
    return any(_iou(box, (x, y, x + w, y + h)) >= min_iou for x, y, w, h in panes)


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
               require_axis_aligned: bool = True,
               panes: Optional[Sequence[Tuple[int, int, int, int]]] = None) -> List[Located]:
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
    # ACCUMULATE ACROSS SCALES rather than stopping at the first that finds anything. A
    # multi-lens window legitimately holds a large pane that matches at 1.0 and small ones
    # that only match downscaled, so breaking early would silently return a subset -- and a
    # subset is indistinguishable from "that camera is not on screen".
    scored: List[tuple] = []
    best_for: dict = {}
    for scale in SEARCH_SCALES:
        view = _scaled(frame, scale)
        grey = view if view.ndim == 2 else cv2.cvtColor(view, cv2.COLOR_BGR2GRAY)
        kps, desc = _orb().detectAndCompute(grey, None)
        window = (int(view.shape[0]), int(view.shape[1]))
        for hit in (_match_one(kps, desc, ref, window, require_axis_aligned)
                    for ref in references):
            if hit is None:
                continue
            ref, corners, H, inl, ratio, reproj = hit
            lifted = tuple((x / scale, y / scale) for x, y in corners)
            if not lands_on_a_pane(lifted, panes):
                continue
            key = (ref.scene_id, ref.variant)
            if key in best_for and best_for[key][3] >= inl:
                continue
            best_for[key] = (ref, tuple((x / scale, y / scale) for x, y in corners),
                             _unscale(H, scale), inl, ratio, reproj)
    scored = list(best_for.values())
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

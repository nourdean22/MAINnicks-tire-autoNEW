"""Fetch the pinned detector weights, verifying every byte.

The Open Model Zoo is, in Intel's own words in its README, "in maintenance mode as a
source of models" -- it still exists and is still Apache-2.0, but it is no longer a
growing source and its docs point elsewhere. That is weaker than "discontinued" (an
earlier draft of this file said discontinued; the README refuted it), and it is still
reason enough to pin: the fetch path is release-specific (2026.x paths 404), so the
exact artifacts this system was measured against are pinned by sha256 and fetched
directly. A model that silently changes underneath a detector is a measurement that
quietly stops meaning anything -- the hash is the point, not the download.

    python -m vision.fetch_models --dest ov_models
    python -m vision.fetch_models --dest ov_models --verify-only

Exit codes: 0 all files present and verified; 1 a fetch or hash check failed.

If the host goes away, every file below is content-addressed: any mirror serving these
exact sha256 digests is equivalent, and `--base-url` will take one. Do NOT "fix" a
hash mismatch by updating the expected digest -- re-measure the detector first.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

#: Open Model Zoo release these artifacts came from. Part of the URL, so it is a pin
#: (2026.x paths 404 -- the release number is load-bearing, not decorative).
OMZ_RELEASE = "2023.0"
DEFAULT_BASE_URL = (
    f"https://storage.openvinotoolkit.org/repositories/open_model_zoo/{OMZ_RELEASE}/models_bin/1"
)


@dataclass(frozen=True)
class PinnedFile:
    #: Path relative to the models root, e.g. "vehicle-detection-0200/FP16/....xml".
    rel_path: str
    sha256: str
    size_bytes: int


# Verified live 2026-09-09: both URLs returned HTTP 200 with exactly these digests and
# byte counts, matching the local copy every measurement in this package was taken on.
PINNED: tuple[PinnedFile, ...] = (
    PinnedFile(
        "vehicle-detection-0200/FP16/vehicle-detection-0200.xml",
        "306f228315b4f6002d669db1205e4a11e4d7d4f39488be94294f863ae5a2e019",
        254_617,
    ),
    PinnedFile(
        "vehicle-detection-0200/FP16/vehicle-detection-0200.bin",
        "0c46011610964399a3cf5b1a3f8b1c8c2d84b914a69c02bc026b4e0272f464ce",
        3_634_654,
    ),
    # Office "watch" person count (vision/officeframes.py). Same OMZ release, same SSD
    # output format; verified live 2026-10-02 at exactly these digests and byte counts.
    # Kept AFTER the vehicle pins: run_live.py reports the first pinned .bin as the
    # vehicle model's digest, and main() prints PINNED[0] as the detector path.
    PinnedFile(
        "person-detection-0200/FP16/person-detection-0200.xml",
        "6a393e1a58607cf65ff58b437b0aeb0bf6c46a18926e1c5718374c804c419faa",
        254_619,
    ),
    PinnedFile(
        "person-detection-0200/FP16/person-detection-0200.bin",
        "cebd5b36edce228fd7a519b372d824f220466c4c7a0d75bfe22fbb6c5aca4fcd",
        3_634_654,
    ),
)


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(path: Path, pin: PinnedFile) -> tuple[bool, str]:
    """Return (ok, reason). Size is checked first: it is the cheap discriminator."""
    if not path.exists():
        return False, "missing"
    actual_size = path.stat().st_size
    if actual_size != pin.size_bytes:
        return False, f"size {actual_size} != expected {pin.size_bytes}"
    actual = sha256_of(path)
    if actual != pin.sha256:
        return False, f"sha256 {actual[:16]}... != expected {pin.sha256[:16]}..."
    return True, "ok"


#: Smallest plausible OpenVINO IR payload. The topology XML for the smallest model in use
#: here is ~250 KB and the weights are megabytes; an error page is around 1 KB.
MIN_PLAUSIBLE_BYTES = 4096


def _implausible(content_type: str, body: bytes) -> str:
    """Reason this response cannot be a model file, or "" when it looks like one."""
    if "html" in content_type or "xhtml" in content_type:
        return (f"the server returned {content_type!r}, which is a web page and not a model. "
                "This host answers a missing path with a directory listing at HTTP 200.")
    if len(body) < MIN_PLAUSIBLE_BYTES:
        return (f"only {len(body)} bytes returned, below the {MIN_PLAUSIBLE_BYTES} an IR "
                "could plausibly be -- almost certainly an error page, not a model")
    head = body[:512].lstrip()[:64].lower()
    if head.startswith(b"<!doctype html") or head.startswith(b"<html"):
        return "the body begins with an HTML document, not an OpenVINO IR"
    return ""


def fetch_one(pin: PinnedFile, dest_root: Path, base_url: str) -> bool:
    dest = dest_root / pin.rel_path
    ok, _ = verify(dest, pin)
    if ok:
        print(f"  ok       {pin.rel_path} (already verified)")
        return True

    url = f"{base_url.rstrip('/')}/{pin.rel_path}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with urllib.request.urlopen(url, timeout=120) as resp:  # noqa: S310 - pinned host
            if resp.status != 200:
                print(f"  FAIL     {pin.rel_path}: HTTP {resp.status}")
                return False
            content_type = (resp.headers.get("Content-Type") or "").lower()
            body = resp.read()
        # AN HTTP 200 IS NOT A MODEL, and this storage host proves it: asking for a model
        # that does not exist in a given release returns a DIRECTORY-LISTING PAGE with
        # status 200 and `text/html`. Measured while adding a new pin -- the .xml and the
        # .bin came back byte-identical at 1,061 bytes, which is the giveaway only if
        # somebody happens to look.
        #
        # The existing sha256 pin catches this on every LATER run, but not on the run that
        # matters most: the first one, where whoever is recording a new pin would compute
        # and enshrine the hash of an error page. After that the corpus verifies perfectly
        # forever against the wrong bytes.
        reason = _implausible(content_type, body)
        if reason:
            print(f"  FAIL     {pin.rel_path}: {reason}")
            tmp.unlink(missing_ok=True)
            return False
        tmp.write_bytes(body)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"  FAIL     {pin.rel_path}: {exc}")
        tmp.unlink(missing_ok=True)
        return False

    # Verify the TEMP file, and only then publish it. A partial or wrong download must
    # never land at the real path, where a later run would treat it as cached.
    ok, reason = verify(tmp, pin)
    if not ok:
        print(f"  FAIL     {pin.rel_path}: {reason}")
        tmp.unlink(missing_ok=True)
        return False
    tmp.replace(dest)
    print(f"  fetched  {pin.rel_path} ({pin.size_bytes:,} bytes, sha256 verified)")
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dest", default="ov_models", help="models root (default: ov_models)")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL,
                    help="override the host; any mirror serving the pinned digests works")
    ap.add_argument("--verify-only", action="store_true",
                    help="check what is on disk and download nothing")
    args = ap.parse_args(argv)

    dest_root = Path(args.dest).resolve()
    print(f"models root : {dest_root}")
    print(f"omz release : {OMZ_RELEASE} (Open Model Zoo is in maintenance mode upstream)")

    failed = 0
    for pin in PINNED:
        if args.verify_only:
            ok, reason = verify(dest_root / pin.rel_path, pin)
            print(f"  {'ok      ' if ok else 'FAIL    '} {pin.rel_path}: {reason}")
            failed += 0 if ok else 1
        else:
            failed += 0 if fetch_one(pin, dest_root, args.base_url) else 1

    if failed:
        print(f"\n{failed} file(s) unverified. The detector must NOT be run against them.")
        return 1
    print(f"\nAll {len(PINNED)} pinned file(s) verified.")
    print(f"Point the detector at: {dest_root / PINNED[0].rel_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

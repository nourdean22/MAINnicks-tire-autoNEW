"""Fetch the pinned detector weights, verifying every byte.

Intel DISCONTINUED the Open Model Zoo. There is no `omz_downloader` to fall back on
and no guarantee the storage host outlives the models, so the exact artifacts this
system was measured against are pinned here by sha256 and fetched directly. A model
that silently changes underneath a detector is a measurement that quietly stops
meaning anything -- the hash is the point, not the download.

    python -m vision.fetch_models --dest ov_models
    python -m vision.fetch_models --dest ov_models --verify-only

Exit codes: 0 all files present and verified; 1 a fetch or hash check failed.

If the host is gone, every file below is content-addressed: any mirror serving these
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

#: Open Model Zoo release these artifacts came from. Part of the URL, so it is a pin.
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
            tmp.write_bytes(resp.read())
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
    print(f"omz release : {OMZ_RELEASE} (Open Model Zoo is DISCONTINUED upstream)")

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

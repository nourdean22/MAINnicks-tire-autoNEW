"""Verify one file against an expected SHA-256 digest."""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(path: Path, expected: str) -> bool:
    return digest_file(path) == expected.lower()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("expected")
    args = parser.parse_args()
    if verify(args.path, args.expected):
        print(f"{args.path}: OK")
        return 0
    print(f"{args.path}: SHA256 mismatch", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

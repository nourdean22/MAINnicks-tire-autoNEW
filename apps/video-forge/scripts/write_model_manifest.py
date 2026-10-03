"""Write a deterministic model-weight manifest for canary provenance."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

WEIGHT_SUFFIXES = {".safetensors", ".pth"}


def build_manifest(model_dir: Path, repo: str, revision: str) -> dict:
    files: dict[str, str] = {}
    total_bytes = 0
    for file in sorted(model_dir.rglob("*")):
        if not file.is_file() or file.suffix not in WEIGHT_SUFFIXES:
            continue
        digest = hashlib.sha256()
        with file.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 24), b""):
                digest.update(chunk)
        files[file.relative_to(model_dir).as_posix()] = digest.hexdigest()
        total_bytes += file.stat().st_size
    if not files:
        raise ValueError(f"no model weight files found under {model_dir}")
    return {
        "repo": repo,
        "revision": revision,
        "files": files,
        "total_bytes": total_bytes,
    }


def write_manifest(model_dir: Path, repo: str, revision: str) -> dict:
    manifest = build_manifest(model_dir, repo, revision)
    sums = "".join(f"{digest}  {rel}\n" for rel, digest in manifest["files"].items())
    (model_dir / "SHA256SUMS").write_text(sums, encoding="utf-8")
    (model_dir / "MANIFEST.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    manifest = write_manifest(args.model_dir, args.repo, args.revision)
    print(json.dumps({"files": len(manifest["files"]), "bytes": manifest["total_bytes"], "revision": args.revision}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

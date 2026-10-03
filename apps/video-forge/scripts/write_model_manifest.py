"""Write a deterministic manifest for every runtime-visible model artifact."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from forge.model_manifest import iter_model_artifacts  # noqa: E402


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 24), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(model_dir: Path, repo: str, revision: str) -> dict:
    root = model_dir.resolve()
    files: dict[str, str] = {}
    total_bytes = 0
    for file in iter_model_artifacts(root):
        rel = file.relative_to(root).as_posix()
        files[rel] = _sha256(file)
        total_bytes += file.stat().st_size
    if not files:
        raise ValueError(f"no runtime model artifacts found under {model_dir}")
    return {
        "repo": repo,
        "revision": revision,
        "files": files,
        "total_bytes": total_bytes,
    }


def write_manifest(model_dir: Path, repo: str, revision: str) -> dict:
    model_dir.mkdir(parents=True, exist_ok=True)
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

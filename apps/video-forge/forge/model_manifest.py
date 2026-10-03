"""Model-weight provenance verification shared by preflight and runtime."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


class ModelManifestError(RuntimeError):
    pass


def verify_model_manifest(
    model_dir: Path,
    *,
    expected_repo: str | None = None,
    expected_revision: str | None = None,
) -> dict[str, Any]:
    root = model_dir.resolve()
    sums_path = root / "SHA256SUMS"
    manifest_path = root / "MANIFEST.json"
    missing: list[str] = []
    if not sums_path.is_file():
        missing.append(f"missing weight checksum file: {sums_path}")
    if not manifest_path.is_file():
        missing.append(f"missing weight manifest: {manifest_path}")
    if missing:
        raise ModelManifestError("; ".join(missing))

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ModelManifestError(f"invalid weight manifest: {exc}") from exc

    if expected_repo is not None and manifest.get("repo") != expected_repo:
        raise ModelManifestError(
            f"weight manifest repo mismatch: expected {expected_repo}, got {manifest.get('repo')}"
        )
    if expected_revision is not None and manifest.get("revision") != expected_revision:
        raise ModelManifestError(
            f"weight manifest revision mismatch: expected {expected_revision}, got {manifest.get('revision')}"
        )

    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise ModelManifestError("weight manifest contains no hashed model files")

    actual_total = 0
    for rel, expected in files.items():
        if not isinstance(rel, str) or not isinstance(expected, str) or len(expected) != 64:
            raise ModelManifestError(f"invalid weight manifest entry: {rel!r}")
        candidate = (root / rel).resolve()
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise ModelManifestError(f"weight manifest path escapes model directory: {rel}") from exc
        if not candidate.is_file():
            raise ModelManifestError(f"weight file missing: {rel}")
        digest = hashlib.sha256()
        with candidate.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 24), b""):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise ModelManifestError(f"weight sha256 mismatch: {rel}")
        actual_total += candidate.stat().st_size

    parsed: dict[str, str] = {}
    for line in sums_path.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split(maxsplit=1)
        if len(parts) == 2:
            parsed[parts[1].lstrip("*")] = parts[0]
    if parsed != files:
        raise ModelManifestError("SHA256SUMS does not match MANIFEST.json")
    if manifest.get("total_bytes") != actual_total:
        raise ModelManifestError(
            f"weight total_bytes mismatch: expected {manifest.get('total_bytes')}, got {actual_total}"
        )
    return manifest

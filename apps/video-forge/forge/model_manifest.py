"""Model artifact provenance verification shared by preflight and runtime."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterator

# Hugging Face local_dir downloads keep transport/cache metadata under .cache.
# Our own provenance files are generated after the download. Neither category is
# consumed by inference, so neither belongs inside its own manifest.
IGNORED_DIR_NAMES = {".cache", ".git", "__pycache__"}
PROVENANCE_FILES = {"MANIFEST.json", "SHA256SUMS"}


class ModelManifestError(RuntimeError):
    pass


def iter_model_artifacts(model_dir: Path) -> Iterator[Path]:
    """Yield every runtime-visible model artifact, excluding known metadata only."""
    root = model_dir.resolve()
    for file in sorted(root.rglob("*")):
        if not file.is_file():
            continue
        rel = file.relative_to(root)
        if rel.name in PROVENANCE_FILES:
            continue
        if any(part in IGNORED_DIR_NAMES for part in rel.parts):
            continue
        yield file


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 24), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
        missing.append(f"missing model checksum file: {sums_path}")
    if not manifest_path.is_file():
        missing.append(f"missing model manifest: {manifest_path}")
    if missing:
        raise ModelManifestError("; ".join(missing))

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ModelManifestError(f"invalid model manifest: {exc}") from exc

    if expected_repo is not None and manifest.get("repo") != expected_repo:
        raise ModelManifestError(
            f"model manifest repo mismatch: expected {expected_repo}, got {manifest.get('repo')}"
        )
    if expected_revision is not None and manifest.get("revision") != expected_revision:
        raise ModelManifestError(
            f"model manifest revision mismatch: expected {expected_revision}, got {manifest.get('revision')}"
        )

    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise ModelManifestError("model manifest contains no hashed runtime artifacts")

    manifest_paths = set(files)
    actual_paths = {
        file.relative_to(root).as_posix()
        for file in iter_model_artifacts(root)
    }
    if actual_paths != manifest_paths:
        unverified = sorted(actual_paths - manifest_paths)
        absent = sorted(manifest_paths - actual_paths)
        detail: list[str] = []
        if unverified:
            detail.append(f"unverified runtime artifacts: {unverified[:8]}")
        if absent:
            detail.append(f"manifest artifacts missing: {absent[:8]}")
        raise ModelManifestError("model artifact set mismatch: " + "; ".join(detail))

    actual_total = 0
    for rel, expected in files.items():
        if not isinstance(rel, str) or not isinstance(expected, str) or len(expected) != 64:
            raise ModelManifestError(f"invalid model manifest entry: {rel!r}")
        candidate = (root / rel).resolve()
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise ModelManifestError(f"model manifest path escapes model directory: {rel}") from exc
        if not candidate.is_file():
            raise ModelManifestError(f"model artifact missing: {rel}")
        if _sha256(candidate) != expected:
            raise ModelManifestError(f"model sha256 mismatch: {rel}")
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
            f"model total_bytes mismatch: expected {manifest.get('total_bytes')}, got {actual_total}"
        )
    return manifest

#!/usr/bin/env python3
"""Fail-closed overlay for the reviewed ha-eufy-sdk-bridge v0.3.0 runtime.

The overlay is intentionally narrow:
- expose PTZ + preset.goto through the bridge device.action router;
- bind bundled go2rtc listeners to loopback only.

Safety contract:
- require the exact reviewed bridge package/version;
- pin the FULL logical source of every target file, not just replacement seams;
- preflight every target before writing anything;
- roll back earlier writes if a later write/verification fails;
- accept both the reviewed upstream state and the reviewed patched state so reruns are idempotent.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

SUPPORTED_NAME = "ha-eufy-sdk-bridge"
SUPPORTED_VERSION = "0.3.0"

WS_PATH = Path("src/ws-server.mjs")
GO2RTC_PATH = Path("go2rtc-config.mjs")

# SHA-256 over UTF-8 source with CRLF normalized to LF. This pins ALL executable
# content while remaining valid on Windows and Linux checkouts of the same source.
REVIEWED_DIGESTS: dict[Path, frozenset[str]] = {
    WS_PATH: frozenset(
        {
            # upstream v0.3.0 @ f00dd98
            "665a4134c11051f0a72482fd89397d3cdd837ae2d51f06ef1e1a568d2e9afa73",
            # reviewed StateNour PTZ/preset overlay
            "7fa967da9d83c1fa35d42f1fa6abfe1e8d103fe55895232371bede2e71cd17d7",
        }
    ),
    GO2RTC_PATH: frozenset(
        {
            # upstream v0.3.0 @ f00dd98
            "a06f4c47b07a7a4ab2c9eb827375261cb116dbb672fd3bc1f190ff5d89f5886d",
            # reviewed StateNour loopback-only overlay
            "55a8a0e8965cdbc6131e75c965b4542a0600dae41a1e54cd8d730f8da0169293",
        }
    ),
}

ROUTER_OLD = """          // Capability surfaces that expose actions. Add more accessors here as needed.
          const surfaces = [dev.smartLight?.(), dev.camera?.(), dev.lock?.(), dev.siren?.()].filter(Boolean);
          const surface = surfaces.find((s) => typeof s?.[action] === "function");
          if (!surface) return fail(`no action '${action}' on ${msg.sn}`);
          const t0 = Date.now();
          dbg(`device.action → ${action} sn=${msg.sn} args=${JSON.stringify(args)}`);
          try {
            const result = await surface[action](...args);"""

ROUTER_NEW = """          // Capability surfaces that expose actions. Add more accessors here as needed.
          const ptz = dev.ptz?.();
          const surfaces = [dev.smartLight?.(), dev.camera?.(), dev.lock?.(), dev.siren?.(), ptz].filter(Boolean);
          let surface = surfaces.find((s) => typeof s?.[action] === "function");
          let method = action;
          // PTZ presets intentionally live behind a nested namespace: dev.ptz().preset().goto(id).
          // Expose only the reviewed goto path rather than generically traversing arbitrary dotted names.
          if (!surface && action === "preset.goto" && typeof ptz?.preset === "function") {
            const preset = ptz.preset();
            if (typeof preset?.goto === "function") {
              surface = preset;
              method = "goto";
            }
          }
          if (!surface) return fail(`no action '${action}' on ${msg.sn}`);
          const t0 = Date.now();
          dbg(`device.action → ${action} sn=${msg.sn} args=${JSON.stringify(args)}`);
          try {
            const result = await surface[method](...args);"""

LISTENER_REPLACEMENTS = (
    ('  listen: ":1984"', '  listen: "127.0.0.1:1984"'),
    ('  listen: ":8554"', '  listen: "127.0.0.1:8554"'),
    ('  listen: ":8555"', '  listen: "127.0.0.1:8555"'),
)


class OverlayError(RuntimeError):
    """Bridge version/source is unsupported or drifted from the reviewed runtime."""


@dataclass(frozen=True)
class OverlayReport:
    bridge_root: str
    bridge_version: str
    ptz_router: str
    go2rtc_listeners: str
    changed_files: tuple[str, ...]


@dataclass(frozen=True)
class _Plan:
    path: Path
    relative: Path
    original: str
    updated: str
    state: str

    @property
    def changed(self) -> bool:
        return self.original != self.updated


def _canonical_digest(text: str) -> str:
    normalized = text.replace("\r\n", "\n")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _load_package(root: Path) -> dict:
    path = root / "package.json"
    if not path.is_file():
        raise OverlayError(f"missing {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OverlayError(f"cannot read bridge package.json: {exc}") from exc
    name = str(payload.get("name") or "")
    version = str(payload.get("version") or "")
    if (name, version) != (SUPPORTED_NAME, SUPPORTED_VERSION):
        raise OverlayError(
            f"unsupported bridge {name!r} {version!r}; "
            f"expected {SUPPORTED_NAME!r} {SUPPORTED_VERSION!r}"
        )
    return payload


def _read_reviewed(root: Path, relative: Path) -> str:
    path = root / relative
    if not path.is_file():
        raise OverlayError(f"missing {path}")
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise OverlayError(f"cannot read {path}: {exc}") from exc
    digest = _canonical_digest(text)
    allowed = REVIEWED_DIGESTS.get(relative, frozenset())
    if digest not in allowed:
        raise OverlayError(
            f"{relative.as_posix()} full-source drift: sha256={digest}; "
            "runtime is not one of the reviewed upstream/patched files"
        )
    return text


def _replace_exact(text: str, old: str, new: str, label: str) -> tuple[str, str]:
    if new in text:
        return text, "already_patched"
    count = text.count(old)
    if count != 1:
        raise OverlayError(
            f"{label} source drift: expected exactly one reviewed seam, found {count}"
        )
    return text.replace(old, new, 1), "patched"


def _plan_file(
    root: Path,
    relative: Path,
    transforms: Iterable[tuple[str, str, str]],
) -> _Plan:
    original = _read_reviewed(root, relative)
    current = original
    states: list[str] = []
    for old, new, label in transforms:
        current, state = _replace_exact(current, old, new, label)
        states.append(state)

    # The transformed full file must itself be one of the reviewed digests.
    digest = _canonical_digest(current)
    if digest not in REVIEWED_DIGESTS[relative]:
        raise OverlayError(
            f"{relative.as_posix()} transformed to unreviewed source sha256={digest}"
        )
    state = "patched" if current != original else "already_patched"
    return _Plan(root / relative, relative, original, current, state)


def _write_atomic(path: Path, text: str) -> None:
    """Write one UTF-8/LF file atomically in the target directory."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.statenour-",
        suffix=".tmp",
        dir=str(path.parent),
        text=True,
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except Exception:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _plans(root: Path) -> tuple[_Plan, _Plan]:
    """Preflight BOTH targets completely before the first mutation."""
    ptz = _plan_file(
        root,
        WS_PATH,
        ((ROUTER_OLD, ROUTER_NEW, "PTZ/preset device.action router"),),
    )
    go2rtc = _plan_file(
        root,
        GO2RTC_PATH,
        tuple(
            (old, new, f"go2rtc listener {new}")
            for old, new in LISTENER_REPLACEMENTS
        ),
    )
    return ptz, go2rtc


def verify(root: str | Path) -> OverlayReport:
    base = Path(root).resolve()
    package = _load_package(base)
    ws_text = _read_reviewed(base, WS_PATH)
    go_text = _read_reviewed(base, GO2RTC_PATH)

    if ROUTER_NEW not in ws_text or ROUTER_OLD in ws_text:
        raise OverlayError("PTZ/preset action router overlay is not verified")
    for old, new in LISTENER_REPLACEMENTS:
        if new not in go_text or old in go_text:
            raise OverlayError(f"go2rtc listener overlay is not verified: {new}")

    return OverlayReport(
        bridge_root=str(base),
        bridge_version=str(package["version"]),
        ptz_router="verified_with_preset_goto",
        go2rtc_listeners="loopback_only",
        changed_files=(),
    )


def apply(root: str | Path) -> OverlayReport:
    base = Path(root).resolve()
    package = _load_package(base)

    # Critical invariant: inspect package + BOTH complete source files before writing either.
    plans = _plans(base)
    changed = [plan for plan in plans if plan.changed]
    written: list[_Plan] = []

    try:
        for plan in changed:
            _write_atomic(plan.path, plan.updated)
            written.append(plan)
        verify(base)
    except Exception as exc:
        rollback_errors: list[str] = []
        for plan in reversed(written):
            try:
                _write_atomic(plan.path, plan.original)
            except Exception as rollback_exc:  # pragma: no cover - catastrophic FS failure
                rollback_errors.append(
                    f"{plan.relative.as_posix()}: {type(rollback_exc).__name__}: {rollback_exc}"
                )
        if rollback_errors:
            raise OverlayError(
                f"overlay failed ({exc}); rollback also failed: {' | '.join(rollback_errors)}"
            ) from exc
        if isinstance(exc, OverlayError):
            raise
        raise OverlayError(f"overlay write failed and was rolled back: {exc}") from exc

    return OverlayReport(
        bridge_root=str(base),
        bridge_version=str(package["version"]),
        ptz_router=plans[0].state,
        go2rtc_listeners=plans[1].state,
        changed_files=tuple(plan.relative.as_posix() for plan in changed),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Apply/verify the reviewed StateNour overlay for Eufy bridge v0.3.0."
    )
    parser.add_argument("--bridge-root", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)

    try:
        report = apply(args.bridge_root) if args.apply else verify(args.bridge_root)
    except (OverlayError, OSError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2

    print(json.dumps({"ok": True, **asdict(report)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

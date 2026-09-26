#!/usr/bin/env python3
"""Fail-closed overlay for the tested ha-eufy-sdk-bridge runtime.

Live commissioning on 2026-09-26 proved three gaps in upstream bridge v0.3.0:
1. the SDK exposes PTZ actions, but the bridge device.action router omits dev.ptz();
2. StateNour's preset.goto route is nested at dev.ptz().preset().goto(id), while the
   upstream action router resolves only direct methods;
3. generated go2rtc listeners bind all interfaces instead of the loopback-only boundary
   used by the StateNour local bridge.

This module applies ONLY those exact, reviewed edits to bridge v0.3.0. Unknown versions or
unexpected source drift fail closed instead of being patched heuristically.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

SUPPORTED_NAME = "ha-eufy-sdk-bridge"
SUPPORTED_VERSION = "0.3.0"

WS_PATH = Path("src/ws-server.mjs")
GO2RTC_PATH = Path("go2rtc-config.mjs")

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
    """Bridge version/source is unsupported or has drifted from the reviewed seam."""


@dataclass(frozen=True)
class OverlayReport:
    bridge_root: str
    bridge_version: str
    ptz_router: str
    go2rtc_listeners: str
    changed_files: tuple[str, ...]


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


def _replace_exact(text: str, old: str, new: str, label: str) -> tuple[str, str]:
    if new in text:
        return text, "already_patched"
    count = text.count(old)
    if count != 1:
        raise OverlayError(
            f"{label} source drift: expected exactly one reviewed seam, found {count}"
        )
    return text.replace(old, new, 1), "patched"


def _apply_file(path: Path, transforms: Iterable[tuple[str, str, str]]) -> tuple[str, bool]:
    if not path.is_file():
        raise OverlayError(f"missing {path}")
    try:
        original = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise OverlayError(f"cannot read {path}: {exc}") from exc

    current = original
    for old, new, label in transforms:
        current, _state = _replace_exact(current, old, new, label)

    changed = current != original
    if changed:
        try:
            path.write_text(current, encoding="utf-8", newline="\n")
        except OSError as exc:
            raise OverlayError(f"cannot write {path}: {exc}") from exc
    return ("patched" if changed else "already_patched"), changed


def verify(root: str | Path) -> OverlayReport:
    base = Path(root).resolve()
    package = _load_package(base)
    ws_text = (base / WS_PATH).read_text(encoding="utf-8")
    go_text = (base / GO2RTC_PATH).read_text(encoding="utf-8")

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
    changed: list[str] = []

    ptz_state, ptz_changed = _apply_file(
        base / WS_PATH,
        ((ROUTER_OLD, ROUTER_NEW, "PTZ/preset device.action router"),),
    )
    if ptz_changed:
        changed.append(WS_PATH.as_posix())

    go_transforms = tuple(
        (old, new, f"go2rtc listener {new}") for old, new in LISTENER_REPLACEMENTS
    )
    go_state, go_changed = _apply_file(base / GO2RTC_PATH, go_transforms)
    if go_changed:
        changed.append(GO2RTC_PATH.as_posix())

    verify(base)
    return OverlayReport(
        bridge_root=str(base),
        bridge_version=str(package["version"]),
        ptz_router=ptz_state,
        go2rtc_listeners=go_state,
        changed_files=tuple(changed),
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

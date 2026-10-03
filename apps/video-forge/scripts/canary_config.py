"""Pure canary deployment configuration validation."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PROFILE_REGISTRY = ROOT / "forge" / "profiles.json"


def load_profile_registry(path: Path = PROFILE_REGISTRY) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))["profiles"]


def validate_enabled_profiles(
    raw: str,
    install_ltx: str,
    install_wan: str,
    profiles: dict[str, Any] | None = None,
) -> set[str]:
    profiles = load_profile_registry() if profiles is None else profiles
    enabled = {p.strip() for p in raw.split(",") if p.strip()}
    if not enabled:
        raise ValueError("FORGE_ENABLED_PROFILES must name at least one profile")
    unknown = sorted(enabled.difference(profiles))
    if unknown:
        raise ValueError("unknown FORGE_ENABLED_PROFILES: " + ", ".join(unknown))
    for profile_id in sorted(enabled):
        backend = profiles[profile_id].get("backend")
        if backend == "ltx2" and install_ltx != "1":
            raise ValueError(f"{profile_id} requires FORGE_INSTALL_LTX=1")
        if backend == "wan22" and install_wan != "1":
            raise ValueError(f"{profile_id} requires FORGE_INSTALL_WAN=1")
    return enabled

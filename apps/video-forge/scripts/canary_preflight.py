"""No-spend preflight for a real Video Forge GPU canary.

Validates only local config/artifacts. It never allocates a GPU, calls Modal,
downloads weights, or mutates production state.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from forge.model_manifest import ModelManifestError, verify_model_manifest

PROFILES = ROOT / "forge" / "profiles.json"
WAN_5B_PROFILE = "wan2.2-ti2v-5b"
WAN_5B_CODE_REF = "1ea34ff48f87168174e12956e200b1d908b1c5ff"
WAN_5B_REVISION = "921dbaf3f1674a56f47e83fb80a34bac8a8f203e"


def _load_profiles(path: Path = PROFILES) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))["profiles"]


def _is_sha(value: str) -> bool:
    return len(value) == 40 and all(c in "0123456789abcdefABCDEF" for c in value)


def validate(profile_id: str, env: dict[str, str] | None = None, model_dir: Path | None = None) -> dict[str, Any]:
    env = dict(os.environ if env is None else env)
    profiles = _load_profiles()
    errors: list[str] = []
    warnings: list[str] = []

    profile = profiles.get(profile_id)
    if profile is None:
        errors.append(f"unknown profile: {profile_id}")
        return {"ok": False, "errors": errors, "warnings": warnings}

    install_ltx = env.get("FORGE_INSTALL_LTX", "1") == "1"
    install_wan = env.get("FORGE_INSTALL_WAN", "1") == "1"
    ltx_ref = env.get("LTX2_REF", "UNPINNED")
    wan_ref = env.get("WAN22_REF", "UNPINNED")
    wan_weight_rev = env.get("WAN22_WEIGHT_REV", WAN_5B_REVISION if profile_id == WAN_5B_PROFILE else "UNPINNED")
    gpu = env.get("FORGE_MODAL_GPU", "A100")

    if gpu not in {"A100", "A100-40GB", "A100-80GB"}:
        errors.append("FORGE_MODAL_GPU must be A100, A100-40GB, or A100-80GB for this canary")
    if profile_id != WAN_5B_PROFILE:
        errors.append(
            f"profile {profile_id} is not verified by this canary preflight; "
            f"only {WAN_5B_PROFILE} has exact code + weight pins"
        )
    if profile["backend"] == "wan22" and not install_wan:
        errors.append("selected Wan profile but FORGE_INSTALL_WAN is not 1")
    if profile["backend"] == "ltx2" and not install_ltx:
        errors.append("selected LTX profile but FORGE_INSTALL_LTX is not 1")
    if install_wan and not _is_sha(wan_ref):
        errors.append("WAN22_REF must be a 40-character git commit SHA")
    if profile_id == WAN_5B_PROFILE and wan_ref != WAN_5B_CODE_REF:
        errors.append("WAN22_REF must match the Wan code revision verified for this canary")
    if profile_id == WAN_5B_PROFILE and wan_weight_rev != WAN_5B_REVISION:
        errors.append("WAN22_WEIGHT_REV must match the pinned Wan 5B Hugging Face revision")
    if install_ltx and not _is_sha(ltx_ref):
        errors.append("LTX2_REF must be a 40-character git commit SHA")

    if profile.get("license_state") not in {"APPROVED_COMMERCIAL", "APPROVED_WITH_CONDITIONS"}:
        errors.append(f"profile license is not approved: {profile.get('license_state')}")
    if profile.get("rollout") not in {"built", "operator_selectable", "production"}:
        errors.append(f"unexpected rollout state: {profile.get('rollout')}")

    if profile_id == WAN_5B_PROFILE and install_ltx:
        warnings.append("Wan-only canary can set FORGE_INSTALL_LTX=0 to avoid gated LTX dependencies")
    if profile_id == WAN_5B_PROFILE:
        warnings.append(f"Wan 5B weights must be fetched at pinned HF revision {WAN_5B_REVISION}")

    model = None
    if model_dir is not None:
        try:
            model = verify_model_manifest(
                model_dir,
                expected_repo="Wan-AI/Wan2.2-TI2V-5B" if profile_id == WAN_5B_PROFILE else None,
                expected_revision=WAN_5B_REVISION if profile_id == WAN_5B_PROFILE else None,
            )
        except ModelManifestError as exc:
            errors.append(str(exc))

    return {
        "ok": not errors,
        "profile": profile_id,
        "backend": profile["backend"],
        "install_ltx": install_ltx,
        "install_wan": install_wan,
        "gpu": gpu,
        "wan_code_ref": wan_ref,
        "wan_weight_revision": wan_weight_rev,
        "errors": errors,
        "warnings": warnings,
        "model_manifest": model,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default=WAN_5B_PROFILE)
    parser.add_argument("--model-dir", type=Path)
    args = parser.parse_args()
    result = validate(args.profile, model_dir=args.model_dir)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())

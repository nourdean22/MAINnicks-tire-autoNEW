from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from forge.app import _verify_enabled_model_artifacts, load_profiles
from scripts.canary_preflight import WAN_5B_CODE_REF, WAN_5B_REVISION, validate
from scripts.write_model_manifest import write_manifest


WAN_CODE_SHA = WAN_5B_CODE_REF
WAN_REPO = "Wan-AI/Wan2.2-TI2V-5B"
LTX_CODE_SHA = "b" * 40


class CanaryPreflightTests(unittest.TestCase):
    def test_flash_attn_wheel_is_integrity_pinned(self):
        dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("FLASH_ATTN_SHA256=f25da18657a87fc83dc1bfb8b7751b82246e9db355510226b674fd437c34b5fb", dockerfile)
        self.assertIn('sha256sum -c -', dockerfile)

    def test_weight_fetch_writes_revision_manifest(self):
        source = (Path(__file__).resolve().parents[1] / "modal_app.py").read_text(encoding="utf-8")
        self.assertIn('"MANIFEST.json"', source)
        self.assertIn('"revision": WAN_5B["revision"]', source)
        self.assertIn('f.relative_to(root).as_posix()', source)

    def test_runpod_fetch_writes_model_manifests(self):
        source = (Path(__file__).resolve().parents[1] / "scripts" / "fetch_models.sh").read_text(encoding="utf-8")
        self.assertIn("write_model_manifest.py", source)
        self.assertIn('Wan2.2-TI2V-5B" --repo Wan-AI/Wan2.2-TI2V-5B', source)
        # The first Wan canary must not require or fetch gated LTX weights.
        self.assertIn(': "${FETCH_LTX:=1}"', source)
        self.assertIn(': "${FETCH_LTX_DFR:=0}"', source)
        self.assertIn('if [ "$FETCH_LTX" = "1" ]; then', source)
        self.assertIn('if [ "$FETCH_WAN" = "1" ]; then', source)
        self.assertIn('pin LTX25_REV when FETCH_LTX=1', source)
        self.assertIn('pin LTX25_DFR_LORA_REV when FETCH_LTX_DFR=1', source)
        self.assertIn('pin WAN22_REV when FETCH_WAN=1', source)

    def test_docker_receipt_provenance_is_verified_at_runtime(self):
        dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("ARG WAN22_WEIGHT_REV=UNPINNED", dockerfile)
        self.assertIn("FORGE_WAN22_CODE_REV=$WAN22_REF", dockerfile)
        self.assertIn("FORGE_WAN_5B_EXPECTED_REV=$WAN22_WEIGHT_REV", dockerfile)
        self.assertIn("FORGE_REQUIRE_VERIFIED_MODELS=1", dockerfile)
        self.assertIn("FORGE_ENABLED_PROFILES=$ENABLED_PROFILES", dockerfile)
        self.assertNotIn("FORGE_WAN_REV=$WAN22_WEIGHT_REV", dockerfile)

    def test_manifest_writer_hashes_relative_weight_paths(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            nested = root / "nested"
            nested.mkdir()
            weight = nested / "weights.safetensors"
            weight.write_bytes(b"abc")
            manifest = write_manifest(root, "Wan-AI/test", WAN_5B_REVISION)
            saved = json.loads((root / "MANIFEST.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest, saved)
            self.assertEqual(saved["revision"], WAN_5B_REVISION)
            self.assertEqual(saved["total_bytes"], 3)
            self.assertEqual(
                saved["files"]["nested/weights.safetensors"],
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            )
            self.assertIn("nested/weights.safetensors", (root / "SHA256SUMS").read_text(encoding="utf-8"))

    def test_wrong_weight_env_revision_is_refused(self):
        result = validate(
            "wan2.2-ti2v-5b",
            {
                "FORGE_INSTALL_LTX": "0",
                "FORGE_INSTALL_WAN": "1",
                "WAN22_REF": WAN_CODE_SHA,
                "WAN22_WEIGHT_REV": "c" * 40,
            },
        )
        self.assertFalse(result["ok"])
        self.assertTrue(any("WAN22_WEIGHT_REV" in e for e in result["errors"]))

    def test_wan_only_config_is_green_without_gpu_or_network(self):
        result = validate(
            "wan2.2-ti2v-5b",
            {
                "FORGE_INSTALL_LTX": "0",
                "FORGE_INSTALL_WAN": "1",
                "WAN22_REF": WAN_CODE_SHA,
                "WAN22_WEIGHT_REV": WAN_5B_REVISION,
                "FORGE_MODAL_GPU": "A100-40GB",
            },
        )
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["gpu"], "A100-40GB")
        self.assertFalse(result["install_ltx"])

    def test_modal_a100_aliases_are_allowed_but_unknown_gpu_is_refused(self):
        for gpu in ("A100", "A100-40GB", "A100-80GB"):
            with self.subTest(gpu=gpu):
                result = validate(
                    "wan2.2-ti2v-5b",
                    {
                        "FORGE_INSTALL_LTX": "0",
                        "FORGE_INSTALL_WAN": "1",
                        "WAN22_REF": WAN_CODE_SHA,
                        "WAN22_WEIGHT_REV": WAN_5B_REVISION,
                        "FORGE_MODAL_GPU": gpu,
                    },
                )
                self.assertTrue(result["ok"], result)
        bad = validate(
            "wan2.2-ti2v-5b",
            {
                "FORGE_INSTALL_LTX": "0",
                "FORGE_INSTALL_WAN": "1",
                "WAN22_REF": WAN_CODE_SHA,
                "WAN22_WEIGHT_REV": WAN_5B_REVISION,
                "FORGE_MODAL_GPU": "A100-20GB",
            },
        )
        self.assertFalse(bad["ok"])
        self.assertTrue(any("FORGE_MODAL_GPU" in e for e in bad["errors"]))

    def test_unverified_wan_code_sha_is_refused(self):
        result = validate(
            "wan2.2-ti2v-5b",
            {
                "FORGE_INSTALL_LTX": "0",
                "FORGE_INSTALL_WAN": "1",
                "WAN22_REF": "a" * 40,
                "WAN22_WEIGHT_REV": WAN_5B_REVISION,
                "FORGE_MODAL_GPU": "A100",
            },
        )
        self.assertFalse(result["ok"])
        self.assertTrue(any("verified for this canary" in e for e in result["errors"]))

    def test_other_profiles_are_blocked_until_exact_pins_exist(self):
        cases = [
            (
                "wan2.2-i2v-a14b",
                {
                    "FORGE_INSTALL_LTX": "0",
                    "FORGE_INSTALL_WAN": "1",
                    "WAN22_REF": WAN_CODE_SHA,
                    "WAN22_WEIGHT_REV": WAN_5B_REVISION,
                    "FORGE_MODAL_GPU": "A100-80GB",
                },
            ),
            (
                "ltx-2.5-distilled",
                {
                    "FORGE_INSTALL_LTX": "1",
                    "FORGE_INSTALL_WAN": "0",
                    "LTX2_REF": LTX_CODE_SHA,
                    "FORGE_MODAL_GPU": "A100-80GB",
                },
            ),
        ]
        for profile_id, env in cases:
            with self.subTest(profile=profile_id):
                result = validate(profile_id, env)
                self.assertFalse(result["ok"])
                self.assertTrue(any("not verified by this canary preflight" in e for e in result["errors"]))

    def test_modal_canary_reserves_host_resources_and_limits_profiles(self):
        source = (Path(__file__).resolve().parents[1] / "modal_app.py").read_text(encoding="utf-8")
        self.assertIn('ENABLED_PROFILES = _os.environ.get("FORGE_ENABLED_PROFILES", "wan2.2-ti2v-5b")', source)
        self.assertIn('gpu=_os.environ.get("FORGE_MODAL_GPU", "A100-40GB")', source)
        self.assertIn('memory=int(_os.environ.get("FORGE_MODAL_MEMORY_MB", "98304"))', source)
        self.assertIn('cpu=float(_os.environ.get("FORGE_MODAL_CPU", "4"))', source)
        self.assertIn('os.environ.setdefault("FORGE_REQUIRE_VERIFIED_MODELS", "1")', source)

    def test_readme_runpod_canary_disables_ltx_fetch(self):
        source = (Path(__file__).resolve().parents[1] / "README.md").read_text(encoding="utf-8")
        self.assertIn("FETCH_LTX=0 FETCH_WAN=1 WAN22_REV=", source)
        self.assertIn("FETCH_LTX=1 FETCH_LTX_DFR=1", source)

    def test_runtime_derives_receipt_revision_from_verified_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            model_dir = Path(td) / "Wan2.2-TI2V-5B"
            model_dir.mkdir()
            (model_dir / "weights.safetensors").write_bytes(b"verified-runtime-weights")
            write_manifest(model_dir, WAN_REPO, WAN_5B_REVISION)
            env = {
                "FORGE_REQUIRE_VERIFIED_MODELS": "1",
                "FORGE_WAN_5B_EXPECTED_REV": WAN_5B_REVISION,
                "FORGE_WAN_CKPT_TI2V_5B": str(model_dir),
            }
            with patch.dict(os.environ, env, clear=False):
                os.environ.pop("FORGE_WAN_REV", None)
                _verify_enabled_model_artifacts(load_profiles(), {"wan2.2-ti2v-5b"})
                self.assertEqual(os.environ["FORGE_WAN_REV"], WAN_5B_REVISION)

    def test_runtime_refuses_corrupted_or_unverified_enabled_profiles(self):
        profiles = load_profiles()
        with patch.dict(os.environ, {"FORGE_REQUIRE_VERIFIED_MODELS": "1"}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "no verified runtime artifact contract"):
                _verify_enabled_model_artifacts(profiles, {"wan2.2-i2v-a14b"})
        with tempfile.TemporaryDirectory() as td:
            model_dir = Path(td) / "Wan2.2-TI2V-5B"
            model_dir.mkdir()
            weight = model_dir / "weights.safetensors"
            weight.write_bytes(b"before")
            write_manifest(model_dir, WAN_REPO, WAN_5B_REVISION)
            weight.write_bytes(b"after")
            env = {
                "FORGE_REQUIRE_VERIFIED_MODELS": "1",
                "FORGE_WAN_5B_EXPECTED_REV": WAN_5B_REVISION,
                "FORGE_WAN_CKPT_TI2V_5B": str(model_dir),
            }
            with patch.dict(os.environ, env, clear=False):
                with self.assertRaisesRegex(RuntimeError, "sha256 mismatch"):
                    _verify_enabled_model_artifacts(profiles, {"wan2.2-ti2v-5b"})

    def test_unpinned_selected_backend_is_refused(self):
        result = validate(
            "wan2.2-ti2v-5b",
            {"FORGE_INSTALL_LTX": "0", "FORGE_INSTALL_WAN": "1", "WAN22_REF": "UNPINNED"},
        )
        self.assertFalse(result["ok"])
        self.assertTrue(any("WAN22_REF" in e for e in result["errors"]))

    def test_selected_backend_cannot_be_disabled(self):
        result = validate(
            "wan2.2-ti2v-5b",
            {"FORGE_INSTALL_LTX": "0", "FORGE_INSTALL_WAN": "0", "WAN22_REF": WAN_CODE_SHA},
        )
        self.assertFalse(result["ok"])
        self.assertTrue(any("FORGE_INSTALL_WAN" in e for e in result["errors"]))

    def test_model_manifest_is_required_when_model_dir_is_checked(self):
        with tempfile.TemporaryDirectory() as td:
            result = validate(
                "wan2.2-ti2v-5b",
                {"FORGE_INSTALL_LTX": "0", "FORGE_INSTALL_WAN": "1", "WAN22_REF": WAN_CODE_SHA},
                Path(td),
            )
        self.assertFalse(result["ok"])
        self.assertTrue(any("checksum" in e for e in result["errors"]))
        self.assertTrue(any("manifest" in e for e in result["errors"]))

    def test_wrong_weight_revision_is_refused(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / "weights.safetensors").write_bytes(b"weights")
            write_manifest(d, WAN_REPO, "wrong")
            result = validate(
                "wan2.2-ti2v-5b",
                {"FORGE_INSTALL_LTX": "0", "FORGE_INSTALL_WAN": "1", "WAN22_REF": WAN_CODE_SHA},
                d,
            )
        self.assertFalse(result["ok"])
        self.assertTrue(any("revision" in e for e in result["errors"]))

    def test_corrupted_weight_file_is_refused(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            weight = d / "weights.safetensors"
            weight.write_bytes(b"before")
            write_manifest(d, WAN_REPO, WAN_5B_REVISION)
            weight.write_bytes(b"after")
            result = validate(
                "wan2.2-ti2v-5b",
                {"FORGE_INSTALL_LTX": "0", "FORGE_INSTALL_WAN": "1", "WAN22_REF": WAN_CODE_SHA},
                d,
            )
        self.assertFalse(result["ok"])
        self.assertTrue(any("sha256 mismatch" in e for e in result["errors"]))

    def test_checksum_file_must_match_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / "weights.safetensors").write_bytes(b"weights")
            write_manifest(d, WAN_REPO, WAN_5B_REVISION)
            (d / "SHA256SUMS").write_text("0" * 64 + "  weights.safetensors\n", encoding="utf-8")
            result = validate(
                "wan2.2-ti2v-5b",
                {"FORGE_INSTALL_LTX": "0", "FORGE_INSTALL_WAN": "1", "WAN22_REF": WAN_CODE_SHA},
                d,
            )
        self.assertFalse(result["ok"])
        self.assertTrue(any("SHA256SUMS" in e for e in result["errors"]))

    def test_pinned_weight_manifest_is_green(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / "weights.safetensors").write_bytes(b"weights")
            write_manifest(d, WAN_REPO, WAN_5B_REVISION)
            result = validate(
                "wan2.2-ti2v-5b",
                {"FORGE_INSTALL_LTX": "0", "FORGE_INSTALL_WAN": "1", "WAN22_REF": WAN_CODE_SHA},
                d,
            )
        self.assertTrue(result["ok"], result)


if __name__ == "__main__":
    unittest.main()

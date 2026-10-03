from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.canary_preflight import WAN_5B_CODE_REF, WAN_5B_REVISION, validate
from scripts.write_model_manifest import write_manifest


WAN_CODE_SHA = WAN_5B_CODE_REF
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
        self.assertIn('if [ "$FETCH_LTX" = "1" ]; then', source)
        self.assertIn('if [ "$FETCH_WAN" = "1" ]; then', source)
        self.assertIn('pin LTX25_REV when FETCH_LTX=1', source)
        self.assertIn('pin WAN22_REV when FETCH_WAN=1', source)

    def test_docker_receipt_provenance_is_pinned(self):
        dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("ARG WAN22_WEIGHT_REV=UNPINNED", dockerfile)
        self.assertIn("FORGE_WAN22_CODE_REV=$WAN22_REF", dockerfile)
        self.assertIn("FORGE_WAN_REV=$WAN22_WEIGHT_REV", dockerfile)

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
                "FORGE_MODAL_GPU": "A100",
            },
        )
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["gpu"], "A100")
        self.assertFalse(result["install_ltx"])

    def test_legacy_modal_a100_40gb_identifier_is_refused(self):
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
        self.assertFalse(result["ok"])
        self.assertTrue(any("A100" in e for e in result["errors"]))

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
            write_manifest(d, "Wan-AI/test", "wrong")
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
            write_manifest(d, "Wan-AI/test", WAN_5B_REVISION)
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
            write_manifest(d, "Wan-AI/test", WAN_5B_REVISION)
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
            write_manifest(d, "Wan-AI/test", WAN_5B_REVISION)
            result = validate(
                "wan2.2-ti2v-5b",
                {"FORGE_INSTALL_LTX": "0", "FORGE_INSTALL_WAN": "1", "WAN22_REF": WAN_CODE_SHA},
                d,
            )
        self.assertTrue(result["ok"], result)


if __name__ == "__main__":
    unittest.main()

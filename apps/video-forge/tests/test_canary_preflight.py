from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from forge.app import _verify_enabled_model_artifacts, load_profiles
from scripts.canary_config import load_profile_registry, validate_enabled_profiles
from scripts.canary_preflight import WAN_5B_CODE_REF, WAN_5B_REVISION, validate
from scripts.write_model_manifest import write_manifest


WAN_CODE_SHA = WAN_5B_CODE_REF
WAN_REPO = "Wan-AI/Wan2.2-TI2V-5B"
LTX_CODE_SHA = "b" * 40


def _fake_modal_module() -> tuple[types.ModuleType, list[tuple[str, object]]]:
    calls: list[tuple[str, object]] = []
    module = types.ModuleType("modal")

    class FakeImage:
        @classmethod
        def from_dockerfile(cls, *args, **kwargs):
            calls.append(("from_dockerfile", {"args": args, "kwargs": kwargs}))
            return cls()

        @classmethod
        def debian_slim(cls, *args, **kwargs):
            calls.append(("debian_slim", {"args": args, "kwargs": kwargs}))
            return cls()

        def pip_install(self, *args, **kwargs):
            calls.append(("pip_install", {"args": args, "kwargs": kwargs}))
            return self

        def add_local_python_source(self, *modules, **kwargs):
            calls.append(("add_local_python_source", {"modules": modules, "kwargs": kwargs}))
            return self

    class FakeVolume:
        @classmethod
        def from_name(cls, *args, **kwargs):
            calls.append(("volume_from_name", {"args": args, "kwargs": kwargs}))
            return cls()

        def commit(self):
            calls.append(("volume_commit", {}))

    class FakeSecret:
        @classmethod
        def from_name(cls, *args, **kwargs):
            calls.append(("secret_from_name", {"args": args, "kwargs": kwargs}))
            return cls()

    class FakeApp:
        def __init__(self, *args, **kwargs):
            calls.append(("app_init", {"args": args, "kwargs": kwargs}))

        def function(self, *args, **kwargs):
            calls.append(("function_decorator", {"args": args, "kwargs": kwargs}))
            return lambda fn: fn

    def asgi_app(*args, **kwargs):
        calls.append(("asgi_app", {"args": args, "kwargs": kwargs}))
        return lambda fn: fn

    module.Image = FakeImage
    module.Volume = FakeVolume
    module.Secret = FakeSecret
    module.App = FakeApp
    module.asgi_app = asgi_app
    return module, calls


def _exec_modal_app(enabled_profiles: str):
    root = Path(__file__).resolve().parents[1]
    stub, calls = _fake_modal_module()
    name = f"_video_forge_modal_probe_{abs(hash((enabled_profiles, id(calls))))}"
    spec = importlib.util.spec_from_file_location(name, root / "modal_app.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    env = {
        "FORGE_INSTALL_LTX": "0",
        "FORGE_INSTALL_WAN": "1",
        "FORGE_ENABLED_PROFILES": enabled_profiles,
        "WAN22_REF": WAN_CODE_SHA,
        "LTX2_REF": "UNPINNED",
        "FORGE_MODAL_GPU": "A100-40GB",
    }
    error: BaseException | None = None
    with patch.dict(os.environ, env, clear=False), patch.dict(sys.modules, {"modal": stub}):
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
        except BaseException as exc:  # returned to tests so they can inspect pre-image failures
            error = exc
        finally:
            sys.modules.pop(name, None)
    return module, calls, error


def _find_working_bash() -> str | None:
    candidates: list[str] = []
    if os.name == "nt":
        candidates.extend([
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files\Git\usr\bin\bash.exe",
        ])
    discovered = shutil.which("bash")
    if discovered:
        candidates.append(discovered)
    for candidate in candidates:
        if not candidate or not Path(candidate).is_file():
            continue
        probe = subprocess.run([candidate, "--version"], capture_output=True, text=True, check=False)
        if probe.returncode == 0:
            return candidate
    return None


def _run_fetch_models(extra_env: dict[str, str]):
    root = Path(__file__).resolve().parents[1]
    bash = _find_working_bash()
    if not bash:
        raise unittest.SkipTest("bash is unavailable")
    with tempfile.TemporaryDirectory() as td:
        temp_root = Path(td)
        log = temp_root / "mock.log"
        models = temp_root / "models"
        models.mkdir()
        env = os.environ.copy()
        for key in (
            "LTX25_REV",
            "LTX25_DFR_LORA_REV",
            "WAN22_REV",
            "WAN22_A14B_REV",
            "FETCH_LTX",
            "FETCH_LTX_DFR",
            "FETCH_WAN",
        ):
            env.pop(key, None)
        env.update(extra_env)
        # Git Bash understands drive-letter paths with forward slashes.
        env["FETCH_SCRIPT"] = str(root / "scripts" / "fetch_models.sh").replace("\\", "/")
        env["MOCK_LOG"] = str(log).replace("\\", "/")
        env["MODELS_DIR"] = str(models).replace("\\", "/")
        wrapper = r"""
pip() { printf 'pip %s\n' "$*" >> "$MOCK_LOG"; }
huggingface-cli() { printf 'huggingface-cli %s\n' "$*" >> "$MOCK_LOG"; }
python3() { printf 'python3 %s\n' "$*" >> "$MOCK_LOG"; }
find() { return 0; }
xargs() { cat >/dev/null; return 0; }
tee() { cat >/dev/null; return 0; }
source "$FETCH_SCRIPT"
"""
        result = subprocess.run(
            [bash, "-c", wrapper],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        log_text = log.read_text(encoding="utf-8") if log.exists() else ""
        return result, log_text


class CanaryPreflightTests(unittest.TestCase):
    def test_flash_attn_wheel_guard_rejects_bad_digest_and_accepts_good_digest(self):
        root = Path(__file__).resolve().parents[1]
        dockerfile = (root / "Dockerfile").read_text(encoding="utf-8")
        verifier = root / "scripts" / "verify_sha256.py"
        self.assertIn("FLASH_ATTN_SHA256=f25da18657a87fc83dc1bfb8b7751b82246e9db355510226b674fd437c34b5fb", dockerfile)
        self.assertIn("python3 /usr/local/bin/verify_sha256.py /tmp/flash_attn.whl", dockerfile)
        with tempfile.TemporaryDirectory() as td:
            artifact = Path(td) / "flash_attn.whl"
            artifact.write_bytes(b"known-wheel-bytes")
            good = hashlib.sha256(artifact.read_bytes()).hexdigest()
            bad = "0" * 64
            failed = subprocess.run(
                [sys.executable, str(verifier), str(artifact), bad],
                capture_output=True,
                text=True,
                check=False,
            )
            passed = subprocess.run(
                [sys.executable, str(verifier), str(artifact), good],
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertNotEqual(failed.returncode, 0, failed.stdout + failed.stderr)
        self.assertEqual(passed.returncode, 0, passed.stdout + passed.stderr)

    def test_enabled_profile_registry_rejects_typos_and_checks_installed_backend(self):
        profiles = load_profile_registry()
        enabled = validate_enabled_profiles("wan2.2-ti2v-5b", "0", "1", profiles)
        self.assertEqual(enabled, {"wan2.2-ti2v-5b"})
        with self.assertRaisesRegex(ValueError, "unknown FORGE_ENABLED_PROFILES"):
            validate_enabled_profiles("wan2.2-ti2v-5B", "0", "1", profiles)
        with self.assertRaisesRegex(ValueError, "FORGE_INSTALL_WAN=1"):
            validate_enabled_profiles("wan2.2-ti2v-5b", "0", "0", profiles)

    def test_modal_module_rejects_typo_before_image_declaration(self):
        _module, calls, error = _exec_modal_app("wan2.2-ti2v-5B")
        self.assertIsInstance(error, ValueError)
        self.assertIn("unknown FORGE_ENABLED_PROFILES", str(error))
        self.assertFalse(any(name == "from_dockerfile" for name, _payload in calls), calls)

    def test_modal_module_valid_profile_reaches_image_declaration(self):
        module, calls, error = _exec_modal_app("wan2.2-ti2v-5b")
        self.assertIsNone(error, error)
        image_calls = [payload for name, payload in calls if name == "from_dockerfile"]
        self.assertEqual(len(image_calls), 1)
        self.assertEqual(
            image_calls[0]["kwargs"]["build_args"]["ENABLED_PROFILES"],
            "wan2.2-ti2v-5b",
        )
        self.assertEqual(image_calls[0]["kwargs"]["build_args"]["INSTALL_LTX"], "0")
        self.assertEqual(image_calls[0]["kwargs"]["build_args"]["INSTALL_WAN"], "1")
        self.assertTrue(callable(module.forge))

    def test_modal_factory_import_constructs_one_forge_and_no_global_app(self):
        root = Path(__file__).resolve().parents[1]
        env = os.environ.copy()
        env.update(
            {
                "FORGE_SECRET": "x" * 32,
                "FORGE_FACTORY_ONLY": "1",
                "FORGE_REQUIRE_VERIFIED_MODELS": "0",
            }
        )
        probe = subprocess.run(
            [
                sys.executable,
                "-c",
                "import forge.app as module; assert module.app is None; print('factory-only-ok')",
            ],
            cwd=root,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(probe.returncode, 0, probe.stdout + probe.stderr)
        self.assertIn("factory-only-ok", probe.stdout)

        module, _calls, error = _exec_modal_app("wan2.2-ti2v-5b")
        self.assertIsNone(error, error)
        created: list[bool] = []

        def fake_create_app(*, start_worker: bool = True):
            self.assertEqual(os.environ.get("FORGE_FACTORY_ONLY"), "1")
            created.append(start_worker)
            return object()

        original_path = list(sys.path)
        try:
            with patch("forge.app.create_app", side_effect=fake_create_app):
                with patch.dict(os.environ, {"FORGE_FACTORY_ONLY": "0"}, clear=False):
                    module.forge()
        finally:
            sys.path[:] = original_path
        self.assertEqual(created, [True])

    def test_modal_fetch_image_packages_shared_manifest_writer(self):
        module, calls, error = _exec_modal_app("wan2.2-ti2v-5b")
        self.assertIsNone(error, error)
        packaged = [payload for name, payload in calls if name == "add_local_python_source"]
        self.assertEqual(len(packaged), 1)
        self.assertIn("scripts.write_model_manifest", packaged[0]["modules"])
        self.assertIn("forge.model_manifest", packaged[0]["modules"])
        self.assertTrue(callable(module.fetch_wan_5b))

    def test_fetch_models_dfr_without_separate_pin_fails(self):
        result, log = _run_fetch_models(
            {
                "FETCH_LTX": "1",
                "FETCH_LTX_DFR": "1",
                "FETCH_WAN": "0",
                "LTX25_REV": "ltx-rev",
            }
        )
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("LTX25_DFR_LORA_REV", result.stderr)
        self.assertEqual(log, "", "invalid DFR fetch plan performed external work before failing")

    def test_fetch_models_missing_ltx_pin_fails_before_external_work(self):
        result, log = _run_fetch_models(
            {
                "FETCH_LTX": "1",
                "FETCH_LTX_DFR": "0",
                "FETCH_WAN": "0",
            }
        )
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("LTX25_REV", result.stderr)
        self.assertEqual(log, "", "missing LTX pin performed external work before failing")

    def test_fetch_models_missing_wan_pin_fails_before_external_work(self):
        result, log = _run_fetch_models(
            {
                "FETCH_LTX": "0",
                "FETCH_LTX_DFR": "0",
                "FETCH_WAN": "1",
            }
        )
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("WAN22_REV", result.stderr)
        self.assertEqual(log, "", "missing Wan pin performed external work before failing")

    def test_fetch_models_wan_only_never_touches_ltx(self):
        result, log = _run_fetch_models(
            {
                "FETCH_LTX": "0",
                "FETCH_LTX_DFR": "0",
                "FETCH_WAN": "1",
                "WAN22_REV": WAN_5B_REVISION,
            }
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Wan-AI/Wan2.2-TI2V-5B", log)
        self.assertIn("write_model_manifest.py", log)
        self.assertNotIn("Lightricks/LTX-2.5", log)
        self.assertNotIn("IC-LoRA", log)

    def test_fetch_models_valid_dfr_selection_reaches_expected_commands(self):
        result, log = _run_fetch_models(
            {
                "FETCH_LTX": "1",
                "FETCH_LTX_DFR": "1",
                "FETCH_WAN": "0",
                "LTX25_REV": "ltx-rev",
                "LTX25_DFR_LORA_REV": "dfr-rev",
            }
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Lightricks/LTX-2.5 --revision ltx-rev", log)
        self.assertIn("LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler --revision dfr-rev", log)
        self.assertGreaterEqual(log.count("write_model_manifest.py"), 2)
        self.assertNotIn("Wan-AI/Wan2.2", log)

    def test_docker_receipt_provenance_is_verified_at_runtime(self):
        dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("ARG WAN22_WEIGHT_REV=UNPINNED", dockerfile)
        self.assertIn("FORGE_WAN22_CODE_REV=$WAN22_REF", dockerfile)
        self.assertIn("FORGE_WAN_5B_EXPECTED_REV=$WAN22_WEIGHT_REV", dockerfile)
        self.assertIn("FORGE_REQUIRE_VERIFIED_MODELS=1", dockerfile)
        self.assertIn("FORGE_ENABLED_PROFILES=$ENABLED_PROFILES", dockerfile)
        self.assertNotIn("FORGE_WAN_REV=$WAN22_WEIGHT_REV", dockerfile)

    def test_manifest_writer_hashes_all_runtime_artifacts_and_ignores_cache(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            nested = root / "nested"
            tokenizer = root / "tokenizer"
            cache = root / ".cache" / "huggingface"
            nested.mkdir()
            tokenizer.mkdir()
            cache.mkdir(parents=True)
            (nested / "weights.safetensors").write_bytes(b"abc")
            (root / "config.json").write_bytes(b'{"model":"wan"}')
            (tokenizer / "tokenizer.json").write_bytes(b'{"tokens":["a"]}')
            (tokenizer / "MANIFEST.json").write_bytes(b'{"runtime":"nested"}')
            (cache / "download.lock").write_bytes(b"transport-metadata")
            manifest = write_manifest(root, "Wan-AI/test", WAN_5B_REVISION)
            saved = json.loads((root / "MANIFEST.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest, saved)
            self.assertEqual(saved["revision"], WAN_5B_REVISION)
            self.assertEqual(
                set(saved["files"]),
                {
                    "nested/weights.safetensors",
                    "config.json",
                    "tokenizer/tokenizer.json",
                    "tokenizer/MANIFEST.json",
                },
            )
            self.assertEqual(
                saved["total_bytes"],
                len(b"abc")
                + len(b'{"model":"wan"}')
                + len(b'{"tokens":["a"]}')
                + len(b'{"runtime":"nested"}'),
            )
            self.assertEqual(
                saved["files"]["nested/weights.safetensors"],
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            )
            sums = (root / "SHA256SUMS").read_text(encoding="utf-8")
            self.assertIn("config.json", sums)
            self.assertIn("tokenizer/tokenizer.json", sums)
            self.assertNotIn(".cache", sums)

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
        self.assertIn("_enabled = validate_enabled_profiles(", source)
        self.assertLess(source.index("_enabled = validate_enabled_profiles("), source.index("image = modal.Image.from_dockerfile("))
        self.assertIn('gpu=_os.environ.get("FORGE_MODAL_GPU", "A100-40GB")', source)
        self.assertIn('memory=int(_os.environ.get("FORGE_MODAL_MEMORY_MB", "98304"))', source)
        self.assertIn('cpu=float(_os.environ.get("FORGE_MODAL_CPU", "4"))', source)
        self.assertIn('os.environ.setdefault("FORGE_REQUIRE_VERIFIED_MODELS", "1")', source)

    def test_readme_runpod_canary_disables_ltx_fetch_and_build(self):
        source = (Path(__file__).resolve().parents[1] / "README.md").read_text(encoding="utf-8")
        self.assertIn("FETCH_LTX=0 FETCH_WAN=1 WAN22_REV=", source)
        self.assertIn("--build-arg INSTALL_LTX=0", source)
        self.assertIn("--build-arg INSTALL_WAN=1", source)
        self.assertIn("--build-arg ENABLED_PROFILES=wan2.2-ti2v-5b", source)
        self.assertIn("--build-arg WAN22_REF=" + WAN_CODE_SHA, source)
        self.assertIn("--build-arg WAN22_WEIGHT_REV=" + WAN_5B_REVISION, source)
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

    def test_corrupted_config_or_tokenizer_artifact_is_refused(self):
        for rel in ("config.json", "tokenizer/tokenizer.json"):
            with self.subTest(rel=rel), tempfile.TemporaryDirectory() as td:
                d = Path(td)
                target = d / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                (d / "weights.safetensors").write_bytes(b"weights")
                target.write_bytes(b"before")
                write_manifest(d, WAN_REPO, WAN_5B_REVISION)
                target.write_bytes(b"after")
                result = validate(
                    "wan2.2-ti2v-5b",
                    {"FORGE_INSTALL_LTX": "0", "FORGE_INSTALL_WAN": "1", "WAN22_REF": WAN_CODE_SHA},
                    d,
                )
                self.assertFalse(result["ok"])
                self.assertTrue(any("sha256 mismatch" in e for e in result["errors"]), result)

    def test_new_unmanifested_runtime_artifact_is_refused(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / "weights.safetensors").write_bytes(b"weights")
            write_manifest(d, WAN_REPO, WAN_5B_REVISION)
            (d / "tokenizer_config.json").write_text('{"added":"later"}', encoding="utf-8")
            result = validate(
                "wan2.2-ti2v-5b",
                {"FORGE_INSTALL_LTX": "0", "FORGE_INSTALL_WAN": "1", "WAN22_REF": WAN_CODE_SHA},
                d,
            )
        self.assertFalse(result["ok"])
        self.assertTrue(any("unverified runtime artifacts" in e for e in result["errors"]), result)

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

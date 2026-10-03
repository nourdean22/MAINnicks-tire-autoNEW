from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from forge.model_manifest import ModelManifestError, verify_model_manifest
from scripts.write_model_manifest import write_manifest

APP_ROOT = Path(__file__).resolve().parents[1]
FETCH_SCRIPT = APP_ROOT / "scripts" / "fetch_models.sh"
WAN_REV = "921dbaf3f1674a56f47e83fb80a34bac8a8f203e"


def _bash() -> str | None:
    candidates = []
    if os.name == "nt":
        candidates.extend(
            [
                Path(r"C:\Program Files\Git\bin\bash.exe"),
                Path(r"C:\Program Files\Git\usr\bin\bash.exe"),
            ]
        )
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return shutil.which("bash")


def _write_bash(path: Path, body: str) -> None:
    path.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body, encoding="utf-8")
    path.chmod(0o755)


class RuntimeArtifactManifestTests(unittest.TestCase):
    def test_manifest_covers_runtime_config_tokenizer_and_weights(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "weights.safetensors").write_bytes(b"weights")
            (root / "config.json").write_text('{"model":"wan"}', encoding="utf-8")
            tokenizer = root / "tokenizer"
            tokenizer.mkdir()
            (tokenizer / "tokenizer.json").write_text('{"version":"1"}', encoding="utf-8")
            cache = root / ".cache" / "huggingface" / "download"
            cache.mkdir(parents=True)
            (cache / "transport.metadata").write_text("ignored", encoding="utf-8")

            manifest = write_manifest(root, "Wan-AI/test", WAN_REV)

            self.assertEqual(
                set(manifest["files"]),
                {"config.json", "tokenizer/tokenizer.json", "weights.safetensors"},
            )
            verified = verify_model_manifest(
                root,
                expected_repo="Wan-AI/test",
                expected_revision=WAN_REV,
            )
            self.assertEqual(verified["files"], manifest["files"])

    def test_unmanifested_runtime_artifact_is_refused(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "weights.safetensors").write_bytes(b"weights")
            (root / "config.json").write_text("v1", encoding="utf-8")
            write_manifest(root, "Wan-AI/test", WAN_REV)
            (root / "tokenizer.json").write_text("new-unverified-byte", encoding="utf-8")
            with self.assertRaisesRegex(ModelManifestError, "unverified runtime artifacts"):
                verify_model_manifest(
                    root,
                    expected_repo="Wan-AI/test",
                    expected_revision=WAN_REV,
                )


class ModalDeploymentBehaviorTests(unittest.TestCase):
    def _stub_modal_dir(self, root: Path) -> tuple[Path, Path]:
        stub = root / "stub"
        stub.mkdir()
        marker = root / "modal-image-called.txt"
        (stub / "modal.py").write_text(
            textwrap.dedent(
                """
                import os
                from pathlib import Path

                def _mark(value):
                    marker = os.environ.get("MODAL_STUB_MARKER")
                    if marker:
                        Path(marker).write_text(value, encoding="utf-8")

                class _ImageObject:
                    def pip_install(self, *args, **kwargs):
                        return self

                    def add_local_dir(self, *args, **kwargs):
                        return self

                class Image:
                    @staticmethod
                    def from_dockerfile(*args, **kwargs):
                        _mark("from_dockerfile")
                        return _ImageObject()

                    @staticmethod
                    def debian_slim(*args, **kwargs):
                        return _ImageObject()

                class _VolumeObject:
                    def commit(self):
                        return None

                class Volume:
                    @staticmethod
                    def from_name(*args, **kwargs):
                        return _VolumeObject()

                class Secret:
                    @staticmethod
                    def from_name(*args, **kwargs):
                        return object()

                class App:
                    def __init__(self, *args, **kwargs):
                        pass

                    def function(self, *args, **kwargs):
                        def decorator(fn):
                            return fn
                        return decorator

                def asgi_app():
                    def decorator(fn):
                        return fn
                    return decorator
                """
            ).lstrip(),
            encoding="utf-8",
        )
        return stub, marker

    def _import_modal_app(self, enabled: str) -> tuple[subprocess.CompletedProcess[str], bool]:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            stub, marker = self._stub_modal_dir(root)
            env = os.environ.copy()
            env.update(
                {
                    "PYTHONPATH": os.pathsep.join([str(stub), str(APP_ROOT)]),
                    "MODAL_STUB_MARKER": str(marker),
                    "FORGE_ENABLED_PROFILES": enabled,
                    "FORGE_INSTALL_LTX": "0",
                    "FORGE_INSTALL_WAN": "1",
                    "WAN22_REF": "1ea34ff48f87168174e12956e200b1d908b1c5ff",
                    "WAN22_WEIGHT_REV": WAN_REV,
                }
            )
            result = subprocess.run(
                [sys.executable, "-c", "import modal_app"],
                cwd=APP_ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            called = marker.is_file()
            return result, called

    def test_typo_fails_before_modal_image_declaration(self):
        result, called = self._import_modal_app("wan2.2-ti2v-5B")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("unknown FORGE_ENABLED_PROFILES", result.stderr)
        self.assertFalse(called, "Modal image declaration was reached despite invalid profile")

    def test_valid_profile_reaches_modal_image_declaration(self):
        result, called = self._import_modal_app("wan2.2-ti2v-5b")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(called, "valid profile never reached Modal image declaration")

    def test_modal_factory_sets_factory_only_before_importing_forge_app(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            stub, marker_file = self._stub_modal_dir(root)
            forge_pkg = stub / "forge"
            forge_pkg.mkdir()
            (forge_pkg / "__init__.py").write_text("", encoding="utf-8")
            (forge_pkg / "app.py").write_text(
                textwrap.dedent(
                    """
                    import os
                    if os.environ.get("FORGE_FACTORY_ONLY") != "1":
                        raise RuntimeError("factory-only flag was not set before forge.app import")
                    def create_app(start_worker=True):
                        return "factory-app"
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            env = os.environ.copy()
            env.update(
                {
                    "PYTHONPATH": os.pathsep.join([str(stub), str(APP_ROOT)]),
                    "MODAL_STUB_MARKER": str(marker_file),
                    "FORGE_ENABLED_PROFILES": "wan2.2-ti2v-5b",
                    "FORGE_INSTALL_LTX": "0",
                    "FORGE_INSTALL_WAN": "1",
                    "WAN22_REF": "1ea34ff48f87168174e12956e200b1d908b1c5ff",
                    "WAN22_WEIGHT_REV": WAN_REV,
                }
            )
            result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "import modal_app; assert modal_app.forge() == 'factory-app'; print('modal-factory-ok')",
                ],
                cwd=root,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("modal-factory-ok", result.stdout)

    def test_factory_only_import_suppresses_global_forge_construction(self):
        env = os.environ.copy()
        env.update(
            {
                "PYTHONPATH": str(APP_ROOT),
                "FORGE_SECRET": "s" * 32,
                "FORGE_FACTORY_ONLY": "1",
            }
        )
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "import forge.app as m; assert m.app is None; print('factory-only-ok')",
            ],
            cwd=APP_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("factory-only-ok", result.stdout)


@unittest.skipUnless(_bash(), "bash is required for fetch_models.sh behavior tests")
class FetchModelsBehaviorTests(unittest.TestCase):
    def _run_fetch(self, overrides: dict[str, str]) -> tuple[subprocess.CompletedProcess[str], str]:
        bash = _bash()
        assert bash is not None
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            models = root / "models"
            models.mkdir()
            log = root / "commands.log"
            mocks = root / "mocks"
            mocks.mkdir()

            pip_mock = mocks / "pip-mock.sh"
            hf_mock = mocks / "hf-mock.sh"
            py_mock = mocks / "python-mock.sh"

            _write_bash(pip_mock, 'echo "pip $*" >> "$FORGE_FETCH_TEST_LOG"\n')
            _write_bash(
                hf_mock,
                textwrap.dedent(
                    """
                    echo "hf $*" >> "$FORGE_FETCH_TEST_LOG"
                    dest=""
                    while [ "$#" -gt 0 ]; do
                      if [ "$1" = "--local-dir" ]; then
                        shift
                        dest="$1"
                        break
                      fi
                      shift
                    done
                    if [ -n "$dest" ]; then
                      mkdir -p "$dest"
                      printf 'mock-weights' > "$dest/mock.safetensors"
                    fi
                    """
                ).lstrip(),
            )
            _write_bash(py_mock, 'echo "py $*" >> "$FORGE_FETCH_TEST_LOG"\n')

            env = os.environ.copy()
            env.update(
                {
                    "MODELS_DIR": models.as_posix(),
                    "FORGE_FETCH_TEST_LOG": log.as_posix(),
                    "PIP_BIN": pip_mock.as_posix(),
                    "HF_CLI_BIN": hf_mock.as_posix(),
                    "PYTHON_BIN": py_mock.as_posix(),
                }
            )
            env.update(overrides)
            result = subprocess.run(
                [bash, FETCH_SCRIPT.as_posix()],
                cwd=APP_ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            text = log.read_text(encoding="utf-8") if log.is_file() else ""
            return result, text

    def test_dfr_selection_without_lora_revision_fails(self):
        result, log = self._run_fetch(
            {
                "FETCH_LTX": "1",
                "FETCH_LTX_DFR": "1",
                "FETCH_WAN": "0",
                "LTX25_REV": "ltx-base-rev",
            }
        )
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("pin LTX25_DFR_LORA_REV", result.stderr)
        self.assertEqual(log, "", "invalid DFR plan performed external work before failing")

    def test_wan_only_selection_does_not_touch_ltx(self):
        result, log = self._run_fetch(
            {
                "FETCH_LTX": "0",
                "FETCH_LTX_DFR": "0",
                "FETCH_WAN": "1",
                "WAN22_REV": WAN_REV,
            }
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Wan-AI/Wan2.2-TI2V-5B", log)
        self.assertIn("write_model_manifest.py", log)
        self.assertNotIn("Lightricks", log)

    def test_valid_dfr_selection_reaches_base_lora_and_manifests(self):
        result, log = self._run_fetch(
            {
                "FETCH_LTX": "1",
                "FETCH_LTX_DFR": "1",
                "FETCH_WAN": "0",
                "LTX25_REV": "ltx-base-rev",
                "LTX25_DFR_LORA_REV": "ltx-lora-rev",
            }
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Lightricks/LTX-2.5 --revision ltx-base-rev", log)
        self.assertIn("LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler", log)
        self.assertGreaterEqual(log.count("write_model_manifest.py"), 2)
        self.assertNotIn("Wan-AI", log)


if __name__ == "__main__":
    unittest.main()

"""
NOUR external worker agent.

Consumes only AI_EXTERNAL_WORKER WorkItems from StateNour's existing runner
protocol. No inbound listener, no second queue, no API-key fallback.

Required:
  RUNNER_SHARED_SECRET
Optional:
  STATENOUR_BASE_URL=https://bdnick.info
  NOUR_EXTERNAL_WORKER_ALLOW_WRITES=0
  NOUR_EXTERNAL_WORKER_WORKSPACES_JSON={"repo":"C:\\Users\\nourd\\NOURCITY"}
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import requests

BASE_URL = os.getenv("STATENOUR_BASE_URL", "https://bdnick.info").rstrip("/")
RUNNER_SECRET = os.getenv("RUNNER_SHARED_SECRET", "").strip()
NODE_KEY = os.getenv(
    "NOUR_EXTERNAL_WORKER_NODE_KEY",
    f"external-worker:{platform.node().lower() or 'windows'}",
)
POLL_SECONDS = max(3, int(os.getenv("NOUR_EXTERNAL_WORKER_POLL_SECONDS", "10")))
TIMEOUT_SECONDS = max(30, int(os.getenv("NOUR_EXTERNAL_WORKER_TIMEOUT_SECONDS", "900")))
ALLOW_WRITES = os.getenv("NOUR_EXTERNAL_WORKER_ALLOW_WRITES", "0").strip() == "1"
MAX_OUTPUT_CHARS = 50_000
LOCAL_GATEWAY = os.getenv("NOUR_LOCAL_GATEWAY_URL", "http://127.0.0.1:11436")

LANE_IDS = ("codex", "claude-code", "antigravity", "local-qwen")
runtime_lane_overrides: dict[str, dict[str, str]] = {}


def log(message: str) -> None:
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}", flush=True)


def scrubbed_env() -> dict[str, str]:
    env = dict(os.environ)
    for key in (
        "OPENAI_API_KEY",
        "CODEX_API_KEY",
        "CODEX_ACCESS_TOKEN",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
    ):
        env.pop(key, None)
    return env


def default_workspaces() -> dict[str, str]:
    home = Path.home()
    repo = home / "NOURCITY"
    return {
        "repo": str(repo),
        "statenour": str(repo / "apps" / "statenour"),
        "nickstire": str(repo / "apps" / "nickstire"),
    }


def workspace_map() -> dict[str, str]:
    raw = os.getenv("NOUR_EXTERNAL_WORKER_WORKSPACES_JSON", "").strip()
    if not raw:
        return default_workspaces()
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("NOUR_EXTERNAL_WORKER_WORKSPACES_JSON must be an object")
    out: dict[str, str] = {}
    for key, value in parsed.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise ValueError("workspace keys and paths must be strings")
        out[key] = value
    return out


def resolve_workspace(key: str) -> Path:
    value = workspace_map().get(key)
    if not value:
        raise ValueError(f"workspace_key_not_allowed:{key}")
    path = Path(value).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise ValueError(f"workspace_missing:{key}")
    return path


def _cmdline_for_batch(executable: str, args: list[str]) -> list[str]:
    comspec = os.environ.get("COMSPEC", r"C:\Windows\System32\cmd.exe")
    return [comspec, "/d", "/s", "/c", subprocess.list2cmdline([executable, *args])]


def executable_command(name: str, args: list[str]) -> list[str]:
    path = shutil.which(name)
    if not path:
        raise FileNotFoundError(f"{name}_not_installed")
    if path.lower().endswith((".cmd", ".bat")):
        return _cmdline_for_batch(path, args)
    return [path, *args]


def run_process(
    name: str,
    args: list[str],
    *,
    cwd: Path | None = None,
    stdin_text: str | None = None,
    timeout: int = 20,
) -> tuple[int, str]:
    cmd = executable_command(name, args)
    cp = subprocess.run(
        cmd,
        input=stdin_text,
        text=True,
        capture_output=True,
        cwd=str(cwd) if cwd else None,
        env=scrubbed_env(),
        timeout=timeout,
        check=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    output = (cp.stdout or "") + (("\n" + cp.stderr) if cp.stderr else "")
    return cp.returncode, output.strip()


def quota_from_text(text: str) -> str:
    lower = text.lower()
    if any(
        phrase in lower
        for phrase in (
            "quota exceeded",
            "usage limit",
            "rate limit reached",
            "workspace credits",
            "out of credits",
            "insufficient credits",
            "limit reached",
        )
    ):
        return "exhausted"
    return "unknown"


def probe_local_qwen() -> dict[str, str]:
    try:
        res = requests.get(f"{LOCAL_GATEWAY}/health", timeout=3)
        body = res.json() if res.ok else {}
        ready = bool(body.get("status") == "ok" and body.get("backendReady"))
        return {
            "health": "ready" if ready else "unavailable",
            "quota": "available",
            "auth": "local",
            "detail": f"gateway={res.status_code}; backendReady={body.get('backendReady')}",
        }
    except Exception as exc:
        return {
            "health": "unavailable",
            "quota": "unknown",
            "auth": "local",
            "detail": f"gateway unavailable: {type(exc).__name__}",
        }


def probe_codex() -> dict[str, str]:
    try:
        code, text = run_process("codex", ["login", "status"], timeout=15)
        ready = code == 0 and "Logged in using ChatGPT" in text
        override = runtime_lane_overrides.get("codex", {})
        return {
            "health": override.get("health", "ready" if ready else "unavailable"),
            "quota": override.get("quota", "unknown"),
            "auth": "ChatGPT" if ready else "not logged in",
            "detail": override.get("detail", "subscription auth; API env scrubbed"),
        }
    except Exception as exc:
        return {
            "health": "unavailable",
            "quota": "unknown",
            "auth": "unknown",
            "detail": f"codex probe failed: {type(exc).__name__}",
        }


def probe_claude() -> dict[str, str]:
    try:
        code, text = run_process("claude", ["auth", "status"], timeout=15)
        ready = code == 0 and '"loggedIn": true' in text
        subscription = "claude.ai"
        try:
            data = json.loads(text[text.find("{") :])
            subscription = f"claude.ai/{data.get('subscriptionType') or 'subscription'}"
        except Exception:
            pass
        override = runtime_lane_overrides.get("claude-code", {})
        return {
            "health": override.get("health", "ready" if ready else "unavailable"),
            "quota": override.get("quota", "unknown"),
            "auth": subscription if ready else "not logged in",
            "detail": override.get("detail", "subscription auth; ANTHROPIC_API_KEY scrubbed"),
        }
    except Exception as exc:
        return {
            "health": "unavailable",
            "quota": "unknown",
            "auth": "unknown",
            "detail": f"claude probe failed: {type(exc).__name__}",
        }


def probe_antigravity() -> dict[str, str]:
    try:
        agy = str(Path(os.getenv("LOCALAPPDATA", "")) / "agy" / "bin" / "agy.exe")
        if not Path(agy).exists():
            return {
                "health": "unavailable",
                "quota": "unknown",
                "auth": "unknown",
                "detail": "agy unavailable",
            }
        cp = subprocess.run(
            [agy, "--version"],
            text=True,
            capture_output=True,
            env=scrubbed_env(),
            timeout=15,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        ready = cp.returncode == 0
        override = runtime_lane_overrides.get("antigravity", {})
        return {
            "health": override.get("health", "ready" if ready else "unavailable"),
            "quota": override.get("quota", "unknown"),
            "auth": "Google account" if ready else "unknown",
            "detail": override.get("detail", (cp.stdout or cp.stderr).strip()[:160]),
        }
    except Exception as exc:
        return {
            "health": "unavailable",
            "quota": "unknown",
            "auth": "unknown",
            "detail": f"antigravity probe failed: {type(exc).__name__}",
        }


def probe_lanes() -> dict[str, dict[str, str]]:
    checked = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    lanes = {
        "codex": probe_codex(),
        "claude-code": probe_claude(),
        "antigravity": probe_antigravity(),
        "local-qwen": probe_local_qwen(),
    }
    for lane in lanes.values():
        lane["checkedAt"] = checked
    return lanes


def headers() -> dict[str, str]:
    if not RUNNER_SECRET:
        raise RuntimeError("RUNNER_SHARED_SECRET is required")
    return {
        "x-runner-secret": RUNNER_SECRET,
        "content-type": "application/json",
    }


def post(path: str, payload: dict[str, Any], timeout: int = 20) -> dict[str, Any]:
    response = requests.post(
        BASE_URL + path,
        headers=headers(),
        json=payload,
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError(f"unexpected response from {path}")
    # StateNour apiHandler wraps route results in { ok, data, meta }.
    # Preserve compatibility with raw-dict responses while unwrapping the
    # standard envelope so callers such as claim() can see data.items.
    if data.get("ok") is True and isinstance(data.get("data"), dict):
        return data["data"]
    return data


def heartbeat(lanes: dict[str, dict[str, str]]) -> None:
    post(
        "/api/internal/runner/heartbeat",
        {
            "nodeKey": NODE_KEY,
            "label": "NOUR External Worker",
            "status": "READY",
            "version": "external-worker-v1",
            "metadata": {
                "externalWorker": {
                    "writesEnabled": ALLOW_WRITES,
                    "lanes": lanes,
                }
            },
        },
    )


def claim() -> dict[str, Any] | None:
    data = post(
        "/api/internal/runner/claim",
        {
            "nodeKey": NODE_KEY,
            "limit": 1,
            "types": ["AI_EXTERNAL_WORKER"],
        },
    )
    items = data.get("items")
    if isinstance(items, list) and items:
        item = items[0]
        return item if isinstance(item, dict) else None
    return None


def truncate_output(text: str) -> tuple[str, bool]:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text, False
    return text[:MAX_OUTPUT_CHARS], True


def execute_local_qwen(prompt: str) -> tuple[int, str, str | None]:
    response = requests.post(
        f"{LOCAL_GATEWAY}/v1/chat/completions",
        json={
            "model": "qwen35-4b-local",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "max_tokens": 1600,
        },
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    data = response.json()
    text = data["choices"][0]["message"]["content"]
    return 0, str(text), "qwen35-4b-local"


def execute_codex(prompt: str, workspace: Path, write: bool) -> tuple[int, str, str | None]:
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt", encoding="utf-8") as tmp:
        output_path = tmp.name
    try:
        args = [
            "exec",
            "--skip-git-repo-check",
            "--color",
            "never",
        ]
        if write:
            # Current Codex CLI: --approve-for-me already routes approval
            # requests through the workspace-write sandbox and conflicts with
            # an explicit --sandbox/-s flag.
            args.append("--approve-for-me")
        else:
            args.extend(["-s", "read-only"])
        args.extend([
            "-C",
            str(workspace),
            "-o",
            output_path,
            "-",
        ])
        code, raw = run_process(
            "codex",
            args,
            cwd=workspace,
            stdin_text=prompt,
            timeout=TIMEOUT_SECONDS,
        )
        final = Path(output_path).read_text(encoding="utf-8", errors="replace").strip()
        return code, final or raw, None
    finally:
        Path(output_path).unlink(missing_ok=True)


def execute_claude(prompt: str, workspace: Path, write: bool) -> tuple[int, str, str | None]:
    # Worker sessions must not inherit the operator's giant interactive Claude
    # context (CLAUDE.md, hooks, plugins, MCP servers, skills, memory, etc.).
    # Safe mode preserves Claude auth and built-in tools while isolating those
    # customizations; no-session-persistence prevents durable worker chat state.
    base_args = [
        "-p",
        "--output-format",
        "json",
        "--safe-mode",
        "--no-session-persistence",
        "--no-chrome",
        "--permission-prompts",
        "none",
    ]
    if write:
        args = base_args + [
            "--permission-mode",
            "acceptEdits",
            "--tools",
            "Read,Glob,Grep,Edit,Write,Bash,PowerShell",
        ]
    else:
        args = base_args + [
            "--restricted",
            "--permission-mode",
            "manual",
            "--tools",
            "Read,Glob,Grep",
        ]
    code, raw = run_process(
        "claude",
        args,
        cwd=workspace,
        stdin_text=prompt,
        timeout=TIMEOUT_SECONDS,
    )
    try:
        # Claude can append non-JSON diagnostics after the JSON result (for
        # example a workspace-trust warning). Decode the first JSON value and
        # ignore only trailing diagnostic text instead of discarding the result.
        data, _ = json.JSONDecoder().raw_decode(raw.lstrip())
        result = data.get("result") if isinstance(data, dict) else None
        model = data.get("model") if isinstance(data, dict) else None
        if not model and isinstance(data, dict) and isinstance(data.get("modelUsage"), dict):
            model = next(iter(data["modelUsage"]), None)
        return code, str(result if result is not None else raw), str(model) if model else None
    except Exception:
        return code, raw, None


def execute_antigravity(prompt: str, workspace: Path, write: bool) -> tuple[int, str, str | None]:
    agy = str(Path(os.getenv("LOCALAPPDATA", "")) / "agy" / "bin" / "agy.exe")
    if not Path(agy).exists():
        raise FileNotFoundError("agy_not_installed")
    args = [
        agy,
        "--print",
        prompt,
        "--output-format",
        "json",
        "--mode",
        "accept-edits" if write else "plan",
        "--sandbox",
    ]
    cp = subprocess.run(
        args,
        text=True,
        capture_output=True,
        cwd=str(workspace),
        env=scrubbed_env(),
        timeout=TIMEOUT_SECONDS,
        check=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    raw = ((cp.stdout or "") + (("\n" + cp.stderr) if cp.stderr else "")).strip()
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            return cp.returncode, raw, None
        response = str(data.get("response") or data.get("result") or data.get("output") or "").strip()
        model = data.get("model")
        denied = data.get("denied_actions")
        status = str(data.get("status") or "").upper()
        if status and status != "SUCCESS":
            return cp.returncode or 3, response or raw, str(model) if model else None
        if not response and isinstance(denied, list) and denied:
            return 3, f"antigravity denied required actions: {json.dumps(denied)[:1200]}", str(model) if model else None
        if not response:
            return 3, "antigravity returned success without a response", str(model) if model else None
        return cp.returncode, response, str(model) if model else None
    except Exception:
        return cp.returncode, raw, None


def choose_lane(
    candidates: list[str], lanes: dict[str, dict[str, str]]
) -> str | None:
    for lane in candidates:
        state = lanes.get(lane) or {}
        if state.get("health") in ("ready", "degraded") and state.get("quota") != "exhausted":
            return lane
    return None


def execute_job(item: dict[str, Any], lanes: dict[str, dict[str, str]]) -> tuple[str, dict[str, Any], str | None, str | None]:
    payload = item.get("requestPayload")
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1:
        result = {
            "schemaVersion": 1,
            "laneId": "local-qwen",
            "status": "refused",
            "output": "",
            "outputTruncated": False,
            "elapsedMs": 0,
            "exitCode": None,
            "model": None,
            "errorCode": "INVALID_JOB_PAYLOAD",
        }
        return "failed", result, "INVALID_JOB_PAYLOAD", "invalid external worker payload"

    candidates = payload.get("candidateLaneIds")
    if not isinstance(candidates, list) or not all(c in LANE_IDS for c in candidates):
        candidates = []

    ready_candidates = [
        candidate
        for candidate in candidates
        if (lanes.get(candidate) or {}).get("health") in ("ready", "degraded")
        and (lanes.get(candidate) or {}).get("quota") != "exhausted"
    ]
    lane = ready_candidates[0] if ready_candidates else None
    if lane is None:
        fallback = candidates[0] if candidates else "local-qwen"
        result = {
            "schemaVersion": 1,
            "laneId": fallback,
            "status": "refused",
            "output": "",
            "outputTruncated": False,
            "elapsedMs": 0,
            "exitCode": None,
            "model": None,
            "errorCode": "NO_READY_LANE",
        }
        return "failed", result, "NO_READY_LANE", "no candidate worker lane is currently ready"

    workspace_key = str(payload.get("workspaceKey") or "repo")
    try:
        workspace = resolve_workspace(workspace_key)
    except Exception as exc:
        result = {
            "schemaVersion": 1,
            "laneId": lane,
            "status": "refused",
            "output": "",
            "outputTruncated": False,
            "elapsedMs": 0,
            "exitCode": None,
            "model": None,
            "errorCode": "WORKSPACE_NOT_ALLOWED",
        }
        return "failed", result, "WORKSPACE_NOT_ALLOWED", str(exc)[:240]

    wants_write = bool(payload.get("allowWorkspaceWrite"))
    if wants_write and not ALLOW_WRITES:
        result = {
            "schemaVersion": 1,
            "laneId": lane,
            "status": "refused",
            "output": "",
            "outputTruncated": False,
            "elapsedMs": 0,
            "exitCode": None,
            "model": None,
            "errorCode": "WRITE_POLICY_DISABLED",
        }
        return "failed", result, "WRITE_POLICY_DISABLED", "machine-level worker write policy is disabled"

    prompt = str(payload.get("prompt") or "")
    if len(prompt) < 5 or len(prompt) > 20_000:
        result = {
            "schemaVersion": 1,
            "laneId": lane,
            "status": "refused",
            "output": "",
            "outputTruncated": False,
            "elapsedMs": 0,
            "exitCode": None,
            "model": None,
            "errorCode": "PROMPT_INVALID",
        }
        return "failed", result, "PROMPT_INVALID", "prompt length outside contract"

    attempt_failures: list[str] = []
    last_result: dict[str, Any] | None = None
    last_error_code: str | None = None

    for lane in ready_candidates:
        started = time.monotonic()
        try:
            if lane == "local-qwen":
                code, output, model = execute_local_qwen(prompt)
            elif lane == "codex":
                code, output, model = execute_codex(prompt, workspace, wants_write)
            elif lane == "claude-code":
                code, output, model = execute_claude(prompt, workspace, wants_write)
            elif lane == "antigravity":
                code, output, model = execute_antigravity(prompt, workspace, wants_write)
            else:
                raise RuntimeError("unsupported_lane")
        except subprocess.TimeoutExpired:
            code, output, model = -1, "worker timed out", None
        except Exception as exc:
            code, output, model = -1, f"{type(exc).__name__}: {exc}", None

        elapsed_ms = int((time.monotonic() - started) * 1000)
        quota = quota_from_text(output)
        if quota == "exhausted":
            runtime_lane_overrides[lane] = {
                "health": "degraded",
                "quota": "exhausted",
                "detail": "execution reported subscription/quota exhaustion",
            }

        bounded, truncated = truncate_output(output)
        success = code == 0 and bool(bounded.strip())
        error_code = None if success else (
            "QUOTA_EXHAUSTED" if quota == "exhausted" else "WORKER_EXEC_FAILED"
        )
        result = {
            "schemaVersion": 1,
            "laneId": lane,
            "status": "completed" if success else "failed",
            "output": bounded,
            "outputTruncated": truncated,
            "elapsedMs": elapsed_ms,
            "exitCode": code,
            "model": model,
            "errorCode": error_code,
        }
        if success:
            return "completed", result, None, None

        last_result = result
        last_error_code = error_code
        attempt_failures.append(f"{lane}:{error_code or 'unknown'}")

        # Once a write-capable execution begins we never auto-run the same job
        # through another agent. A partially-applied edit plus failover would
        # create duplicate or conflicting side effects. Read-only jobs may
        # safely fail over across the already-approved candidate list.
        if wants_write:
            break

    if last_result is None:
        last_result = {
            "schemaVersion": 1,
            "laneId": lane,
            "status": "failed",
            "output": "",
            "outputTruncated": False,
            "elapsedMs": 0,
            "exitCode": None,
            "model": None,
            "errorCode": "WORKER_EXEC_FAILED",
        }
        last_error_code = "WORKER_EXEC_FAILED"

    return (
        "failed",
        last_result,
        last_error_code,
        ("worker attempts failed: " + ", ".join(attempt_failures))[:500],
    )


def complete(
    work_item_id: str,
    status: str,
    payload: dict[str, Any],
    error_code: str | None,
    error_message: str | None,
) -> None:
    post(
        "/api/internal/runner/complete",
        {
            "workItemId": work_item_id,
            "status": status,
            "payload": payload,
            "errorCode": error_code,
            "errorMessage": error_message,
        },
    )


def run_once() -> bool:
    lanes = probe_lanes()
    heartbeat(lanes)
    item = claim()
    if not item:
        return False

    job_id = str(item.get("id") or "")
    log(f"claimed {job_id}")
    status, result, error_code, error_message = execute_job(item, lanes)
    complete(job_id, status, result, error_code, error_message)
    log(f"completed {job_id} status={status} lane={result.get('laneId')}")
    return True


def main() -> int:
    if not RUNNER_SECRET:
        log("RUNNER_SHARED_SECRET is missing; refusing to start")
        return 2

    once = "--once" in sys.argv
    while True:
        try:
            did_work = run_once()
        except KeyboardInterrupt:
            return 0
        except Exception as exc:
            log(f"cycle failed: {type(exc).__name__}: {exc}")
            did_work = False

        if once:
            return 0
        time.sleep(1 if did_work else POLL_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
r"""NOUR Cockpit Bridge.

Loopback-only OpenAPI tool server that lets OpenWebUI supervise durable OpenCode
runs without polluting StateNour Mission/Task records.

Design:
- One CockpitRun -> one isolated git worktree -> one OpenCode session.
- Safe/read-only shell commands and test commands may be auto-approved.
- Commit/push/PR/deploy/destructive/external actions remain pending for owner approval.
- CockpitRun state is machine-local JSON under %USERPROFILE%\AI\cockpit\runs.
- No writes to bdnick.info Mission or Task tables.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HOST = os.getenv("NOUR_COCKPIT_HOST", "127.0.0.1")
PORT = int(os.getenv("NOUR_COCKPIT_PORT", "4101"))
OPENCODE_URL = os.getenv("NOUR_OPENCODE_URL", "http://127.0.0.1:4097").rstrip("/")
USERPROFILE = Path(os.getenv("USERPROFILE") or Path.home())
SOURCE_REPO = Path(
    os.getenv(
        "NOUR_COCKPIT_SOURCE_REPO",
        str(USERPROFILE / "Documents" / "Codex" / "NATTYNOUR-RUNTIME-WRITES-DO-NOT-CLEAN"),
    )
)
WORKTREE_ROOT = Path(
    os.getenv("NOUR_COCKPIT_WORKTREE_ROOT", str(USERPROFILE / "Documents" / "Codex" / "cockpit-runs"))
)
STATE_ROOT = Path(os.getenv("NOUR_COCKPIT_STATE_ROOT", str(USERPROFILE / "AI" / "cockpit")))
RUNS_ROOT = STATE_ROOT / "runs"
LOG_PATH = STATE_ROOT / "cockpit.log"
MODEL_PROVIDER = os.getenv("NOUR_COCKPIT_MODEL_PROVIDER", "nour")
MODEL_ID = os.getenv("NOUR_COCKPIT_MODEL_ID", "nour-auto")

_RUN_LOCK = threading.RLock()
_STOP = threading.Event()

SYSTEM_PROMPT = """You are the execution engine underneath Nour's OpenWebUI cockpit.

Hard boundaries:
- Work only inside the isolated worktree assigned to this session.
- Never create, edit, or use StateNour Mission/Task records unless the user explicitly asks to link this run later.
- Do not touch other worktrees, NattyNour runtime roots, production databases, secrets, or unrelated sessions.
- Inspect/reuse before rebuilding. Keep changes minimal and coherent.
- Do not commit, push, open/merge PRs, deploy, message customers, publish, or perform destructive/external actions unless the user's objective explicitly requires it; those actions are permission-gated and may pause for owner approval.
- Never claim completion without tests/evidence appropriate to the task.
- Prefer one coherent change set over many commits/PRs.
- Request at most ONE shell command per tool call; never chain shell commands with ;, &&, ||, pipes, or redirection. Prefer built-in read/glob/grep tools for inspection.
- If blocked on a permission, stop and let the cockpit surface it instead of inventing a workaround.
"""

SAFE_GIT_PREFIXES = (
    "git status",
    "git diff",
    "git log",
    "git show",
    "git grep",
    "git rev-parse",
    "git ls-files",
    "git branch --show-current",
)
SAFE_TEST_PREFIXES = (
    "node --check ",
    "python -m unittest",
    "python3 -m unittest",
    "pytest ",
    "python -m pytest",
    "python3 -m pytest",
    "pnpm test",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm check",
    "pnpm exec vitest",
    "pnpm --filter ",
)
SHELL_META = ("&&", "||", ";", "|", ">", "<", "\n", "\r")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    line = f"{now_iso()} {message}\n"
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(line)


def slugify(text: str, limit: int = 42) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (slug[:limit].strip("-") or "work")


def safe_shell_command(command: str) -> bool:
    cmd = " ".join(str(command or "").strip().split())
    if not cmd or any(meta in cmd for meta in SHELL_META):
        return False
    lower = cmd.lower()
    if any(lower.startswith(prefix) for prefix in SAFE_GIT_PREFIXES):
        return True
    if lower.startswith(("node --check ", "python -m unittest", "python3 -m unittest",
                         "pytest ", "python -m pytest", "python3 -m pytest",
                         "pnpm test", "pnpm lint", "pnpm typecheck",
                         "pnpm check", "pnpm exec vitest")):
        return True
    if lower.startswith("pnpm --filter "):
        return any(token in lower for token in (" test", " lint", " typecheck", " check", " vitest"))
    return False


def run_git(args: list[str], cwd: Path, timeout: int = 120) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=timeout,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {(proc.stderr or proc.stdout).strip()}")
    return proc.stdout.strip()


def http_json(
    method: str,
    url: str,
    body: dict[str, Any] | None = None,
    timeout: int = 20,
) -> Any:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"accept": "application/json"}
    if data is not None:
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return None
            text = raw.decode("utf-8", errors="replace")
            ctype = resp.headers.get("content-type", "")
            if "json" in ctype or text[:1] in "[{":
                return json.loads(text)
            return text
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} -> {exc.code}: {raw[:600]}") from exc


def quote_dir(path: str) -> str:
    return urllib.parse.quote(path, safe="")


def run_path(run_id: str) -> Path:
    return RUNS_ROOT / f"{run_id}.json"


def save_run(run: dict[str, Any]) -> None:
    with _RUN_LOCK:
        RUNS_ROOT.mkdir(parents=True, exist_ok=True)
        run["updated_at"] = now_iso()
        target = run_path(run["run_id"])
        tmp = target.with_suffix(".tmp")
        tmp.write_text(json.dumps(run, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, target)


def load_run(run_id: str) -> dict[str, Any]:
    path = run_path(run_id)
    if not path.exists():
        raise KeyError(f"Unknown cockpit run: {run_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def all_runs() -> list[dict[str, Any]]:
    RUNS_ROOT.mkdir(parents=True, exist_ok=True)
    out = []
    for path in RUNS_ROOT.glob("*.json"):
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            continue
    return sorted(out, key=lambda item: item.get("created_at", ""), reverse=True)


def opencode_health() -> dict[str, Any]:
    payload = http_json("GET", f"{OPENCODE_URL}/global/health", timeout=5)
    if not isinstance(payload, dict) or not payload.get("healthy"):
        raise RuntimeError("OpenCode server is not healthy")
    return payload


def permission_rules() -> list[dict[str, str]]:
    # Last matching rule wins in OpenCode. Keep filesystem edits inside the isolated
    # worktree available, while shell/external/secrets are gated.
    return [
        {"permission": "*", "pattern": "*", "action": "allow"},
        {"permission": "bash", "pattern": "*", "action": "ask"},
        {"permission": "external_directory", "pattern": "*", "action": "deny"},
        {"permission": "read", "pattern": "*.env", "action": "deny"},
        {"permission": "read", "pattern": "*.env.*", "action": "deny"},
    ]


def create_session(worktree: Path, title: str) -> str:
    url = f"{OPENCODE_URL}/session?directory={quote_dir(str(worktree))}"
    payload = {
        "title": title[:120],
        "agent": "build",
        "model": {"id": MODEL_ID, "providerID": MODEL_PROVIDER},
        "permission": permission_rules(),
        "metadata": {"source": "nour-cockpit"},
    }
    data = http_json("POST", url, payload, timeout=15)
    session_id = str((data or {}).get("id") or "")
    if not session_id.startswith("ses_"):
        raise RuntimeError(f"OpenCode did not return a session id: {data!r}")
    return session_id


def prompt_async(run: dict[str, Any], text: str) -> None:
    sid = run["session_id"]
    directory = quote_dir(run["worktree"])
    url = f"{OPENCODE_URL}/session/{sid}/prompt_async?directory={directory}"
    payload = {
        "model": {"providerID": MODEL_PROVIDER, "modelID": MODEL_ID},
        "agent": "build",
        "system": SYSTEM_PROMPT,
        "parts": [{"type": "text", "text": text}],
    }
    http_json("POST", url, payload, timeout=15)


def pending_permissions(run: dict[str, Any]) -> list[dict[str, Any]]:
    directory = quote_dir(run["worktree"])
    data = http_json("GET", f"{OPENCODE_URL}/permission?directory={directory}", timeout=8)
    if isinstance(data, list):
        values = data
    elif isinstance(data, dict):
        values = data.get("value", [])
    else:
        values = []
    return [item for item in values if item.get("sessionID") == run.get("session_id")]


def respond_permission(run: dict[str, Any], permission_id: str, response: str) -> None:
    if response not in {"once", "reject"}:
        raise ValueError("response must be 'once' or 'reject'")
    directory = quote_dir(run["worktree"])
    sid = run["session_id"]
    url = f"{OPENCODE_URL}/session/{sid}/permissions/{permission_id}?directory={directory}"
    http_json("POST", url, {"response": response}, timeout=10)


def auto_approve_safe(run: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    approved: list[dict[str, Any]] = []
    pending: list[dict[str, Any]] = []
    for req in pending_permissions(run):
        command = str((req.get("metadata") or {}).get("command") or "")
        if req.get("permission") == "bash" and safe_shell_command(command):
            respond_permission(run, req["id"], "once")
            approved.append({"id": req["id"], "permission": "bash", "command": command})
            log(f"run={run['run_id']} auto-approved safe bash: {command}")
        else:
            pending.append(req)
    return approved, pending


def session_status(run: dict[str, Any]) -> str:
    directory = quote_dir(run["worktree"])
    try:
        data = http_json("GET", f"{OPENCODE_URL}/session/status?directory={directory}", timeout=6)
        if isinstance(data, dict):
            value = data.get("value", data)
            if isinstance(value, dict) and run["session_id"] in value:
                info = value[run["session_id"]]
                return str((info or {}).get("type") or "running")
    except Exception:
        pass
    return "idle"


def session_messages(run: dict[str, Any], limit: int = 40) -> list[dict[str, Any]]:
    directory = quote_dir(run["worktree"])
    url = f"{OPENCODE_URL}/session/{run['session_id']}/message?directory={directory}&limit={limit}"
    data = http_json("GET", url, timeout=10)
    if isinstance(data, dict) and isinstance(data.get("value"), list):
        return data["value"]
    if isinstance(data, list):
        return data
    return []


def session_diff(run: dict[str, Any]) -> Any:
    directory = quote_dir(run["worktree"])
    url = f"{OPENCODE_URL}/session/{run['session_id']}/diff?directory={directory}"
    try:
        data = http_json("GET", url, timeout=10)
        if isinstance(data, dict) and "value" in data:
            return data["value"]
        return data
    except Exception as exc:
        return {"error": str(exc)}


def last_assistant_text(messages: list[dict[str, Any]]) -> str:
    for item in reversed(messages):
        info = item.get("info") or {}
        if info.get("role") != "assistant":
            continue
        texts = []
        for part in item.get("parts") or []:
            if part.get("type") == "text" and part.get("text"):
                texts.append(str(part["text"]))
        if texts:
            return "\n".join(texts)[-8000:]
    return ""


def format_pending(reqs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for req in reqs:
        out.append(
            {
                "permission_id": req.get("id"),
                "permission": req.get("permission"),
                "patterns": req.get("patterns") or [],
                "command": (req.get("metadata") or {}).get("command"),
                "always": req.get("always") or [],
            }
        )
    return out


def refresh_run(run: dict[str, Any]) -> dict[str, Any]:
    if run.get("status") in {"cancelled", "failed"}:
        return run
    try:
        approved, pending = auto_approve_safe(run)
        state = session_status(run)
        messages = session_messages(run)
        diff = session_diff(run)
        last_text = last_assistant_text(messages)
        if pending:
            status = "awaiting_approval"
        elif state in {"busy", "running", "retry"}:
            status = "running"
        elif (
            run.get("status") in {"starting", "running"}
            and not messages
            and time.time() - float(run.get("turn_started_epoch") or time.time()) < 180
        ):
            # OpenCode can spend tens of seconds bootstrapping a large worktree
            # before its first message/status record becomes visible.
            status = "running"
        else:
            status = "ready"
        run.update(
            {
                "status": status,
                "opencode_status": state,
                "pending_approvals": format_pending(pending),
                "last_assistant_text": last_text,
                "diff": diff,
                "message_count": len(messages),
                "last_auto_approved": approved[-10:],
            }
        )
        save_run(run)
    except Exception as exc:
        run["last_monitor_error"] = str(exc)
        save_run(run)
    return run


def create_worktree(objective: str) -> tuple[str, Path, str]:
    if not SOURCE_REPO.exists():
        raise RuntimeError(f"Source repo missing: {SOURCE_REPO}")
    run_git(["fetch", "origin", "--prune", "--quiet"], SOURCE_REPO, timeout=120)
    base = run_git(["rev-parse", "origin/main"], SOURCE_REPO)
    run_id = "cr_" + datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
    branch = f"cockpit/run-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{slugify(objective, 28)}-{run_id[-4:]}"
    worktree = WORKTREE_ROOT / run_id
    WORKTREE_ROOT.mkdir(parents=True, exist_ok=True)
    run_git(["worktree", "prune", "--expire", "now"], SOURCE_REPO)
    run_git(["worktree", "add", "--quiet", "-b", branch, str(worktree), "origin/main"], SOURCE_REPO, timeout=120)
    return run_id, worktree, base


def start_run(objective: str) -> dict[str, Any]:
    objective = str(objective or "").strip()
    if not objective:
        raise ValueError("objective is required")
    opencode_health()
    run_id, worktree, base = create_worktree(objective)
    try:
        sid = create_session(worktree, f"NOUR Cockpit · {objective[:80]}")
        run = {
            "run_id": run_id,
            "objective": objective,
            "status": "starting",
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "source_repo": str(SOURCE_REPO),
            "base_commit": base,
            "worktree": str(worktree),
            "branch": run_git(["branch", "--show-current"], worktree),
            "session_id": sid,
            "model": f"{MODEL_PROVIDER}/{MODEL_ID}",
            "mission_id": None,
            "pending_approvals": [],
            "receipts": [],
        }
        save_run(run)
        prompt_async(
            run,
            (
                "Execute this objective end-to-end in the assigned isolated worktree:\n\n"
                f"{objective}\n\n"
                "Establish current ground truth first. Reuse existing infrastructure. "
                "Keep the change set coherent. Run appropriate verification. "
                "Do not commit/push/deploy unless the objective requires it; permission gates will pause those actions."
            ),
        )
        run["status"] = "running"
        run["turn_started_epoch"] = time.time()
        save_run(run)
        log(f"started run={run_id} session={sid} branch={run['branch']}")
        return public_run(refresh_run(run))
    except Exception:
        try:
            run_git(["worktree", "remove", "--force", str(worktree)], SOURCE_REPO)
        except Exception:
            pass
        raise


def public_run(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": run.get("run_id"),
        "objective": run.get("objective"),
        "status": run.get("status"),
        "branch": run.get("branch"),
        "base_commit": run.get("base_commit"),
        "worktree": run.get("worktree"),
        "session_id": run.get("session_id"),
        "model": run.get("model"),
        "mission_linked": bool(run.get("mission_id")),
        "pending_approvals": run.get("pending_approvals") or [],
        "last_assistant_text": run.get("last_assistant_text") or "",
        "diff": run.get("diff"),
        "message_count": run.get("message_count", 0),
        "last_monitor_error": run.get("last_monitor_error"),
        "created_at": run.get("created_at"),
        "updated_at": run.get("updated_at"),
    }


def get_status(run_id: str) -> dict[str, Any]:
    run = refresh_run(load_run(run_id))
    return public_run(run)


def continue_run(run_id: str, instruction: str) -> dict[str, Any]:
    run = refresh_run(load_run(run_id))
    if run.get("status") == "awaiting_approval":
        raise RuntimeError("Run is awaiting approval; approve or reject the pending action before continuing")
    instruction = str(instruction or "").strip()
    if not instruction:
        raise ValueError("instruction is required")
    prompt_async(run, instruction)
    run["status"] = "running"
    run["turn_started_epoch"] = time.time()
    save_run(run)
    log(f"continued run={run_id}")
    return public_run(run)


def approve_run(run_id: str, decision: str = "once") -> dict[str, Any]:
    run = refresh_run(load_run(run_id))
    decision = str(decision or "once").lower()
    if decision not in {"once", "reject"}:
        raise ValueError("decision must be 'once' or 'reject'")
    pending = pending_permissions(run)
    if not pending:
        return public_run(run)
    acted = []
    for req in pending:
        respond_permission(run, req["id"], decision)
        acted.append(
            {
                "permission_id": req["id"],
                "decision": decision,
                "command": (req.get("metadata") or {}).get("command"),
            }
        )
    run.setdefault("receipts", []).append(
        {"at": now_iso(), "type": "permission_response", "actions": acted}
    )
    run["status"] = "running" if decision == "once" else "ready"
    save_run(run)
    log(f"permission run={run_id} decision={decision} count={len(acted)}")
    time.sleep(0.4)
    return public_run(refresh_run(run))


def cancel_run(run_id: str) -> dict[str, Any]:
    run = load_run(run_id)
    directory = quote_dir(run["worktree"])
    try:
        http_json(
            "POST",
            f"{OPENCODE_URL}/session/{run['session_id']}/abort?directory={directory}",
            {},
            timeout=10,
        )
    except Exception as exc:
        run["cancel_error"] = str(exc)
    run["status"] = "cancelled"
    run.setdefault("receipts", []).append({"at": now_iso(), "type": "cancel"})
    save_run(run)
    log(f"cancelled run={run_id}")
    return public_run(run)


def recent_runs(limit: int = 10) -> dict[str, Any]:
    limit = max(1, min(int(limit or 10), 25))
    return {"runs": [public_run(refresh_run(run)) for run in all_runs()[:limit]]}


def monitor_loop() -> None:
    while not _STOP.wait(1.5):
        for run in all_runs()[:25]:
            if run.get("status") in {"cancelled", "failed"}:
                continue
            try:
                refresh_run(run)
            except Exception:
                log(f"monitor error run={run.get('run_id')}: {traceback.format_exc()[-1000:]}")


OPENAPI = {
    "openapi": "3.0.3",
    "info": {
        "title": "NOUR Cockpit",
        "version": "1.0.0",
        "description": (
            "Operate isolated OpenCode work from OpenWebUI. "
            "Cockpit runs are machine-work records and never create StateNour Mission/Task items."
        ),
    },
    "servers": [{"url": f"http://127.0.0.1:{PORT}"}],
    "paths": {
        "/runs/start": {
            "post": {
                "operationId": "start_cockpit_run",
                "summary": "Start isolated work",
                "description": "Start a durable OpenCode run in a fresh isolated git worktree.",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {
                                    "objective": {
                                        "type": "string",
                                        "description": "The outcome to execute end-to-end.",
                                    }
                                },
                                "required": ["objective"],
                            }
                        }
                    },
                },
                "responses": {"200": {"description": "Run created"}},
            }
        },
        "/runs/status": {
            "post": {
                "operationId": "check_cockpit_run",
                "summary": "Check work",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {"run_id": {"type": "string"}},
                                "required": ["run_id"],
                            }
                        }
                    },
                },
                "responses": {"200": {"description": "Current run status"}},
            }
        },
        "/runs/continue": {
            "post": {
                "operationId": "continue_cockpit_run",
                "summary": "Continue work",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {
                                    "run_id": {"type": "string"},
                                    "instruction": {"type": "string"},
                                },
                                "required": ["run_id", "instruction"],
                            }
                        }
                    },
                },
                "responses": {"200": {"description": "Instruction queued"}},
            }
        },
        "/runs/approve": {
            "post": {
                "operationId": "approve_cockpit_run",
                "summary": "Approve or reject pending action",
                "description": (
                    "Respond to the current run's pending consequential permission(s). "
                    "Use decision=once to approve this occurrence or decision=reject to deny."
                ),
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {
                                    "run_id": {"type": "string"},
                                    "decision": {
                                        "type": "string",
                                        "enum": ["once", "reject"],
                                        "default": "once",
                                    },
                                },
                                "required": ["run_id"],
                            }
                        }
                    },
                },
                "responses": {"200": {"description": "Permission response applied"}},
            }
        },
        "/runs/cancel": {
            "post": {
                "operationId": "cancel_cockpit_run",
                "summary": "Cancel work",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {"run_id": {"type": "string"}},
                                "required": ["run_id"],
                            }
                        }
                    },
                },
                "responses": {"200": {"description": "Run cancelled"}},
            }
        },
        "/runs/recent": {
            "get": {
                "operationId": "recent_cockpit_runs",
                "summary": "Recent work",
                "parameters": [
                    {
                        "name": "limit",
                        "in": "query",
                        "schema": {"type": "integer", "minimum": 1, "maximum": 25, "default": 10},
                    }
                ],
                "responses": {"200": {"description": "Recent cockpit runs"}},
            }
        },
        "/health": {
            "get": {
                "operationId": "cockpit_health",
                "summary": "Cockpit health",
                "responses": {"200": {"description": "Health"}},
            }
        },
    },
}


CORS_ORIGINS = {"http://127.0.0.1:8080", "http://localhost:8080"}


class Handler(BaseHTTPRequestHandler):
    server_version = "NOURCockpit/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        log("http " + (fmt % args))

    def _cors_origin(self) -> str | None:
        origin = (self.headers.get("origin") or "").strip()
        return origin if origin in CORS_ORIGINS else None

    def _send_cors_headers(self) -> None:
        origin = self._cors_origin()
        if origin:
            self.send_header("access-control-allow-origin", origin)
            self.send_header("vary", "Origin")

    def _json(self, code: int, payload: Any) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(raw)))
        self.send_header("cache-control", "no-store")
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(raw)

    def _allowed_host(self) -> bool:
        host = (self.headers.get("host") or "").split(":", 1)[0].strip("[]").lower()
        return host in {"127.0.0.1", "localhost", "::1"}

    def _allowed_origin(self) -> bool:
        origin = (self.headers.get("origin") or "").strip()
        return not origin or origin in CORS_ORIGINS

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length") or "0")
        if length <= 0:
            return {}
        if length > 1_000_000:
            raise ValueError("request body too large")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8")) if raw else {}

    def _guard(self) -> bool:
        if not self._allowed_host():
            self._json(403, {"ok": False, "error": "loopback host required"})
            return False
        if not self._allowed_origin():
            self._json(403, {"ok": False, "error": "local OpenWebUI origin required"})
            return False
        return True

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._guard():
            return
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        requested_headers = (self.headers.get("access-control-request-headers") or "").strip()
        self.send_header("access-control-allow-headers", requested_headers or "content-type")
        self.send_header("access-control-max-age", "600")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if not self._guard():
            return
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/openapi.json":
                self._json(200, OPENAPI)
                return
            if parsed.path == "/health":
                health = opencode_health()
                self._json(
                    200,
                    {
                        "ok": True,
                        "cockpit": "ready",
                        "opencode": health,
                        "source_repo": str(SOURCE_REPO),
                        "mission_task_writes": False,
                    },
                )
                return
            if parsed.path == "/runs/recent":
                query = urllib.parse.parse_qs(parsed.query)
                limit = int((query.get("limit") or ["10"])[0])
                self._json(200, recent_runs(limit))
                return
            self._json(404, {"ok": False, "error": "not found"})
        except Exception as exc:
            log(traceback.format_exc())
            self._json(500, {"ok": False, "error": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        if not self._guard():
            return
        parsed = urllib.parse.urlparse(self.path)
        try:
            body = self._body()
            if parsed.path == "/runs/start":
                result = start_run(body.get("objective", ""))
            elif parsed.path == "/runs/status":
                result = get_status(body.get("run_id", ""))
            elif parsed.path == "/runs/continue":
                result = continue_run(body.get("run_id", ""), body.get("instruction", ""))
            elif parsed.path == "/runs/approve":
                result = approve_run(body.get("run_id", ""), body.get("decision", "once"))
            elif parsed.path == "/runs/cancel":
                result = cancel_run(body.get("run_id", ""))
            else:
                self._json(404, {"ok": False, "error": "not found"})
                return
            self._json(200, {"ok": True, **result})
        except KeyError as exc:
            self._json(404, {"ok": False, "error": str(exc)})
        except ValueError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
        except Exception as exc:
            log(traceback.format_exc())
            self._json(500, {"ok": False, "error": str(exc)})


def serve() -> None:
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    RUNS_ROOT.mkdir(parents=True, exist_ok=True)
    monitor = threading.Thread(target=monitor_loop, name="nour-cockpit-monitor", daemon=True)
    monitor.start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log(f"listening http://{HOST}:{PORT} opencode={OPENCODE_URL}")
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        _STOP.set()
        server.server_close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        checks = {
            "slug": slugify("Fix Instagram Studio!") == "fix-instagram-studio",
            "safe_git": safe_shell_command("git status --short"),
            "unsafe_push": not safe_shell_command("git push origin main"),
            "unsafe_chain": not safe_shell_command("git status && git push"),
            "unsafe_deploy": not safe_shell_command("railway up"),
            "mission_separate": "Mission/Task" in OPENAPI["info"]["description"],
            "openapi_actions": all(
                op in json.dumps(OPENAPI)
                for op in (
                    "start_cockpit_run",
                    "check_cockpit_run",
                    "continue_cockpit_run",
                    "approve_cockpit_run",
                    "cancel_cockpit_run",
                )
            ),
        }
        print(json.dumps(checks, indent=2))
        return 0 if all(checks.values()) else 1
    serve()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

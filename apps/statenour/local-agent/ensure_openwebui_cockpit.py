import asyncio
import json
import os
import sqlite3
import urllib.request
from pathlib import Path

os.environ.setdefault("DATA_DIR", r"C:\Users\nourd\AppData\Roaming\open-webui\data")
os.environ.setdefault("WEBUI_AUTH", "false")

from open_webui.models.config import Config
from open_webui.models.models import ModelForm, ModelMeta, ModelParams, Models
from open_webui.models.users import Users

COCKPIT_ID = "nour-cockpit"
TOOL_ID = "direct_server:nour-cockpit"
BASE_MODEL = "nour-auto"
RUNTIME_DIR = Path(__file__).resolve().parent
OPENWEBUI_PACKAGE = (
    Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
    / "open-webui"
    / "python"
    / "Lib"
    / "site-packages"
    / "open_webui"
)
UI_PATCHES = {
    "loader.js": RUNTIME_DIR / "openwebui-nour-cockpit-loader.js",
    "custom.css": RUNTIME_DIR / "openwebui-nour-cockpit.css",
}
UI_START = "/* NOUR_COCKPIT_CONTROLS_START */"
UI_END = "/* NOUR_COCKPIT_CONTROLS_END */"

BASE_PINNED = [
    "nour-auto",
    "qwen35-4b-local",
    "nour-research",
    "nour-codex-chatgpt",
    "nour-claude-subscription",
    "nour-antigravity",
]
TOOL_CONNECTIONS = [{
    "url": "http://127.0.0.1:4101",
    "path": "/openapi.json",
    "type": "openapi",
    "auth_type": "none",
    "forward_cookies": False,
    "headers": None,
    "key": None,
    "config": {"enable": True},
    "info": {
        "id": "nour-cockpit",
        "name": "NOUR Cockpit",
        "description": (
            "Start and supervise isolated OpenCode work from OpenWebUI "
            "without writing StateNour Mission/Task records."
        ),
    },
}]

MODEL_META = {
    "description": (
        "Your default NattyNour cockpit: NOUR Auto intelligence with "
        "NOUR Cockpit execution tools pre-attached. Machine work stays "
        "in isolated CockpitRuns and does not write StateNour Mission/Task "
        "records by default."
    ),
    "toolIds": [TOOL_ID],
    "tags": [{"name": "cockpit"}, {"name": "default"}],
}

COCKPIT_TOOL_OPERATIONS = {
    "start_cockpit_run",
    "check_cockpit_run",
    "continue_cockpit_run",
    "approve_cockpit_run",
    "cancel_cockpit_run",
    "recent_cockpit_runs",
}
TOOL_SERVER_ASSET = "nour-cockpit-tool-server.json"


def _fetch_json(url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "Cache-Control": "no-cache"},
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def _resolve_schema(schema: dict, components: dict, seen: set[str] | None = None) -> dict:
    if not isinstance(schema, dict):
        return {}
    seen = set(seen or ())
    ref = schema.get("$ref")
    if ref:
        parts = ref.strip("#/").split("/")
        if len(parts) < 2 or parts[0] != "components":
            return {}
        name = parts[-1]
        if name in seen:
            return {}
        resolved = components
        for part in parts[1:]:
            resolved = resolved.get(part, {}) if isinstance(resolved, dict) else {}
        return _resolve_schema(resolved, components, seen | {name})
    result = json.loads(json.dumps(schema))
    if isinstance(result.get("properties"), dict):
        result["properties"] = {
            key: _resolve_schema(value, components, seen)
            for key, value in result["properties"].items()
        }
    if isinstance(result.get("items"), dict):
        result["items"] = _resolve_schema(result["items"], components, seen)
    for keyword in ("oneOf", "anyOf", "allOf"):
        if isinstance(result.get(keyword), list):
            result[keyword] = [
                _resolve_schema(value, components, seen) for value in result[keyword]
            ]
    return result


def _openapi_tool_specs(openapi_spec: dict) -> list[dict]:
    specs: list[dict] = []
    components = openapi_spec.get("components", {})
    for path, methods in openapi_spec.get("paths", {}).items():
        if not isinstance(methods, dict):
            continue
        path_params = methods.get("parameters", [])
        if not isinstance(path_params, list):
            path_params = []
        for method, operation in methods.items():
            if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue
            if not isinstance(operation, dict):
                continue
            operation_id = operation.get("operationId")
            if operation_id not in COCKPIT_TOOL_OPERATIONS:
                continue
            tool = {
                "name": operation_id,
                "description": operation.get(
                    "description",
                    operation.get("summary", "No description available."),
                ),
                "parameters": {"type": "object", "properties": {}, "required": []},
            }
            merged: dict[tuple[str, str], dict] = {}
            op_params = operation.get("parameters", [])
            if not isinstance(op_params, list):
                op_params = []
            for param in [*path_params, *op_params]:
                if isinstance(param, dict) and param.get("name"):
                    merged[(param["name"], param.get("in", ""))] = param
            for param in merged.values():
                name = param.get("name")
                schema = param.get("schema", {}) if isinstance(param.get("schema"), dict) else {}
                description = schema.get("description") or param.get("description") or ""
                if isinstance(schema.get("enum"), list):
                    values = ", ".join(str(value) for value in schema["enum"])
                    description = (description + f". Possible values: {values}").strip()
                prop = {
                    "type": schema.get("type") or "string",
                    "description": description,
                }
                if schema.get("type") == "array" and "items" in schema:
                    prop["items"] = schema["items"]
                tool["parameters"]["properties"][name] = prop
                if param.get("required"):
                    tool["parameters"]["required"].append(name)
            request_body = operation.get("requestBody")
            if isinstance(request_body, dict):
                content = request_body.get("content", {})
                schema = (
                    content.get("application/json", {}).get("schema")
                    if isinstance(content, dict)
                    else None
                )
                if isinstance(schema, dict):
                    resolved = _resolve_schema(schema, components)
                    if isinstance(resolved.get("properties"), dict):
                        tool["parameters"]["properties"].update(resolved["properties"])
                        required = resolved.get("required", [])
                        if isinstance(required, list):
                            tool["parameters"]["required"] = list(
                                dict.fromkeys([*tool["parameters"]["required"], *required])
                            )
                    elif resolved.get("type") == "array":
                        tool["parameters"] = resolved
            specs.append(tool)
    return specs


def materialize_cockpit_tool_server() -> dict:
    connection = TOOL_CONNECTIONS[0]
    spec_url = connection["url"].rstrip("/") + "/" + connection["path"].lstrip("/")
    openapi = _fetch_json(spec_url)
    if not isinstance(openapi, dict) or "paths" not in openapi:
        raise RuntimeError("NOUR Cockpit OpenAPI is invalid")
    openapi = json.loads(json.dumps(openapi))
    info = openapi.setdefault("info", {})
    info["title"] = connection["info"]["name"]
    info["description"] = connection["info"]["description"]
    specs = _openapi_tool_specs(openapi)
    names = {spec.get("name") for spec in specs}
    if names != COCKPIT_TOOL_OPERATIONS:
        raise RuntimeError(
            f"NOUR Cockpit tool spec mismatch: expected={sorted(COCKPIT_TOOL_OPERATIONS)} "
            f"actual={sorted(name for name in names if name)}"
        )
    return {
        "id": connection["info"]["id"],
        "idx": 0,
        "url": connection["url"].rstrip("/"),
        "openapi": openapi,
        "info": info,
        "specs": specs,
    }


def sync_tool_server_asset() -> tuple[bool, int]:
    server = materialize_cockpit_tool_server()
    desired = json.dumps(server, ensure_ascii=False, separators=(",", ":")) + "\n"
    changed = False
    for target_dir in (
        OPENWEBUI_PACKAGE / "frontend" / "static",
        OPENWEBUI_PACKAGE / "static",
    ):
        if not target_dir.is_dir():
            raise RuntimeError(f"OpenWebUI static directory missing: {target_dir}")
        target = target_dir / TOOL_SERVER_ASSET
        current = target.read_text(encoding="utf-8") if target.exists() else ""
        if current != desired:
            target.write_text(desired, encoding="utf-8")
            changed = True
    return changed, len(server["specs"])


def remove_managed_ui_block(text: str) -> str:
    while UI_START in text:
        before, rest = text.split(UI_START, 1)
        if UI_END not in rest:
            text = before
            break
        _, after = rest.split(UI_END, 1)
        text = before + after
    return text.rstrip()


def sync_ui_assets() -> bool:
    changed = False
    targets = [
        OPENWEBUI_PACKAGE / "frontend" / "static",
        OPENWEBUI_PACKAGE / "static",
    ]
    for name, source in UI_PATCHES.items():
        if not source.is_file():
            raise RuntimeError(f"NOUR Cockpit UI source missing: {source}")
        patch = source.read_text(encoding="utf-8").strip()
        for target_dir in targets:
            if not target_dir.is_dir():
                raise RuntimeError(f"OpenWebUI static directory missing: {target_dir}")
            target = target_dir / name
            native = target.read_text(encoding="utf-8") if target.exists() else ""
            base = remove_managed_ui_block(native)
            desired = (
                (base + "\n\n" if base else "")
                + UI_START
                + "\n"
                + patch
                + "\n"
                + UI_END
                + "\n"
            )
            if native != desired:
                target.write_text(desired, encoding="utf-8")
                changed = True
    return changed


async def main():
    ui_changed = sync_ui_assets()
    tool_asset_changed, tool_spec_count = sync_tool_server_asset()
    changed = ui_changed or tool_asset_changed
    connections = await Config.get("tool_server.connections", []) or []
    if connections != TOOL_CONNECTIONS:
        await Config.upsert({"tool_server.connections": TOOL_CONNECTIONS})
        changed = True

    db_path = os.path.join(os.environ["DATA_DIR"], "webui.db")
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    row = con.execute(
        "select id from user where role='admin' order by created_at asc limit 1"
    ).fetchone()
    con.close()
    if not row:
        raise RuntimeError("OpenWebUI admin user not found")
    user_id = row[0]

    form = ModelForm(
        id=COCKPIT_ID,
        base_model_id=BASE_MODEL,
        name="NOUR Cockpit",
        params=ModelParams(),
        meta=ModelMeta.model_validate(MODEL_META),
        access_grants=None,
        is_active=True,
    )
    existing = await Models.get_model_by_id(COCKPIT_ID)
    desired_meta = form.meta.model_dump()
    needs_model = (
        existing is None
        or existing.base_model_id != BASE_MODEL
        or existing.name != "NOUR Cockpit"
        or existing.params.model_dump() != {}
        or existing.meta.model_dump() != desired_meta
        or not existing.is_active
    )
    if needs_model:
        if existing is None:
            result = await Models.insert_new_model(form, user_id=user_id)
        else:
            result = await Models.update_model_by_id(COCKPIT_ID, form)
        if not result:
            raise RuntimeError("Failed to persist NOUR Cockpit model")
        changed = True

    if await Config.get("ui.default_models", "") != COCKPIT_ID:
        await Config.upsert({"ui.default_models": COCKPIT_ID})
        changed = True
    current = str(await Config.get("ui.default_pinned_models", "") or "")
    current_ids = [x for x in current.split(";") if x and x != COCKPIT_ID]
    merged = [COCKPIT_ID] + current_ids
    for model_id in BASE_PINNED:
        if model_id not in merged:
            merged.append(model_id)
    pinned = ";".join(merged)
    if current != pinned:
        await Config.upsert({"ui.default_pinned_models": pinned})
        changed = True

    verify = await Models.get_model_by_id(COCKPIT_ID)
    payload = {
        "changed": changed,
        "model": verify.id if verify else None,
        "base_model": verify.base_model_id if verify else None,
        "tool_ids": verify.meta.model_dump().get("toolIds") if verify else None,
        "default_model": await Config.get("ui.default_models", ""),
        "ui_patch": "installed",
        "ui_changed": ui_changed,
        "tool_server_asset": TOOL_SERVER_ASSET,
        "tool_server_asset_changed": tool_asset_changed,
        "tool_spec_count": tool_spec_count,
        "mission_task_writes": False,
    }
    print("NOUR_COCKPIT_ENSURE=" + json.dumps(payload, separators=(",", ":")))

asyncio.run(main())

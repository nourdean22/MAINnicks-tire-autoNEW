import asyncio
import json
import os
import sqlite3
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
    changed = ui_changed
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
        "mission_task_writes": False,
    }
    print("NOUR_COCKPIT_ENSURE=" + json.dumps(payload, separators=(",", ":")))

asyncio.run(main())

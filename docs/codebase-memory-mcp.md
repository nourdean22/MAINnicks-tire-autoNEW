# Codebase Memory MCP Server

## Overview

The codebase-memory MCP server exposes the NOURCITY monorepo to AI agents via the
[Model Context Protocol](https://modelcontextprotocol.io/), enabling code-aware
reasoning without manual file-by-file pasting.

> **⚠ Access posture: READ-WRITE.** The official `@modelcontextprotocol/server-filesystem`
> exposes write tools unconditionally — `write_file`, `edit_file`, `create_directory`,
> `move_file` — and has **no `--read-only` flag** (verified against the official README,
> 2026-08-04, latest published version `2026.7.10`; an earlier revision of this doc claimed
> such a flag exists — it does not). Treat ANY session with this server attached as having
> full write access to the exposed directories.

## Quick Start

```powershell
# From repo root:
powershell scripts/start-codebase-mcp.ps1
```

The launcher pins the server version (supply-chain rule: no unpinned `npx -y` in agent
startup). Bump the pin deliberately in `scripts/start-codebase-mcp.ps1` + this doc together.

## IDE Configuration

### Antigravity / Gemini

Add to your MCP server config (`.gemini/settings.json` or equivalent):

```json
{
  "mcpServers": {
    "codebase-memory": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem@2026.7.10",
        "C:/Users/nourd/NOURCITY/apps/statenour",
        "C:/Users/nourd/NOURCITY/apps/nickstire",
        "C:/Users/nourd/NOURCITY/packages",
        "C:/Users/nourd/NOURCITY/docs"
      ]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json` — same `command`/`args` block as above.

> Note: some older notes referenced a root `mcp_config.json` — that file is **not tracked
> in this repo**. The launcher script + the config blocks in this doc are canonical.

## Exposed Directories

| Directory | Purpose |
|-----------|---------|
| `apps/statenour` | StateNour OS app (bdnick.info) |
| `apps/nickstire` | Nick's Tire auto shop app (nickstire.org) |
| `packages` | Shared packages |
| `docs` | Documentation, ADRs, audits, runbooks |
| `scripts` | Build, deploy, and utility scripts |

## Available Tools

Read set: `read_text_file` · `read_media_file` · `read_multiple_files` · `list_directory` ·
`list_directory_with_sizes` · `directory_tree` · `search_files` · `get_file_info` ·
`list_allowed_directories`.

Write set (always exposed — see posture warning above): `write_file` · `edit_file` ·
`create_directory` · `move_file`.

## Restricting to read-only (the honest options)

The server itself cannot be made read-only. If a read-only surface is required:

1. **Client-side tool allowlist** — allow only the read-set tool names in the consuming
   client's tool configuration (supported by most MCP clients, including Claude Code
   permission rules).
2. **Container mount** — run the server in Docker with `ro` bind mounts
   (`type=bind,src=...,dst=...,ro`), per the official README.
3. Don't attach it — for pure read workflows, native agent file tools are usually enough.

## Security

- The server only exposes the directories you specify — keep the list tight.
- No network access — purely local filesystem over stdio.
- Version pinned (`@2026.7.10`) — unpinned `npx -y` can execute a newly published,
  unreviewed package at startup.

## CI Integration (Optional)

```yaml
# GitHub Actions example — keep the pin here too
- name: Start codebase MCP
  run: npx -y @modelcontextprotocol/server-filesystem@2026.7.10 ./apps/statenour ./docs &
```

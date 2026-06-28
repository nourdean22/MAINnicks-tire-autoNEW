# Codebase Memory MCP Server

## Overview

The codebase-memory MCP server gives AI agents read-access to the NOURCITY
monorepo via the [Model Context Protocol](https://modelcontextprotocol.io/).
This enables code-aware reasoning without manually copy-pasting files.

## Quick Start

```powershell
# From repo root:
powershell scripts/start-codebase-mcp.ps1
```

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
        "@modelcontextprotocol/server-filesystem",
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

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codebase-memory": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "C:/Users/nourd/NOURCITY/apps/statenour",
        "C:/Users/nourd/NOURCITY/apps/nickstire",
        "C:/Users/nourd/NOURCITY/packages",
        "C:/Users/nourd/NOURCITY/docs"
      ]
    }
  }
}
```

## Exposed Directories

| Directory | Purpose |
|-----------|---------|
| `apps/statenour` | StateNour OS app (bdnick.info) |
| `apps/nickstire` | Nick's Tire auto shop app (nickstire.org) |
| `packages` | Shared packages |
| `docs` | Documentation, ADRs, audits, runbooks |
| `scripts` | Build, deploy, and utility scripts |

## Available Tools

The MCP filesystem server exposes these tools:

- `read_file` — Read contents of a file
- `read_multiple_files` — Read multiple files at once
- `write_file` — Write contents to a file
- `list_directory` — List directory contents
- `search_files` — Search for files by pattern
- `get_file_info` — Get file metadata

## Security

- The server only exposes the directories you specify
- No network access — purely local filesystem
- Read-write by default; use `--read-only` flag for read-only mode

## CI Integration (Optional)

For CI pipelines that need codebase context (e.g., automated review):

```yaml
# GitHub Actions example
- name: Start codebase MCP
  run: npx -y @modelcontextprotocol/server-filesystem ./apps/statenour ./docs &
```

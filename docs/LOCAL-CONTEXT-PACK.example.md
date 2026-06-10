# LOCAL-CONTEXT-PACK.example.md — NOURCITY Dev Environment Template
> Local tooling context template: Ollama setup, MCP configuration, dev environment facts,
> and local model recommendations. Copy to `LOCAL-CONTEXT-PACK.md` (which is local-only)
> and populate with your own machine details.
>
> Last verified: 2026-06-10

---

## 1. Local Machine Profile

| Component | Value |
|---|---|
| OS | Windows 11 / Unix / macOS |
| RAM | [LOCAL_RAM_GB] |
| GPU | [LOCAL_GPU_NAME] / CPU-only |
| GPU mode | Ollama GPU acceleration state |
| Node | >=20.0.0 |
| Package manager | pnpm |
| Shell preference | bash / zsh / command shell |

### ⚠️ OOM / Resource Constraints

```bash
# Run vitest serialized if under memory pressure:
pnpm exec vitest run --pool=forks --poolOptions.forks.singleFork=true

# Avoid running both apps' dev servers simultaneously if resources are limited
```

---

## 2. Ollama — Local Model Server

### Status Template

| Check | Result |
|---|---|
| Ollama version | Installed version (e.g., v0.30.x) |
| Service running | Listening address (e.g., http://localhost:11434) |
| Models pulled | List of local models pulled |
| GPU acceleration | Enabled/Disabled status |

### Ollama API Endpoints

```
http://localhost:11434/api/tags          ← list available models
http://localhost:11434/api/generate      ← generate completion
http://localhost:11434/v1/               ← OpenAI-compatible endpoint
http://localhost:11434/api/chat          ← chat completion (native)
```

### OpenAI-Compatible Base URL

```
http://localhost:11434/v1
```

---

## 3. Antigravity + Ollama Configuration

**Antigravity cannot use local Ollama models directly as its main reasoning engine.**
Instead, local models can be used via MCP as a tool call.

### Example MCP Configuration

```json
// File: C:\Users\[LOCAL_USER]\.gemini\config\mcp_config.json
{
  "mcpServers": {
    "ollama-local": {
      "command": "npx",
      "args": ["-y", "ollama-mcp"],
      "env": {
        "OLLAMA_HOST": "http://localhost:11434"
      }
    }
  }
}
```

---

## 4. Recommended Local Model Stack (CPU-Only)

Practical limit for CPU-only inference: ~7B parameters.

### Pull Commands

```bash
ollama pull [LOCAL_MODEL_NAME_3B]     # e.g. llama3.2:3b
ollama pull [LOCAL_MODEL_NAME_7B]     # e.g. qwen2.5-coder:7b
ollama pull [LOCAL_EMBED_MODEL]       # e.g. nomic-embed-text
```

---

## 5. Nickstire AI Gateway Config

```
AI_PROVIDER=venice    ← Venice AI (primary)
AI_PROVIDER=openai    ← OpenAI fallback
AI_PROVIDER=ollama    ← Local Ollama (fallback/test)
```

---

## 6. Remote Access / Cloudflare Tunnel Template

```
Tunnel Host: [CLOUDFLARE_TUNNEL_URL] (e.g., trycloudflare.com or custom subdomain)
Tunnel ID:   [CLOUDFLARE_TUNNEL_ID]
DNS CNAME:   [DNS_CNAME_TARGET]
```

---

## 7. Railway CLI Usage

```bash
railway run --service [SERVICE_NAME] pnpm exec tsx scripts/<script>.ts
```

---

## 8. Local Dev Ports

| App | Default Port | Notes |
|---|---|---|
| nickstire dev | 5173 (Vite) | `pnpm dev` from `apps/nickstire/` |
| statenour dev | 3001 | `pnpm dev` from `apps/statenour/` |
| Ollama API | 11434 | Default port |

---

*Last updated: 2026-06-10.*

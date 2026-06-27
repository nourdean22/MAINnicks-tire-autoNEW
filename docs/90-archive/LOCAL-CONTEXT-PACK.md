# LOCAL-CONTEXT-PACK.md — NOURCITY Dev Environment
> Local tooling context: Ollama setup, MCP configuration, dev environment facts,
> and local model recommendations. Read alongside `AGENT-OPERATING-PROFILE.md`.
>
> Last verified: 2026-06-10

---

## 1. Local Machine Profile

| Component | Value |
|---|---|
| OS | Windows 11 |
| RAM | ~32–64 GB |
| GPU | No discrete NVIDIA GPU (nvidia-smi not found) |
| GPU mode | Ollama runs CPU-only |
| Node | >=20.0.0 (`.node-version` in repo) |
| Package manager | pnpm@10.4.1 |
| Shell preference | bash via Git Bash · `.bat` for launchers · avoid PowerShell for complex scripts |

### ⚠️ OOM Risk

This machine hits memory pressure under heavy concurrent workloads. Rules:

```bash
# Run vitest serialized (not parallel) to avoid OOM:
pnpm exec vitest run --pool=forks --poolOptions.forks.singleFork=true

# Don't run both apps' dev servers simultaneously unless RAM allows
# Dev server for nickstire: pnpm dev (from apps/nickstire/)
# Dev server for statenour: pnpm dev (from apps/statenour/) → port 3001
```

---

## 2. Ollama — Local Model Server

### Status (2026-06-10)

| Check | Result |
|---|---|
| Ollama version | **v0.30.7** ✅ installed |
| Service running | **Yes** — listening at `http://localhost:11434` ✅ |
| Models pulled | **None** — fresh install, no models yet |
| GPU acceleration | **No** — CPU-only mode |

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

Use this with any OpenAI SDK client for local inference (NOT for Antigravity — see Section 3).

---

## 3. Antigravity + Ollama Reality

**Antigravity cannot use Ollama as its reasoning model.** This is a platform constraint — no
custom base URL, no local providers. The cloud model always handles reasoning.

**What IS possible:** Use Ollama via MCP as a **tool** Antigravity can call.

```
Cloud Antigravity Brain  →  calls Ollama MCP tool  →  Ollama local model
                              for: private generation, fast drafts, embeddings
```

### Proposed MCP Configuration (NOT YET APPLIED)

```json
// File: C:\Users\nourd\.gemini\config\mcp_config.json
// Add this entry (do not overwrite existing entries):
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

**Before applying:** Run `npm view ollama-mcp` to verify the package is legitimate.
**Status:** Pending approval. Do not apply without explicit sign-off.

---

## 4. Recommended Local Model Stack (CPU-Only)

Since there's no GPU, all inference is CPU. Practical limit: ~7B params for daily use.

### Priority Pull Order

```bash
# Tier 1 — Core (pull these first)
ollama pull llama3.2:3b          # ~2 GB · fast general model · planning/drafts
ollama pull qwen2.5-coder:7b     # ~5 GB · best CPU-friendly coder
ollama pull nomic-embed-text     # ~0.3 GB · embeddings · semantic search

# Tier 2 — Extended
ollama pull llama3.1:8b          # ~5 GB · 128k context · long docs / summarization
ollama pull mistral:7b           # ~5 GB · creative writing / marketing copy

# Tier 3 — Optional
ollama pull llama3.2:1b          # ~0.7 GB · ultra-fast drafts (low quality)
ollama pull phi4:14b             # ~9 GB · strong reasoning (needs ~9+ GB free RAM)
```

> **Nothing above is installed.** These are approved reference commands only.
> Pull individually after confirming RAM availability.

### Use Case → Model Map

| Use Case | Recommended Model | CPU Speed |
|---|---|---|
| Coding assistant (monorepo) | `qwen2.5-coder:7b` | ~30–90s/response |
| Repo search / embeddings | `nomic-embed-text` | <1s |
| Personal assistant / planning | `llama3.2:3b` | ~15–30s/response |
| Marketing copy | `mistral:7b` | ~30–60s/response |
| Private file summarization | `llama3.1:8b` | ~45–120s/response |
| Long-context research | `llama3.1:8b` (128k ctx) | slow for >32k tokens |
| Fast cheap drafts | `llama3.2:1b` or `llama3.2:3b` | ~5–15s/response |

### Honest Assessment: Local vs Cloud

| Task | Local Wins | Cloud Wins |
|---|---|---|
| Privacy-sensitive files | ✅ | — |
| Offline work | ✅ | — |
| Cost per token | ✅ | — |
| Code quality (complex) | — | ✅ (Claude/Gemini far ahead) |
| Speed | — | ✅ (10–50x faster on cloud) |
| Long context | — | ✅ |
| Marketing copy quality | — | ✅ |

**Recommended default:** Use cloud (Claude Sonnet 4.6 or Gemini 3.5 Flash) for Antigravity work.
Use local Ollama for: private/sensitive files, offline drafts, bulk embedding generation.

---

## 5. Nickstire Local AI Gateway

Nickstire has its own embedded AI gateway (`server/services/`):

```
AI_PROVIDER=ollama    ← pins Ollama, disables failover (DO NOT use in prod — was deleted 2026-05-xx)
AI_PROVIDER=venice    ← Venice AI (primary)
AI_PROVIDER=openai    ← OpenAI fallback

CRITICAL: Structured output (JSON schema) calls MUST use OpenAI invokeLLM()
          Ollama does NOT support strict JSON schema → use only for unstructured generation
```

---

## 6. Cloudflare Tunnel (Remote Access)

```
Quick tunnel (changes on restart): https://bird-cork-bringing-efforts.trycloudflare.com
Named tunnel nour-local (ID: 6193177a) exists
DNS fix needed: add CNAME dev → 6193177a-0bd6-45cf-b2f8-0e3ef9162113.cfargotunnel.com
  at DNS provider: globaldomaingroup.com (not Cloudflare)
Tunnel URL written to: C:\Users\nourd\.cloudflared\tunnel-url.txt
```

---

## 7. Railway CLI

```bash
railway login    # not currently authenticated — must re-auth before railway run commands
railway run --service MAINnicks-tire-auto pnpm exec tsx scripts/<script>.ts
```

---

## 8. Local Dev Ports

| App | Default Port | Notes |
|---|---|---|
| nickstire dev | 5173 (Vite) | `pnpm dev` from `apps/nickstire/` |
| statenour dev | 3001 | `pnpm dev` from `apps/statenour/` (3000 was taken) |
| Ollama API | 11434 | Always running if Ollama service is active |

---

## 9. Local Launchers & Scripts

```
C:\Users\nourd\NOURCITY\apps\statenour\start.bat   ← statenour launcher (cmd.exe)
~/push-main.sh                                      ← safe shared-main push script
```

---

## 10. Saved Credentials & Remote Access (Euclid PC)

### Active Credentials
*   **Auto Labor Guide / ShopDriver Elite**:
    *   Username: `moeseuclid`
    *   Password: `Euclid17625!`
*   **DK Tire B2B**:
    *   Account: `70001887`
    *   Password: `Moes17625$`
*   **Ring / Eufy Cameras**:
    *   Account: `nourdean22@gmail.com`
    *   Password: `Jamie23358!`
*   **Shop SMS Gateway**:
    *   Username: `BY9G1A`
    *   Password: `5lhjcnqp-caenp`
*   **Shop V380 Cameras (RTSP/ONVIF)**:
    *   Credentials: `admin/admin`

### Chrome Remote Desktop (CRD) PIN
*   **Plaintext PIN**: No plaintext record exists.
*   **Connection / Reset**: If you cannot connect via the saved session on `NATTYNOUR`, you must physically access the Euclid computer at the shop, open the Chrome Remote Desktop Host interface, and click **"Change PIN"** to reset the 6-digit numeric PIN.
*   **Windows Local Login Passwords to try**:
    *   `Euclid17625!`
    *   `Moes17625$`
    *   `Moes17625!`
    *   `moeseuclid`
    *   `moeseuclid17625!`

---

*Update after major env changes (new GPU, RAM, new Ollama version, MCP additions). Last: 2026-06-24.*


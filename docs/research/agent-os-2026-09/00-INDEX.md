# bdnick.info -> Personal Agent OS : Research Program (2026-09-03)

Branch: `statenour/agent-os-2026-09-03` · Worktree: `C:/Users/nourd/NOURCITY-wt/agent-os`

## Track status — ALL RESEARCH COMPLETE
| # | Track | File | Status |
|---|-------|------|--------|
| 1 | Model + inference layer | `01-model-layer.md` | ✅ |
| 2 | Agent architecture + coding agents | `02-agent-architecture.md` | ✅ |
| 3 | MCP fabric + agent security | `03-mcp-security.md` | ✅ |
| 4 | Browser/computer use + sandboxes | `04-browser-sandbox.md` | ✅ |
| 5 | Research engine (search/crawl/extract) | `05-research-engine.md` | ✅ |
| 6 | Memory + context + unified search | `06-memory-context.md` | pending write-up |
| 7 | Durable workflows + observability | `07-durable-observability.md` | pending write-up |
| 8 | Workspace/artifacts + docgen + UI/UX | `08-workspace-ui.md` | pending write-up |
| 9 | Voice + auth + connectors + missed gaps | `09-voice-auth-gaps.md` | pending write-up |
| — | **Current-state diagnostic** | `10-current-state.md` | ✅ |
| — | **HOST HARDWARE REALITY (measured)** | `11-host-hardware-reality.md` | ✅ **read this first** |

## Ground truth (verified 2026-09-03, not inferred)
- Primary checkout on `nickstire/audit-fixes-2026-09-03` @ `09235243e`, **0 behind origin/main**.
- ⚠ A **sibling session is actively editing `apps/nickstire/**`** (10 dirty files). HANDS OFF.
- `apps/statenour`: 2,581 TS/TSX files · 103 Prisma models · **181 chat tools, 24/turn budget** ·
  Inngest 4.4.0 · Sentry 10.73.0 · `@langfuse/otel` 5.10.1 · Playwright 1.62.1 · vitest evals.
- **Next.js is `^16.2.11`, NOT 15** — the original brief was wrong and that error propagated into
  several research prompts. Corrected in `02-agent-architecture.md`.
- **`ai` was pinned to exactly `6.0.162` because of a local patch** (`patches/ai@6.0.162.patch`)
  fixing a null-deref in `AbstractChat.onFinish`. **Upstream fixed it in the v6 line** — verified by
  reading `ai@6.0.275`'s `dist/index.mjs`. Patch dropped, SDK bumped. See "Applied changes" below.

## MEASURED host hardware — overrides all "run it locally" advice
| Probe | Value |
|---|---|
| CPU | Intel Core Ultra 7 266V (Lunar Lake), 8c/8t |
| **GPU** | **Intel Arc 140V iGPU — no NVIDIA, no CUDA** |
| **RAM** | **15.72 GB, on-package LPDDR5X → NOT upgradeable** |
| **Free disk C:** | **~15 GB** — binding constraint |
| WSL | v2.6.3.0 installed, **zero distros** |

⇒ **There is no local model on this machine that can drive a reliable tool-calling agent loop.**
Hosted API for reasoning is a hardware fact, not a preference. Cost discipline must come from
**routing + caching**, not local inference. Full analysis in `11-host-hardware-reality.md`.

## Applied changes (this branch)
| Change | Status |
|---|---|
| `ai` 6.0.162 → **6.0.275** (113 patch releases) | applied, installing clean |
| Delete `apps/statenour/patches/ai@6.0.162.patch` (fixed upstream, better) | applied |
| Remove its `pnpm.patchedDependencies` entry | applied |

## ⚠ Unresolved contradiction — do NOT treat as settled
Two independent research passes disagree on whether AI SDK's **`WorkflowAgent` can run against a
self-hosted Workflow "World"**:
- Pass A: *"the docs give no self-hosting path — the sharpest lock-in vector in the AI SDK"* (self-flagged unverified).
- Pass B: *"Apache-2.0 with a production-proven self-hosted Postgres World."*

Both agree `vercel/workflow` is Apache-2.0. **Requires a prototype to settle.** Moot under the
recommended path, which uses the already-installed **Inngest 4.4.0** for durability instead.

## Cross-cutting findings worth acting on
1. **`@inngest/agent-kit` is abandoned** — no stable release since 2025-11-13, one 2026 alpha.
   Keep Inngest as the durable executor; do **not** build the agent loop on AgentKit.
2. **AutoGen is dead** (0 releases in 2026, maintenance mode); **Aider unmaintained** (96%
   single-author, no release in ~13 months); **Roo Code archived**; **Continue read-only**.
3. **tldraw is NOT MIT** — proprietary, dev-only by default, with license-key enforcement *in code*
   and a watermark on the free tier. Multiple 2026 blog posts get this wrong.
4. **Scaffold ≈ 1–3 SWE-bench points; model ≈ 20.** A 100-line bash agent scores 76.8% vs a full
   platform's 77.6%. **MiniMax M2.5: 75.8% at $0.073/instance vs Claude 4.5 Opus 76.8% at $0.754.**
5. **Bing Web Search API is retired**; **Brave killed its free tier**; **Google CSE is closed to new
   customers** and dies 2027-01-01. Self-hosted SearXNG is *a DuckDuckGo proxy*, not a Google SERP API.
6. **MCP spec `2026-07-28` is the largest breaking revision ever** — sessions, sampling, roots,
   logging and SSE resumability all removed/deprecated. 12-month clock on any `2025-*` client code.
7. **iOS PWA: no Background Sync, no silent push.** The phone can command and confirm the agent;
   it can never *run* it. All scheduling stays server-side.

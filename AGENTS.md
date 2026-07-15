# AGENTS.md — NOURCITY monorepo

Two apps share this repo: `apps/statenour` (Railway → bdnick.info) and `apps/nickstire` (Railway → nickstire.org). **Per-app detail lives in `apps/<app>/AGENTS.md` — read that first for the app you're touching.** This file is only the cross-cutting rules that recur. Claude-specific extras: [`CLAUDE.md`](./CLAUDE.md).

## Branching — Autonomous Merging Allowed

- Work on named branches only: `nickstire/<task>` · `statenour/<task>` · `docs/<task>` · `chore/<task>`. Push the branch, then create and merge the PR yourself using the `gh` CLI. (Remove the dummy IDE token first):
  ```bash
  Remove-Item Env:\GITHUB_TOKEN -ErrorAction SilentlyContinue
  gh pr create --head <branch> --title "<message>" --body "<body>"
  gh pr merge <pr-number> --squash --delete-branch
  ```
  After merging, keep the local repository clean by syncing your local `main` with origin (`git fetch origin main` and `git reset --hard origin/main`).
- Concurrent agent sessions share this repo — start from a fresh worktree using the setup script: `powershell scripts/worktree-setup.ps1 -branchName <branch> -targetDir .worktrees/<name>`. This script automatically copies env files and creates NTFS directory junctions for all `node_modules` instantly, completely bypassing pnpm install to save minutes of setup and gigabytes of disk space. Worktrees are shared surfaces too: `git log origin/<branch>..HEAD` before AND after pushing; disclose rider commits in the PR body, never rewrite them away. Once merged, clean up the worktree using `git worktree remove .worktrees/<name>` and delete the local branch with `git branch -d <branch>`.
- Stage **only your files by explicit path** — never `git add -A` · never `--no-verify` · never force-push shared history.
- Scope changes to the assigned task ONLY — no unrelated docs, generated reports, or sibling-session files.
- Final report: branch · SHA · changed files · checks run · PR link · intentional exclusions.

## Guidelines & Operating Frameworks

- **CIITTY Framework**: Always apply the custom `ciitty` operating framework (defined in the [ciitty skill](.agents/frameworks/ciitty/SKILL.md)). Read and follow its rules for deep reasoning, Visual Kinetics UI/UX design aesthetics, resilient database engineering (Prisma, Neon, parameterized queries), and PowerShell command reliability on Windows.
- **Strategic Mandate**: Act as a world-class strategist, ruthless operator, and Nour's external cognitive force. Optimize every response for truth, leverage, speed, precision, and compounding outcomes. Always enforce the **"Forgotten Factor" Protocol** (Blind Spot Check), **Asymmetric Risk Assessment**, **Contrarian Arbitrage**, and **Frontier Supremacy**. Refer to the full profiles in [AGENT-OPERATING-PROFILE.md](./AGENT-OPERATING-PROFILE.md) and [.antigravityrules](./.antigravityrules).

## Context routing

- `apps/statenour/**` → read `apps/statenour/AGENTS.md` first. Schema + migrations are hand-applied (`prisma/**`) — one wrong flag silently drops pgvector.
- `apps/nickstire/**` → read `apps/nickstire/AGENTS.md` first. SMS/VAPI = `server/**` · PWA UI = `client/**`.
- **Both apps run as standalone iOS PWAs**: window.confirm/alert/prompt are silently suppressed on the operator's phone — use in-DOM confirms (two-tap pattern).

## Verify gates

- The push gate = repo-root `lefthook.yml` (`pre-push` hook) → `turbo build --affected`. (Husky is no longer used; there is no `.husky/` directory.) Other printed checks (lint-baseline, prompt:size-check) can be RED but are NON-blocking — a green local test run is on you.
- statenour (from `apps/statenour/`): `pnpm typecheck` · `pnpm lint` · `pnpm test` · full gate `pnpm verify:hard`. Piping vitest to `tail` masks the exit code — read the summary line.
- nickstire (from `apps/nickstire/`): `pnpm run verify` (master gate). Full suite MUST be serial on Windows: `pnpm exec vitest run --pool=forks --poolOptions.forks.singleFork=true`. Serial mode shares ONE process across test files — follow the Test-hygiene rules in `apps/nickstire/AGENTS.md` §3 (unmock/unstub/env-restore) or leaks resurface as intermittent failures in unrelated files.
- Supply-chain security: `powershell scripts/security-scan.ps1` wraps `pnpm audit --json` with structured reporting. Advisory-only by default; use `-FailOnCritical` for CI gating. Report lands at `reports/security-audit.json`.
- Fresh worktrees created via `scripts/worktree-setup.ps1` do NOT need `pnpm install` because `node_modules` are automatically junctioned from the root. If dependencies or `pnpm-lock.yaml` change, run `pnpm install --frozen-lockfile --filter "<app>..."` — WITH the `...` suffix (bare `--filter` skips workspace deps → phantom `clsx`/import failures).

## Commit Attribution

AI commits MUST include:

```
Co-Authored-By: <model name> <noreply@anthropic.com>
```

## Environment (Windows)

- The CLI shell is standard Windows PowerShell. **Do not chain commands using `&&`** as it throws a parser syntax error. Execute chained commands using a semicolon `;` or run them as separate tool calls.
- Bash cwd resets to `C:\` between calls — prefix every command with `cd /c/Users/nourd/NOURCITY/... &&`.
- `Edit` old_string containing unicode (arrows, middots, emoji) often fails to match — use ASCII-only anchors from a fresh Read.
- Pre-push "IO error: provided value is too long when setting link name" / symlink warnings = non-fatal Windows-path noise; the build still passes.

## Memory / handoff

- Cross-session agent memory: `~/.claude/projects/C--/memory/MEMORY.md` (index + topic files) — concurrently edited by sibling sessions, re-read before editing. Per-app last-session handoff: `apps/<app>/.remember/remember.md`.
- statenour's own "brain" (BrainMemory + pgvector recall) is a product feature — separate from agent memory.

## Integrations (2026-06-22)

### Deep reasoning tool-access
- **Flag:** `NICK_DEEP_REASONING` (feature flags DB). When ON, the reasoning engine's pipeline includes a `runToolGather()` step that calls read-only business/brain tools via `generateText` (not `aiChat` — which doesn't support tools).
- **Whitelist:** `lib/ai/reasoning/reasoning-tools.ts` — 16 READ-ONLY tools (revenue, reviews, tasks, brain search, etc.). The engine OBSERVES, never ACTS.
- **Fencing:** All tool output is wrapped via `fenceContent()` to prevent prompt-injection bleeding into the reasoning loop.

### Firecrawl web scraper
- **Tool:** `scrapeWebPage` in `lib/ai/tools/system.ts` — converts any URL to clean LLM-ready markdown.
- **Integration:** `lib/integrations/firecrawl.ts` — `withGuardian` wrapped, 30s timeout, 2 retries, graceful degradation when `FIRECRAWL_API_KEY` is missing.
- **Security:** SSRF defense via `assertPublicUrl()` + content fencing via `fenceContent()`. Catalog entry: `research` category, `battle: true`, `cost: cheap`.
- **Env:** `FIRECRAWL_API_KEY` — set on Railway and `.env.local`.

### Supply-chain security scan
- **Script:** `scripts/security-scan.ps1` — wraps `pnpm audit --json` with structured JSON reporting.
- **Usage:** `powershell scripts/security-scan.ps1 [-OutputFile reports/audit.json] [-Severity critical] [-FailOnCritical]`
- **Report:** `reports/security-audit.json` — severity breakdown (critical/high/moderate/low) + advisory details.

### Codebase-memory MCP
- **Server:** `@modelcontextprotocol/server-filesystem` — exposes `apps/statenour`, `apps/nickstire`, `packages`, `docs`, `scripts` directories.
- **Startup:** `powershell scripts/start-codebase-mcp.ps1` or via the `codebase-memory` entry in `mcp_config.json`.
- **Docs:** `docs/codebase-memory-mcp.md` — IDE config for Antigravity + Claude Desktop.

### last30days Research Engine
- **Tool:** `last30days` in `apps/statenour/lib/ai/tools/system.ts` — runs deep search and aggregation queries across Reddit, Hacker News, Polymarket, GitHub, and YouTube.
- **Integration:** Placed in `lib/ai/last30days` in `statenour` with output tracing enabled in `next.config.ts` and `python3` runtime packages added to the `Dockerfile`. Whitelisted in `reasoning-tools.ts` for Nick's reasoning loops.

### MoneyPrinterTurbo Video Generator
- **Tool:** `moneyprinter` in `apps/statenour/lib/ai/tools/system.ts` — generates high-definition short videos automatically from a topic or a custom script.
- **Integration:** Placed in `lib/ai/moneyprinter` in `statenour` with output tracing enabled in `next.config.ts`. System packages `ffmpeg`, `imagemagick`, `py3-pip`, and python dependencies are installed inside the production `Dockerfile`. Credentials are dynamically mapped to `config.toml` at runtime.

---

## Skill frameworks (lazy-loaded — invoke as skills, do not inline here)

- **CIITTY v2.1** — canonical text lives at [.agents/frameworks/ciitty/SKILL.md](.agents/frameworks/ciitty/SKILL.md); apply per the Guidelines section above.
- **Clarity Gate v2.1.3** (community, frmoretto/clarity-gate) — pre-ingestion epistemic verification; invoke via its skill when validating docs for RAG/CGD/SOT work.

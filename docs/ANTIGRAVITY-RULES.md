# ANTIGRAVITY-RULES.md — NOURCITY Monorepo
> Antigravity-specific operating rules. Read `AGENT-OPERATING-PROFILE.md` first for the full
> context. This file covers what's unique to Antigravity: model selection, provider setup,
> session startup, MCP config, and safety rules for this IDE specifically.
>
> Last verified: 2026-06-10

---

## 1. Antigravity Model Reality

Antigravity uses a **closed, curated cloud model list**. It does NOT support:
- Custom base URLs
- OpenAI-compatible local endpoints
- Ollama as a reasoning model
- LiteLLM proxy
- Any local model provider

**Confirmed as of 2026-06-10:** Antigravity docs contain zero references to Ollama, custom endpoints,
or local providers. This is an architectural decision by Google.

### Recommended Model Profile

| Use Case | Recommended Model | Why |
|---|---|---|
| Complex monorepo reasoning | Claude Sonnet 4.6 (Thinking) | Best for multi-file edits, nuanced decisions |
| Fast iteration / quick queries | Gemini 3.5 Flash (High) | Speed + cost efficiency |
| Long-context document analysis | Claude Sonnet 4.6 (Thinking) | 200k context, reliable |
| Code explanation / quick fixes | Gemini 3.5 Flash (High) | Low latency |

### Ollama Integration (MCP Tool Only)

Ollama CAN be used as a **tool** inside Antigravity via MCP — not as the reasoning model.
See `docs/LOCAL-CONTEXT-PACK.md` for the proposed MCP configuration.
This allows Antigravity (cloud brain) to call Ollama for local/private generation tasks.

---

## 2. Session Startup Checklist

Run through this mentally at the start of every Antigravity session:

```
[ ] Which app am I working on? (nickstire OR statenour — not both)
[ ] Have I read the correct CLAUDE.md / AGENTS.md for that app?
[ ] Have I read .remember/remember.md for session continuity?
[ ] Do I know the current HEAD commit? (git log --oneline -3)
[ ] Am I scoped to only my app's files?
[ ] Have I confirmed I know what the verify gate is for this app?
```

---

## 3. Context Routing (Don't Load the Whole Repo)

Antigravity has a context window. Load only what's relevant.

### For nickstire work

```
Primary:   apps/nickstire/CLAUDE.md
Secondary: apps/nickstire/.remember/remember.md
           apps/nickstire/truth_os.md
Quick ref: apps/nickstire/docs/AGENT-CONTEXT.md
```

### For statenour work

```
Primary:   apps/statenour/AGENTS.md (or AGENT-CONTEXT.md for quick-load)
Truth:     apps/statenour/docs/CURRENT-TRUTH.md
State:     apps/statenour/.remember/now.md
History:   apps/statenour/docs/RECONCILIATION.md (top entry only)
```

### Cross-cutting (always relevant)

```
[REPO_ROOT]/AGENT-OPERATING-PROFILE.md    ← this is the master
[REPO_ROOT]/CLAUDE.md                     ← always-must-know gotchas
C:\Users\nourd\.gemini\config\skills\ciitty\SKILL.md  ← CIITTY Operating Rules
```

---

## 4. What Antigravity Can and Cannot Do in This Repo

### ✅ Safe

- Read any file in `[REPO_ROOT]` (except secrets — see Section 5)
- Edit `apps/nickstire/**` or `apps/statenour/**` (one app per session)
- Create documentation files in `docs/`
- Run `pnpm` commands (verify, test, typecheck, lint)
- Create files in `.remember/` (safe project notes only)
- Run `git log`, `git status`, `git diff`
- Run `git add <specific path>` + `git commit`
- Run `bash ~/push-main.sh` after explicit approval

### ❌ Requires Explicit Approval

- `git push` (any form)
- `git add -A`
- Editing files in BOTH apps in one session
- Database migrations (apply scripts)
- Changes to Railway environment variables
- Changes to SMS routing or Twilio config
- Changes to payment/Stripe logic
- Changes to auth/middleware
- Changes to `gbpContentGenerator.ts` (FTC risk — flagged)
- Any destructive DB operation

### 🚫 Never Do

- `git push --force`
- `git push --no-verify` (without written justification)
- Write secrets into any file
- Run migrations with `--accept-data-loss`
- Touch `.env` files (read `.env.example` instead)

---

## 5. Secrets Policy for Antigravity Sessions

```
NEVER read:   .env  .env.local  .env.production  .env.*.local
NEVER log:    API keys · tokens · Railway env vars · DB connection strings
NEVER write:  Secrets into docs, comments, commit messages, logs

SAFE to read: .env.example  (contract reference only — no real values)
SAFE to ask:  "What env var is needed for X?" → document it, don't read the value
```

---

## 6. Windows / Shell Gotchas

These are documented in `CLAUDE.md` but critical for Antigravity's PowerShell environment:

```powershell
# Shell cwd resets to C:\ between calls — always prefix bash commands:
cd [REPO_ROOT]/apps/nickstire && pnpm test

# PowerShell is unreliable for some operations — prefer bash/sh via Git Bash
# For scripts: use .bat (cmd.exe) or explicit bash.exe

# OOM risk on this machine:
# Run vitest with: pnpm exec vitest run --pool=forks --poolOptions.forks.singleFork=true
# Don't run both apps' dev servers + test suites simultaneously

# Unicode in Edit tool (old_string) often fails to match — use ASCII-only anchors
```

---

## 7. iOS PWA Rule (Both Apps)

Both `nickstire.org` and `bdnick.info` run as **standalone iOS PWAs** on the operator's phone.

```
window.confirm()   ← SILENTLY SUPPRESSED on iOS standalone PWA
window.alert()     ← SILENTLY SUPPRESSED on iOS standalone PWA  
window.prompt()    ← SILENTLY SUPPRESSED on iOS standalone PWA

Use instead: in-DOM confirm components (two-tap inline confirm)
Skill reference: nickstire-ios-pwa-primitives
```

---

## 8. Push Protocol

**Always use the push script:**

```bash
bash ~/push-main.sh
# Does: git fetch origin → rebase → turbo affected-build gate → push
# Auto-recovers from ref-lock races (concurrent session pushing)
```

**Before running push-main.sh, verify:**

```bash
git log origin/main..HEAD   # confirm what's riding along
git diff --stat HEAD        # confirm only your files changed
```

---

## 9. Commit Message Format

Both apps follow the same format:

```
<type> · <app> · <one-line summary>

<context paragraph: what triggered this, what was broken>

<implementation: files touched, how the fix works>

Verification:
- pnpm typecheck → 0 errors
- pnpm test → N tests, all pass
- turbo build → green

Co-Authored-By: <model name> <noreply@...>
```

Types: `fix` `feat` `docs` `chore` `refactor` `perf`  
Scope: `nickstire` or `statenour`

---

## 10. Cron and Inngest Safety

Statenour uses Inngest for durable workflows. Nickstire uses Drizzle-backed crons.

```
NEVER:  Add a cron without registering it in config/crons.ts (statenour)
NEVER:  Remove a cron without verifying it has no callers (pnpm check:crons)
ALWAYS: Confirm CRON_SECRET is set on Railway before a new cron can fire
ALWAYS: For statenour, run `pnpm check:crons` after any cron changes
```

---

## 11. The 5 Lies to Watch Out For

From `apps/statenour/docs/AGENT-CONTRACT.md` — applies to all agents here:

1. **"It probably works, I don't need to test."** Run the tests.
2. **"The orphan detection script said this is dead."** Search the base name across all files first.
3. **"This warning doesn't matter."** It'll be 300 warnings by next week.
4. **"I'll just fix this one thing before the plan."** No. Update the plan first.
5. **"Nour won't care about this detail."** He will.

---

*Update this file after major platform changes or new safety rules. Last updated: 2026-06-10.*

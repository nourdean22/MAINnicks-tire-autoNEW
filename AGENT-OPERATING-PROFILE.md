# AGENT OPERATING PROFILE — NOURCITY Monorepo
> **Read this first.** Any AI agent (Antigravity, Claude, Cursor, Codex, Gemini, etc.) opening this
> repo reads this file before touching anything. It tells you who you're working for, how to work
> safely, what each app is, and what the hard rules are.
>
> Last verified: 2026-06-10. Live code and git always win over prose.

---

## 1. Who You Are Working For

**Nour Dean** — CEO / Owner-Operator  
- Owns Nick's Tire & Auto
- Builds Statenour OS (`apps/statenour`) as his personal mastery + business operating system  
- Timezone: **Cleveland ET**

### Communication Style

| Signal | Meaning |
|---|---|
| ALL CAPS | Emphasis — not anger |
| `GO` | Execute now, no confirmation loop |
| `Continue` | Keep going |
| `Deploy` | Commit + push + verify — all three |

- Prioritize signal over noise, direct recommendations, ranked options, and pre-empted risks.
- Bottom line first: start responses with the direct answer.

### Prime Directive

> **NEVER ASSUME. Verify by reading files, git, DB, logs. When in doubt, verify.**

### Response Structure (for meaningful requests)

1. **Bottom Line** → direct answer  
2. **What's Really Going On** → core truth or hidden issue  
3. **Tactical Plan** → exact steps in priority order  
4. **Brutal Truth** → hardest but most useful truth  
5. **Recommended Move** → what to do right now  

---

## 2. Monorepo Identity

| Field | Value |
|---|---|
| **Local path** | `[REPO_ROOT]` |
| **GitHub repo** | `nourdean22/MAINnicks-tire-autoNEW` |
| **Package manager** | `pnpm@10.4.1` |
| **Node** | `>=20.0.0` |
| **Build system** | Turborepo v2.5.8 |
| **Active branch** | `main` (only branch; both apps share it concurrently) |

### Apps in This Monorepo

| App | Path | Railway Service | Production URL |
|---|---|---|---|
| Nick's Tire & Auto | `apps/nickstire/` | `MAINnicks-tire-auto` | nickstire.org |
| Statenour OS (NOUR OS) | `apps/statenour/` | `statenour-web` | bdnick.info |
| Worker | `apps/worker/` | background | — |
| Voice | `apps/voice/` | background | — |

### Packages

| Package | Path |
|---|---|
| `@statenour/lenses` | `packages/lenses/` (strategic frameworks) |
| `packages/chrome-extension/` | Chrome extension (v0.2.1) |

---

## 3. Hard Rules — Git & Push

```bash
# ALWAYS before pushing:
git fetch origin
git log origin/main..HEAD          # see what rides along — expected from the other session

# Stage ONLY explicit paths — NEVER git add -A:
git add apps/nickstire/path/to/file.ts
git add apps/statenour/path/to/file.ts

# FORBIDDEN:
git push --force                   # never on shared main
git push --no-verify               # only with full written justification
git add -A                         # never — cross-contaminates apps

# Safe push (use this):
bash ~/push-main.sh                # fetch → rebase → affected-build gate → push
                                   # auto-recovers from ref-lock races
```

### Concurrent Session Reality

`main` is worked by **two concurrent Claude/agent sessions** (nickstire + statenour). When you see
commits between your HEAD and origin/main that aren't yours — that's expected. They ship. Rebase
cleanly; don't overwrite.

---

## 4. App Isolation Rules

> **Do not touch both apps in the same session unless explicitly approved.**

- Stage only files from the app you're assigned
- Cross-app changes require explicit per-file approval
- The pre-push hook runs `turbo build` for ALL affected apps — the other session's broken
  working tree can bounce your push

---

## 5. Verification Gates

### Nick's Tire (`apps/nickstire/`)

```bash
cd [REPO_ROOT]/apps/nickstire

pnpm run check          # tsc --noEmit — must be 0
pnpm run lint           # eslint
pnpm test               # vitest
pnpm run build          # full build
pnpm run verify         # MASTER GATE: env + check + lint + source-lint + hooks-lint + route-validate + tests + build
pnpm run validate:routes  # confirm registered routes match handler files
pnpm run lint:hooks       # catch useState used after early-return
```

### Statenour (`apps/statenour/`)

```bash
cd [REPO_ROOT]/apps/statenour

pnpm typecheck          # tsc --noEmit — must be 0
pnpm lint               # eslint — ~359 `any` warnings are pre-existing/non-blocking; errors fail
pnpm test               # vitest — read the SUMMARY LINE, not $? (unhandled-rejection noise)
pnpm verify:hard        # MASTER GATE: typecheck · lint · test · raw-SQL · crons · prompt-size · prisma validate
```

### Monorepo Root

```bash
cd [REPO_ROOT]

pnpm build:affected     # turbo affected builds
pnpm test:affected      # turbo affected tests
pnpm verify:affected    # check + lint + test affected
```

### Pre-Push Hook (Automatic)

`.husky/pre-push` → `turbo run build --filter=...[upstream]` — runs for affected apps before every push.
A Next.js prerender error in statenour or a build failure in nickstire will block the push.
**Windows pre-push symlink warnings ("IO error: provided value is too long") = non-fatal noise. Build still passes.**

---

## 6. How to Verify Without Claiming Done

Run the gate commands above. Then state **exactly**:

```
Verification:
- pnpm typecheck → 0 errors
- pnpm test → 3007 tests, 211 files, all pass (read summary line)
- pnpm verify:hard → clean
- turbo build → green
```

Never claim "it should work" or "it probably passes." Run it. Report the output.

---

## 7. Env-Gated Failures — How to Classify

If a test or runtime failure is caused by a missing env var, say so explicitly:

> "This fails because `STATENOUR_SYNC_KEY` is not set — this is operator-side. Code is correct."

Do NOT claim the feature is broken when it's env-gated. The distinction matters.

---

## 8. No-Secrets Rules

- Never commit secrets (env files, tokens, API keys, passwords)
- `.env.example` is the contract reference — use it to understand what vars are needed
- If a new required var is needed, add it to `scripts/env-validate.mjs` + `.env.example`
- When referencing Railway env vars, list what's needed — don't read or log their values

---

## 9. No Broad Refactor Rules

- No wide refactors without explicit operator approval
- "Preserve existing work" means: don't rewrite what Claude built — extend or fix surgically
- Before deleting anything, run an import-graph scan — orphan detection has false positives
- Read the file before editing it. Read the calling code before changing the API.

---

## 10. Preserving Claude Work

This codebase has extensive AI-built layers. Before modifying any feature:

1. Read the relevant `AGENTS.md` / `CLAUDE.md` for the app — it documents what shipped
2. Check `docs/RECONCILIATION.md` (statenour) or `truth_os.md` (nickstire) for the latest wave
3. If a file looks "dead," search its base name across the whole codebase before deleting
4. Never rewrite a working system without a clearly-documented reason and rollback path

---

## 11. Multi-Agent Mode Safety

When multiple agents are running concurrently:

1. **Scope isolation:** Each agent owns one app (`apps/nickstire` OR `apps/statenour`) — never both
2. **No shared mutable state:** Don't write to `docs/RECONCILIATION.md` mid-flight from two agents
3. **Git serialization:** One agent pushes at a time via `push-main.sh`; the other rebases
4. **Memory conflicts:** Root `CLAUDE.md` warns that cross-session memory files are concurrently
   edited — re-read before editing
5. **Test isolation:** Never run both apps' test suites simultaneously (OOM risk on this machine)

---

## 12. How to Report Final Status

At end of every session, your report must include:

```markdown
## Session Report

### What I Shipped
- Commit SHA: `<hash>` — <summary>
- Files changed: <list exact paths>
- Tests: <command> → <result>
- Build: <green/fail + detail>

### What I Did NOT Do
- <list deferred items and why>

### What Needs Operator Action
- <list operator-gated items (creds, Railway env, DNS, etc.)>

### Verification Proof
- pnpm typecheck → 0 errors
- pnpm test → N tests, all pass
- turbo build → green
- push-main.sh → success / attempt N
```

---

## 13. Context Loading Order (Read These, In This Order)

**For nickstire work:**
1. This file
2. `apps/nickstire/CLAUDE.md` (primary context + MASTER OPERATING DIRECTIVE)
3. `apps/nickstire/.remember/remember.md` (last-session handoff)
4. `apps/nickstire/truth_os.md` (what's live in prod)
5. `apps/nickstire/docs/AGENT-CONTEXT.md` (quick context for Antigravity)

**For statenour work:**
1. This file
2. `apps/statenour/AGENTS.md` (primary context)
3. `apps/statenour/docs/CURRENT-TRUTH.md` (one-screen reality check)
4. `apps/statenour/docs/RECONCILIATION.md` (top entry = latest wave)
5. `apps/statenour/.remember/now.md` (session buffer)
6. `apps/statenour/docs/AGENT-CONTEXT.md` (quick context for Antigravity)

**Cross-cutting:**
- Root `CLAUDE.md` — always-must-know gotchas
- `docs/ANTIGRAVITY-PROFILE.md` — Antigravity Operating Profile
- `docs/ANTIGRAVITY-RULES.md` — Antigravity-specific rules and constraints
- `docs/MIGRATION_PLAN.md` — cross-app migration context
- `TASKS.md` — active task log

---

## 14. Anti-Patterns to Call Out Immediately

Call these out to Nour when you see them:

- Overthinking / planning as procrastination
- Novelty-chasing / shiny object syndrome
- Intensity over consistency (vs. systems)
- Ego-driven decisions
- Unnecessary complexity added to working code
- Avoidance of the hard next action
- Dopamine-seeking disguised as strategy

---

*This file is a living document. Update after major work waves. Last updated: 2026-06-10.*

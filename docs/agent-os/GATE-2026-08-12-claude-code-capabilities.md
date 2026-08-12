# GATE — Claude Code capabilities report (2026-08-12)

**Input:** a pasted external research report, "Claude Code Capabilities Verification (August 2026):
Building a Single-Shot Autonomous Execution Prompt", recommending an interactive auto-mode session +
file-based guardrails for a NOUR OS redesign run.

**Verdict: the report is factually excellent — 0 of ~20 checkable claims refuted, every
decision-critical claim confirmed verbatim against live docs — but its Stage-1 configuration is
~70% incumbent-or-rejected in this repo.** The genuinely new pieces shipped with this gate: six
narrow `permissions.deny` lines (defense-in-depth for auto mode), the launch-prompt template below,
and the Aug-14 operational heads-up.

## Claim scorecard (checked 2026-08-12)

Source: https://code.claude.com/docs/en/permission-modes · /docs/en/permissions ·
anthropics/claude-code `CHANGELOG.md` + `.claude/commands/commit-push-pr.md` (raw), plus this
machine and this very session as live evidence.

| Claim | Verdict | Receipt |
|---|---|---|
| Six permission modes: default/"Manual" (v2.1.200+), acceptEdits, plan, auto, dontAsk, bypassPermissions | **CONFIRMED** | permissions page mode table, verbatim; CHANGELOG v2.1.200 "Changed the 'default' permission mode to 'Manual'" |
| Auto mode classifier sentence ("A separate classifier model reviews actions…hostile content Claude read") | **CONFIRMED** (verbatim) | permission-modes page |
| Auto default for new sessions on Pro/Max/Team **starting 2026-08-14** | **CONFIRMED** (verbatim) | permission-modes page Note + blog link. Nuance the report omitted: a self-set default stays unless you accept a one-time switch prompt; org-managed defaults unchanged |
| Auto mode allows pushing to any branch incl. default; before v2.1.203 default-branch pushes were blocked; force-push / `reset --hard` / `checkout -- .` / `clean -fd` / secrets / prod deploys / `curl\|bash` blocked | **CONFIRMED** (incl. both version pins; v2.1.211 loosening also documented) | "Allowed by default" + "Blocked by default" lists |
| Conversation boundaries re-read from transcript, lost on compaction; "For a hard guarantee, add a deny rule instead" | **CONFIRMED** (verbatim) | "Boundaries you state in conversation" section |
| Pause threshold "3 times in a row or 20 times total" | **CONFIRMED** (verbatim; thresholds not configurable) | "When auto mode falls back" |
| Headless `-p` blocked-action behavior: action skipped, Claude keeps working | **CONFIRMED** | same section. NOTE: a subagent pass first "refuted" `--permission-prompt-tool` — wrong; the flag is linked from this very page. Absence-in-one-page is not refutation |
| Skills: `.claude/skills/`, commands merged, nested lazy-load, ~25k/5k post-compaction re-attach budget, bundled `/verify` `/run` | **CONFIRMED** | skills docs; `/verify` and `/run` are live in this session's skill list |
| `commit-push-pr` command 5 steps + allowed-tools | **CONFIRMED** (verbatim) | raw `.claude/commands/commit-push-pr.md`; the `commit-commands` plugin is enabled on this machine |
| Structured Task tools default (v2.1.142), Agent-tool rename (v2.1.63), `--worktree` (v2.1.49), attribution setting, `/goal`, issue #51429 | **UNVERIFIED version pins** — but TaskCreate/TaskUpdate/TaskGet/TaskList, the Agent tool, and harness worktrees are all live in this session, so the features themselves are real | this session's tool list; this file was written from `.claude/worktrees/code-capabilities-verify-acdd4b` |

Bonus facts the report missed, worth knowing here:

- **Deny rules apply in every mode, including `bypassPermissions`** — and "Hook decisions don't
  bypass permission rules." Deny rules and hooks are independent layers; both fire.
- **On entering auto mode, broad allow rules that grant arbitrary code execution are dropped**
  (e.g. the user-global `Bash(git push *)`, `Bash(pnpm run *)`). Narrow rules like
  `Bash(npm test)` carry over. So a fat allowlist does not bypass the classifier.
- The classifier sees user messages, tool calls, and CLAUDE.md — **tool results are stripped**,
  with a separate server-side probe scanning them. Auto mode v2.1.205+ also blocks writes to
  `~/.claude/projects/**` transcripts, and v2.1.203+ blocks sensitive-store content entering
  commits/pushes.
- `claude auto-mode defaults` prints the full rule lists as JSON.

## Incumbency map (report recommendation → this repo)

| Report Stage-1 item | Verdict | Receipt |
|---|---|---|
| `CLAUDE.md` with commands + git rules | **NATIVE** | `AGENTS.md` (canonical) + adapters, parity-checked by `pnpm agent:verify` |
| Hard "never push main" guarantee | **NATIVE + thin ADOPT** | `config/agent-os/policy.json` `push-to-main` / `push-implicit-dest` / `force-push` (red-teamed, canary-tested, all spellings incl. `-C`/`-c`/`HEAD:main`) is STRONGER than any settings glob — a naive `Bash(git * main)` deny would false-positive `git merge main` and branch names like `chore/main.ts-refactor` (a policy allowExample). Adopted the thin delta only: six exact-spelling deny lines in `.claude/settings.json`, because deny rules hold in every mode even if a hook crashes/times out (hooks fail open by design) |
| PostToolUse hook: typecheck/lint on every edit | **REJECT** | Shared machine (memory: no baseline sweeps; sibling sessions), Windows vitest serialization, and lefthook pre-commit already gates staged globs. A per-edit turbo run thrashes the box |
| Stop hook blocking until checks green | **REJECT (deliberately)** | `scripts/agent-os/stop-check.mjs` docstring: evidence gates are deliberately NOT in the Stop hook — "a Stop hook that blocks routine turns trains the operator to disable it." One narrow invariant only (dirty tree on `main`). The report re-proposes what this repo already considered and rejected in writing |
| `.mcp.json` + `enableAllProjectMcpServers: true` | **N/A here** | Connectors are user/desktop-scoped (they load in every session already). Auto-trusting project-scope servers also cuts against treating tool output as data |
| Strip commit attribution | **REJECT** | AGENTS.md **requires** the Co-Authored-By trailer |
| `gh` CLI installed + authed | **DONE** | gh 2.89.0, logged in as nourdean22 (verified this session) |
| Interactive auto mode, not `bypassPermissions`, not headless `-p` | **ADOPT** | Matches docs guidance; this repo's enforcement is file-based so it survives compaction and mode changes either way |

## Operational notes (this machine, 2026-08-12)

- **Aug 14:** new sessions on Pro/Max/Team default to auto mode. This repo is ready — enforcement
  is hooks + policy.json + deny rules, none of it conversation-state.
- **UPDATED same day (operator-instructed):** the npm-global CLI was 2.1.150 with its shims
  missing; it is now **2.1.228**, shims restored at `%APPDATA%\npm` (that directory was on PATH
  all along), and terminal `claude --version` answers `2.1.228 (Claude Code)`. Every version gate
  in the scorecard is satisfied locally. Mechanics note: installing the CLI globally from a
  session shell false-positives the cwd-scoped `install-in-junctioned-worktree` rule, because the
  harness pins the shell cwd to the worktree and the hook matches command text. The sanctioned
  path is a process with a non-worktree cwd (e.g. the Desktop Commander runner), not a rule edit.

## The single-shot launch prompt (the genuinely-new deliverable)

Paste as the first message of a fresh session in this repo (auto mode). Repo policy
(AGENTS.md, hooks, skills) loads automatically — the prompt only adds the per-run contract:

```text
Mission: <ONE sentence — the outcome, not the steps>.

Before any edit:
1. GATE (plan-gate skill): read apps/statenour/AGENTS.md, docs/CURRENT-TRUTH.md and the memory
   index; list what ALREADY EXISTS for this mission with receipts (file:line / PR#). Report the
   built/new/refuted split. If it comes back mostly incumbent, stop and report instead of building.
2. Create a structured task list covering every workstream; record the verify baseline
   (typecheck/lint/test exit codes) BEFORE the first edit.

Rules of engagement:
- Scope: ONLY <apps/statenour/** + named paths>. Anything else: flag, don't fix.
- Branch statenour/<slug>; atomic commits, explicit paths (never -A); Co-Authored-By per AGENTS.md.
- Protected operations (AGENTS.md list), schema changes, and anything customer-facing: propose,
  never execute. Invoke statenour-migration if prisma/** is touched.
- Skills: statenour-verify before commit/push; frontend-design lens + nickstire-ios-pwa-primitives
  for any new UI (standalone iOS PWA: no window.confirm/alert, 48px touch targets).

Definition of done:
- From apps/statenour: pnpm typecheck · pnpm lint · targeted tests · pnpm verify:hard — report
  receipts (counts + exit codes) as DELTAS vs the baseline; fix only regressions you introduced.
- ONE PR via gh (clear the dummy GITHUB_TOKEN first), self-merged per AGENTS.md; sync local main
  with fetch + --ff-only.
- Final report: branch · SHA · files · checks with receipts · PR link · what remains UNVERIFIED
  (e.g. visual pass owed — local dev hits prod's OAuth wall).

Do not stop to ask between steps. If the same action is blocked 3×, read the denial text — the
hook names the sanctioned alternative — rather than retrying the spelling.
```

Why so short: the report's prompt architecture was written for a bare repo. Here, its "git
discipline", "use skills", and "verification" sections are ambient policy injected every session;
restating them verbatim only adds compaction weight. What a prompt must still carry per-run:
mission, scope fence, baseline-then-deltas, the one-PR contract, and the incumbency gate.

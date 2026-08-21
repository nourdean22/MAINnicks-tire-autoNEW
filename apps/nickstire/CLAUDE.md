# Nick's Tire & Auto · Claude adapter

@AGENTS.md

That import is the app policy — stack, layout, commands, branching, test hygiene, conventions and
gotchas are already in context; don't re-read the file. It routes you on to `truth_os.md`,
`PROTECTED-CORE.md`, and the on-demand operator persona. Cross-cutting repo rules are also already
loaded (root `CLAUDE.md` imports root [`AGENTS.md`](../../AGENTS.md)). This file adds only what is
Claude-specific: which skill a change arms, and which doc a question opens.

<!--
  Keep `@AGENTS.md` on its own line. A markdown link satisfies a substring check but loads NOTHING:
  before the 2026-08-21 audit this adapter LINKED its AGENTS.md, so 227 lines / ~2,915 tokens of
  nickstire policy auto-loaded in ZERO sessions. Same defect class as root CLAUDE.md before #1767.
  The import is only affordable because AGENTS.md was compressed to ~2,045 tokens in the same pass —
  compress first, then import, never the reverse.
-->


<!--
  Editor notes — stripped before this file reaches the model, so they are free to keep.
  Deleted 2026-08-21 and why (facts preserved, not dropped):
  · Stack / repo-slug / deploy lines: triple-duplicated by root AGENTS.md "Repo topology" and
    "Commands" (always loaded), apps/nickstire/AGENTS.md section 1 (read first per line 3), and
    package.json, which pins node>=24 and pnpm@10 machine-readably. Prose could only drift.
  · Operator-persona section: duplicated verbatim by apps/nickstire/AGENTS.md line 4 — same path,
    same trigger, same exclusion. The relocation is CI-enforced (check-adapters.mjs asserts the
    block lives in apps/nickstire/docs/OPERATOR-DIRECTIVE.md and is absent from this file), so a
    prose reminder buys nothing. Repo-wide persona pointer already sits in root CLAUDE.md.
  · MEMORY.md / architecture_map.md / RECOVERY.md tombstone: superseded, moved to
    docs/_archive/root_reports/ in PR #645. Nothing in the repo points at those paths any more,
    so there is no wrong turn left to prevent. Root AGENTS.md > "Retired — do not look for
    these" is the right home if a tombstone is ever wanted again.
  · Repo-wide skills (harness-worktree-setup, nickstire-shared-main-push, plan-gate,
    session-observer, source-to-skill) stay routed from root CLAUDE.md only. Do not mirror them
    here — a second copy is how an adapter forks into a second policy.
  · Ship history belongs in truth_os.md + the memory index. Never in this adapter.
-->

## Skill triggers (`.claude/skills/`, repo root)

Each bullet names the file pattern that arms it. Fire on the trigger, not on a vibe.

- **New `drizzle/*.sql`, or a column / enum / index / width change in `drizzle/schema.ts` →
  `nickstire-tidb-ddl`.** This skill is the *only* guard: probed 2026-08-21, the PreToolUse hook
  allows both the `schema.ts` edit and the migration-file write (exit 0 each), and migrations are
  hand-applied with no auto-migrate. TiDB runs `STRICT_TRANS_TABLES` — an over-width or
  out-of-enum write is **rejected and the row is lost**, worst inside a failure handler recording
  `status = 'failed_<reason>'`, which leaves the job silently unchanged.
- **Before any commit or push out of `apps/nickstire/` → `nickstire-verify`.** `pnpm run verify` is
  the master gate and its test step is now genuinely serial: `vitest.config.ts` sets `pool: "forks"`
  + `poolOptions.forks.singleFork: true` (fixed 2026-08-21 — it had only a *comment* about
  singleFork since #515, so the gate ran parallel for months). Do not hand-pass pool flags; they are
  redundant. The traps that remain are the brand-voice false positives and the prerender regen rule
  — that is what the skill is for.
- **Any script that opens a database connection → `prod-db-guard`.** `scripts/worktree-setup.ps1`
  copies the PRODUCTION `DATABASE_URL` into every worktree; there is no local DB, and `--dry-run`
  is not a guard until a non-executing check proves it returns before the write.
- **A confirm / alert / text-capture dialog in `client/src/` → `nickstire-ios-pwa-primitives`.**
  `window.confirm/alert/prompt` are silently suppressed in iOS standalone — the operator's actual
  device. Two-tap in-DOM confirms, 48x48px minimum targets.
- **Reel work splits in two.** Producing content (ideate / pack / draft) →
  `nickstire-reel-operator`. Changing `server/services/reel*` or the reel cron →
  `nickstire-verifier-reel-pipeline` FIRST — it records the live-publish endpoint and the
  prod-TiDB binding that make "just run it locally" a customer-facing side effect.

## App docs — open on the trigger, not all at once

| When | Read |
|---|---|
| Claiming what production does, or shipping a change to it | `truth_os.md` · `docs/CURRENT-TRUTH.md` — both **rank 4** in the root source-of-truth hierarchy |
| Touching auth, VAPI, consent/quiet-hours, invoices, migrations, prerender, or the statenour bridge | `PROTECTED-CORE.md` (26 lines) — no-touch surfaces + 10 hard rules, incl. never weaken an auth or signature check to unblock a test |
| Wiring or debugging a third-party call | `docs/integrations/INTEGRATION_REGISTRY.md` (38 lines) — per integration: required secrets, flag/trigger, owner, fallback, risk-if-down |
| Changing anything whose breakage costs revenue or uptime | `docs/operations/LOAD_BEARING_SYSTEMS.md` (32 lines) — protected surfaces, plus the impact statement / validation / rollback / owner ack a PR must carry |
| Re-checking an old ROS-### finding | `docs/ISSUE-REGISTRY.md` — **rank 7**, "dated, frequently superseded", *below* tests. Re-verify against prod before acting on a row. |

`docs/REVENUE-OPS-ROADMAP.md` and `docs/REVENUE-OPS-WAVE2.md` are Wave-1/2 sequencing notes,
unchanged since 2026-07-11 — history, never current truth.

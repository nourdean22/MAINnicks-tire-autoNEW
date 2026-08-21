# statenour-os · Claude adapter

@AGENTS.md

That import is the app policy — stack, canonical sources and gotchas are already in context; its §3
table routes on to `docs/CURRENT-TRUTH.md`, `docs/runbooks/index.md` and `docs/RECONCILIATION.md`.
Cross-cutting rules are also loaded (root `CLAUDE.md` imports root
[`AGENTS.md`](../../AGENTS.md)). This file adds only what is Claude-specific.

<!--
  Keep `@AGENTS.md` on its own line. A markdown link satisfies a substring check but loads NOTHING:
  before the 2026-08-21 audit this adapter LINKED its AGENTS.md, so the app's policy auto-loaded in
  ZERO sessions. Same defect class as root CLAUDE.md before #1767. The import is only affordable
  because AGENTS.md was compressed in the same pass — compress first, then import, never the reverse.
-->


<!--
  Editor notes — stripped before this file reaches the model, so they are free to keep.
  Rewritten 2026-08-21. What changed and why:
  · The four previous bullets restated routes that root CLAUDE.md already carries in an
    always-loaded file (statenour-verify / statenour-migration / statenour-wave-reconcile /
    nickstire-ios-pwa-primitives), and their parenthetical details duplicated root AGENTS.md
    > Protected operations ("hand-applied; one wrong flag silently drops pgvector") and
    apps/statenour/AGENTS.md line 5 ("ship history is canonical in RECONCILIATION"). Every fact
    is preserved below; what was removed is the second copy of the ROUTE. The replacement gives
    each skill a concrete file-path trigger, which is the one thing an app adapter can add that
    a repo-wide list cannot.
  · Repo-wide skills (harness-worktree-setup, prod-db-guard, plan-gate, nickstire-shared-main-push,
    session-observer, source-to-skill) stay routed from root CLAUDE.md only. Do not mirror them
    here — a second copy is how an adapter forks into a second policy.
  · Ship history belongs in docs/RECONCILIATION.md. Never in this adapter, never in the AGENTS.md
    header.
-->

## Claude-only enforcement — state it accurately

**Destructive Prisma flags are hard-blocked in your session.** `.claude/settings.json` runs
`scripts/agent-os/pretool.mjs` on every `Bash|PowerShell|Write|Edit|NotebookEdit`, and the
`destructive-prisma` rule in `config/agent-os/policy.json` denies the data-loss flag, the
force-reset flag, and `prisma migrate reset` with exit 2 (probed live 2026-08-21). There is no
bypass flag; if a rule is genuinely wrong, change it in a PR where the diff is reviewable.

**The asymmetry is the point, and it cuts both ways.** The hook is Claude-only — Codex, Cursor and
Copilot never see it (`pretool.mjs` header comment). So an `AGENTS.md` sentence saying no
automated gate scans for that flag is *true for them and false for you*: do not "fix" it into a
claim that the repository is gated. Equally, do not read the block as broader than it is — it
matches command text, so the same destruction run as raw SQL through another client is not
covered, and `Write`/`Edit` of a migration file is allowed on purpose.

## Skill triggers (`.claude/skills/`, repo root)

Each bullet names the file pattern that arms it. Fire on the trigger, not on a vibe.

- **Editing `prisma/schema.prisma`, or adding a file under `prisma/migrations/` or
  `prisma/migrations-pending/` → `statenour-migration`.** Migrations here are hand-applied, and
  pgvector / tsvector columns are `Unsupported(...)` to Prisma — one wrong flag silently drops
  them, and the HNSW index is raw-SQL only.
- **Before any commit or push out of `apps/statenour/` → `statenour-verify`.** `pnpm verify:hard`
  is the full gate, but prove the instrument sees the target before trusting a green:
  `tsconfig.json` excludes **both `tests` and `scripts`**, so `tsc --noEmit` has never read
  either; and `@statenour/lenses` must be built first
  (`turbo build --filter=@statenour/lenses`) or ~5 strategic-frameworks files fail on import
  rather than on their own merits. Never export real API keys or a prod `DATABASE_URL` into the
  test shell — provider-chain tests reorder and the empty-DB smoke sees real data.
- **Before editing the `Last refreshed:` stamp at the top of [`AGENTS.md`](./AGENTS.md) →
  `statenour-wave-reconcile`.** Keep it to ONE line: one date, one PR pair, one pointer. It grew to
  6,650 bytes on a single line once (~1,662 tokens of ship history loaded into every session, in
  violation of the no-grow rule printed beside it) and was cut back on 2026-08-21. The full wave
  entry goes to the top of `docs/RECONCILIATION.md`, never here.
- **A confirm, alert, or text-capture dialog in `app/` or `components/` →
  `nickstire-ios-pwa-primitives`.** The skill is named for the sibling app but governs this one
  too: statenour is also a standalone iOS PWA, where `window.confirm/alert/prompt` return
  silently. Two-tap in-DOM confirms, 48x48px minimum targets.

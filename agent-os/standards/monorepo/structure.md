> **Canonical source:** [AGENTS.md § Repo topology](../../../AGENTS.md)
> This file is a **cached copy for context injection**. If it disagrees with
> the canonical source, **AGENTS.md wins** — re-run `/discover-standards` to refresh.

# Monorepo Structure & Conventions

## Layout

- `apps/*` — deployable applications
- `packages/*` — shared libraries, consumed via `workspace:*`
- Each app owns its `AGENTS.md`. **Read the nearest one before editing inside it.**

## Package rules

- Internal packages: `workspace:*`, never a version range.
- Shared external versions live in the root `catalog:`.
- **No cross-app imports.** Shared code goes to `packages/*`.
- Changes to `packages/**` or the lockfile hit **every** consuming app — build
  the package before testing consumers, and verify blast radius.

## Commands (from repo root)

| Task | Command |
|---|---|
| Build what changed (push gate) | `pnpm build:affected` |
| CI-equivalent sweep | `pnpm ci:affected` |
| Filter one package | `pnpm --filter <name> <script>` |
| Build one | `turbo run build --filter=<name>` |

## Scoping discipline

- **Don't run full-repo sweeps "for a baseline"** — sibling sessions may share
  the machine. Verify your change's blast radius and let CI be the sweep.
- Use `--affected` during iteration.
- Turbo caching is real: if output looks stale, suspect `inputs`/`outputs` in
  `turbo.json` before blaming the code.

## Definition of done

- Affected `check lint test build` green, receipt captured.
- No new version drift (`sherif` clean).
- Changes scoped to the intended package(s).

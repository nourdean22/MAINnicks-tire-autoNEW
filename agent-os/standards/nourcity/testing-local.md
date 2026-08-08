> **Canonical source:** [AGENTS.md § Commands](../../../AGENTS.md)
> This file is a **cached copy for context injection**. If it disagrees with
> the canonical source, **AGENTS.md wins** — re-run `/discover-standards` to refresh.

# Running Tests in NOURCITY

Per-app invocation differs. Getting this wrong produces false failures.

## nickstire — serial is mandatory

```bash
pnpm exec vitest run path/to/file.test.ts --pool=forks --poolOptions.forks.singleFork=true
```

Serial is required on Windows and shares **one process across files**. That
makes test hygiene non-optional: unmock, unstub, and restore-or-delete env vars
in `afterEach` (see `apps/nickstire/AGENTS.md` §3). The full suite MUST be serial.

## statenour

```bash
pnpm exec vitest run path/to/file.test.ts
```

- **Build lenses first** or strategic-frameworks imports fail:
  ```bash
  turbo build --filter=@statenour/lenses
  ```
- Do **not** export real API keys or a prod `DATABASE_URL` into the test shell —
  provider-chain tests reorder, and the empty-DB smoke test will see real data.
- Piping vitest to `tail` masks the exit code. Read the summary line.

## worker

No test suite. Gate is `pnpm check` + `pnpm build`.

## Scoping

Don't run full-repo sweeps "for a baseline" — sibling sessions share this
machine. Verify your change's blast radius; let CI be the sweep.

## Reporting

Receipts, always: `417 files, 4,670 passed, exit 0`. Never "tests pass".
If a check was skipped, say so.

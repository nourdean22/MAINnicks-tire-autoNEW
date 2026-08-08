> **Canonical source:** [AGENTS.md § Source-of-truth hierarchy](../../../AGENTS.md)
> This file is a **cached copy for context injection**. If it disagrees with
> the canonical source, **AGENTS.md wins** — re-run `/discover-standards` to refresh.

# Best Practices

Universal engineering doctrine. Stack-agnostic. Every project inherits this.

## Source-of-truth hierarchy

When sources disagree, believe them in this order. Agent memory never outranks
the repository; the repository never outranks production.

1. Production evidence (logs, health endpoints, live rows)
2. Current source code in the checkout you are editing
3. Current schema + migrations
4. Current-truth docs
5. Policy files (`AGENTS.md` and per-app equivalents)
6. Tests — they encode intent, and can be green while wrong
7. Historical audits / reconciliation reports — dated, often superseded
8. Agent memory + handoff notes — verify before acting
9. Model assumptions — lowest. State them as assumptions.

## Non-negotiables

- **Verify before you claim done.** Report with receipts
  (`417 files, 4,670 passed, exit 0`) — never the words "tests pass" alone.
  If a check was skipped, say so.
- **Answer-first output.** Lead with the result in the first sentence. Number
  every procedure. The reader is often on a phone while something is broken.
  Readability outranks brevity: cut whole items, never compress into fragments.
- **Smallest diff that solves it.** No drive-by refactors, no reformatting
  unrelated code, no speculative abstraction.
- **Reversibility.** Prefer changes that are easy to roll back.

## Decision-making

- Pick the strongest correct move, not the safest-sounding one. Say why in one line.
- Name the risk or dependency being ignored, not just the happy path.
- Do not conflate motion with progress.
- Check the upstream-adoption record before proposing a new platform, library,
  or service. A prior verdict is an answer, not a starting point.

## Code quality

- Make the change easy, then make the easy change. Understand before editing.
- Fail loud, fail early. Validate at boundaries; never swallow errors.
- No secrets in code or logs. Read config from env.
- Delete dead code instead of commenting it out. Git is the history.
- Comments explain *why*, not *what*.

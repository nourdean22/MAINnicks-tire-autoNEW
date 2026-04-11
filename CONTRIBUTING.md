# Contributing Guide

This repository is operated as production software, not a sandbox. Contributions should prioritize correctness, safety, and operational clarity.

---

## 1) Contribution intent

Every PR should answer:

- what problem is being solved
- why the change is needed now
- what business/system risks are introduced
- how correctness was validated

---

## 2) Branch and commit expectations

- branch from `main`
- keep PRs focused and scoped
- use clear, imperative commit messages
- avoid mixed-purpose commits (refactor + feature + docs in one commit)

---

## 3) Required local checks

Run this before opening a PR:

```bash
pnpm verify
```

If verify fails, include failure context and rationale in PR notes.

At minimum, ensure you executed and reviewed:

- `pnpm env:validate`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

---

## 4) Documentation parity rule

If runtime behavior changes, update corresponding docs in the same PR:

- `README.md` for command/runtime/deploy changes
- `.env.example` for env contract changes
- runbooks/templates when process expectations change

No behavior changes should merge with stale operator documentation.

---

## 5) High-risk change policy

Changes in these areas require elevated review and explicit validation notes:

- auth/admin access
- payments/Stripe
- Twilio/SMS/notifications
- cron/background jobs
- integration bridge/sync
- webhook verification logic
- DB schema and migrations

For high-risk changes, include:

1. impact analysis
2. rollback path
3. proof of validation

---

## 6) Test guidance

- add or update tests for changed behavior where practical
- avoid brittle tests tied to unrelated external services
- mock external dependencies when possible
- if a known flaky test exists, document it and open follow-up

---

## 7) Environment and secrets policy

- never commit secrets
- use `.env.example` as contract reference
- for new required vars, update `scripts/env-validate.mjs`
- annotate fallback behavior for optional integrations

---

## 8) Pull request quality bar

A PR is merge-ready when:

- scope is coherent
- checks are green (or documented known exceptions)
- docs are in sync
- risk/rollback is clearly communicated
- reviewer can reproduce validation steps

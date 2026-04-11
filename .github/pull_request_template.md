## 1) Summary

- What changed?
- Why this change is necessary now?
- Which system boundaries are affected?

## 2) Scope

- [ ] Customer-facing runtime (`client/`)
- [ ] Server/control runtime (`server/`)
- [ ] DB schema/migrations (`drizzle/`)
- [ ] CI/workflows (`.github/workflows/`)
- [ ] Environment contract (`.env.example` / validator)
- [ ] Docs/governance only

## 3) Validation (required)

- [ ] `pnpm env:validate`
- [ ] `pnpm check`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`

Paste notable output or links to CI runs.

## 4) Risk review

- [ ] Touches load-bearing systems (auth/payments/integrations/cron/webhooks)
- [ ] Includes migration change
- [ ] Includes external integration change
- [ ] Includes auth/permission logic change

If any checked, include explicit impact analysis below.

## 5) Rollback plan

- How to revert quickly if this causes issues?
- Any data migration rollback caveats?

## 6) Documentation updates

- [ ] README updated (if runtime/commands changed)
- [ ] `.env.example` updated (if env contract changed)
- [ ] Other runbook/docs updated

## 7) Follow-ups

List deferred tasks, known limitations, or cleanup tickets.

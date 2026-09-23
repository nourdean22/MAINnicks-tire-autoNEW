# Cloud environment — ready to go

A Claude Code **cloud session** starts from a clean container. A local session on the
operator's machine does not, and every difference is invisible until a command fails
halfway through a task — at which point the failure reads like a bug in the work rather
than a missing capability in the environment.

Everything below is committed to the repo on purpose: cloud sessions get a repo's
configuration by it being **in the repo**.

## Ready to go, in two fields

Settings → **Cloud environments** → the environment used for this repo:

**1. Setup script**

```
bash scripts/cloud-setup.sh
```

Idempotent, runs on every container start. It installs pnpm at the pinned version and
the Railway CLI, runs `pnpm install --frozen-lockfile`, then prints a readiness report.
It installs **tooling only** and never writes a secret.

**2. Environment variables** (`.env` format)

```
RAILWAY_TOKEN=<a project token for "natural-appreciation" production>
GH_TOKEN=<a GitHub token with repo scope>
```

That is the whole list. One Railway token unlocks **both** databases — see below.

> Anyone who can use a shared cloud environment can read its variables and its setup
> script. On a personal environment that is just the operator; on a shared one, treat
> every value in that field as visible to the whole team.

Then, in any cloud session:

```
node scripts/cloud-doctor.mjs          # what is present, missing, or undetermined
node scripts/cloud-doctor.mjs --deep   # also confirm each database is reachable
```

## The two databases reach through one door

Neither app keeps a `.env` in a cloud container, and neither should. Both reach their
database the same way — `railway run -s <service>` injects that service's variables into
one subprocess and leaves nothing on disk:

| app | service | engine | client |
|---|---|---|---|
| nickstire | `MAINnicks-tire-auto` | TiDB Cloud (MySQL) | `mysql2` |
| statenour | `statenour-web` | Neon (Postgres) | Prisma / `pg` |

```
railway run -s MAINnicks-tire-auto -- node scripts/diagnostics/<probe>.mjs
railway run -s statenour-web       -- pnpm exec tsx scripts/<script>.ts
```

Verified 2026-09-23 with `cloud-doctor --deep`: `DATABASE_URL` injects for both, naming
`gateway01.us-east-1.prod.aws.tidbcloud.com` and
`ep-quiet-wave-am320eo1-pooler.c-5.us-east-1.aws.neon.tech`. So **one** project-scoped
Railway token covers TiDB and Neon together, and no token covers neither.

### Which Railway token, and what it grants

| variable | scope | use |
|---|---|---|
| `RAILWAY_TOKEN` | one project + environment | **prefer this** — least privilege |
| `RAILWAY_API_TOKEN` | the whole account/workspace | every project, every service |

**Know what either grants before setting it.** `railway run` injects the service's
*entire* variable set. For `MAINnicks-tire-auto` that includes the production
`DATABASE_URL`, `STRIPE_SECRET_KEY`, the Twilio and VAPI credentials,
`SHOP_SMS_GATEWAY_PASSWORD` and `ADMIN_API_KEY`. A container holding that token can read
production data and reach the customer-contact rails. That is not a reason to refuse it —
it is the reason to scope it to a project rather than an account.

The local machine authenticates by **browser OAuth**
(`~/.railway/config.json` holds an access/refresh pair, `user.token` is null). A
container cannot open a browser, which is why a token is the only route.

### Before any write

Read [prod-db-guard](../.claude/skills/prod-db-guard/SKILL.md). In a container there is
no local database, so a script run "just to see what it does" runs against production —
one such run deleted 870 rows. `--dry-run` is not a guard until a non-executing read
proves it returns before the write.

`.env` writes are blocked at the tool call by `config/agent-os/policy.json` →
`secret-file-write`, and a committed token would be caught by the staged-secret scan and
`gitleaks` — but only after it existed.

## What the doctor reports

Three states, never two — the same empty-vs-error discipline the app's own reads use:

- `OK` — present and verified by invoking it
- `MISSING` — verified absent, with the fix on the next line
- `UNKNOWN` — the probe itself failed; **not** folded into `MISSING`, because sending
  someone to re-create a token that already exists and is merely unreachable wastes the
  same hour twice

`--deep` is off by default: it spends a Railway API call per service, and a burst of
those rate-limits the CLI account-wide for about twenty minutes.

## What a cloud container still cannot do

- **Interactive git** — `git rebase -i`, `git add -i` are unsupported.
- **The Windows-only helpers** — `scripts/worktree-setup.ps1`, `worktree-teardown.ps1`
  and `security-scan.ps1` assume PowerShell and NTFS junctions.
- **A junctioned worktree's rules do not apply.** A container is a real checkout, so
  `pnpm install` is correct there — the opposite of the rule on the operator's box, where
  an install offers to wipe the shared `node_modules` every worktree points at.

## Related

- Root [`AGENTS.md`](../AGENTS.md) — branching, protected operations, the enforcement map.
- [`docs/agent-os/README.md`](agent-os/README.md) — the PreToolUse policy.

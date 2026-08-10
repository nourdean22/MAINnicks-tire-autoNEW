# ROS-011 / ROS-012 — history exposure, sized

**Status:** inventory COMPLETE (2026-08-10) · rotation OUTSTANDING (operator)

ROS-011 and ROS-012 have carried *"repository history contains previously removed
sensitive records"* as **accepted risk since 2026-07-11** — accepted, but never
sized. The blocking phrase in both rows is "inventory and rotate affected
material". This file is the inventory half. **The rotation half is operator work
and cannot be delegated to an agent** — it means authenticating to provider
dashboards and issuing new credentials.

No secret VALUE appears in this file, and none was read into any durable
artifact. Only key names were extracted.

## What is exposed

One file: **`apps/statenour/vars.json`** — a 108-key environment dump, UTF-16
encoded (which is also why a naive scan misses it).

| | |
|---|---|
| First committed | `ba228fbca` · 2026-07-09 · #636 *"security(statenour): fix dead surface vulnerabilities"* |
| Removed, re-added, removed again | `f1c016be7` (2026-07-09) · `dfdb82c7e` + `12fc964e5` (2026-07-11, #667) |
| Present in current tree | **No** — absent from `HEAD` |
| Present at any remote branch tip | **No** — checked all 42 `refs/remotes/origin/*` |
| Reachable from `origin/main` history | **YES** — `ba228fbca`, `dfdb82c7e` |
| Repository visibility | **PRIVATE** |

**So:** the credentials are not in the working tree and not on any branch tip,
but they are in the history of `main`. Every clone, every fork, and any CI cache
that fetched full depth carries them. Because the repo is private, the audience
is everyone with repo read access — not the public internet. That lowers the
urgency; it does not make it zero.

## Why the gitleaks gate will never catch this

`.github/workflows/secret-scan.yml` runs gitleaks 8.30.1 as a hard gate, but
scoped to `--log-opts="${BASE_SHA}..${HEAD_SHA}"` — the PR's own commits. Its
header states the reason plainly: the known archived leaks already on `main`
would false-positive every PR, so history is deliberately excluded.

That design is correct for a merge gate and **structurally cannot surface this
file**. Anyone reading "gitleaks is green" as "history is clean" is reading a
different claim than the one the job makes. See `docs/UPSTREAMS.md`, gitleaks
row (PARTIAL) and failure mode 11.

## Rotation list — 42 credentials

Grouped by what an attacker gets. Rotate top-down.

### Tier 1 — direct cost, data, or customer reach
| Key | Why it is first |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string, embeds the password — full read/write to the production brain |
| `TELEGRAM_BOT_TOKEN` | the operator's remote-control surface: ~30 commands incl. `/approve` `/commit` |
| `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET` | places outbound calls, bills per minute; the webhook secret lets forged call events in |
| `META_PAGE_ACCESS_TOKEN` | posts to the shop's public Instagram/Facebook |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | a private key; scope depends on grants |
| `AUTH_SECRET`, `AUTH_GOOGLE_CLIENT_SECRET` | forge sessions / impersonate the owner login |
| `ADMIN_API_KEY`, `BRIDGE_API_KEY`, `STATENOUR_SYNC_KEY`, `VOICE_BRIDGE_TOKEN`, `CRON_SECRET` | first-party auth — the bridge and cron gates |
| `AUTO_LABOR_PASSWORD` | a password, third-party account |

### Tier 2 — metered LLM / API spend
`OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `GEMINI_API_KEY` · `XAI_API_KEY` ·
`COHERE_API_KEY` · `OLLAMA_API_KEY` · `VENICE_API_KEY` · `HF_API_KEY` ·
`HUGGINGFACE_API_KEY` · `BRAINTRUST_API_KEY` · `DEEPGRAM_API_KEY` ·
`CARTESIA_API_KEY` · `DESCRIPT_API_KEY` · `VIDEO_DB_API_KEY` ·
`FIRECRAWL_API_KEY` · `TAVILY_API_KEY` · `APOLLO_API_KEY` · `FINNHUB_API_KEY` ·
`FIREFLIES_API_KEY` · `CLICKUP_API_KEY` · `MAKE_API_KEY` ·
`MAKE_WEBHOOK_API_KEY` · `MAKE_WEBHOOK_URL` (the URL is itself the secret) ·
`INNGEST_EVENT_KEY` · `INNGEST_SIGNING_KEY` · `LIVEKIT_API_KEY` ·
`LIVEKIT_API_SECRET` · `VAPID_PRIVATE_KEY`

**Cross-references worth checking before rotating:**
- `HF_API_KEY` / `HUGGINGFACE_API_KEY` — agent memory already carries *"rotate
  leaked HF token"* as an open item from an earlier audit. This confirms it and
  is the same token; do not treat as two findings.
- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` — the LiveKit lane is RETIRED
  (`apps/voice` deleted 2026-08-03, #1315/#1317). Prefer **revoke** over rotate.
- `DEEPGRAM_API_KEY` — the account is prepaid, so a leaked key spends a fixed
  balance rather than accruing an open bill. Still rotate; the urgency is lower.
- `CARTESIA_API_KEY` — recorded as still in use; rotating needs a config update.

### Not secrets — no action (7)
`AUTH_URL` · `NEXTAUTH_URL` · `AUTH_TRUST_HOST` · `AUTH_ALLOWED_EMAIL` ·
`RAILWAY_PRIVATE_DOMAIN` · `VAPID_PUBLIC_KEY` · `AUTH_GOOGLE_CLIENT_ID`

These matched a `KEY|TOKEN|SECRET|AUTH|...` name filter but carry no credential.
`VAPID_PUBLIC_KEY` is public by design; `AUTH_GOOGLE_CLIENT_ID` is not
independently sensitive (its paired secret is, and is in Tier 1). Listing them
explicitly is deliberate — an inventory that quietly drops entries invites a
recount.

## What history remediation would and would not buy

Rewriting history (`git filter-repo`) to excise the blob is **not** a substitute
for rotation and should not be done first. Once a credential has been committed,
assume it is compromised and rotate; the rewrite only reduces future spread. A
rewrite is also expensive here: it invalidates every outstanding clone and
worktree, and this repo currently has 15 worktrees and 42 remote branches.

**Recommended order:** rotate → confirm services healthy → *then* decide whether
a rewrite is worth its blast radius. If rotation is complete, the historical
values are inert and a rewrite becomes optional hygiene rather than remediation.

## Method

Read-only, no new tooling — gitleaks is not installed locally and this needed no
binary:

```bash
git log --all --pretty=format: --name-only --diff-filter=A | sort -u   # candidate paths
git rev-list --all -1 -- apps/statenour/vars.json                       # lifecycle
git cat-file -e "<ref>:apps/statenour/vars.json"                        # per-ref presence
```

Key names were parsed from the UTF-16 blob in memory and the extracted copy was
deleted immediately; no value was written to disk, logged, or committed.

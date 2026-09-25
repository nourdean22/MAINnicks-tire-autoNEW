# Sovereign dev current state

Snapshot: 2026-09-25. Source of truth is live machine/repo evidence.

## Machine

- Windows 11 Pro; 15.73 GB RAM.
- C: is 237.16 GB total; after safe cleanup it had 15.86 GB free.
- Tailscale, Git, GitHub CLI, Node 24, Corepack, Docker CLI, Railway CLI,
  VS Code, OpenCode, Ollama, and Goose are installed.
- Tailscale is installed but currently reports `NeedsLogin`.
- Docker Desktop engine was not running during this audit.

## Repository

- Primary repo: `nourdean22/MAINnicks-tire-autoNEW`.
- Sovereign-dev work branch: `chore/sovereign-dev-bootstrap-20260925`.
- Branch base at creation: `d2cf2842f4ce44f710c82a9d36a52880df6cd24c`.
- The primary checkout is dirty/stale and is not used for this implementation.

## Recovery

Existing recovery snapshot:
`Documents/NOURCITY-Recovery/snapshot-20260924-230810`.

It records SSH key metadata, local env-file metadata, agent configuration,
browser-profile presence, PowerShell profiles, WSL/Docker state, branch state,
and worktree salvage. The 21-row worktree salvage manifest reported zero
salvage errors. Do not put recovered secrets in Git.

### Clean-room restore proof — 2026-09-25

A brand-new private clone of current `main` at
`2b0783ea58f04d9adc3456d5b1447cf46431ff35` was created at a separate path with
no repo secrets copied in. `scripts/dev/bootstrap.ps1 -Install` completed
successfully from that fresh checkout:

- locked workspace install completed for all 13 workspace projects;
- 2,185 packages resolved, 2,171 reused from the pnpm store, 0 downloaded;
- StateNour Prisma client generated successfully;
- `scripts/dev/doctor.mjs`: `DOCTOR_RESULT=PASS`;
- `pnpm agent:verify`: 340 tests, 332 passed, 8 intentional skips, 0 failures;
- adapter parity: 142 checks, 0 violations;
- working tree remained clean;
- bootstrap exit code: 0.

This proves the repository + developer-toolchain side is reproducibly recoverable
from GitHub on this Windows host. It deliberately does **not** prove recovery of
personal credentials or secrets: the fresh checkout had no `.env` and no
`camera-bridge/.env.local`.

Known reset blockers remain: 2FA recovery-code completeness, passkey/cloud-sync
recoverability, browser-password sync completeness, Windows Credential Manager,
and secure backup of local-only credentials/configuration.

**Reset verdict: CODE/TOOLCHAIN RECOVERY PROVEN; FULL DEVICE RESET STILL BLOCKED
BY CREDENTIAL RECOVERY.**

## Model/agent lanes

- OpenCode 1.18.27: installed; primary shell candidate.
- Goose 1.52.0: installed from its official GitHub release; challenger.
- Granite 4.2 local: verified end-to-end with Ollama, but about 100 seconds for
  a trivial response on this CPU.
- Default Granite context caused a 27 GB runtime footprint at 131072 context.
- A bounded 8192-context profile reduced runtime footprint to 6.9 GB but did
  not materially improve latency.
- Local Granite weights were removed after verification because they were
  regenerable and not competitive on this laptop.

Next model priority: remote open-weight inference behind an OpenAI-compatible
endpoint, with cost/latency measured by NOUR-Bench before becoming default.

## Repository enforcement

GitHub rulesets and main branch-protection reads returned HTTP 403 with an
upgrade/public-repository requirement. Repo-side policy and CI remain usable,
but settings-level required checks/direct-main blocking are externally blocked.

## Storage disposition

KEEP: recovery snapshot, SSH/config metadata, active agent configs, repo source.
DELETE/REGENERATE: stale package caches, temp files, unsuitable local weights.
KEEP/MODIFY: Windows junction worktrees only as an optional local optimization.
REPLACE as canonical: full local dev with portable devcontainer/remote workspace.
DEFER: destructive reset until a clean-room restore succeeds.

Two independently rechecked clean/contained worktrees (`convo`, `lot-board`)
were safely torn down with the repository teardown script while keeping branches.
Their junction targets were verified before directory removal.

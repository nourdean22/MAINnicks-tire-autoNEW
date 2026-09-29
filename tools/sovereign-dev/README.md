# Sovereign developer control plane

This directory is developer infrastructure. It is deliberately separate from
StateNour's product AI router.

## Daily path

1. Deterministic tools first: path search, ripgrep, AST/LSP, git, tests.
2. OpenCode is the default interactive coding shell.
3. Cheap/open models handle bounded work when they pass verification.
4. Stronger remote/open models are escalation lanes.
5. Paid frontier APIs are reserved for high-risk work or verifier failures.

Never give an autonomous agent production-write credentials by default.

## Portable bootstrap

- Linux/devcontainer: `bash scripts/dev/bootstrap.sh --install`
- Windows: `powershell scripts/dev/bootstrap.ps1 -Install`
- Inspection only: `node scripts/dev/doctor.mjs`

The repository pins Node 24 and its pnpm version in `package.json`.
Bootstrap uses Corepack so a machine-global pnpm version is not authoritative.

## Local model lane

Use `opencode.example.jsonc` as a non-secret reference. Local Ollama endpoints
are optional and must be benchmarked on this repository before becoming a
default. Model visibility is not proof of usable latency or coding quality.

## Safety

- one write owner per branch/worktree
- never commit plaintext secrets
- do not bypass red verification
- no direct production DB/customer/Railway side effects
- vendor-neutral handoffs live in `handoff-template.md`

Remote CPU/GPU resources are intentionally not auto-created by bootstrap.
Provisioning those can incur spend and therefore remains an operator-approved
step after the portable environment is verified.

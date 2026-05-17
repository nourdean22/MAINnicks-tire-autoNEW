# Config Spine

This repo now treats config as a small, explicit local spine.

## Purpose

- keep repo-local runtime assumptions visible
- document config precedence
- define evidence paths
- give the bootstrap/preflight script one stable contract

## Source-of-truth split

- `statenour-os` app: runtime execution truth
- Notion: planning, projects, knowledge, and audit destination
- repo-local reports and receipts: evidence truth for this repo pass
- external systems: truth for their own native data

## Config precedence

1. `.env.local`
   - machine-local overrides
   - never committed
2. `.env.example`
   - documented contract for required and optional keys
3. code defaults
   - only for safe, explicit fallback values

## Required repo-local evidence paths

- `reports/`
  - audit artifacts
  - bootstrap receipts
- `logs/`
  - local operational logs and receipts
- `handoffs/`
  - bounded handoff documents
- `data/redacted/`
  - redacted local data artifacts only

## Bootstrap contract

Repo-local bootstrap lives at:

- `scripts/bootstrap_repo.ps1`

It is intentionally limited to:

- repo preflight checks
- required file checks
- package-script checks
- evidence directory creation
- safe receipt generation

It does not:

- verify external credentials
- mutate guarded business systems
- prove `C:\NOUR_OS`
- perform public or customer-facing writes

## External dependency note

This repo still references `C:\NOUR_OS` in multiple app-side routes and services. That dependency is real, but it is outside this repo and therefore not proven by the repo-local bootstrap alone.

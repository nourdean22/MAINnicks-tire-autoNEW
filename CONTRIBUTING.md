# Contributing Guide

Thanks for contributing.

## Workflow

1. Create a branch from `main`.
2. Make focused changes with clear commit messages.
3. Run local gates before opening a PR:

   ```bash
   pnpm verify
   ```

4. Open a pull request using the PR template.

## Standards

- Use `pnpm` (not npm/yarn) for all package operations.
- Keep TypeScript strict and avoid introducing `any` unless justified.
- Keep documentation in sync with real behavior.
- Add or update tests for changed behavior when practical.

## High-risk areas

Changes touching auth, payments, Twilio messaging, cron jobs, migrations, or bridge/sync integrations require extra caution and explicit testing notes in PRs.

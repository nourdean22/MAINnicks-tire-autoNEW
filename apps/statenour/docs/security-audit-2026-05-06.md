# Security Audit · 2026-05-06 · v10.0.375

First formal sweep · per /security-auditor skill.

## Method

Static-analysis script at `scripts/security-audit.ts` covers:

1. **Hardcoded secrets** — 10 patterns (OpenAI, Anthropic, GitHub PAT, AWS, Google, Cohere, Stripe, VideoDB, Twilio, generic AWS) across all `.ts/.tsx/.js/.jsx/.mjs/.cjs` files. `.env*` files allowlisted (gitignored anyway).
2. **API auth gaps** — every `/api/**/route.ts` exporting POST/PUT/DELETE/PATCH must have at least one of: session-based auth (`requireSession` / `requireOwner` / `getServerAuthSession`), shared-secret auth (`timingSafeEqual` + header), or env-var bearer (`CRON_SECRET` / `RUNNER_SHARED_SECRET` / `STATENOUR_SYNC_KEY` / `SYNC_SECRET` / `BRIDGE_API_KEY`).
3. **SQL injection** — `$queryRaw(` or `$executeRaw(` calls with `${interpolation}` (function-style instead of tagged-template).
4. **Open redirects** — `redirect()` calls with user-controlled destinations.

## Allowlists

- `/api/cron/*` — auth via CRON_SECRET bearer
- `/api/health` — public health checks
- `/api/manifest`, `/api/og` — public metadata routes
- `/api/webhook/*` — webhooks have their own signature verification
- `/api/telegram/webhook` — `X-Telegram-Bot-Api-Secret-Token` header verified
- `/api/vapi/*` — VAPI tool routes, signed by VAPI agent
- `/api/internal/runner/*` — local Windows runner, RUNNER_SHARED_SECRET bearer

## Result · 2026-05-06

```
Scanned 1297 files
✅ No findings. Operator-grade clean.
```

## Audit cadence

Run `pnpm tsx scripts/security-audit.ts` before every push or weekly. Future: fold into the pre-push gate (step 16) so it auto-blocks pushes that introduce new findings.

## Known limitations

- Static analysis only — does NOT catch:
  - Dependency vulnerabilities (use `pnpm audit` for that)
  - Runtime auth bypass via header tampering (need pen-test for that)
  - Insufficient rate limiting (separate concern)
  - Permissive CORS (separate scan)
  - Sensitive data in logs (separate scan)
- Auth heuristic is regex-based, can have false negatives if a route uses an unusual auth pattern. Manual review of new auth patterns is recommended.

## Next steps

- [ ] Fold audit into pre-push gate (step 16)
- [ ] Add CORS audit
- [ ] Add log-redaction audit (scan logger calls for sensitive data)
- [ ] Quarterly full pen-test by a third party

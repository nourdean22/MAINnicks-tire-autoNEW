# Nick's Tire & Auto — Protected Core

Treat these systems as load-bearing. Changes require targeted tests, compatibility review and explicit rollback notes.

- Authentication and admin authorization
- VAPI webhook authentication, tool dispatch and idempotency
- Lead, callback and booking persistence
- Customer opt-out, consent and quiet-hour enforcement
- Invoice, payment and work-order records
- GSC authentication and ingestion
- Prerender generation and bot-serving middleware
- Railway environment validation and deploy entrypoints
- TiDB/Drizzle migrations and migration journal
- Nickstire-to-Statenour bridge authentication

## Rules

1. Never weaken authentication or signature checks to unblock a test.
2. Never reinterpret historical metrics silently.
3. Never count inferred demand as paid revenue.
4. Never apply destructive or production migrations without explicit operator approval.
5. Never log full customer phone numbers, transcripts or access material unnecessarily.
6. Preserve idempotency for webhooks, syncs, lead creation and booking creation.
7. Generated crawler HTML must remain semantically aligned with public source truth.
8. Use additive compatibility adapters before renaming or removing fields.
9. A successful code edit is not a successful production action.
10. Follow `docs/CURRENT-TRUTH.md` and `docs/METRICS-CONTRACT.md` for current system and measurement contracts.
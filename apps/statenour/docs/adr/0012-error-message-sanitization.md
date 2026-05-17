# ADR-0012 · Error-message sanitization layer for 500-response envelopes

**Status:** Accepted
**Date adopted:** v10.0.529.4 (2026-05-12) · regex broadened v10.0.529.8

## Context

The security audit shipped as `docs/audits/security-stride-owasp-2026-05-12.md`
flagged item **I-1** (Information Disclosure · raw error strings reach
the wire). The pattern across the OS was consistent:

```ts
} catch (err) {
  return NextResponse.json(
    { error: "task_failed", detail: err instanceof Error ? err.message : String(err) },
    { status: 500 },
  );
}
```

That `err.message` could legitimately contain:

- Neon connection strings (`postgresql://user:pass@ep-...neon.tech/db`) ·
  Prisma errors quote the DATABASE_URL on connection failure
- `Bearer <token>` strings · provider-API failures echo the auth header
- OpenAI / Anthropic / Venice API key prefixes (`sk-...`) · key-malformed
  errors put the prefix in the message
- Absolute filesystem paths (`C:\Users\nourd\...` locally · `/app/...`
  on Railway · `/var/task/...` on Vercel) · Node `ENOENT` errors include
  the full path
- IPv4 addresses (Neon endpoint resolution, internal-network probes)

The `apiHandler` wrapper at `lib/api/handler.ts` already collapses
uncaught throws to a generic `"Unexpected server error"` envelope · but
~30 routes had their own try/catch with hand-rolled JSON 500 bodies
because the operator wanted *some* debug signal in the network tab.
That signal was leaking credentials.

The audit graded I-1 as a HIGH severity finding alongside the rate
limit + tool-quota items in the v10.0.529 series.

## Decision

Add a pure-function `sanitizeError(err: unknown): string` at
`lib/utils/sanitize-error.ts` and route every operator-visible 500
`detail` field through it.

The function:

- Normalizes `err` to a string (`Error.message` or `String(err)`)
- Replaces each leak vector with a fixed redacted token via a regex pack
- Truncates to 200 chars to bound payload size
- Stays pure · no logger side-effect · the caller still
  `log.error`s the raw error server-side

Six regex patterns ship in v10.0.529.4 (one broadened in v10.0.529.8
after a post-session review caught Railway runtime paths like `/app/...`
slipping past the original `/etc|root|home|var` set):

| Vector | Pattern → replacement |
|---|---|
| Postgres URLs | `postgresql?://...` → `[redacted-db-url]` |
| Bearer tokens | `\bBearer\s+[opaque]` → `Bearer [redacted]` |
| API keys | `sk\|sk-ant\|sk-proj\|sk-or-...` → `[redacted-api-key]` |
| Windows paths | `[A-Z]:\\...` → `[redacted-path]` |
| Linux fs roots | `/etc\|root\|home\|var\|tmp\|usr\|srv\|proc\|opt\|app\|sys\|dev\|mnt\|media/...` → `[redacted-path]` |
| IPv4 | `\d{1,3}.\d{1,3}.\d{1,3}.\d{1,3}` → `[redacted-ip]` |

Convenience helper `sanitizedErrorBody(code, err)` returns the
canonical `{ error, detail }` shape so routes can drop in a one-liner.

26 routes updated in v10.0.529.4 + .5 + .8 (see References for the
complete list).

## Consequences

**Positive:**

- Network-tab debug signal preserved (the operator can still tell
  "database failure" from "tool quota exceeded" from "URL not safe")
  without exposing credentials.
- One central regex pack · adding a new leak vector touches one file
  not 26. The v529.8 broadening proved this loop works (one regex
  edit covered all 26 routes).
- Pure function with no DB / I/O dependency · trivially testable.
  Tests at `tests/utils/sanitize-error.test.ts` cover all 6 vectors.
- Composable with `apiHandler` · routes that adopt the wrapper get the
  generic envelope; routes that need richer detail use
  `sanitizedErrorBody` and stay safe.

**Negative:**

- Regex-based scrubbing is fundamentally a deny-list · novel leak
  shapes can slip past. Mitigated by: (a) the 200-char truncation
  caps any leak's blast radius, (b) the broadening cycle (v529.8 came
  fast when the gap surfaced), (c) the audit doc commits to revisit
  every quarter.
- Slight CPU overhead per error · 6 regex passes on a < 200-char
  string. Inconsequential vs the cost of the failed operation itself.
- A determined attacker could still pattern-match on the count + order
  of `[redacted-*]` markers to infer error class. Not a credential
  leak · acceptable signal vs full opacity.

## Alternatives considered

- **Use `apiHandler`'s generic envelope only.** Rejected · the operator
  has stated repeatedly that debug visibility matters during heavy
  development. "Unexpected server error" with no `detail` loses too
  much signal vs the actual cost of routing 26 routes through a
  6-regex pass.
- **Per-route sanitization (inline regex per handler).** Rejected ·
  drift risk. The v529.8 fix would have needed 26 separate edits and
  the next leak vector after that another 26.
- **Adopt a structured-logging library (pino / winston) with a
  `redact` config.** Rejected · adds a dependency for what is ~30 LOC
  of pure regex. The pino redact path is geared for server logs not
  user-facing JSON envelopes. We already use `lib/logger.ts` for
  server-side · the leak surface is the wire response.
- **Switch all routes to `apiHandler` and remove the hand-rolled
  catches.** Deferred · larger refactor, the security work needed to
  ship in days not weeks. `apiHandler` adoption is tracked as a
  separate cleanup task; once 100% adopted, this ADR becomes the
  fallback for the few routes that need richer detail.

## References

- `lib/utils/sanitize-error.ts` — the module
- `tests/utils/sanitize-error.test.ts` — regex pack tests
- `docs/audits/security-stride-owasp-2026-05-12.md` — I-1 finding
  + audit context
- 26 consumer routes:
  - `app/api/ai/{assist,chat/route,chat/documents,chat/suggestions,coach-goal,nick-noticed,operator-brief,plan-day,review,suggest-goals,tasks,teach,voice-to-content}/route.ts`
  - `app/api/brain/category-stats/route.ts`
  - `app/api/cron/{inbox-janitor,ingest-fireflies,monthly-location-rank}/route.ts`
  - `app/api/social/schedule/route.ts`
  - `app/api/system/{hub,performance,tools/stats}/route.ts`
  - `app/api/tasks/route.ts`
  - `app/api/ultron/{personal-pulse,reflect,time-ghost,todo-desk}/route.ts`
  - `lib/ai/tools.ts` (tool result envelopes)
- v10.0.529.4 commit (`04a36b8`) · helper + first sweep
- v10.0.529.5 commit (`4e2b67d`) · I-1 sweep completion
- v10.0.529.8 commit (`63f4146`) · regex broadening for Railway paths
- ADR-0004 · withGuardian wrapper · the inverse direction (capturing
  full errors for breadcrumb logging) · sanitizeError is the
  outbound-envelope counterpart

## Open items

- Add a CI step that greps for `err.message` in JSON 500 responses
  without `sanitizeError` to catch future drift · low priority,
  the v529 sweep was thorough.
- Consider a `sanitizeError.strict()` variant that returns ONLY the
  error code with no detail · useful for genuinely sensitive surfaces
  (auth endpoints) where even error class is too much info.
- The audit doc commits to a quarterly regex-pack review · first
  review due 2026-08-12.

---

**Reconciled at v10.0.529.9** · 2026-05-12 EOD · ADR shipped alongside
the security-audit wave so the rationale is durable before context
rotates.

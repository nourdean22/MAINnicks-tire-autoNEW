# Loud Failure Protocol

## Overview
The Loud Failure protocol is a systemic security and observability standard applied across the `statenour` application. Its primary goal is to ensure that runtime errors, type mismatches, and execution anomalies are explicitly caught, logged, and addressed rather than being silently swallowed or bypassed.

## Core Rules

1. **Never `logError` inside a loop**
   - Accumulate errors during iteration and emit a single aggregate error after the loop completes to prevent log flooding.

2. **No PII in error messages**
   - Ensure error payloads do not contain Personally Identifiable Information (PII), credentials, or sensitive business data.

3. **Respect documented silences**
   - If an error is intentionally suppressed (e.g., expected "not found" states), it must be explicitly documented with a comment explaining *why* it is silent.

4. **Environment isolation**
   - Use lazy imports (`import("@/lib/utils/error-log")`) when logging errors from client-side or edge contexts to avoid pulling Node.js dependencies into the bundle.

5. **Behavior preservation**
   - Adding observability must not alter the business logic or execution flow. When instrumenting hot paths (like WebSocket or stream callbacks), use a log-once latch to avoid excessive spam.

## Remediation Phases Executed

### Phase 1: Swallowed Exceptions
- **Phase 1a:** Removed empty and `console.error` catch blocks in core AI paths.
- **Phase 1b:** Expanded instrumentation to `app/api/` and remaining tool definitions. All silent catch blocks were upgraded to use `logError`, routing telemetry to our observability sink.

### Phase 2: Zod Integration Boundaries
- Replaced dangerous cast assertions (`as unknown as Type` or `as any`) with strict `z.parse()` or `z.safeParse()` validation.
- Enforced at key external integration boundaries (e.g., Telegram webhooks, business sync routes) to fail loudly on unexpected schema drift.

### Phase 3: SQL Injection Hardening
- Performed a codebase-wide codemod converting all instances of `$queryRawUnsafe` to `$queryRaw` using parameterized template literals.
- Eliminated dynamic SQL string concatenation vectors.

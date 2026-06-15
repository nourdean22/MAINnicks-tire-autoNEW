/**
 * lib/utils/sanitize-error.ts · v10.0.529.4
 *
 * Render an arbitrary `unknown` error into a string safe to embed
 * in a user-facing 500 response. Strips the well-known leak vectors
 * documented in the security audit (security-stride-owasp-2026-05-12
 * I-1):
 *
 *   · postgres connection strings (`postgresql://user:pass@host/db`)
 *   · Bearer tokens (`Bearer <opaque>`)
 *   · OpenAI-style API keys (`sk-...`)
 *   · IPv4 addresses (Neon/internal endpoint hostnames sometimes
 *     resolve to IPs in error messages)
 *   · Absolute Windows paths (`C:\Users\...`) that reveal the
 *     deployment filesystem layout
 *
 * Returns at most 200 chars · longer messages get truncated with an
 * ellipsis. The intent is "the operator can identify the broad class
 * of failure without an attacker getting credential prefixes or
 * internal-network signal."
 *
 * Usage:
 *   } catch (err) {
 *     return NextResponse.json(
 *       { error: "task_failed", detail: sanitizeError(err) },
 *       { status: 500 },
 *     );
 *   }
 *
 * Pure function · no logger side-effect. The CALLER should still
 * log.error the raw error server-side · this is only for the
 * outbound JSON envelope.
 */

const PATTERNS: Array<[RegExp, string]> = [
  // Postgres / Neon connection strings — match before generic IP scrub
  // so the host portion gets folded into the redacted-db-url tag.
  [/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted-db-url]"],
  // Bearer tokens of any opaque shape
  [/\bBearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]"],
  // OpenAI / Anthropic / Venice-style API keys
  [/\b(sk|sk-ant|sk-proj|sk-or)-[A-Za-z0-9_\-]{8,}/gi, "[redacted-api-key]"],
  // Absolute Windows paths (Vercel build artifacts sometimes appear)
  [/\b[A-Z]:\\(?:[^\s"'<>:\\]+\\)*[^\s"'<>:\\]+/g, "[redacted-path]"],
  // v10.0.529.8 · post-session-review fix · the v529.4 regex only matched
  // /etc, /root, /home, /var/secrets · missed Railway/Vercel runtime paths
  // like /app, /tmp, /usr, /srv, /proc, /opt. Broadened the prefix set
  // BUT scoped to fs-leak roots only · don't want to scrub legitimate
  // URL paths like /api/foo that show up in error context strings.
  [/\/(?:etc|root|home|var|tmp|usr|srv|proc|opt|app|sys|dev|mnt|media)\/[^\s"'<>:]*/g, "[redacted-path]"],
  // IPv4 addresses (catches internal-network info leak)
  [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[redacted-ip]"],
];

export function sanitizeError(err: unknown): string {
  let raw = err instanceof Error ? err.message : String(err);
  if (typeof raw !== "string") raw = "(non-string error value)";
  for (const [re, replacement] of PATTERNS) {
    raw = raw.replace(re, replacement);
  }
  if (raw.length > 200) raw = raw.slice(0, 197) + "...";
  return raw;
}

/**
 * Convenience wrapper for the common shape `{ error, details }`. The
 * caller usually wants both a stable error code AND a redacted detail
 * string for the operator to read in the network tab.
 */
export function sanitizedErrorBody(
  code: string,
  err: unknown,
): { error: string; detail: string } {
  return { error: code, detail: sanitizeError(err) };
}

const SENSITIVE_KEYS = new Set([
  "password", "token", "secret", "key", "authorization",
  "cookie", "x-sync-key", "bearer", "api_key", "apikey",
  "phone", "email", "phonenumber", "phone_number",
  "ssn", "social_security", "creditcard", "credit_card",
  "fullname", "full_name", "address", "dob", "date_of_birth",
]);

export function redactSensitive(obj: unknown, depth = 0): unknown {
  if (obj === null || obj === undefined) return obj;
  if (depth > 3) {
    if (typeof obj === "string") {
      return sanitizeError(obj);
    }
    if (typeof obj === "object") {
      return "[REDACTED_SUBTREE]";
    }
    return obj;
  }
  if (typeof obj === "string") {
    return sanitizeError(obj);
  }
  if (Array.isArray(obj)) return obj.map((v) => redactSensitive(v, depth + 1));
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        result[k] = "[REDACTED]";
      } else {
        result[k] = redactSensitive(v, depth + 1);
      }
    }
    return result;
  }
  return obj;
}

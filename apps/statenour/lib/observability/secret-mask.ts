/**
 * lib/observability/secret-mask.ts · 2026-09-02
 *
 * One redaction shared by every exporter that ships text out of the process:
 * Langfuse span attributes (`maskLangfuseData`) and Sentry event messages /
 * exception values / breadcrumbs (`scrubSentryEvent`). An API key or bearer
 * token that leaks into a prompt, a tool result, a model reply or an error
 * message never reaches a vendor. Belt-and-braces on top of the private-mode
 * gate (Langfuse) and `sendDefaultPii: false` (Sentry).
 */
const SECRET_RE = /\b(?:sk|pk)-[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g;

export function maskSecrets(data: unknown): unknown {
  if (typeof data !== "string") return data;
  return data.replace(SECRET_RE, (m) => (m.startsWith("Bearer") ? "Bearer [REDACTED]" : `${m.slice(0, 3)}[REDACTED]`));
}

export function maskSecretString(text: string): string {
  return maskSecrets(text) as string;
}

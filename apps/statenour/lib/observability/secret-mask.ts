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

/**
 * 2026-10-10 (audit 07-SN-08) - shop customers' emails and phone numbers ride
 * in prompts, tool results and replies. Email; a +-prefixed number of 10-15
 * digits (+44 20 7946 0958); a formatted NANP number (216-555-0100,
 * (216) 555-0100, 216.555.0100); or a bare 10-15 digit run. The email arm
 * starts only at a run boundary, so a long blob is scanned once. A digit arm
 * never starts right after "." or "-", so decimals (0.8723456789012) and UUID
 * segments survive.
 * shortcut: a bare 10-15 digit id or epoch-ms timestamp is masked too; narrow it if traces need them.
 */
const PII_RE =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}|(?<![\w+.-])\+\d(?:[\s.-]?\d){9,14}(?!\w)|(?<![\w+.-])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\w)|(?<![\w+.-])\+?\d{10,15}(?!\w)/g;

const maskText = (s: string): string => s.replace(PII_RE, (m) => (m.includes("@") ? "[EMAIL]" : "[PHONE]"));

function parses(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

function maskLeaves(v: unknown): unknown {
  if (typeof v === "string") return maskText(v);
  if (typeof v === "number") return maskText(String(v)) === String(v) ? v : "[PHONE]";
  if (Array.isArray(v)) return v.map(maskLeaves);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [maskText(k), maskLeaves(x)]));
  }
  return v;
}

export function maskPii(data: unknown): unknown {
  if (typeof data !== "string") return data;
  const masked = maskText(data);
  if (masked === data || !/^\s*[[{]/.test(data) || parses(masked)) return masked;
  // A bare-number match (a numeric phone, an epoch-ms) broke a JSON payload: mask it leaf by leaf instead.
  // shortcut: this path re-stringifies, so integers above 2^53 lose precision and formatting is compacted; parse with a bigint-safe reader if traces need them.
  try {
    return JSON.stringify(maskLeaves(JSON.parse(data)));
  } catch {
    return masked;
  }
}

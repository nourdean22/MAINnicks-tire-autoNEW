/**
 * lib/observability/sentry.ts · 2026-09-02
 *
 * SDK-free Sentry configuration. Everything here is plain functions over env
 * so the version route and the tests can use it without pulling the SDK into
 * their bundles; the three `sentry.*.config.ts` files are the only places that
 * call `Sentry.init`, and they spread `sentryInitOptions()`.
 *
 * Fail-closed stance: no valid DSN → `enabled: false` and nothing leaves the
 * process. A placeholder such as `<paste-sentry-dsn>` counts as no DSN (the
 * 2026-09-02 Langfuse key incident set an 11-character placeholder on Railway
 * and the presence-check badge said "configured").
 */
import { maskSecretString } from "./secret-mask";
import { LANGFUSE_SELFCHECK_SPAN_NAME } from "./span-names";

type Env = Record<string, string | undefined>;

/** Resolve the DSN without letting placeholder values enable reporting. */
export function resolveSentryDsn(env: Env = process.env): string | undefined {
  const candidate = (env.NEXT_PUBLIC_SENTRY_DSN ?? env.SENTRY_DSN)?.trim();
  const isPlaceholder = /[<>]/.test(candidate ?? "") || /(?:YOUR|CHANGE_ME|REPLACE_ME|example\.com|\.\.\.)/i.test(candidate ?? "");
  if (!candidate || isPlaceholder) {
    return undefined;
  }

  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/.test(parsed.protocol) || !parsed.username || parsed.pathname.length < 2) {
      return undefined;
    }
    return candidate;
  } catch {
    return undefined;
  }
}

/**
 * `SENTRY_ENVIRONMENT` (Sentry's own variable) wins, then the public client
 * variant, then Railway's environment name, then NODE_ENV — the same ladder the
 * Langfuse processor uses, so both vendors agree on what "production" means.
 */
export function resolveSentryEnvironment(env: Env = process.env): string | undefined {
  const raw = (env.SENTRY_ENVIRONMENT || env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || "")
    .trim()
    .toLowerCase();
  return raw || undefined;
}

/** `SENTRY_RELEASE`, else the Railway commit SHA — an event then pins to a deploy. */
export function resolveSentryRelease(env: Env = process.env): string | undefined {
  const raw = (env.SENTRY_RELEASE || env.RAILWAY_GIT_COMMIT_SHA || "").trim();
  return raw || undefined;
}

/** The parts of a Sentry event that carry free text we redact before export. */
export interface SentryScrubbableEvent {
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<{ message?: string }>;
}

/**
 * `beforeSend` body: keys and bearer tokens are masked in the message, every
 * exception value and every breadcrumb message. Mutates and returns the same
 * event so Sentry's `beforeSend` contract (return the event to send it) holds.
 */
export function scrubSentryEvent<T extends SentryScrubbableEvent>(event: T): T {
  if (typeof event.message === "string") event.message = maskSecretString(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === "string") ex.value = maskSecretString(ex.value);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.message === "string") crumb.message = maskSecretString(crumb.message);
  }
  return event;
}

export interface SentryInitBase {
  dsn: string | undefined;
  enabled: boolean;
  /** Never ship IPs, cookies or user identity by default — single-operator app, private data. */
  sendDefaultPii: false;
  /**
   * Errors only by default. NOT a literal 0 type: when a foreign span
   * processor rides on Sentry's provider (Langfuse), this MUST be raised or
   * the sampler returns NOT_RECORD and OpenTelemetry hands back a
   * non-recording span BEFORE any processor runs — see initSentryServer.
   */
  tracesSampleRate: number;
  environment?: string;
  release?: string;
}

/**
 * The init block every runtime config spreads. The client passes its own
 * `NEXT_PUBLIC_*` view of env (Next only inlines those); the release on the
 * client is injected at build time by `withSentryConfig`, so it is left unset
 * there rather than guessed.
 */
export function sentryInitOptions(env: Env = process.env): SentryInitBase {
  const dsn = resolveSentryDsn(env);
  const environment = resolveSentryEnvironment(env);
  const release = resolveSentryRelease(env);
  return {
    dsn,
    enabled: Boolean(dsn),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    ...(environment ? { environment } : {}),
    ...(release ? { release } : {}),
  };
}

/**
 * Which spans are worth recording when Langfuse rides on Sentry's provider.
 *
 * Sentry's sampler decides BEFORE any processor runs, so this is the cheap
 * gate: only AI SDK spans (`ai.*`) and our own boot self-check ever become
 * recording spans. Everything else — every HTTP request, render and query
 * Sentry auto-instruments — stays non-recording, so we neither pay for it nor
 * risk exporting it. `aiOnlySpanProcessor` is the second, exact gate on the
 * export side. (Review finding on #2080.)
 */
export function shouldRecordSpanForLangfuse(spanName: unknown): boolean {
  return typeof spanName === "string" && (spanName.startsWith("ai.") || spanName === LANGFUSE_SELFCHECK_SPAN_NAME);
}

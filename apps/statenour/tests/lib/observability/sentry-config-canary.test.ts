/**
 * tests/lib/observability/sentry-config-canary.test.ts · 2026-09-02
 *
 * Sentry's configuration is a fail-closed gate plus a redaction, so it gets
 * the repo's canary treatment: assert the BEHAVIOUR, then assert every runtime
 * config file actually uses it, with a mutation canary proving the scan can go
 * red. A DSN presence badge was already shown to lie once this week — Railway
 * held an 11-character placeholder for LANGFUSE_* while /api/version reported
 * "configured: true" — so a placeholder must never enable reporting.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveSentryDsn,
  resolveSentryEnvironment,
  resolveSentryRelease,
  scrubSentryEvent,
  sentryInitOptions,
} from "@/lib/observability/sentry";
import { maskLangfuseData } from "@/lib/observability/langfuse";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// Synthetic, deliberately. Real key material must never enter the tree — the
// first draft of this file put the operator's live Langfuse secret here and
// gitleaks caught it on #2079.
const SAMPLE_DSN = "https://00000000000000000000000000000000@o000000.ingest.us.sentry.io/0000000";

describe("resolveSentryDsn · fails closed", () => {
  it("accepts a well-formed DSN", () => {
    expect(resolveSentryDsn({ SENTRY_DSN: SAMPLE_DSN })).toBe(SAMPLE_DSN);
  });

  it("prefers the public DSN when both are set (the client can only see that one)", () => {
    expect(resolveSentryDsn({ NEXT_PUBLIC_SENTRY_DSN: SAMPLE_DSN, SENTRY_DSN: "https://other@o1.ingest.us.sentry.io/2" })).toBe(SAMPLE_DSN);
  });

  it("treats missing, placeholder and malformed values as NOT configured", () => {
    expect(resolveSentryDsn({})).toBeUndefined();
    expect(resolveSentryDsn({ SENTRY_DSN: "   " })).toBeUndefined();
    expect(resolveSentryDsn({ SENTRY_DSN: "<paste-sentry-dsn>" })).toBeUndefined();
    expect(resolveSentryDsn({ SENTRY_DSN: "YOUR_DSN_HERE" })).toBeUndefined();
    expect(resolveSentryDsn({ SENTRY_DSN: "https://public@example.com/123" })).toBeUndefined();
    expect(resolveSentryDsn({ SENTRY_DSN: "not-a-url" })).toBeUndefined();
    // no public key in the URL — Sentry would reject it, so we do first
    expect(resolveSentryDsn({ SENTRY_DSN: "https://o1.ingest.us.sentry.io/2" })).toBeUndefined();
  });
});

describe("sentryInitOptions · the block every runtime config spreads", () => {
  it("disables the SDK entirely without a DSN — nothing leaves the process", () => {
    const opts = sentryInitOptions({});
    expect(opts.enabled).toBe(false);
    expect(opts.dsn).toBeUndefined();
  });

  it("enables with a well-formed DSN, and keeps PII off and tracing at zero", () => {
    const opts = sentryInitOptions({ SENTRY_DSN: SAMPLE_DSN, RAILWAY_ENVIRONMENT_NAME: "production", RAILWAY_GIT_COMMIT_SHA: "abc123" });
    expect(opts.enabled).toBe(true);
    expect(opts.sendDefaultPii).toBe(false);
    expect(opts.tracesSampleRate).toBe(0);
    expect(opts.environment).toBe("production");
    expect(opts.release).toBe("abc123");
  });

  it("tags every event app:statenour — the project is shared with nickstire (2026-09-07)", () => {
    expect(sentryInitOptions({ SENTRY_DSN: SAMPLE_DSN }).initialScope).toEqual({ tags: { app: "statenour" } });
    // The tag must survive the disabled path too: a config that only tags
    // when enabled would silently drop it on the next env mishap.
    expect(sentryInitOptions({}).initialScope).toEqual({ tags: { app: "statenour" } });
  });

  it("environment and release follow the same ladder Langfuse uses", () => {
    expect(resolveSentryEnvironment({ SENTRY_ENVIRONMENT: "staging", RAILWAY_ENVIRONMENT_NAME: "production" })).toBe("staging");
    expect(resolveSentryEnvironment({ RAILWAY_ENVIRONMENT_NAME: "Production" })).toBe("production");
    expect(resolveSentryEnvironment({})).toBeUndefined();
    expect(resolveSentryRelease({ SENTRY_RELEASE: "v1", RAILWAY_GIT_COMMIT_SHA: "sha" })).toBe("v1");
    expect(resolveSentryRelease({})).toBeUndefined();
  });
});

describe("scrubSentryEvent · secrets never reach the vendor", () => {
  it("masks keys and bearer tokens in message, exception values and breadcrumbs", () => {
    const event = scrubSentryEvent({
      message: "failed with sk-lf-00000000-0000-4000-8000-000000000000",
      exception: { values: [{ value: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123" }] },
      breadcrumbs: [{ message: "used pk-lf-11111111-1111-4111-8111-111111111111" }],
    });
    expect(event.message).toBe("failed with sk-[REDACTED]");
    expect(event.exception?.values?.[0].value).toBe("Authorization: Bearer [REDACTED]");
    expect(event.breadcrumbs?.[0].message).toBe("used pk-[REDACTED]");
  });

  it("leaves ordinary text and absent fields alone", () => {
    const event = scrubSentryEvent({ message: "the desk-lamp task-list is fine" });
    expect(event.message).toBe("the desk-lamp task-list is fine");
    expect(() => scrubSentryEvent({})).not.toThrow();
  });

  it("shares ONE redaction with Langfuse — a secret is masked identically on both exports", () => {
    const fakeKey = "sk-lf-00000000-0000-4000-8000-000000000000";
    const viaSentry = scrubSentryEvent({ message: fakeKey }).message;
    const viaLangfuse = maskLangfuseData(fakeKey);
    expect(viaSentry).toBe(viaLangfuse);
  });
});

describe("every runtime config actually uses the shared block", () => {
  const FILES = ["sentry.server.config.ts", "sentry.edge.config.ts", "sentry.client.config.ts"];

  function usesSharedBlock(text: string): boolean {
    return /\.\.\.sentryInitOptions\(/.test(text) && /beforeSend:\s*\(event\)\s*=>\s*scrubSentryEvent\(event\)/.test(text);
  }

  it("inverse check: all three runtime configs exist", () => {
    for (const f of FILES) {
      expect(readFileSync(join(APP_ROOT, f), "utf8").length, f).toBeGreaterThan(0);
    }
  });

  it("each spreads sentryInitOptions() and scrubs before sending", () => {
    const bare = FILES.filter((f) => !usesSharedBlock(readFileSync(join(APP_ROOT, f), "utf8")));
    expect(bare, "runtime configs not using the shared fail-closed + masking block").toEqual([]);
  });

  it("the Node config accepts span processors — the Langfuse handover point", () => {
    const server = readFileSync(join(APP_ROOT, "sentry.server.config.ts"), "utf8");
    expect(server).toMatch(/openTelemetrySpanProcessors/);
    expect(server).toMatch(/export function initSentryServer/);
  });

  it("MUTATION CANARY: dropping beforeSend from one config in memory makes exactly that file go bare", () => {
    const source = readFileSync(join(APP_ROOT, "sentry.server.config.ts"), "utf8");
    const mutated = source.replace(/\s*beforeSend:[^\n]*\n/, "\n");
    expect(mutated).not.toBe(source);
    expect(usesSharedBlock(source)).toBe(true);
    expect(usesSharedBlock(mutated)).toBe(false);
  });
});

describe("browser-bundle safety · sentry.ts must stay Node-free", () => {
  // lib/observability/sentry.ts is loaded by sentry.client.config.ts, so it
  // lands in the BROWSER bundle. Importing the Langfuse module from it (for a
  // shared constant) dragged that file's Node-only @opentelemetry/sdk-node
  // reference into the client graph and broke `next build` with
  // module-not-found. The pre-push build gate caught it; this catches it in
  // milliseconds instead of 80 seconds.
  const SENTRY_LIB = join(APP_ROOT, "lib", "observability", "sentry.ts");
  const source = readFileSync(SENTRY_LIB, "utf8");

  function nodeOnlyImports(text: string): string[] {
    return [...text.matchAll(/^import[^;]*from\s+"([^"]+)";/gm)]
      .map((m) => m[1])
      .filter((spec) => /langfuse|sdk-node|@opentelemetry|@sentry/.test(spec));
  }

  it("imports nothing that reaches a Node-only module", () => {
    expect(nodeOnlyImports(source), "these would enter the browser bundle via sentry.client.config.ts").toEqual([]);
  });

  it("the shared span-name constants live in a dependency-free module", () => {
    const spanNames = readFileSync(join(APP_ROOT, "lib", "observability", "span-names.ts"), "utf8");
    expect(spanNames).toMatch(/AI_SDK_TRACER_NAME/);
    expect(spanNames).toMatch(/LANGFUSE_SELFCHECK_SPAN_NAME/);
    expect(nodeOnlyImports(spanNames)).toEqual([]);
    expect(spanNames.match(/^import /gm), "span-names.ts must import nothing at all").toBeNull();
  });

  it("MUTATION CANARY: re-adding the langfuse import in memory makes the gate fail", () => {
    const mutated = `import { LANGFUSE_SELFCHECK_SPAN_NAME } from "./langfuse";
${source}`;
    expect(nodeOnlyImports(source)).toEqual([]);
    expect(nodeOnlyImports(mutated)).toEqual(["./langfuse"]);
  });
});

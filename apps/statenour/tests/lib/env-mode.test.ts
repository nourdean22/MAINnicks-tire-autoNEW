import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkEnvHealth } from "@/lib/env";

/**
 * truth-substrate audit P0 (2026-07-21) · finding #13.
 *
 * Proves `checkEnvHealth({ mode })` actually enforces production-only required
 * secrets. The pre-fix bug: lib/env.ts captured the prod flag in a module-level
 * `const PROD` at IMPORT time, but `check:env:prod` set NODE_ENV AFTER importing
 * — so `--prod` was a no-op and AUTH_SECRET / OAuth / CRON_SECRET / SYNC_KEY were
 * never required. This test fails against the old code and passes against the fix.
 */

const PROD_ONLY_KEYS = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_CLIENT_ID",
  "AUTH_GOOGLE_CLIENT_SECRET",
  "AUTH_ALLOWED_EMAIL",
  "CRON_SECRET",
  "STATENOUR_SYNC_KEY",
];
// Alias keys that would satisfy the OAuth specs — must also be cleared.
const ALIAS_KEYS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of [...PROD_ONLY_KEYS, ...ALIAS_KEYS, "NODE_ENV", "VERCEL_ENV"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("checkEnvHealth · production mode enforcement (audit #13)", () => {
  it("requires every production-only secret when mode='production'", () => {
    const missing = new Set(checkEnvHealth({ mode: "production" }).missing.map((m) => m.key));
    for (const key of PROD_ONLY_KEYS) {
      expect(missing, `${key} must be required in production`).toContain(key);
    }
  });

  it("does NOT require them when mode='development'", () => {
    const missing = new Set(checkEnvHealth({ mode: "development" }).missing.map((m) => m.key));
    for (const key of PROD_ONLY_KEYS) {
      expect(missing, `${key} must NOT be required in development`).not.toContain(key);
    }
  });

  it("does not rely on NODE_ENV being set before import (the original bug)", () => {
    // NODE_ENV is unset here (cleared in beforeEach). Explicit mode must still
    // force production requiredness — proving the flag is read at call time.
    expect(process.env.NODE_ENV).toBeUndefined();
    const missing = checkEnvHealth({ mode: "production" }).missing.map((m) => m.key);
    expect(missing).toContain("AUTH_SECRET");
  });
});

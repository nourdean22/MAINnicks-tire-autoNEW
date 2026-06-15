/**
 * v10.0.529.11 · sanitizeError + sanitizedErrorBody unit tests.
 *
 * Each test case represents a real leak vector the v529.4 + v529.8
 * regexes were designed to scrub. Failures here mean the helper let
 * a vector through · add a case for any new attack surface.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeError,
  sanitizedErrorBody,
  redactSensitive,
} from "@/lib/utils/sanitize-error";

describe("v10.0.529.4 · sanitizeError", () => {
  it("returns a string for null/undefined/non-string", () => {
    expect(typeof sanitizeError(null)).toBe("string");
    expect(typeof sanitizeError(undefined)).toBe("string");
    expect(typeof sanitizeError(123)).toBe("string");
    expect(typeof sanitizeError({ weird: true })).toBe("string");
  });

  it("passes benign content through unchanged", () => {
    expect(sanitizeError("query failed: timeout after 30s")).toBe(
      "query failed: timeout after 30s",
    );
  });

  it("scrubs postgres:// connection strings", () => {
    const raw =
      "Can't reach database: postgresql://neondb_owner:npg_PcSDw9NXCuE2@ep-quiet-wave.neon.tech/neondb";
    expect(sanitizeError(raw)).toBe(
      "Can't reach database: [redacted-db-url]",
    );
  });

  it("scrubs postgres:// (without ql suffix)", () => {
    expect(sanitizeError("connect to postgres://user:pass@host/db")).toBe(
      "connect to [redacted-db-url]",
    );
  });

  it("scrubs Bearer tokens", () => {
    expect(sanitizeError("Auth failed: Bearer abc123.def456.ghi789")).toBe(
      "Auth failed: Bearer [redacted]",
    );
  });

  it("scrubs OpenAI / Anthropic / Venice-style API keys", () => {
    expect(sanitizeError("Got sk-ant-api03-RealKeyShape-_xyz123")).toContain(
      "[redacted-api-key]",
    );
    expect(sanitizeError("sk-proj-abc123def456")).toContain(
      "[redacted-api-key]",
    );
    expect(sanitizeError("sk-or-v1-abc123")).toContain("[redacted-api-key]");
  });

  it("scrubs absolute Windows paths", () => {
    expect(
      sanitizeError(
        "ENOENT: C:\\Users\\nourd\\NOUR-OS\\apps\\statenour-os\\config\\crons.ts",
      ),
    ).toContain("[redacted-path]");
  });

  it("v10.0.529.8 · scrubs /app container paths (Railway/Vercel)", () => {
    expect(
      sanitizeError(
        "ENOENT: no such file or directory, open '/app/data/skills-registry.json'",
      ),
    ).toContain("[redacted-path]");
  });

  it("v10.0.529.8 · scrubs /tmp /usr /srv /proc /opt /sys /dev /mnt /media", () => {
    expect(sanitizeError("write to /tmp/foo")).toContain("[redacted-path]");
    expect(sanitizeError("read /usr/local/bin/node")).toContain(
      "[redacted-path]",
    );
    expect(sanitizeError("lstat /proc/1/status")).toContain(
      "[redacted-path]",
    );
    expect(sanitizeError("mount /mnt/data")).toContain("[redacted-path]");
  });

  it("v10.0.529.8 · does NOT scrub legitimate /api URL paths in error context", () => {
    // The narrowed prefix list means `/api/foo` is preserved — leaving
    // URL paths intact for operator debugging while still scrubbing
    // filesystem paths.
    expect(sanitizeError("404 on /api/ai/chat")).toBe("404 on /api/ai/chat");
  });

  it("scrubs IPv4 addresses", () => {
    expect(sanitizeError("connecting to 10.0.0.42")).toBe(
      "connecting to [redacted-ip]",
    );
    expect(sanitizeError("connecting to 192.168.1.1:5432")).toContain(
      "[redacted-ip]",
    );
  });

  it("truncates messages over 200 chars with ellipsis", () => {
    const huge = "x".repeat(500);
    const out = sanitizeError(huge);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("...")).toBe(true);
  });

  it("strips connection-string components even when truncating kicks in", () => {
    const huge = `Database error: postgres://user:pass@host/db ${"x".repeat(500)}`;
    const out = sanitizeError(huge);
    expect(out).toContain("[redacted-db-url]");
    expect(out).not.toContain("postgres://");
    expect(out).not.toContain("user:pass");
  });

  it("handles Error instances by reading .message", () => {
    const err = new Error("Auth failed for postgres://user:pwd@host/db");
    expect(sanitizeError(err)).toBe("Auth failed for [redacted-db-url]");
  });
});

describe("v10.0.529.4 · sanitizedErrorBody", () => {
  it("returns { error, detail } with the right shape", () => {
    const body = sanitizedErrorBody("oauth_failed", new Error("boom"));
    expect(body).toEqual({ error: "oauth_failed", detail: "boom" });
  });

  it("sanitizes the detail field", () => {
    const body = sanitizedErrorBody(
      "db_error",
      new Error("postgres://user:pwd@host"),
    );
    expect(body.error).toBe("db_error");
    expect(body.detail).toBe("[redacted-db-url]");
  });
});

describe("redactSensitive", () => {
  it("scrubs sensitive keys from an object recursively", () => {
    const input = {
      password: "super-secret-password",
      email: "test@example.com",
      benign: "value",
      nested: {
        token: "bearer token-value",
        safe: "yes",
        deep: {
          x: "postgres://user:pass@host/db",
          api_key: "sk-12345678"
        }
      }
    };

    const expected = {
      password: "[REDACTED]",
      email: "[REDACTED]",
      benign: "value",
      nested: {
        token: "[REDACTED]",
        safe: "yes",
        deep: {
          x: "[redacted-db-url]",
          api_key: "[REDACTED]"
        }
      }
    };

    expect(redactSensitive(input)).toEqual(expected);
  });

  it("safely truncates deeply nested subtrees at depth > 3 to [REDACTED_SUBTREE]", () => {
    const input = {
      nested: {
        deep: {
          deeper: {
            deepest: {
              password: "leak-me-not",
              safe: "value",
            },
            secretString: "sk-proj-superSecretKey",
          }
        }
      }
    };

    const expected = {
      nested: {
        deep: {
          deeper: {
            deepest: "[REDACTED_SUBTREE]",
            secretString: "[redacted-api-key]",
          }
        }
      }
    };

    expect(redactSensitive(input)).toEqual(expected);
  });
});

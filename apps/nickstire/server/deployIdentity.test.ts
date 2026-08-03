/**
 * Deployment identity must never invent a build.
 *
 * statenour's equivalent module exists because deploy surfaces read Vercel-only
 * env vars that Railway never injects, so on prod they printed the literals
 * "dev" / "local" — a deployment-truth page confidently lying about what was
 * live. These tests pin the property that prevents it here.
 */
import { describe, it, expect } from "vitest";
import { resolveNickDeployIdentity, resolveConfiguredSurfaces } from "./lib/deployIdentity";

describe("resolveNickDeployIdentity · never fabricate a SHA", () => {
  it("reports unknown, not a placeholder, when no SHA is present", () => {
    const id = resolveNickDeployIdentity({});
    expect(id.commit).toBeNull();
    expect(id.commitShort).toBeNull();
    expect(id.status).toBe("unknown");
    expect(id.source).toBe("none");
    // The failure mode being guarded against: a string that LOOKS like an answer.
    expect(id.note).toMatch(/cannot identify/i);
  });

  it("prefers Railway, which is the actual deploy platform", () => {
    const id = resolveNickDeployIdentity({
      RAILWAY_GIT_COMMIT_SHA: "f3b91f4f3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      GIT_SHA: "deadbeefdeadbeef",
    });
    expect(id.source).toBe("railway");
    expect(id.commitShort).toBe("f3b91f4f3");
  });

  it("falls back to an explicit SHA for non-Railway builds", () => {
    const id = resolveNickDeployIdentity({ GIT_SHA: "abc123456789" });
    expect(id.source).toBe("explicit");
    expect(id.status).toBe("identified");
    expect(id.commitShort).toBe("abc123456");
  });

  it("treats whitespace-only env values as absent", () => {
    // Railway injects empty strings for unset vars in some configurations; an
    // empty SHA that passed a truthiness check would render as a blank commit.
    const id = resolveNickDeployIdentity({ RAILWAY_GIT_COMMIT_SHA: "   ", GIT_SHA: "" });
    expect(id.commit).toBeNull();
    expect(id.status).toBe("unknown");
  });
});

describe("resolveConfiguredSurfaces · presence only, and no secrets", () => {
  it("returns booleans, never the values", () => {
    const surfaces = resolveConfiguredSurfaces({
      DATABASE_URL: "mysql://user:hunter2@host/db",
      TELEGRAM_BOT_TOKEN: "secret-token",
      TELEGRAM_CHAT_ID: "123",
    });
    for (const v of Object.values(surfaces)) expect(typeof v).toBe("boolean");
    expect(JSON.stringify(surfaces)).not.toMatch(/hunter2|secret-token/);
    expect(surfaces.database).toBe(true);
    expect(surfaces.telegramAlerts).toBe(true);
  });

  it("requires BOTH halves of a paired credential", () => {
    expect(resolveConfiguredSurfaces({ TELEGRAM_BOT_TOKEN: "t" }).telegramAlerts).toBe(false);
    expect(resolveConfiguredSurfaces({ TELEGRAM_CHAT_ID: "c" }).telegramAlerts).toBe(false);
  });

  it("reports absent surfaces as false rather than omitting them", () => {
    // An omitted key reads as "no such capability"; false reads as "exists,
    // not configured". The operator needs the second.
    const surfaces = resolveConfiguredSurfaces({});
    expect(Object.keys(surfaces).length).toBeGreaterThan(3);
    expect(Object.values(surfaces).every((v) => v === false)).toBe(true);
  });
});

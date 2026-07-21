import { describe, it, expect } from "vitest";
import { resolveDeployMeta, readDeployIdentity } from "@/lib/services/deploy-identity";

/**
 * truth-substrate audit P0 (#11/#14). Proves the canonical deploy-identity reader
 * is Railway-first and never fabricates a deploy identity when neither platform's
 * env is present — the bug was Vercel-only reads showing "dev"/"local"/
 * "development" on Railway prod.
 */
describe("deploy-identity · Railway-first, honest unknown", () => {
  it("reads Railway env first (statenour prod is Railway)", () => {
    const m = resolveDeployMeta({
      RAILWAY_GIT_COMMIT_SHA: "abcdef1234567890",
      RAILWAY_GIT_BRANCH: "main",
      RAILWAY_ENVIRONMENT_NAME: "production",
      RAILWAY_GIT_COMMIT_MESSAGE: "ship it",
      // Vercel vars present too — Railway must still win.
      VERCEL_GIT_COMMIT_SHA: "0000000",
      VERCEL_ENV: "preview",
    });
    expect(m.source).toBe("railway");
    expect(m.sha).toBe("abcdef1234567890");
    expect(m.shaShort).toBe("abcdef1");
    expect(m.branch).toBe("main");
    expect(m.env).toBe("production");
    expect(m.status).toBe("production");
    expect(m.commitMessage).toBe("ship it");
  });

  it("marks non-production Railway envs correctly", () => {
    const m = resolveDeployMeta({ RAILWAY_GIT_COMMIT_SHA: "deadbeef", RAILWAY_ENVIRONMENT_NAME: "staging" });
    expect(m.status).toBe("non-production");
  });

  it("falls back to Vercel only when Railway env is absent", () => {
    const m = resolveDeployMeta({ VERCEL_GIT_COMMIT_SHA: "cafebabe1234", VERCEL_ENV: "production" });
    expect(m.source).toBe("vercel");
    expect(m.sha).toBe("cafebabe1234");
    expect(m.status).toBe("production");
  });

  it("returns HONEST unknown (never a fabricated dev/local) when no platform env is set", () => {
    const m = resolveDeployMeta({});
    expect(m.source).toBe("none");
    expect(m.status).toBe("unknown");
    expect(m.sha).toBeNull();
    expect(m.shaShort).toBeNull();
    expect(m.branch).toBeNull();
    expect(m.env).toBeNull();
    // The key property: it does NOT invent "dev"/"local"/"development".
    expect(m.note).toMatch(/not available|verify/i);
  });

  it("ignores the sentinel Vercel 'dev' SHA (treats as unknown)", () => {
    const m = resolveDeployMeta({ VERCEL_GIT_COMMIT_SHA: "dev" });
    expect(m.source).toBe("none");
    expect(m.sha).toBeNull();
  });

  it("readDeployIdentity is the 6-field subset of resolveDeployMeta", () => {
    const env = { RAILWAY_GIT_COMMIT_SHA: "abc123", RAILWAY_ENVIRONMENT_NAME: "production" };
    const id = readDeployIdentity(env);
    expect(Object.keys(id).sort()).toEqual(["branch", "env", "note", "sha", "source", "status"]);
    expect(id.sha).toBe("abc123");
    expect(id.status).toBe("production");
  });
});

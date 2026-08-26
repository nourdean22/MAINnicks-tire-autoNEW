import { describe, it, expect } from "vitest";
import { isPublic, PUBLIC_EXACT } from "@/lib/security/route-policy";

/**
 * truth-substrate audit P0 (2026-07-21) · route-security contract test.
 *
 * Proves the middleware's public-route classifier does NOT anonymously expose
 * the private cockpit or the detailed health payload, while keeping the minimal
 * external uptime probe public. This is a PURE test of the boundary — no auth
 * runtime, no mock — so it actually catches a regression that re-adds "/" or
 * "/api/health" to the public allowlist (audit findings #1 and #3).
 */
describe("route-policy · public allowlist", () => {
  it("gates the private root cockpit '/' (audit #1)", () => {
    expect(isPublic("/")).toBe(false);
  });

  it("gates the detailed '/api/health' payload (audit #3)", () => {
    expect(isPublic("/api/health")).toBe(false);
  });

  it("keeps the minimal external heartbeat public (Railway healthcheckPath)", () => {
    expect(isPublic("/api/system/heartbeat")).toBe(true);
  });

  it("still gates other private surfaces", () => {
    for (const p of ["/chat", "/brain", "/missions", "/api/tasks", "/api/system/diagnostics"]) {
      expect(isPublic(p)).toBe(false);
    }
  });

  it("still lets self-authed server-to-server prefixes through", () => {
    for (const p of ["/api/auth/session", "/api/cron/tick", "/auth/sign-in", "/_next/data/x", "/api/system/perplexica-diag"]) {
      expect(isPublic(p)).toBe(true);
    }
  });

  it("never re-adds '/' or '/api/health' to the exact allowlist", () => {
    expect(PUBLIC_EXACT).not.toContain("/");
    expect(PUBLIC_EXACT).not.toContain("/api/health");
  });
});

describe("apple-health inlets bypass the session gate (H1 smoke-caught bug)", () => {
  // The end-to-end smoke's first live POST hit the middleware 401
  // ({"error":"Unauthorized"}) before the route's own bearer auth could
  // run — the exact bug /api/health/summary had before its exemption.
  it("both device inlets are session-exempt (own bearer auth at the route)", () => {
    expect(isPublic("/api/integrations/apple-health/v1/hae")).toBe(true);
    expect(isPublic("/api/integrations/apple-health/v1/batches")).toBe(true);
  });
});

describe("/api/version is session-exempt EXACTLY, and cannot bleed (2026-08-25)", () => {
  // The endpoint answers "is what I merged what is live?". It has to be
  // reachable without a session or it cannot answer that from outside — which
  // is the state the 2026-08-25 audit hit: /api/health, /api/version,
  // /api/ping and /api/system/hub all 401, / 307, so statenour's deployed SHA
  // was unverifiable while nickstire's was one request away.
  it("is public", () => {
    expect(isPublic("/api/version")).toBe(true);
  });

  // The reason it lives in PUBLIC_EXACT and not PUBLIC_PREFIXES. This file has
  // been bitten by prefix bleed twice — "/api/short/" and "/api/actions/" both
  // carry trailing slashes because the bare prefix also exempted an unrelated
  // sibling route. A prefix entry here would anonymously expose every future
  // /api/version* path, including ones nobody has written yet.
  it("does NOT exempt a sibling or child path", () => {
    for (const p of [
      "/api/versions",
      "/api/version-history",
      "/api/version/secret",
      "/api/version/",
    ]) {
      expect(isPublic(p), `${p} must stay session-gated`).toBe(false);
    }
  });

  it("fails CLOSED on case variants rather than open", () => {
    expect(isPublic("/API/VERSION")).toBe(false);
    expect(isPublic("/Api/Version")).toBe(false);
  });

  // Locks the classification itself: if someone "simplifies" the entry into
  // PUBLIC_PREFIXES, this arm goes red even though the arm above might not
  // (a prefix would make /api/version public too — the bleed is the regression,
  // and asserting only the happy path would miss it entirely).
  it("is registered as an EXACT path, never a prefix", () => {
    expect(PUBLIC_EXACT).toContain("/api/version");
  });
});

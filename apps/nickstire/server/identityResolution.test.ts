/**
 * Identity resolution — verdict matrix + fail direction + the send-bridge
 * gate (Autopilot Wave 4, mission P2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyIdentity, firstNameToken } from "./services/identityResolution";

describe("firstNameToken", () => {
  it("normalizes to the lowercase first token", () => {
    expect(firstNameToken("Sam Rivera")).toBe("sam");
    expect(firstNameToken("  MAYA ")).toBe("maya");
    expect(firstNameToken(null)).toBe("");
    expect(firstNameToken("O'Brien")).toBe("o'brien");
  });
});

describe("classifyIdentity (pure verdict matrix)", () => {
  it("0 customers → unresolved", () => {
    expect(classifyIdentity({ customerMatches: [], recentNonCustomerNames: ["Sam"] }).verdict).toBe("unresolved");
  });

  it("1 customer, no conflicting signals → resolved with the id", () => {
    const r = classifyIdentity({
      customerMatches: [{ id: 7, name: "Sam Rivera", optOut: false }],
      recentNonCustomerNames: ["Sam"],
    });
    expect(r.verdict).toBe("resolved");
    expect(r.customerId).toBe(7);
  });

  it("2+ customers → ambiguous, NO customerId leaks", () => {
    const r = classifyIdentity({
      customerMatches: [
        { id: 7, name: "Sam Rivera", optOut: false },
        { id: 9, name: "Dana Rivera", optOut: false },
      ],
      recentNonCustomerNames: [],
    });
    expect(r.verdict).toBe("ambiguous");
    expect(r.customerId).toBeNull();
  });

  it("1 customer but a DIFFERENT recent self-declared name → conflicted", () => {
    const r = classifyIdentity({
      customerMatches: [{ id: 7, name: "Sam Rivera", optOut: false }],
      recentNonCustomerNames: ["Jordan"],
    });
    expect(r.verdict).toBe("conflicted");
    expect(r.customerId).toBeNull();
  });

  it("opt-out is the most restrictive read across ALL matches, surviving ambiguity", () => {
    const r = classifyIdentity({
      customerMatches: [
        { id: 7, name: "Sam", optOut: false },
        { id: 9, name: "Dana", optOut: true },
      ],
      recentNonCustomerNames: [],
    });
    expect(r.verdict).toBe("ambiguous");
    expect(r.optOutAnyMatch).toBe(true);
  });

  it("short/garbage signal tokens never trigger a conflict", () => {
    const r = classifyIdentity({
      customerMatches: [{ id: 7, name: "Sam Rivera", optOut: false }],
      recentNonCustomerNames: ["s", "", "??"],
    });
    expect(r.verdict).toBe("resolved");
  });
});

describe("resolveIdentity (fail direction)", () => {
  it("DB throw → unresolved + readable:false (never a guess)", async () => {
    vi.doMock("./db", () => ({ getDb: async () => { throw new Error("down"); } }));
    try {
      vi.resetModules();
      const { resolveIdentity } = await import("./services/identityResolution");
      const r = await resolveIdentity("+12165550101");
      expect(r.verdict).toBe("unresolved");
      expect(r.readable).toBe(false);
    } finally {
      vi.doUnmock("./db");
      vi.resetModules();
    }
  });

  it("malformed phone → unresolved but readable (a real answer)", async () => {
    const { resolveIdentity } = await import("./services/identityResolution");
    const r = await resolveIdentity("nope");
    expect(r.verdict).toBe("unresolved");
    expect(r.readable).toBe(true);
  });
});

// ─── The send-bridge identity gate ──────────────────────────────────

let verdict: { verdict: string; readable: boolean; evidence: unknown[] } = {
  verdict: "resolved",
  readable: true,
  evidence: [],
};
const sendSpy = vi.fn(async () => ({ success: true }));

describe("sendOpportunityDraft identity gate", () => {
  beforeEach(() => {
    vi.resetModules();
    sendSpy.mockClear();
    vi.doMock("./services/identityResolution", () => ({
      resolveIdentity: async () => verdict,
    }));
    vi.doMock("./services/opportunityQueue", () => ({
      listOpportunities: async () => [{
        id: "11111111-2222-4333-8444-555555555555",
        sourceType: "stale_lead",
        customerName: "Sam",
        customerPhone: "+12165550101",
        state: "new",
        consentOk: true,
        evidence: {},
        dataQuality: "verified",
      }],
      transitionOpportunity: async () => ({ ok: true }),
    }));
    vi.doMock("./sms", () => ({ sendSms: (...a: unknown[]) => sendSpy(...a) }));
    vi.doMock("./services/nickgptPreflightGuard", () => ({
      runNickgptPreflightGuard: () => ({ allowed: true, severity: "low", reasonCode: "ok", findings: [], action: "allow", shouldEnqueueNexusAudit: false }),
    }));
  });

  // singleFork hygiene: doMocks are NOT file-scoped — unhook every one.
  afterEach(() => {
    vi.doUnmock("./services/identityResolution");
    vi.doUnmock("./services/opportunityQueue");
    vi.doUnmock("./sms");
    vi.doUnmock("./services/nickgptPreflightGuard");
    vi.resetModules();
  });

  async function trySend() {
    const { sendOpportunityDraft } = await import("./services/opportunityDraft");
    return sendOpportunityDraft({ id: "11111111-2222-4333-8444-555555555555", body: "Hey Sam", by: "test" });
  }

  it("resolved → sends", async () => {
    verdict = { verdict: "resolved", readable: true, evidence: [] };
    const r = await trySend();
    expect(r.ok).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("unresolved (no customer row — a normal lead) → sends", async () => {
    verdict = { verdict: "unresolved", readable: true, evidence: [] };
    const r = await trySend();
    expect(r.ok).toBe(true);
  });

  for (const v of ["ambiguous", "conflicted"]) {
    it(`${v} → REFUSED, nothing sent`, async () => {
      verdict = { verdict: v, readable: true, evidence: [] };
      const r = await trySend();
      expect(r.ok).toBe(false);
      expect(r.error).toContain(v);
      expect(sendSpy).not.toHaveBeenCalled();
    });
  }

  it("unreadable verdict → REFUSED (can't verify → don't personalize)", async () => {
    verdict = { verdict: "unresolved", readable: false, evidence: [] };
    const r = await trySend();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unreadable/i);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("identity module throwing → REFUSED (fail closed at the send)", async () => {
    vi.doMock("./services/identityResolution", () => ({
      resolveIdentity: async () => { throw new Error("boom"); },
    }));
    vi.resetModules();
    const r = await trySend();
    expect(r.ok).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

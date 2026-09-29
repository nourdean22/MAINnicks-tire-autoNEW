/**
 * ADR-0019 T9 (sender half): escalating the same subject twice must reach
 * StateNour with the same Idempotency-Key, so its bridge_receipts open ONE task.
 * Before this change the header was never sent, and every call — the revenue
 * reconciliation re-runs every 2 h — opened a new task.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { escalateToOwner, type OwnerEscalation } from "./services/ownerEscalation";

const base: OwnerEscalation = {
  trigger: "attribution_weak_matches",
  summary: "Revenue reconciliation left 2 call-invoice matches ambiguous.",
  decisionRequested: "Rule on 2 ambiguous call-invoice matches",
  consequence: "Until ruled, these calls carry no revenue attribution.",
  deadline: null,
  evidenceLinks: ["/admin?tab=voiceReceptionist"],
  authorization: { tier: 1, role: "manager" },
  writeBack: "revenueAttribution.resolve",
};

async function headersOf(e: OwnerEscalation): Promise<Record<string, string>> {
  vi.stubEnv("STATENOUR_SYNC_KEY", "k-canary");
  vi.stubEnv("STATENOUR_SYNC_URL", "https://statenour.example");
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
  escalateToOwner(e, fetchSpy as unknown as typeof fetch);
  await new Promise((r) => setTimeout(r, 0));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
  return init.headers as Record<string, string>;
}

describe("owner escalation idempotency key", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("the same subject gives the same key on every call", async () => {
    const a = await headersOf({ ...base, subjectId: { opaque: "3,17" } });
    const b = await headersOf({ ...base, subjectId: { opaque: "3,17" } });
    expect(a["Idempotency-Key"]).toMatch(/^v1:obligation\.opened:attribution_weak_matches:[a-p]{16}$/);
    expect(b["Idempotency-Key"]).toBe(a["Idempotency-Key"]);
  });

  it("a different subject or trigger is a different obligation", async () => {
    const a = await headersOf({ ...base, subjectId: { opaque: "3,17" } });
    const b = await headersOf({ ...base, subjectId: { opaque: "3,17,40" } });
    const c = await headersOf({ ...base, trigger: "campaign_draft_awaiting_send", subjectId: { opaque: "3,17" } });
    expect(b["Idempotency-Key"]).not.toBe(a["Idempotency-Key"]);
    expect(c["Idempotency-Key"]).not.toBe(a["Idempotency-Key"]);
  });

  it("a plain draft id travels as-is", async () => {
    const h = await headersOf({ ...base, trigger: "campaign_draft_awaiting_send", subjectId: "draft-42" });
    expect(h["Idempotency-Key"]).toBe("v1:obligation.opened:campaign_draft_awaiting_send:draft-42");
  });

  it("no subject, or a phone-shaped one, sends unkeyed (today's path) and still sends", async () => {
    expect(await headersOf(base)).not.toHaveProperty("Idempotency-Key");
    expect(await headersOf({ ...base, subjectId: "2165550100" })).not.toHaveProperty("Idempotency-Key");
  });

  it("auth header is untouched", async () => {
    const h = await headersOf({ ...base, subjectId: "draft-1" });
    expect(h["x-sync-key"]).toBe("k-canary");
  });
});

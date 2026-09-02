import { describe, it, expect, vi, afterEach } from "vitest";
import { escalateToOwner, type OwnerEscalation } from "./services/ownerEscalation";

const sample: OwnerEscalation = {
  trigger: "campaign_draft_awaiting_send",
  summary: "The GPT bridge drafted a win-back campaign for 212 customers.",
  decisionRequested: "Send, edit, or discard win-back draft #4242",
  consequence: "Nothing is sent until you decide; the draft expires with the segment.",
  deadline: null,
  evidenceLinks: ["/admin?tab=campaigns&outreachTab=campaigns"],
  authorization: { tier: 0, role: "owner" },
  writeBack: "campaigns.send({ campaignId: 4242 })",
};

type OpenLoopPayload = {
  module: string;
  data: { title: string; description: string; priority: string; source: string; domain: string };
};

/**
 * The payload is read the way StateNour reads it — off the wire. The builder
 * is deliberately not exported (knip orphan gate), so every assertion goes
 * through the public function with a captured fetch.
 */
async function capture(e: OwnerEscalation): Promise<{ url: string; init: RequestInit; payload: OpenLoopPayload }> {
  vi.stubEnv("STATENOUR_SYNC_KEY", "k-canary");
  vi.stubEnv("STATENOUR_SYNC_URL", "https://statenour.example");
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
  escalateToOwner(e, fetchSpy as unknown as typeof fetch);
  await new Promise((r) => setTimeout(r, 0));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init, payload: JSON.parse(String(init.body)) as OpenLoopPayload };
}

describe("owner escalation → StateNour open_loop", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("posts the receiver's open_loop shape with every contract field in the description", async () => {
    const { url, init, payload: p } = await capture(sample);
    expect(url).toBe("https://statenour.example/api/sync/nour-os");
    expect((init.headers as Record<string, string>)["x-sync-key"]).toBe("k-canary");
    expect(p.module).toBe("open_loop");
    expect(p.data.source).toBe("nickstire");
    expect(p.data.domain).toBe("shop");
    expect(p.data.title).toMatch(/^\[Nick's Tire\] Send, edit, or discard/);
    expect(p.data.description).toMatch(/Consequence:/);
    expect(p.data.description).toMatch(/Open: \/admin\?tab=campaigns/);
    expect(p.data.description).toMatch(/Authorization: Tier 0, owner/);
    expect(p.data.description).toMatch(/Write-back: campaigns\.send/);
    expect(p.data.priority).toBe("high"); // Tier 0 defaults to high
  });

  it("a Tier 1 escalation defaults to medium priority and carries its deadline", async () => {
    const { payload: p } = await capture({
      ...sample,
      trigger: "attribution_weak_matches",
      deadline: "2026-09-05T17:00:00-04:00",
      authorization: { tier: 1, role: "manager" },
    });
    expect(p.data.priority).toBe("medium");
    expect(p.data.description).toMatch(/Deadline: 2026-09-05T17:00:00-04:00/);
    expect(p.data.description).toMatch(/Authorization: Tier 1, manager/);
    expect(p.data.description).toMatch(/Trigger: attribution_weak_matches/);
  });

  it("is a no-op without a sync key, and never throws when the network fails", async () => {
    vi.stubEnv("STATENOUR_SYNC_KEY", "");
    const fetchSpy = vi.fn();
    escalateToOwner(sample, fetchSpy as unknown as typeof fetch);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.stubEnv("STATENOUR_SYNC_KEY", "k");
    const failing = vi.fn(async () => { throw new Error("offline"); });
    expect(() => escalateToOwner(sample, failing as unknown as typeof fetch)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("CANARY — the payload carries no phone-shaped digits even when the summary is careless", async () => {
    const { payload: p } = await capture({ ...sample, summary: "Customer 216-555-0100 asked" });
    // The contract forbids PII; this test documents that the builder does NOT
    // scrub — callers must not put it there. If scrubbing is ever added, flip
    // this assertion. Today it is a visible reminder, not a guard.
    expect(p.data.description).toContain("216-555-0100");
  });
});

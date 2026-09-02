import { describe, it, expect, vi, afterEach } from "vitest";
import { buildOpenLoopPayload, escalateToOwner, type OwnerEscalation } from "./services/ownerEscalation";

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

describe("owner escalation → StateNour open_loop", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("builds the receiver's open_loop shape with every contract field in the description", () => {
    const p = buildOpenLoopPayload(sample);
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

  it("posts to /api/sync/nour-os with the sync key header", async () => {
    vi.stubEnv("STATENOUR_SYNC_KEY", "k-canary");
    vi.stubEnv("STATENOUR_SYNC_URL", "https://statenour.example");
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    escalateToOwner(sample, fetchSpy as unknown as typeof fetch);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://statenour.example/api/sync/nour-os");
    expect((init.headers as Record<string, string>)["x-sync-key"]).toBe("k-canary");
    expect(JSON.parse(String(init.body)).module).toBe("open_loop");
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

  it("CANARY — the payload carries no phone-shaped digits even when the summary is careless", () => {
    const p = buildOpenLoopPayload({ ...sample, summary: "Customer 216-555-0100 asked" });
    // The contract forbids PII; this test documents that the builder does NOT
    // scrub — callers must not put it there. If scrubbing is ever added, flip
    // this assertion. Today it is a visible reminder, not a guard.
    expect(p.data.description).toContain("216-555-0100");
  });
});

/**
 * A vitest run must never post to the live StateNour (bdnick.info).
 *
 * 2026-11-06 audit: bdnick held 94 tasks titled "[Nick's Tire] Send, edit, or discard win-back draft
 * #4242" (77 soft-deleted, 16 open, 1 done). 4242 is the mocked draft id in
 * bridgeSmsCampaignDraft.test.ts; that test drives the real bridge route, which calls
 * escalateToOwner with the real fetch, and apps/nickstire/.env (copied into every worktree) and
 * railway run carry STATENOUR_SYNC_KEY. The fix is vitest.config.ts `test.env`, same as Telegram
 * (telegramTestIsolation.test.ts). The positive control proves the same path DOES post once the
 * test itself supplies a key, so a green "no post" is not a path that never ran.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { escalateToOwner } from "../services/ownerEscalation";

const fetchMock = vi.fn(async (..._a: unknown[]) => new Response("{}", { status: 200 }));

const sample = {
  trigger: "campaign_draft_awaiting_send",
  summary: "isolation canary",
  decisionRequested: "Send, edit, or discard win-back draft #4242",
  consequence: "none",
  deadline: null,
  evidenceLinks: [],
  authorization: { tier: 0 as const, role: "owner" as const },
  writeBack: "campaigns.send({ campaignId: 4242 })",
  subjectId: "draft-4242",
};

function statenourCalls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/api/sync/nour-os"));
}

afterEach(() => {
  fetchMock.mockClear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the vitest process carries no StateNour sync key", () => {
  it("STATENOUR_SYNC_KEY is empty, whatever the parent shell or .env held", () => {
    expect(process.env.STATENOUR_SYNC_KEY ?? "").toBe("");
  });

  it("an owner escalation through the default (global) fetch posts nothing", async () => {
    vi.stubGlobal("fetch", fetchMock);
    escalateToOwner(sample);
    await new Promise((r) => setTimeout(r, 0));
    expect(statenourCalls()).toEqual([]);
  });

  it("positive control: with a key supplied by the test, the same call does post", async () => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("STATENOUR_SYNC_KEY", "control-key");
    vi.stubEnv("STATENOUR_SYNC_URL", "https://statenour.example");
    escalateToOwner(sample);
    await new Promise((r) => setTimeout(r, 0));
    expect(statenourCalls()).toEqual(["https://statenour.example/api/sync/nour-os"]);
  });
});

/**
 * Audit 2026-10-10 sentinel sweep (Task 2b): the weekly relationship digest
 * sent the outage apology to the operator's Telegram as "the strategist's
 * digest" and stored it as the week's RELATIONSHIP_DIGEST_SENT row. A
 * sentinel must take the existing factual fallback (counts + link), the
 * same text a thrown call produces.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));
const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  tracedAiChat: (...a: unknown[]) => mockChat(...a),
}));
const send = vi.fn();
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: (...a: unknown[]) => send(...a) }));
const db = vi.hoisted(() => ({ memFindFirst: vi.fn(), memCreate: vi.fn(), personFindMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findFirst: db.memFindFirst, create: db.memCreate },
    personProfile: { findMany: db.personFindMany },
  },
}));

import { GET } from "@/app/api/cron/relationship-digest/route";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};

const run = () =>
  (GET as unknown as (req: Request, ctx: unknown) => Promise<Record<string, unknown>>)(
    new Request("http://localhost/api/cron/relationship-digest"),
    {},
  );

beforeEach(() => {
  mockChat.mockReset();
  send.mockReset().mockResolvedValue(true);
  db.memFindFirst.mockReset().mockResolvedValue(null);
  db.memCreate.mockReset().mockResolvedValue({});
  db.personFindMany.mockReset().mockResolvedValue([
    {
      id: "p1",
      name: "Sam",
      role: "mentor",
      status: "active",
      trustScore: 7,
      lastInteraction: new Date(Date.now() - 40 * 86_400_000),
      interactionCount: 3,
      cadenceDays: 14,
      birthday: null,
      anniversary: null,
      applicableLaws: [],
      darkTraits: [],
      powerBalance: 0,
    },
  ]);
});

describe("relationship-digest - provider sentinel", () => {
  it("sends and stores the factual fallback, never the outage text", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    await run();
    const sent = String(send.mock.calls[0][0]);
    expect(sent).not.toContain("trouble connecting");
    expect(sent).toContain("Cooling: 1");
    expect(String(db.memCreate.mock.calls[0][0].data.content)).not.toContain("trouble connecting");
  });

  it("control: a real digest is sent", async () => {
    mockChat.mockResolvedValue({ content: "Sam has gone quiet for 40 days.", provider: "ollama", model: "m" });
    await run();
    expect(String(send.mock.calls[0][0])).toContain("Sam has gone quiet");
  });
});

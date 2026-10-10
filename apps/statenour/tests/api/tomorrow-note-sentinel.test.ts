/**
 * Audit 2026-10-10 sentinel sweep (Task 2b): when the model's reply is not
 * JSON the tomorrow-note route "stuffs the raw text into focus" and upserts
 * the draft. On an outage that put the apology into tomorrow's focus line and
 * overwrote any existing draft. A sentinel must return an error and write
 * nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-guard", () => ({ requireSession: vi.fn().mockResolvedValue({}) }));
const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  tracedAiChat: (...a: unknown[]) => mockChat(...a),
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
const db = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { count: vi.fn().mockResolvedValue(0) },
    commitment: { count: vi.fn().mockResolvedValue(0) },
    brainMemory: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: db.upsert,
    },
    chatMessage: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { POST } from "@/app/api/ultron/tomorrow-note/route";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};
const post = () =>
  POST(new Request("http://localhost/api/ultron/tomorrow-note", { method: "POST", body: "{}" }));

beforeEach(() => {
  mockChat.mockReset();
  db.upsert.mockReset().mockResolvedValue({});
});

describe("tomorrow-note POST - provider sentinel", () => {
  it("returns an error and does not write the outage text as a draft", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    const res = await post();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("control: a real draft is written", async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify({ focus: "Close the fleet quote", avoid: "", anchor: "one call", reason: "overdue" }),
      provider: "ollama",
      model: "m",
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(db.upsert).toHaveBeenCalledTimes(1);
  });
});

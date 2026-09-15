/**
 * The DOMAIN sendTelegram tool tells the truth about completion.
 *
 * Before 2026-09-15 the tool's dedupe branch returned `sent: true` from the
 * mere existence of a claim marker, and a transport timeout was folded into
 * `false` (a "known failure") which released the marker and let a retry
 * double-send. Drives the REAL tool with a mocked claim store and a mocked
 * observed transport: positive control first, then every state the model can
 * now see, and the two things that must never happen again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const brainMemory = {
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory } }));

const sendTelegramObserved = vi.fn();
vi.mock("@/lib/services/telegram-observed", () => ({ sendTelegramObserved }));

import { socialTools } from "@/lib/ai/tools/social";

type Exec = (input: { message: string; title?: string; urgency: "low" | "medium" | "high" }, opts: unknown) => Promise<{
  sent: boolean;
  state: string;
  deduped?: boolean;
  priorState?: string;
  error?: string;
  messageId?: number;
}>;
const run = (input: Parameters<Exec>[0]) =>
  (socialTools.sendTelegram.execute as unknown as Exec)(input, { toolCallId: "t1", messages: [] });

beforeEach(() => {
  vi.clearAllMocks();
  brainMemory.create.mockResolvedValue({});
  brainMemory.findUnique.mockResolvedValue(null);
  brainMemory.update.mockResolvedValue({});
  brainMemory.deleteMany.mockResolvedValue({ count: 1 });
});

describe("sendTelegram tool · completion truth", () => {
  it("positive control: a provider receipt is the only way to get sent:true", async () => {
    sendTelegramObserved.mockResolvedValueOnce({ state: "provider_accepted", messageId: 42 });
    const r = await run({ message: "hi", urgency: "medium" });
    expect(r).toMatchObject({ sent: true, state: "provider_accepted", messageId: 42 });
    expect(r.error).toBeUndefined();
    expect(brainMemory.deleteMany).not.toHaveBeenCalled(); // marker kept: the send committed
  });

  it("a live dedupe marker is NOT a receipt: the duplicate is suppressed and reported sent:false", async () => {
    brainMemory.create.mockRejectedValueOnce({ code: "P2002" });
    brainMemory.findUnique.mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 60_000), content: "claimed:x" });
    const r = await run({ message: "hi", urgency: "medium" });
    expect(sendTelegramObserved).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: false, state: "duplicate_suppressed", deduped: true, priorState: "claimed" });
    expect(r.error).toMatch(/already claimed/);
  });

  it("a prior UNKNOWN attempt is surfaced as such — never retried, never called sent", async () => {
    brainMemory.create.mockRejectedValueOnce({ code: "P2002" });
    brainMemory.findUnique.mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 60_000), content: "unknown:x" });
    const r = await run({ message: "hi", urgency: "high" });
    expect(sendTelegramObserved).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: false, state: "duplicate_suppressed", priorState: "unknown" });
    expect(r.error).toMatch(/unknown completion/);
  });

  it("a transport timeout is UNKNOWN completion: sent:false, an error the model sees, and the marker is KEPT as unknown (no blind retry)", async () => {
    sendTelegramObserved.mockResolvedValueOnce({ state: "unknown_completion", reason: "TimeoutError" });
    const r = await run({ message: "hi", urgency: "medium" });
    expect(r).toMatchObject({ sent: false, state: "unknown_completion" });
    expect(r.error).toMatch(/unknown/);
    expect(brainMemory.deleteMany).not.toHaveBeenCalled();
    const marked = brainMemory.update.mock.calls.some(
      (c) => typeof c[0]?.data?.content === "string" && c[0].data.content.startsWith("unknown:"),
    );
    expect(marked).toBe(true);
  });

  it("an explicit provider rejection is a KNOWN failure: sent:false and the marker is released so a real retry can run", async () => {
    sendTelegramObserved.mockResolvedValueOnce({ state: "known_failure", reason: "telegram_http_400", status: 400 });
    const r = await run({ message: "hi", urgency: "low" });
    expect(r).toMatchObject({ sent: false, state: "known_failure" });
    expect(r.error).toMatch(/failed/);
    expect(brainMemory.deleteMany).toHaveBeenCalledOnce();
  });

  it("fails CLOSED when the claim store is unavailable: no send, an honest state", async () => {
    brainMemory.create.mockRejectedValueOnce(new Error("db down"));
    const r = await run({ message: "hi", urgency: "medium" });
    expect(sendTelegramObserved).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: false, state: "idempotency_unavailable" });
    expect(r.error).toMatch(/unavailable/);
  });
});

/**
 * NICKSTIRE-A (2026-09-30): Studio sends its source detail (allowed up to 1000
 * chars) as generateReelBrief's `topic`, which the router capped at max(300) —
 * so every long detail was refused with a zod BAD_REQUEST before generation
 * ran (3 occurrences in 10s). The steer is now capped, not refused, and the
 * full detail still reaches the generator via sourceDetail.
 */
import { describe, expect, it, vi } from "vitest";

const { generateReelBriefAI } = vi.hoisted(() => ({
  generateReelBriefAI: vi.fn(async () => ({ brief: { topic: "t" } })),
}));

vi.mock("./services/reelBriefGen", () => ({ generateReelBriefAI }));
vi.mock("./services/reelQualityScore", () => ({ scoreReelBriefWithMemory: vi.fn(async () => ({ overall: 80 })) }));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin", loginMethod: "manus",
      role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

describe("contentAdmin.generateReelBrief topic steer", () => {
  it("accepts a source detail longer than 300 chars as the topic and caps the steer", async () => {
    const detail = "Customer declined front brake pads and rotors; grinding noise on stops. ".repeat(9).trim();
    expect(detail.length).toBeGreaterThan(300);
    expect(detail.length).toBeLessThanOrEqual(1000);

    const res = await appRouter.createCaller(ctx()).contentAdmin.generateReelBrief({
      topic: detail,
      sourceType: "manual_idea",
      sourceDetail: detail,
    });

    expect(res.success).toBe(true);
    const passed = generateReelBriefAI.mock.calls[0][0] as { topic?: string; sourceDetail?: string };
    expect(passed.topic).toBe(detail.slice(0, 300));
    expect(passed.sourceDetail).toBe(detail);
  });
});

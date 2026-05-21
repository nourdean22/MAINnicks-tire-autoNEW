/**
 * Create-schema contract tests · 2026-05-21.
 *
 * taskCreateSchema and missionCreateSchema sit behind the only two
 * tRPC mutations with a permissive `z.record()` input — task.create
 * and task.createMission. A permissive input means TypeScript gives
 * the calling page ZERO payload safety: the *only* contract between
 * the client payload and the server is the runtime `.parse()` inside
 * createTask() / createMission(). When a page sends a thin payload the
 * schema didn't expect, `.parse()` throws a ZodError that surfaces as
 * a generic "Failed to …" toast — exactly the 2026-05-21 add-task bug.
 *
 * These tests pin the *real* thin payloads the /tasks page sends — the
 * quick-add bar and getInbox()'s auto-Inbox creation — directly
 * against the schemas. A future "make this field required again" edit
 * now fails CI instead of production. Pure schema parse, no Prisma —
 * the contract is the schema, so the test is too.
 */

import { describe, it, expect } from "vitest";
import { taskCreateSchema } from "@/lib/validators/tasks";
import { missionCreateSchema } from "@/lib/validators/missions";

describe("taskCreateSchema · /tasks quick-add contract", () => {
  // The minimum the quick-add bar can produce: a bare title + the
  // resolved inbox missionId. Everything else must default.
  it("accepts the bare quick-add payload (title + missionId)", () => {
    const r = taskCreateSchema.parse({ title: "call the vendor", missionId: "m1" });
    expect(r.effort).toBe("M15");
    expect(r.frictionScore).toBe(50);
    expect(r.energyRequired).toBe("MEDIUM");
    expect(r.context).toBe("ANYWHERE");
    expect(r.roiScore).toBe(50);
    expect(r.loopKind).toBe("ONCE");
  });

  // The exact field set addTask() forwards through trpc.task.create.
  it("accepts the full quick-add bar payload shape", () => {
    expect(() =>
      taskCreateSchema.parse({
        title: "ship the redesign",
        missionId: "m1",
        effort: "M30",
        roiScore: 80,
        loopKind: "PROMISE",
        promiseTo: "dania",
        dueDate: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  // A rich-editor payload must still validate — defaults rescue thin
  // callers without loosening anything for full ones.
  it("accepts a full rich-editor task payload", () => {
    expect(() =>
      taskCreateSchema.parse({
        title: "rebuild the recall layer",
        missionId: "m1",
        nextPhysicalAction: "draft the cosine-similarity query",
        effort: "H1",
        roiScore: 75,
        frictionScore: 40,
        energyRequired: "HIGH",
        context: "DESK",
        finishCondition: "recall p95 < 200ms",
        loopKind: "ONCE",
      }),
    ).not.toThrow();
  });
});

describe("missionCreateSchema · getInbox() auto-Inbox contract", () => {
  // The exact payload getInbox() sends when no mission exists yet.
  // `description` isn't a missionBaseSchema field — z.object() strips
  // unknown keys silently, so it's harmless noise, not a parse error.
  it("accepts the thin auto-Inbox payload getInbox() sends", () => {
    const r = missionCreateSchema.parse({
      title: "Inbox",
      description: "Quick tasks",
      status: "ACTIVE",
    });
    expect(r.domain).toBe("PERSONAL");
    expect(r.priority).toBe(5);
    expect(r.roiScore).toBe(50);
    expect(r.neglectCost).toBe(50);
    expect(r.status).toBe("ACTIVE");
  });

  // A bare title alone must also validate — the most minimal caller.
  it("accepts a mission created from a title alone", () => {
    expect(() => missionCreateSchema.parse({ title: "Inbox" })).not.toThrow();
  });

  // The mission editor's full payload must still validate.
  it("accepts a full mission payload from the editor", () => {
    expect(() =>
      missionCreateSchema.parse({
        title: "Q3 Growth",
        domain: "BUSINESS",
        status: "ACTIVE",
        priority: 8,
        roiScore: 90,
        neglectCost: 70,
      }),
    ).not.toThrow();
  });
});

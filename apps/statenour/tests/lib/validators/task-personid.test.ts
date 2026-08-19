/**
 * Task.personId passthrough (2026-08-19; mechanism CORRECTED by the
 * round-2 adversarial review).
 *
 * Precise history: TWO create paths exist. createTaskAndEnrich takes
 * Prisma.TaskUncheckedCreateInput and creates directly with NO zod
 * parse — so addTasksToProject's personId was never stripped on that
 * path (the original commit message overclaimed "every create"). The
 * createTask() service path (tRPC/REST) DOES parse with
 * taskCreateSchema, which did not list the key — zod silently stripped
 * personId there. This suite pins the schema half: schema membership is
 * the whole write path for createTask because runCore spreads the
 * parsed payload into prisma.task.create. The FK-existence guard for
 * hallucinated personIds lives in createTaskAndEnrich beside the
 * goalId guard (round-2 fix).
 */
import { describe, it, expect } from "vitest";

import { taskCreateSchema, taskUpdateSchema } from "@/lib/validators/tasks";

const base = { title: "call Sam about the invoice", missionId: "m-inbox" };

describe("taskCreateSchema · personId", () => {
  it("retains personId when supplied", () => {
    const parsed = taskCreateSchema.parse({ ...base, personId: "person-1" });
    expect(parsed.personId).toBe("person-1");
  });

  it("accepts explicit null", () => {
    const parsed = taskCreateSchema.parse({ ...base, personId: null });
    expect(parsed.personId).toBeNull();
  });

  it("omits the key entirely when absent — the spread must not write undefined", () => {
    const parsed = taskCreateSchema.parse(base);
    expect("personId" in parsed && parsed.personId !== undefined).toBe(false);
  });
});

describe("taskUpdateSchema · personId", () => {
  it("retains personId on a partial update", () => {
    expect(taskUpdateSchema.parse({ personId: "person-2" }).personId).toBe("person-2");
  });

  it("does not inject personId into an unrelated partial PATCH (zod-v4 partial-defaults trap)", () => {
    const parsed = taskUpdateSchema.parse({ status: "READY" });
    expect("personId" in parsed).toBe(false);
  });
});

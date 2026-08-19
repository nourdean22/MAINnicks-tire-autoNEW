/**
 * Task.personId passthrough (2026-08-19).
 *
 * The column + index have existed since the Power Atlas work, and
 * lib/ai/tools/missions.ts addTasksToProject has been passing personId
 * into createTaskAndEnrich — but taskCreateSchema didn't list the key,
 * so zod parse() silently STRIPPED it and the column stayed null
 * forever. The /people "open promises to X" query and the brain-graph
 * person edge were reading a field nothing could write.
 *
 * createTask spreads the parsed payload into prisma.task.create
 * (lib/services/tasks.ts runCore), so schema membership IS the write
 * path — these tests pin the schema half of that contract.
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

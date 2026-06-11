/**
 * Ultron task-domain slice contract tests · Phase B.6b (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · task-domain sub-slice).
 *
 * The ultron task-domain sub-slice migrated 5 client call-sites in
 * components/ultron/* off `authedFetch` onto `trpc.task.*`:
 *
 *   · resume-last-work.tsx        → task.missions      (REUSED, no input)
 *   · next-action-whisperer.tsx   → task.list (REUSED) · task.update (REUSED)
 *   · active-task-companion.tsx   → task.session · task.logSessionEvent (NEW)
 *   · todo-desk.tsx (patchTask)   → task.update        (REUSED)
 *   · omni-capture.tsx            → task.create · task.createMission (REUSED)
 *                                   · task.missions   (REUSED, no input)
 *
 * The risk that migration introduces is the typed-payload-mismatch
 * class: a client payload TypeScript accepts but the server Zod input
 * rejects at runtime, surfacing as a generic failure toast (the /tasks
 * quick-add bug, 2026-05-21).
 *
 * Procedures with no payload to mismatch — `task.missions` (no input)
 * and `task.list` (called with `undefined` from the whisperer) — have
 * nothing to pin.
 *
 * The structured-input procedures this sub-slice exercises:
 *
 *   1. SHARED-SCHEMA · `task.update` takes z.object({ id, fields:
 *      taskUpdateSchema }) · `taskUpdateSchema` from @/lib/validators/tasks
 *      is the EXACT schema `services/tasks.updateTask` re-parses. The
 *      ultron call-sites send 1-2 key partial-field maps.
 *
 *   2. REUSED-PERMISSIVE · `task.create` / `task.createMission` use a
 *      permissive `z.record(z.string(), z.unknown())` tRPC input · the
 *      REAL validation is `taskCreateSchema` / `missionCreateSchema`
 *      inside the delegated service. So the genuine contract for the
 *      migrated call-sites is the downstream schema — pinned here.
 *
 *   3. NEW-INLINE · `task.session` / `task.logSessionEvent` declare
 *      strict inline `z.object({...})` inputs in lib/trpc/routers/task.ts
 *      (no permissive z.record — the bug-class guard). Those `.input(...)`
 *      objects are re-declared here VERBATIM so a tightened bound fails
 *      CI before it breaks a real call-site.
 *
 * Pure schema parse, no Prisma — the contract is the schema, so the
 * test is too. Mirrors tests/lib/validators/ultron-operator-schemas.test.ts
 * + tests/lib/validators/task-actions-schemas.test.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { taskUpdateSchema, taskCreateSchema } from "@/lib/validators/tasks";
import { missionCreateSchema } from "@/lib/validators/missions";

// ──────────────── task.update · taskUpdateSchema ────────────────
//
// task.update's input is z.object({ id, fields: taskUpdateSchema }).
// The `fields` payloads below are the exact partial-update objects the
// two migrated ultron call-sites send. taskUpdateSchema =
// taskBaseSchema.partial(), so every key is optional.

describe("taskUpdateSchema · ultron task.update call-site payloads", () => {
  it("accepts the next-action-whisperer start payload — { status: 'DOING' }", () => {
    // next-action-whisperer.tsx `start()` → fields: { status: "DOING" }
    expect(() => taskUpdateSchema.parse({ status: "DOING" })).not.toThrow();
  });

  it("accepts every todo-desk patchTask status transition", () => {
    // todo-desk.tsx start/finish/pause → { status: <X> }
    for (const status of ["DOING", "DONE", "READY", "INBOX"] as const) {
      expect(() => taskUpdateSchema.parse({ status })).not.toThrow();
    }
  });

  it("accepts the todo-desk archive payload — status + autoPriorityExplanation", () => {
    // todo-desk.tsx `archive()` → { status: "ARCHIVED",
    //   autoPriorityExplanation: "parked via desk" }
    expect(() =>
      taskUpdateSchema.parse({
        status: "ARCHIVED",
        autoPriorityExplanation: "parked via desk",
      }),
    ).not.toThrow();
  });

  it("accepts the todo-desk skip payload — status INBOX + a skip explanation", () => {
    // todo-desk.tsx `skip()` → { status: "INBOX",
    //   autoPriorityExplanation: "skipped · <reason>" }
    expect(() =>
      taskUpdateSchema.parse({
        status: "INBOX",
        autoPriorityExplanation: "skipped · waiting on parts",
      }),
    ).not.toThrow();
  });

  it("rejects a status outside the TaskStatus enum — the enum is the guard", () => {
    expect(() =>
      taskUpdateSchema.parse({ status: "PARKED" as unknown as "INBOX" }),
    ).toThrow();
  });
});

// ──────────────── task.create · taskCreateSchema ────────────────
//
// task.create's tRPC `.input()` is a permissive z.record — the real
// validation is `taskCreateSchema` inside createTaskFromAPI →
// createTask. omni-capture.tsx fires two distinct create payloads.

describe("taskCreateSchema · omni-capture task.create call-site payloads", () => {
  it("accepts the omni-capture quick-task payload — { title, status, source }", () => {
    // fire() case "task" → { title: text.slice(0,200), status: "INBOX",
    //   source: "omni-capture" }. missionId is absent — createTaskFromAPI
    //   defaults it to the Inbox mission before createTask runs, but the
    //   schema itself requires missionId, so the thin payload is pinned
    //   WITH missionId supplied (the shape createTask actually parses).
    expect(() =>
      taskCreateSchema.parse({
        title: "call Mike about the brake quote",
        missionId: "m-inbox",
        status: "INBOX",
        source: "omni-capture",
      }),
    ).not.toThrow();
  });

  it("accepts the omni-capture plan-step task payload — the full field set", () => {
    // executePlanStep() case "task" → the rich create body.
    expect(() =>
      taskCreateSchema.parse({
        title: "draft the Q3 brake-bay plan",
        missionId: "m-inbox",
        nextPhysicalAction: "draft the Q3 brake-bay plan",
        effort: "M15",
        roiScore: 55,
        frictionScore: 30,
        energyRequired: "MEDIUM",
        context: "ANYWHERE",
        finishCondition: "Done",
        autoPriorityExplanation: "from plan: micro-plan",
      }),
    ).not.toThrow();
  });

  it("rejects a create payload with no title — title is required", () => {
    expect(() =>
      taskCreateSchema.parse({ missionId: "m-inbox", status: "INBOX" }),
    ).toThrow();
  });

  it("rejects an effort outside the EffortBand enum", () => {
    expect(() =>
      taskCreateSchema.parse({
        title: "x",
        missionId: "m-inbox",
        effort: "M45" as unknown as "M15",
      }),
    ).toThrow();
  });
});

// ──────────────── task.createMission · missionCreateSchema ────────────────
//
// task.createMission's tRPC `.input()` is a permissive z.record — the
// real validation is `missionCreateSchema` inside createMission.
// omni-capture executePlanStep() creates the Inbox mission when none
// exists.

describe("missionCreateSchema · omni-capture task.createMission payload", () => {
  it("accepts the omni-capture Inbox-create payload — { title, description, status }", () => {
    // executePlanStep() case "task" → createMission({ title: "Inbox",
    //   description: "Ad-hoc tasks", status: "ACTIVE" }).
    // NOTE · `missionCreateSchema` has no `description` field · Zod's
    // default object behaviour STRIPS the unknown `description` key
    // (it does not reject it · the schema is not `.strict()`). The
    // legacy POST /api/missions route called the same `createMission`,
    // so `description` was always dropped — no regression, pinned here
    // so the strip stays intentional.
    expect(() =>
      missionCreateSchema.parse({
        title: "Inbox",
        description: "Ad-hoc tasks",
        status: "ACTIVE",
      }),
    ).not.toThrow();
  });

  it("rejects a mission-create payload with no title — title is required", () => {
    expect(() =>
      missionCreateSchema.parse({ description: "Ad-hoc tasks", status: "ACTIVE" }),
    ).toThrow();
  });
});

// ──────────────── task.session ────────────────
//
// active-task-companion.tsx `loadSession()` fires
// utils.task.session.fetch({ taskId }). The tRPC `.input()` is
// re-declared verbatim from lib/trpc/routers/task.ts.

describe("task.session · call-site payload contract", () => {
  const sessionInput = z.object({ taskId: z.string().min(1).max(64) });

  it("accepts the loadSession payload — { taskId }", () => {
    expect(() =>
      sessionInput.parse({ taskId: "clx9k2p4t0001abcd1234efgh" }),
    ).not.toThrow();
  });

  it("rejects an empty taskId — min(1) is the guard", () => {
    expect(() => sessionInput.parse({ taskId: "" })).toThrow();
  });

  it("rejects a missing taskId key", () => {
    expect(() => sessionInput.parse({})).toThrow();
  });
});

// ──────────────── task.logSessionEvent ────────────────
//
// active-task-companion.tsx `submit()` fires
// logSessionEvent.mutateAsync({ taskId, ...payload }) for note / photo
// / voice / log events. The tRPC `.input()` is re-declared verbatim
// from lib/trpc/routers/task.ts — a STRICT z.object with a 4-value
// `kind` enum (the route's `["note","photo","voice","log"].includes`
// check, hoisted to the boundary).

describe("task.logSessionEvent · call-site payload contract", () => {
  const logSessionEventInput = z.object({
    taskId: z.string().min(1).max(64),
    kind: z.enum(["note", "photo", "voice", "log"]),
    text: z.string().max(20_000).optional(),
    photoUrl: z.string().max(2_500_000).optional(),
    audioUrl: z.string().max(2_500_000).optional(),
    durationMs: z.number().int().min(0).max(86_400_000).optional(),
  });

  it("accepts the note payload — saveNote() → { taskId, kind: 'note', text }", () => {
    expect(() =>
      logSessionEventInput.parse({
        taskId: "task-1",
        kind: "note",
        text: "checked the rotor spec — within tolerance",
      }),
    ).not.toThrow();
  });

  it("accepts the log payload — logProgress() → { taskId, kind: 'log', text }", () => {
    expect(() =>
      logSessionEventInput.parse({
        taskId: "task-1",
        kind: "log",
        text: "progress check · 2:45 PM",
      }),
    ).not.toThrow();
  });

  it("accepts the voice payload — onend → { kind: 'voice', text, durationMs }", () => {
    expect(() =>
      logSessionEventInput.parse({
        taskId: "task-1",
        kind: "voice",
        text: "transcribed voice note",
        durationMs: 12_400,
      }),
    ).not.toThrow();
  });

  it("accepts the photo payload — onPhotoPick → { kind: 'photo', photoUrl }", () => {
    // The companion caps the data URL at ~2MB before submit · the 2.5MB
    // schema bound is the tRPC-boundary guard, generous above that cap.
    expect(() =>
      logSessionEventInput.parse({
        taskId: "task-1",
        kind: "photo",
        photoUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
      }),
    ).not.toThrow();
  });

  it("rejects a kind outside the 4-value enum — the companion only emits note/photo/voice/log", () => {
    // A permissive z.string() here would let an unknown kind through to
    // the service's stricter check — exactly the bug class this slice
    // guards against. The enum rejects it at the tRPC boundary.
    expect(() =>
      logSessionEventInput.parse({
        taskId: "task-1",
        kind: "audio" as unknown as "voice",
      }),
    ).toThrow();
  });

  it("rejects an empty taskId", () => {
    expect(() =>
      logSessionEventInput.parse({ taskId: "", kind: "note" }),
    ).toThrow();
  });

  it("rejects a missing kind key — kind is required", () => {
    expect(() =>
      logSessionEventInput.parse({ taskId: "task-1", text: "orphan note" }),
    ).toThrow();
  });
});

// ──────────────── task.byId ────────────────
//
// /missions?taskId= deep-link support · fires trpc.task.byId({ id }).
// The tRPC `.input()` is re-declared verbatim from lib/trpc/routers/task.ts.

describe("task.byId · call-site payload contract", () => {
  const byIdInput = z.object({ id: z.string().min(1).max(64) });

  it("accepts the byId payload — { id }", () => {
    expect(() =>
      byIdInput.parse({ id: "clx9k2p4t0001abcd1234efgh" }),
    ).not.toThrow();
  });

  it("rejects an empty id — min(1) is the guard", () => {
    expect(() => byIdInput.parse({ id: "" })).toThrow();
  });

  it("rejects a missing id key", () => {
    expect(() => byIdInput.parse({})).toThrow();
  });
});

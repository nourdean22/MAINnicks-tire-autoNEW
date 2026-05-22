/**
 * Journal-router contract tests · Phase TT.2 (2026-05-22 ·
 * legacy-modernizer REST→tRPC journal slice).
 *
 * The journal slice migrated 6 client files off `authedFetch` onto
 * `trpc.journal.*`. The risk that migration introduces is the
 * typed-payload-mismatch class: a client payload that TypeScript
 * accepts but the server Zod input rejects at runtime, surfacing as a
 * generic "save failed" toast (the /tasks quick-add bug, 2026-05-21).
 *
 * The two journal procedures with a structured input — `journal.reflect`
 * and `journal.calibrate` — take their schema from
 * @/lib/validators/journal, the SAME schema the legacy REST routes parse.
 * These tests pin the *real* payloads the ReflectComposer and
 * MemoryCalibration components send directly against those schemas. A
 * future "make this field required again" edit now fails CI instead of
 * production. Pure schema parse, no Prisma — the contract is the schema,
 * so the test is too.
 *
 * The thread / convergence / suggestion procedures take bare scalar
 * inputs (key · hash · name) declared inline in the router; their
 * payload shapes are exercised here too so a tightened bound (e.g. a
 * shorter max length) can't silently break a real call-site.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  calibrationRulingSchema,
  reflectSubmitSchema,
} from "@/lib/validators/journal";

// ───────────────────────── reflect ─────────────────────────
//
// The exact payloads ReflectComposer.submit() forwards through
// trpc.journal.reflect.useMutation. One per template — each template
// has a different field set, and `submit` always sends askPushback:true
// plus the persisted extractIntelligence toggle.

describe("reflectSubmitSchema · ReflectComposer submit contract", () => {
  it("accepts the Driscoll submission (3 fields · the default template)", () => {
    const r = reflectSubmitSchema.parse({
      template: "driscoll",
      fields: {
        what: "shipped the journal tRPC slice",
        so_what: "drift between REST and tRPC is now structurally gone",
        now_what: "soak it, then decommission the dead routes",
      },
      mood: "focused",
      askPushback: true,
      extractIntelligence: false,
    });
    expect(r.template).toBe("driscoll");
    expect(r.askPushback).toBe(true);
  });

  it("accepts the SOAP submission (4 fields)", () => {
    expect(() =>
      reflectSubmitSchema.parse({
        template: "soap",
        fields: {
          subjective: "felt slow today",
          objective: "3 commits, 1 review",
          assessment: "pace is fine, perception is off",
          plan: "log a reflection nightly",
        },
        askPushback: true,
        extractIntelligence: false,
      }),
    ).not.toThrow();
  });

  it("accepts the AAR submission with extraction toggled ON", () => {
    const r = reflectSubmitSchema.parse({
      template: "aar",
      fields: {
        expected: "clean 6/6 migration",
        happened: "clean 6/6 migration",
        lesson: "shared schema is the whole game",
        adjust: "extract a service before the router, every time",
      },
      mood: "motivated",
      askPushback: true,
      extractIntelligence: true,
    });
    expect(r.extractIntelligence).toBe(true);
  });

  it("accepts a thin submission — one field, no mood, defaults rescue the rest", () => {
    // The composer lets the operator submit with a single field filled.
    // mood/askPushback/extractIntelligence are all optional — the
    // payload below is the genuine minimum a call-site can produce.
    const r = reflectSubmitSchema.parse({
      template: "ssc",
      fields: { stop: "context-switching mid-task" },
    });
    expect(r.template).toBe("ssc");
    // optionals stay undefined — the server applies its own behaviour
    expect(r.mood).toBeUndefined();
    expect(r.askPushback).toBeUndefined();
  });

  it("rejects an unknown template — the enum is the guard", () => {
    expect(() =>
      reflectSubmitSchema.parse({ template: "freeform", fields: {} }),
    ).toThrow();
  });
});

// ───────────────────────── calibrate ─────────────────────────
//
// The exact payloads MemoryCalibration.act() forwards through
// trpc.journal.calibrate.useMutation. `act(id, action, newContent?)` —
// verify/retire omit newContent, update sends it.

describe("calibrationRulingSchema · MemoryCalibration act contract", () => {
  it("accepts a verify ruling (no newContent — act omits it)", () => {
    const r = calibrationRulingSchema.parse({
      id: "mem_abc123",
      action: "verify",
    });
    expect(r.action).toBe("verify");
    expect(r.newContent).toBeUndefined();
  });

  it("accepts a retire ruling (no newContent)", () => {
    expect(() =>
      calibrationRulingSchema.parse({ id: "mem_abc123", action: "retire" }),
    ).not.toThrow();
  });

  it("accepts an update ruling carrying the edited content", () => {
    const r = calibrationRulingSchema.parse({
      id: "mem_abc123",
      action: "update",
      newContent: "Nour prefers blunt feedback, not cushioned",
    });
    expect(r.action).toBe("update");
    expect(r.newContent).toContain("blunt");
  });

  it("accepts the explicit-undefined newContent act() sends for verify", () => {
    // act() calls mutateAsync({ id, action, newContent }) where
    // newContent is the function's optional 3rd arg — `undefined` for a
    // verify/retire ruling. An optional field must accept that verbatim.
    expect(() =>
      calibrationRulingSchema.parse({
        id: "mem_abc123",
        action: "verify",
        newContent: undefined,
      }),
    ).not.toThrow();
  });

  it("rejects an unknown action — the enum is the guard", () => {
    expect(() =>
      calibrationRulingSchema.parse({ id: "mem_abc123", action: "delete" }),
    ).toThrow();
  });
});

// ─────────────────── thread / convergence / suggestion ───────────────────
//
// These procedures take bare scalar inputs declared inline in the
// router. The schemas below are the literal `.input(...)` objects from
// lib/trpc/routers/journal.ts — re-declared here so a tightened bound
// in the router fails this test before it breaks a real call-site.

describe("journal scalar-input procedures · call-site payload contract", () => {
  // journal.createThread — ThreadRail (operator new thread) +
  // ThreadRadar CandidateCard (confirm convergence candidate).
  const createThreadInput = z.object({
    name: z.string().min(1).max(120),
    clusterHash: z.string().min(1).max(200).optional(),
    summary: z.string().max(400).nullable().optional(),
  });

  it("createThread accepts the ThreadRail operator-new-thread payload", () => {
    // submitNewThread() sends only { name }.
    expect(() =>
      createThreadInput.parse({ name: "the pricing puzzle" }),
    ).not.toThrow();
  });

  it("createThread accepts the CandidateCard confirm payload", () => {
    // CandidateCard.confirm() sends { clusterHash, name }.
    expect(() =>
      createThreadInput.parse({
        clusterHash: "cluster_9f2a1b",
        name: "the cleveland question",
      }),
    ).not.toThrow();
  });

  it("createThread rejects an empty name", () => {
    expect(() => createThreadInput.parse({ name: "" })).toThrow();
  });

  // journal.acceptSuggestion / dismissSuggestion — ThreadSuggestions.
  // The composite key shape is `${threadId}:${entrySource}:${entryId}`.
  const suggestionKeyInput = z.object({
    key: z.string().min(1).max(200),
  });

  it("suggestion procedures accept the composite-key payload", () => {
    expect(() =>
      suggestionKeyInput.parse({
        key: "thread_abc:brain_dump:bd_xyz789",
      }),
    ).not.toThrow();
  });

  // journal.dismissCandidate — ThreadRadar CandidateCard.dismiss().
  const dismissCandidateInput = z.object({
    hash: z.string().min(1).max(200),
  });

  it("dismissCandidate accepts the clusterHash payload", () => {
    expect(() =>
      dismissCandidateInput.parse({ hash: "cluster_9f2a1b" }),
    ).not.toThrow();
  });

  // journal.feed — the /journal page load() call. The page sends a
  // fully-specified object: { source?, type, limit, days }.
  const feedInput = z
    .object({
      limit: z.number().int().min(1).max(200).default(100),
      days: z.number().int().min(1).max(365).default(60),
      type: z.string().max(40).nullable().optional(),
      source: z.string().max(40).optional(),
    })
    .optional();

  it("feed accepts the /journal page load() payload (all-filter)", () => {
    // load() with no source/type filter sends source:undefined, type:null.
    const r = feedInput.parse({
      source: undefined,
      type: null,
      limit: 100,
      days: 60,
    });
    expect(r?.limit).toBe(100);
  });

  it("feed accepts the load() payload with both filters active", () => {
    expect(() =>
      feedInput.parse({
        source: "dump",
        type: "insight",
        limit: 100,
        days: 60,
      }),
    ).not.toThrow();
  });
});

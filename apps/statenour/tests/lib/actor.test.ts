/**
 * Unit tests for lib/db/actor.ts
 *
 * v7.8 · B3.4 · Apr 29 — covers actor resolution from heterogeneous
 * input shapes, the async-context wrapper, and the audit field
 * spread helpers.
 */

import { describe, it, expect } from "vitest";
import {
  resolveActor,
  isActor,
  actorFromCron,
  actorFromChat,
  actorFromBridge,
  withActor,
  currentActor,
  auditCreate,
  auditUpdate,
} from "@/lib/db/actor";

describe("isActor", () => {
  it("accepts known plain values", () => {
    expect(isActor("user")).toBe(true);
    expect(isActor("nick")).toBe(true);
    expect(isActor("system")).toBe(true);
  });

  it("accepts cron: and bridge: prefixed values", () => {
    expect(isActor("cron:brain-cycle")).toBe(true);
    expect(isActor("bridge:nickstire")).toBe(true);
  });

  it("rejects unknown shapes", () => {
    expect(isActor("rogue")).toBe(false);
    expect(isActor("")).toBe(false);
  });
});

describe("resolveActor", () => {
  it("passes through known actor strings", () => {
    expect(resolveActor("user")).toBe("user");
    expect(resolveActor("cron:foo")).toBe("cron:foo");
  });

  it("falls back to system on unknown strings", () => {
    expect(resolveActor("garbage")).toBe("system");
  });

  it("recognizes chat=true → nick", () => {
    expect(resolveActor({ chat: true })).toBe("nick");
  });

  it("formats cron / bridge inputs", () => {
    expect(resolveActor({ cron: "weekly-review" })).toBe("cron:weekly-review");
    expect(resolveActor({ bridge: "nickstire" })).toBe("bridge:nickstire");
  });

  it("derives 'user' from a Request with cookies", () => {
    const req = new Request("https://example.com", {
      headers: { cookie: "authjs.session-token=abc" },
    });
    expect(resolveActor(req)).toBe("user");
  });

  it("falls back to system on cookieless Request", () => {
    const req = new Request("https://example.com");
    expect(resolveActor(req)).toBe("system");
  });

  it("respects an explicit actor field on objects", () => {
    expect(resolveActor({ actor: "cron:custom" })).toBe("cron:custom");
  });

  it("handles null / undefined / non-objects safely", () => {
    expect(resolveActor(null)).toBe("system");
    expect(resolveActor(undefined)).toBe("system");
    expect(resolveActor(42)).toBe("system");
  });

  it("truncates oversized cron names defensively", () => {
    const long = "x".repeat(200);
    const out = resolveActor({ cron: long });
    expect(out.length).toBeLessThan(60);
    expect(out.startsWith("cron:")).toBe(true);
  });
});

describe("fast-path constructors", () => {
  it("actorFromCron + Chat + Bridge", () => {
    expect(actorFromCron("brain-cycle")).toBe("cron:brain-cycle");
    expect(actorFromChat()).toBe("nick");
    expect(actorFromBridge("nickstire")).toBe("bridge:nickstire");
  });
});

describe("withActor + currentActor (async context)", () => {
  it("returns 'system' outside any withActor scope", () => {
    expect(currentActor()).toBe("system");
  });

  it("returns the wrapped actor inside the scope", async () => {
    await withActor("nick", async () => {
      expect(currentActor()).toBe("nick");
    });
  });

  it("propagates through deep async nesting", async () => {
    await withActor("cron:demo", async () => {
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      expect(currentActor()).toBe("cron:demo");
    });
  });

  it("restores prior context on exit", async () => {
    await withActor("nick", async () => {
      expect(currentActor()).toBe("nick");
    });
    expect(currentActor()).toBe("system");
  });

  it("nests correctly", async () => {
    await withActor("user", async () => {
      expect(currentActor()).toBe("user");
      await withActor("nick", async () => {
        expect(currentActor()).toBe("nick");
      });
      expect(currentActor()).toBe("user");
    });
  });
});

describe("auditCreate / auditUpdate", () => {
  it("auditCreate sets both fields to the current actor", async () => {
    await withActor("nick", async () => {
      const out = auditCreate();
      expect(out).toEqual({ createdBy: "nick", updatedBy: "nick" });
    });
  });

  it("auditUpdate sets only updatedBy", async () => {
    await withActor("user", async () => {
      const out = auditUpdate();
      expect(out).toEqual({ updatedBy: "user" });
    });
  });

  it("falls back to system outside scope", () => {
    expect(auditCreate()).toEqual({ createdBy: "system", updatedBy: "system" });
    expect(auditUpdate()).toEqual({ updatedBy: "system" });
  });
});

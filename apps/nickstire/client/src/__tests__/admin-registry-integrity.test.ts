/**
 * Admin registry integrity — structural invariants for ADMIN_REGISTRY.
 *
 * 2026-07-04 maintainability audit: registry.tsx's `resolveSection()` does
 * a linear scan for an exact `id` match, then a second linear scan for an
 * `alias` match — first hit wins, silently. Nothing stops two entries from
 * registering the same alias (or an alias that collides with another
 * entry's own `id`), and COMPOUND_REDIRECTS' `section` values are hand-typed
 * strings with no compile-time link back to ADMIN_REGISTRY. Both failure
 * modes are silent at authoring time and only visible as "this nav link
 * goes to the wrong place" in the running app. These tests make either
 * fail the build instead.
 */
import { describe, it, expect } from "vitest";
import { ADMIN_REGISTRY, COMPOUND_REDIRECTS } from "../pages/admin/registry";

describe("ADMIN_REGISTRY — structural integrity", () => {
  it("has no duplicate section ids", () => {
    const ids = ADMIN_REGISTRY.map((s) => s.id);
    const unique = new Set(ids);
    expect([...unique].sort()).toEqual([...ids].sort());
  });

  it("has no alias reused across two different sections", () => {
    const owner = new Map<string, string>(); // alias -> owning section id
    const collisions: string[] = [];
    for (const entry of ADMIN_REGISTRY) {
      for (const alias of entry.aliases ?? []) {
        const key = alias.toLowerCase();
        const existingOwner = owner.get(key);
        if (existingOwner && existingOwner !== entry.id) {
          collisions.push(`"${alias}" claimed by both "${existingOwner}" and "${entry.id}"`);
        } else {
          owner.set(key, entry.id);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it("has no alias that collides with a different section's own id", () => {
    const ids = new Set(ADMIN_REGISTRY.map((s) => s.id.toLowerCase()));
    const collisions: string[] = [];
    for (const entry of ADMIN_REGISTRY) {
      for (const alias of entry.aliases ?? []) {
        const key = alias.toLowerCase();
        if (ids.has(key) && key !== entry.id.toLowerCase()) {
          collisions.push(`alias "${alias}" on "${entry.id}" shadows section id "${key}"`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it("every COMPOUND_REDIRECTS target section exists in ADMIN_REGISTRY", () => {
    const validIds = new Set(ADMIN_REGISTRY.map((s) => s.id));
    const dangling = Object.entries(COMPOUND_REDIRECTS)
      .filter(([, target]) => !validIds.has(target.section))
      .map(([slug, target]) => `"${slug}" -> unknown section "${target.section}"`);
    expect(dangling).toEqual([]);
  });
});

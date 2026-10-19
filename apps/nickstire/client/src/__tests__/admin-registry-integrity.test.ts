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
import { ADMIN_REGISTRY, COMPOUND_REDIRECTS, RETIRED_SECTIONS, resolveNavTarget } from "../pages/admin/registry";
import { INNER_TABS, type InnerTabSection } from "../pages/admin/innerTabs";

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

  // 2026-10-19 (admin prune W1): retired ids and aliases share one resolver with
  // the live ones, so a collision would silently send a link to the wrong place.
  it("no retired slug collides with a live id, live alias, compound key or another retired slug", () => {
    const live = new Set<string>();
    for (const e of ADMIN_REGISTRY) {
      live.add(e.id.toLowerCase());
      for (const a of e.aliases ?? []) live.add(a.toLowerCase());
    }
    for (const k of Object.keys(COMPOUND_REDIRECTS)) live.add(k.toLowerCase());
    const seen = new Set<string>();
    const collisions: string[] = [];
    for (const r of RETIRED_SECTIONS) {
      for (const slug of [r.id.toLowerCase(), ...r.aliases]) {
        if (slug !== slug.toLowerCase()) collisions.push(`"${slug}" is not lower-case`);
        if (live.has(slug) || seen.has(slug)) collisions.push(`"${slug}" (retired ${r.id}) resolves twice`);
        seen.add(slug);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("every retired target is a live section and an inner tab value that exists", () => {
    const validIds = new Set(ADMIN_REGISTRY.map((s) => s.id));
    for (const r of RETIRED_SECTIONS) {
      expect(validIds.has(r.to.section), r.id).toBe(true);
      const spec = INNER_TABS[r.to.section as InnerTabSection];
      expect(spec?.key, `${r.id} inner key`).toBe(r.to.innerKey);
      expect(spec?.values, `${r.id} inner value`).toContain(r.to.innerValue);
      expect(resolveNavTarget(r.id)).toEqual(r.to);
    }
  });
});

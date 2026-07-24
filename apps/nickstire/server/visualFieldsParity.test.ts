/**
 * VISUAL_FIELDS ↔ renderer parity + client CAS-honesty pins (Wave 2, 2026-07-24).
 *
 * The client's VISUAL_FIELDS set decides which edits clear rendered media.
 * The renderer's inputs decide which edits SHOULD. These live in different
 * files owned by different layers, and they drifted exactly once already:
 * the renderer started reading artDirection (familyFromArtDirection picks the
 * visual family) while the client comment still said "the renderer never
 * reads it" — so editing art direction kept stale media attached.
 *
 * Source assertions, same style as deferredPublishOwnership.test.ts: what
 * must not regress is a set literal in one file matching a consumption site
 * in another, which is exactly what a source pin measures.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const studioV2 = () => read("client/src/pages/admin/instagram/StudioV2.tsx");
const rendererService = () => read("server/services/instagramStudio.ts");

function visualFieldsBlock(source: string): string {
  const m = source.match(/const VISUAL_FIELDS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!m) throw new Error("VISUAL_FIELDS set literal not found in StudioV2.tsx");
  return m[1];
}

describe("VISUAL_FIELDS covers what the renderer actually draws", () => {
  it("premise: the renderer consumes artDirection (familyFromArtDirection)", () => {
    // If this stops matching, the renderer no longer reads artDirection and
    // the rule below should be revisited — do not delete the rule blindly.
    expect(rendererService()).toMatch(/familyFromArtDirection\(\s*draft\.artDirection/);
  });

  it.each(["format", "headline", "subheadline", "cta", "carouselSlides", "artDirection"])(
    "VISUAL_FIELDS contains %s",
    (field) => {
      expect(visualFieldsBlock(studioV2())).toContain(`"${field}"`);
    },
  );
});

describe("generation and re-score share ONE evaluator-args builder", () => {
  it("the service's generate path builds eval args via buildEvalArgs (not an inline copy)", () => {
    // The inline copy omitted carouselSlides/cta/recentConceptKeys, so the
    // same carousel scored 6 points lower at generation than at re-score.
    const svc = rendererService();
    expect(svc).toMatch(/\.\.\.buildEvalArgs\(/);
    expect(svc).toMatch(/recentConceptKeys:\s*input\.recentConceptKeys/);
  });

  it("the router aliases the service builder instead of keeping its own", () => {
    const router = read("server/routers/instagramStudio.ts");
    expect(router).toMatch(/const evalArgs = buildEvalArgs/);
    expect(router).not.toMatch(/function evalArgs\(/);
  });
});

describe("QueueV2 edit session CAS honesty", () => {
  it("Save sends the version snapshotted at Edit-tap, not the live refetched row's", () => {
    // expectedVersion: item.version tracked the 30s refetch, so a concurrent
    // edit's version was presented as our own and the server CAS never fired.
    const q = read("client/src/pages/admin/instagram/QueueV2.tsx");
    expect(q).toMatch(/expectedVersion:\s*editVersion\s*\?\?\s*item\.version/);
    expect(q).toMatch(/setEditVersion\(item\.version\)/);
  });

  it("re-render results only apply to the item still being edited", () => {
    const q = read("client/src/pages/admin/instagram/QueueV2.tsx");
    expect(q).toMatch(/editingIdRef\.current === \(variables as InstagramStudioDraft\)\.id/);
  });
});

/**
 * IG admin workflow pins — entry-point consolidation, latency boundaries, and
 * the truth layer the reel approval screen was hiding.
 *
 * Each defect below was SILENT in a specific way: a button that lied about where
 * it went, a spinner with no bound, a green all-clear from an unread query, an
 * approval gate whose blocking inputs were unrenderable. None would fail a test
 * that merely exercised the path, so these assert the MECHANISM.
 *
 * Anchors are code-shaped strings that cannot appear in prose — the lesson from
 * igEvidence.test.ts, and one this file's own first run re-taught when a comment
 * matched an assertion.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const IG = "client/src/pages/admin/instagram";

describe("Today has ONE context-free door to Create, not three", () => {
  const today = read(`${IG}/Today.tsx`);
  const hq = read(`${IG}/HQ.tsx`);

  it('the "Reel" button no longer duplicates "New content" byte-for-byte', () => {
    // Both were `onClick={() => onNavigate("create")}` — a Film-icon control
    // labelled "Reel" that silently landed on the STATIC composer at
    // format="post". Two buttons, one behaviour, and the specific label was the
    // false one.
    const bare = today.match(/onClick=\{\(\) => onNavigate\("create"\)\}/g) ?? [];
    expect(bare.length).toBe(1);
  });

  it("the Reel button declares reel intent through the existing handoff", () => {
    expect(today).toContain('writeCreateHandoff({ sourceType: "manual_idea", format: "reel" })');
  });

  it("HQ no longer renders a third door, and stops calling itself a screen", () => {
    // HQ has exactly one importer (Today) and no view key — it is Today's tail
    // section, so an "Enter Studio" button there was the third bare door on one
    // screen.
    expect(hq).not.toMatch(/onNavigate\("studio"\)/);
    expect(hq).not.toMatch(/>Headquarters</);
  });

  it("HQ keeps onNavigate — the reel-recovery link carries real intent", () => {
    // Removing the prop would have taken a USEFUL shortcut with the duplicate.
    expect(hq).toMatch(/onNavigate\?\.\("actions"\)/);
  });

  it("removing the button left no dead imports behind", () => {
    // Button and Plus each had exactly ONE usage — the deleted CTA. Self-audit
    // caught them still imported; typecheck and lint:source both passed anyway
    // (noUnusedLocals is off), so nothing else would have.
    expect(hq).not.toContain('from "@/components/ui/button"');
    expect(hq).not.toMatch(/\bPlus\b/);
  });

  it("HQ's storage copy names the enforced requirement, not CloudFront", () => {
    // "Missing S3/CF" sent the operator hunting for a CloudFront distribution
    // they do not need — only S3_BUCKET is enforced by
    // assertDurableStorageForGeneration. Same class as the Settings.tsx finding
    // raised in review; this was the last consumer still saying it.
    expect(hq).not.toContain("Missing S3/CF");
    expect(hq).not.toContain("Ephemeral Only");
    expect(hq).toContain("health.storage.cdn");
    expect(hq).toMatch(/Permanent URLs via the app/);
  });
});

describe("reel intent survives the handoff instead of being discarded", () => {
  const v2 = read(`${IG}/StudioV2.tsx`);

  it("StudioV2 surfaces startInReel rather than silently dropping format=reel", () => {
    expect(v2).toContain('startInReel: handoff.format === "reel"');
  });

  it("the reel wizard opens directly when asked, saving the second tap", () => {
    expect(v2).toContain("useState(handoff?.startInReel ?? false)");
  });

  it("reel is still absent from the STATIC format state", () => {
    // The point is to route intent, NOT to let the static composer hold a value
    // the server refuses at five separate points.
    expect(v2).toContain('Exclude<InstagramFormat, "reel">');
  });
});

describe("staging a reel no longer strands the operator", () => {
  it("StudioV2 passes onNavigate down, and InstagramAdmin supplies it", () => {
    // Studio.tsx guards its post-stage exit on the prop existing, and the prop
    // was never passed — so a successful stage left the operator in the wizard
    // with only a toast.
    expect(read(`${IG}/StudioV2.tsx`)).toMatch(/onNavigate=\{\(legacyTab\) =>/);
    expect(read(`${IG}/InstagramAdmin.tsx`)).toContain("<StudioV2 onNavigate={navigate} />");
  });
});

describe("the reel's blocking inputs are visible to the operator approving them", () => {
  const studio = read(`${IG}/Studio.tsx`);

  it("buildDraftWorkspace is actually called — it had ZERO callers", () => {
    expect(studio).toContain("buildDraftWorkspace(reelBrief)");
  });

  it("renders mechanicTruth and evidence, the two things grounding hard-blocks on", () => {
    expect(studio).toContain("workspace.truth.mechanicTruth");
    expect(studio).toContain("workspace.truth.evidence");
  });

  it("names the block instead of leaving the operator to guess", () => {
    expect(studio).toContain("workspace.preflight.blocking.map");
    expect(studio).toMatch(/grounding will block/);
  });

  it("reads the REAL PreflightReport shape", () => {
    // status is only "pass" | "block"; there is no `warnings` field — advisory
    // items live on findings[].severity. Guessing this wrong is what the first
    // implementation did.
    expect(studio).toContain('f.severity === "warn"');
    expect(studio).not.toContain("preflight.warnings");
  });

  it("a malformed brief cannot take the review screen down", () => {
    expect(studio).toMatch(/try \{ return buildDraftWorkspace\(reelBrief\); \} catch \{ return null; \}/);
  });
});

describe("one slow procedure no longer gates a whole screen", () => {
  const main = read("client/src/main.tsx");
  const learn = read(`${IG}/Learn.tsx`);

  it("the LLM-backed report is routed OUT of the request batch", () => {
    // httpBatchLink puts concurrent queries in ONE request, so the slowest
    // decides when every other card's data arrives.
    expect(main).toContain("instagramAdmin.getPerformanceReport");
    expect(main).toContain("splitLink({");
    expect(main).toContain("true: httpLink(httpOptions)");
    expect(main).toContain("false: httpBatchLink(httpOptions)");
  });

  it("report.isLoading is no longer in the full-page gate", () => {
    const gate = learn.slice(learn.indexOf("const shellStatus"), learn.indexOf("const winners"));
    expect(gate).not.toContain("report.isLoading");
  });

  it("the recommendations card owns that latency itself", () => {
    expect(learn).toContain('reportStatus.state === "loading"');
    expect(learn).toContain('reportStatus.state === "unavailable"');
  });
});

describe("Insights states what it read", () => {
  const learn = read(`${IG}/Learn.tsx`);

  it("an unread analytics query is unknown, not an empty account", () => {
    expect(learn).toContain('shellStatus.state === "unavailable"');
    expect(learn).toMatch(/unknown<\/strong>, not zero/);
  });

  it("revenue routes BOTH not-read states to the honest branch, killing the $0.00", () => {
    expect(learn).toContain('revenueStatus.state === "unavailable"');
    // The old chain branched on isError alone, so paused fell through to `?? 0`.
    expect(learn).not.toMatch(/\{revenue\.isLoading \? \(/);
  });

  it("a fail-SOFT diagnostics payload cannot print an all-clear", () => {
    // The procedure returns { connected: false, ... } — a TRUTHY object — so
    // `!diagnostics.data` never fired and a DB outage read "No backlog".
    expect(learn).toContain("diagnostics.data.connected !== false");
    expect(learn).toContain("const queueHealth = !diagnosticsUsable");
  });

  it("the limitations list no longer mounts an empty bordered rule", () => {
    expect(learn).toMatch(/\(revenue\.data\?\.limitations \?\? \[\]\)\.length > 0 &&/);
  });

  it("refresh reports what actually failed and covers all six reads", () => {
    expect(learn).toContain("Promise.allSettled");
    // `throwOnError: true` is required — refetch() does not reject by default, so
    // allSettled saw six fulfilled promises and both error branches were dead.
    expect(learn).toContain("swipeFile.refetch({ throwOnError: true })");
    expect(learn).toContain("dubCandidates.refetch({ throwOnError: true })");
    expect(learn).toMatch(/Refresh failed — nothing was updated/);
  });
});

describe("a throw in one view no longer replaces the whole application", () => {
  const admin = read(`${IG}/InstagramAdmin.tsx`);

  it("the IG views are wrapped in their own boundary", () => {
    expect(admin).toContain("<ErrorBoundary");
    expect(admin).toContain("</ErrorBoundary>");
  });

  it("keyed by view, so switching tabs clears a caught error", () => {
    // Without the key the operator is stranded on the fallback until a reload.
    expect(admin).toContain("key={activeView}");
  });
});

describe("AI-generated content stops publishing itself", () => {
  const gen = read("server/content-generator.ts");

  it("articles are written as DRAFT, respecting the column default", () => {
    // Wrote "published", overriding .default("draft"), so every generated
    // article went live on nickstire.org/blog and into the sitemap while the
    // admin showed a Drafts counter that could never be non-zero.
    expect(gen).not.toMatch(/status: "published",\s*\n\s*generatedBy: "ai"/);
    expect(gen).toContain('status: "draft"');
  });

  it("notifications start INACTIVE, so the activate toggle means something", () => {
    expect(gen).not.toMatch(/isActive: 1,\s*\n\s*generatedBy: "ai"/);
    expect(gen).toMatch(/isActive: 0,/);
  });

  it("the operator-facing status vocabulary is untouched", () => {
    // Publishing is still one click away — this gates the DEFAULT, it does not
    // remove the capability.
    expect(gen).toContain('updateArticleStatus');
  });
});

describe("a permanent zero names its own cause", () => {
  it("the From Intelligence counter distinguishes empty payload from unread", () => {
    const ideas = read("client/src/pages/admin/content/AIIdeasEngine.tsx");
    expect(ideas).toContain("intelligenceRead");
    expect(ideas).toMatch(/payloads carry no topics/);
  });
});

describe("the section name describes its job, without stranding links", () => {
  const registry = read("client/src/pages/admin/registry.tsx");

  it("renamed away from the word that collided with the Instagram composer", () => {
    expect(registry).not.toContain('label: "Content & AI"');
    expect(registry).toContain('label: "Website & Local"');
  });

  it("id and every prior alias still resolve", () => {
    const entry = registry.slice(registry.indexOf('id: "content"'));
    const block = entry.slice(0, entry.indexOf("},"));
    for (const alias of ["content", "content-and-ai", "specials", "coupons", "qa", "seoengine"]) {
      expect(block, `alias ${alias} was dropped`).toContain(`"${alias}"`);
    }
    // deadEndClosure.test.ts pins this too — keep the sidebar door.
    expect(block).toMatch(/showInSidebar: true/);
  });
});

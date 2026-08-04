/**
 * The mp4 door must actually be reachable, and must not shortcut any gate.
 *
 * ingestFinishedMp4 shipped with twelve tests and ZERO importers — grep found
 * it referenced only by its own spec. That is the BUILT-TESTED-UNWIRED pattern
 * this repo keeps producing, and it is registered as a P2 on the mp4-ingest
 * capability: "nothing in the admin UI or a router calls it. Grep for importers
 * before assuming it is reachable."
 *
 * A unit test of the service cannot notice that, by construction — the service
 * was already fully tested and still unreachable. So these assert the WIRING:
 * that a router exposes it, that the route is admin-gated, that a client
 * surface calls that route, and that neither end quietly relaxes what the
 * service refuses.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentAdminRouter } from "./routers/content";
import { MP4_INGEST_FLAG } from "./services/mp4Ingest";

const CLIENT = readFileSync(
  join(__dirname, "..", "client", "src", "pages", "admin", "instagram", "ActionCenter.tsx"),
  "utf8",
);
const ROUTER = readFileSync(join(__dirname, "routers", "content.ts"), "utf8");
const PANEL = readFileSync(join(__dirname, "routers", "socialPipeline.ts"), "utf8");

describe("the service is reachable at all", () => {
  it("contentAdmin exposes ingestFinishedMp4", () => {
    expect(contentAdminRouter).toHaveProperty("ingestFinishedMp4");
  });

  it("it is a MUTATION, not a query — it creates a draft and writes a reel_jobs row", () => {
    const proc = (contentAdminRouter as Record<string, { _def?: { type?: string; mutation?: boolean } }>).ingestFinishedMp4;
    const def = proc?._def as { type?: string; mutation?: boolean } | undefined;
    expect(def?.type === "mutation" || def?.mutation === true).toBe(true);
  });

  it("is admin-gated — an ingested draft enters the publish queue", () => {
    const block = ROUTER.slice(ROUTER.indexOf("ingestFinishedMp4: "), ROUTER.indexOf("actOnInventoryItem: adminProcedure"));
    expect(block).toMatch(/ingestFinishedMp4: adminProcedure/);
    expect(block).not.toMatch(/publicProcedure/);
  });
});

describe("a client surface actually calls it", () => {
  it("Action Center wires the mutation — a router with no caller is the same bug one layer up", () => {
    expect(CLIENT).toMatch(/trpc\.contentAdmin\.ingestFinishedMp4\.useMutation/);
    expect(CLIENT).toMatch(/ingestMp4\.mutate\(\{/);
  });

  it("gates the action behind a two-tap arm, in DOM", () => {
    // window.confirm is silently suppressed in the operator's standalone iOS
    // PWA, so a confirm() here would be no gate at all. lint:source enforces
    // the absence of the global; this asserts something took its place.
    expect(CLIENT).toMatch(/ingestArmed/);
    expect(CLIENT).toMatch(/if \(!ingestArmed\) \{ setIngestArmed\(true\); return; \}/);
    // A CALL, not a mention — this file discusses window.confirm in two comments
    // explaining why it is not used, and matching the bare name would fail on
    // the very comments that document the rule.
    expect(CLIENT).not.toMatch(/window\.confirm\s*\(/);
  });

  it("tells the operator it produces a DRAFT, not a post", () => {
    // "Ingest" reads like "publish" if nothing says otherwise, and this button
    // sits on the screen where the publish actions live.
    expect(CLIENT).toMatch(/does NOT publish/);
    expect(CLIENT).toMatch(/Ingest as draft/);
  });

  it("surfaces the server's refusal verbatim rather than flattening it", () => {
    // Each refusal names something actionable — the flag is off, that is not an
    // mp4, that URL expires. "Ingest failed" would hide all three.
    expect(CLIENT).toMatch(/description: e\.message/);
  });
});

describe("the gate is unchanged by being reachable", () => {
  it("the flag name is still the exact-string one the service checks", () => {
    expect(MP4_INGEST_FLAG).toBe("MP4_INGEST_ENABLED");
  });

  it("stays registered in the env-gates panel so an armed flag is visible", () => {
    // Built from the CONSTANT rather than written as a `key: "NAME"` literal.
    // Two reasons, and the second is why the literal is not merely annotated
    // away: (1) gitleaks' generic-api-key rule matches that exact shape and the
    // secret scan only sees a PR's ADDED lines, so a new literal is the one
    // that trips even though every pre-existing entry is identical — the
    // socialPipeline entry itself carries a gitleaks:allow for this reason;
    // (2) asserting against MP4_INGEST_FLAG means renaming the flag cannot
    // leave this test passing against a name nothing checks any more.
    expect(PANEL).toContain(`key: ${JSON.stringify(MP4_INGEST_FLAG)}`);
  });

  it("every interactive control in the card clears the 48px touch target", () => {
    // apps/nickstire/AGENTS.md: "Minimum 48×48px touch targets". min-h-11 is
    // 44px and the Input primitive's default h-9 is 36px — both were below it
    // on a two-tap flow that fires a real ingest.
    const card = CLIENT.slice(CLIENT.indexOf("{/* The mp4 door."), CLIENT.indexOf("{/* Ambiguous publishes lead:"));
    expect(card).toMatch(/min-h-12/);
    expect(card).not.toMatch(/min-h-11/);
    // All three Inputs carry an explicit height rather than inheriting h-9.
    expect((card.match(/<Input\b/g) || []).length).toBe(3);
    expect((card.match(/className="h-12"/g) || []).length).toBe(3);
  });

  it("the router does not pre-empt the service's own checks", () => {
    // Every refusal belongs to the service, which is where the tests for them
    // live. A router that duplicated the ftyp or presigned check would create a
    // second place for the rule to drift.
    const block = ROUTER.slice(ROUTER.indexOf("ingestFinishedMp4: "), ROUTER.indexOf("actOnInventoryItem: adminProcedure"));
    expect(block).not.toMatch(/ftyp|presigned|MP4_INGEST_ENABLED/);
    expect(block).toMatch(/await ingestFinishedMp4\(input\)/);
  });
});

describe("what being reachable turned from latent into live", () => {
  const SERVICE = readFileSync(join(__dirname, "services", "mp4Ingest.ts"), "utf8");

  /**
   * The loadSource BODY, not the whole file — the comment above it explains
   * what `fetch` + arrayBuffer() used to do, and a file-wide negative match
   * fails on the very prose documenting the fix. (Second time this shape has
   * bitten in one PR; the .gitleaksignore note says the same thing.)
   */
  const loadSourceBody = SERVICE.slice(
    SERVICE.indexOf("async function loadSource("),
    SERVICE.indexOf("export async function ingestFinishedMp4("),
  );

  it("fetches through the shared guard, not a bare fetch", () => {
    // A plain fetch follows a 302 anywhere, so validating only the SUBMITTED
    // URL leaves the whole private network one redirect away — the shape of a
    // blind SSRF against a cloud metadata endpoint. fetchPublicBounded
    // re-validates every hop.
    expect(loadSourceBody).toMatch(/fetchPublicBounded\(source, \{/);
    expect(loadSourceBody).not.toMatch(/await fetch\(source/);
    expect(loadSourceBody).not.toMatch(/arrayBuffer\(\)/);
  });

  it("caps the remote body while it streams, not after", () => {
    expect(SERVICE).toMatch(/maxBytes: MP4_MAX_BYTES/);
    expect(SERVICE).toMatch(/maxRedirects: MP4_MAX_REDIRECTS/);
  });

  it("caps the LOCAL path too — a path is operator-supplied like a URL", () => {
    // /dev/zero or a multi-gigabyte render would otherwise be read whole into a
    // Buffer. stat before read, and refuse anything that is not a regular file.
    expect(SERVICE).toMatch(/const stat = await fs\.stat\(source\)/);
    expect(SERVICE).toMatch(/stat\.isFile\(\)/);
    expect(SERVICE).toMatch(/stat\.size > MP4_MAX_BYTES/);
  });

  it("the guard is SHARED with the reel start-image download, not copied", () => {
    // Two hardened copies diverge one bypass at a time. One module, two callers.
    const HF = readFileSync(join(__dirname, "services", "higgsfieldStudio.ts"), "utf8");
    expect(HF).toMatch(/fetchPublicBounded\(url, \{/);
    expect(HF).not.toMatch(/function assertPublicIPv4/);
    expect(HF).not.toMatch(/function assertFetchableImageHost/);
  });
});

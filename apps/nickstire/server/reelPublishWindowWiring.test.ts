/**
 * The 0118 wiring — the half that was inert until the columns existed.
 *
 * WHY THIS IS A SEPARATE FILE FROM reelPublishWindow.test.ts. That file tests
 * the pure gate: given an approval record with a window, what does the gate
 * decide? It passed while the feature was completely unreachable, because
 * nothing read or wrote those fields. A green gate test over fields no query
 * selects is exactly the "silent instrument" shape — it proves the arithmetic,
 * not that the arithmetic is ever run on real data.
 *
 * So this file asserts the SEAM: that the columns are declared, that the reader
 * projects them, that the writer persists them, and that the publish door
 * presents the digest. Without all four the gate logic is decoration.
 *
 * ORDERING NOTE, recorded because it is the dangerous part: these columns were
 * declared in drizzle/schema.ts only AFTER 0118 was applied and reconciled
 * (applied 2026-09-07, `✓ no blocking drift`). findLiveApproval reads with a
 * bare `db.select()`, which enumerates every declared column — declaring them
 * first would have made that query name columns production lacked, and it is
 * wrapped in a catch returning null where null means "not approved". Every reel
 * would have been held, silently and fail-closed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const schema = read("drizzle/schema.ts");
const service = read("server/services/reelApproval.ts");
const router = read("server/routers/instagramAdmin.ts");
const migration = read("drizzle/0118_reel_publish_window.sql");

describe("the columns are declared, and match the DDL that created them", () => {
  it("declares all three approval columns", () => {
    expect(schema).toMatch(/publishWindowStart: timestamp\("publish_window_start"\)/);
    expect(schema).toMatch(/publishWindowEnd: timestamp\("publish_window_end"\)/);
    expect(schema).toMatch(/assetSha256: varchar\("asset_sha256", \{ length: 64 \}\)/);
  });

  it("declares scheduling intent on the JOB, distinct from the publish CAS stamp", () => {
    // publicationScheduledAt is stamped at the CAS and means "publish STARTED".
    // Overloading it would make "intended" and "began" indistinguishable.
    expect(schema).toMatch(/publicationIntendedAt: timestamp\("publication_intended_at"\)/);
    expect(schema).toMatch(/publicationScheduledAt: timestamp\("publication_scheduled_at"\)/);
  });

  it("every column the migration adds is declared, and none is NOT NULL", () => {
    // A NOT NULL column added to a table with existing rows is a different and
    // far more dangerous migration; 0118 is nullable-only by design.
    const added = [...migration.matchAll(/ADD COLUMN IF NOT EXISTS `([a-z_0-9]+)`/g)].map((m) => m[1]);
    expect(added.sort()).toEqual(
      ["asset_sha256", "publication_intended_at", "publish_window_end", "publish_window_start"].sort(),
    );
    for (const col of added) {
      expect(schema, `${col} not declared in schema.ts`).toMatch(new RegExp(`"${col}"`));
    }
    expect(migration).not.toMatch(/ADD COLUMN IF NOT EXISTS `[a-z_0-9]+`[^\n]*NOT NULL/);
  });
});

describe("the reader actually projects the new fields", () => {
  it("findLiveApproval maps all three onto the record the gate reasons over", () => {
    const fn = service.slice(service.indexOf("export async function findLiveApproval"));
    expect(fn).toMatch(/publishWindowStart: row\.publishWindowStart \?\? null/);
    expect(fn).toMatch(/publishWindowEnd: row\.publishWindowEnd \?\? null/);
    expect(fn).toMatch(/assetSha256: row\.assetSha256 \?\? null/);
  });

  it("the publish door presents a digest, or the 'cannot verify' branch is dead", () => {
    // approvalProblem refuses when the approval binds to a digest and the
    // candidate has none. If reelApprovalProblem never supplied one, that
    // refusal would fire on EVERY digest-bound approval — a gate that blocks
    // everything is exactly as broken as one that blocks nothing.
    //
    // BOUNDED TO THE FUNCTION BODY, and getting that bound right took two
    // attempts worth recording. v1 sliced to end-of-file, so `/assetSha256,/`
    // matched the INSERT statement two hundred lines below and passed with the
    // field deleted from the candidate — a planted canary is what exposed it.
    // v2 bounded on the first `\n}`, which matches the PARAMETER OBJECT's
    // closing `}):` line and truncated the slice before the body. Bound on the
    // next top-level construct instead.
    const start = service.indexOf("export async function reelApprovalProblem");
    const end = service.indexOf("\n/* ─", start);
    const fn = service.slice(start, end > start ? end : undefined);
    expect(fn).toMatch(/approval\?\.assetSha256 \? await loadAssetDigest/);
    // The candidate literal itself must carry the field through to the gate.
    const candidate = fn.match(/const candidate: ReelPublishCandidate = \{[\s\S]*?\};/)?.[0] ?? "";
    expect(candidate, "candidate literal not found").not.toBe("");
    expect(candidate).toMatch(/assetSha256,/);
  });
});

describe("the writer persists them, and refuses a window that cannot authorize anything", () => {
  it("inserts all three", () => {
    const insert = service.slice(service.indexOf("tx.insert(reelPublishApprovals)"));
    expect(insert).toMatch(/publishWindowStart: windowStart/);
    expect(insert).toMatch(/publishWindowEnd: windowEnd/);
    expect(insert).toMatch(/assetSha256,/);
  });

  it("refuses an inverted window rather than writing a permanently-blocking row", () => {
    expect(service).toMatch(/window_inverted/);
    expect(service).toMatch(/windowStart\.getTime\(\) > windowEnd\.getTime\(\)/);
  });

  it("refuses a window that already ended — an approval that can never fire is not one", () => {
    expect(service).toMatch(/window_already_passed/);
    expect(service).toMatch(/windowEnd\.getTime\(\) <= Date\.now\(\)/);
  });

  it("a missing digest is NULL, never invented", () => {
    // media_assets registration is a tolerant seam that swallows its own
    // failure, so a real master can exist with no registry row. NULL makes the
    // approval URL-bound (what every pre-0118 row is); a fabricated digest
    // would make it bound to something that was never checked.
    const fn = service.slice(service.indexOf("async function loadAssetDigest"));
    const body = fn.slice(0, fn.indexOf("\n}") + 2);
    expect(body).toMatch(/return null/);
    expect(body).toMatch(/\/\^\[0-9a-f\]\{64\}\$\/i\.test\(sha\)/);
    expect(body).not.toMatch(/createHash|sha256\(/); // never computes one itself
  });

  it("reads media_assets with a PROJECTION, not a bare select", () => {
    // The same trap this whole migration was ordered around: a bare select()
    // over a table breaks the moment that table gains a column ahead of its DDL.
    const fn = service.slice(service.indexOf("async function loadAssetDigest"));
    expect(fn).toMatch(/\.select\(\{ sha256: mediaAssets\.checksumSha256 \}\)/);
  });
});

describe("an operator can actually authorize a future slot", () => {
  it("the approve procedure accepts an optional window", () => {
    expect(router).toMatch(/publishWindowStartISO: z\.string\(\)\.datetime\(\)\.nullable\(\)\.optional\(\)/);
    expect(router).toMatch(/publishWindowEndISO: z\.string\(\)\.datetime\(\)\.nullable\(\)\.optional\(\)/);
  });

  it("passes it through, and omitting it preserves the previous behaviour", () => {
    expect(router).toMatch(/publishWindowStart: input\.publishWindowStartISO \? new Date\(input\.publishWindowStartISO\) : null/);
    expect(router).toMatch(/publishWindowEnd: input\.publishWindowEndISO \? new Date\(input\.publishWindowEndISO\) : null/);
  });
});

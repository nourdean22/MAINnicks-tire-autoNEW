/**
 * The duplicate-post guard must SURVIVE a failed retry.
 *
 * dispatchQueuedPublish refuses to re-post a platform whose ok:true sits in
 * sourceMetadata.publishResults. The Graph calls carry no idempotency key and
 * meta-publish has no dedupe, so that record is the only thing standing between
 * a retry and a duplicate post.
 *
 * The worker originally REPLACED publishResults with just the current run's
 * array, which erased the guard after one failed retry:
 *   1. FB ok, IG times out        -> results [FB ok, IG fail], row "rejected"
 *   2. rejected is re-approvable  -> dispatch targets IG only
 *   3. IG fails again             -> results REPLACED with [IG fail]; FB's win gone
 *   4. next re-approve            -> alreadyPosted empty -> Facebook posted TWICE
 *
 * These lock step 3.
 */
import { describe, it, expect } from "vitest";
import { mergePublishResults, mergePublishUrls } from "@/lib/inngest/functions/social-publish";

describe("mergePublishResults · a prior success is never lost", () => {
  it("keeps an earlier platform success when a later run does not include it", () => {
    const prior = [
      { platform: "facebook", postId: "fb_1", ok: true },
      { platform: "instagram", postId: null, ok: false },
    ];
    // The retry dispatched IG only, so FB is absent from this run entirely.
    const merged = mergePublishResults(prior, [{ platform: "instagram", postId: null, ok: false }]);

    expect(merged.find((r) => r.platform === "facebook")).toEqual({
      platform: "facebook",
      postId: "fb_1",
      ok: true,
    });
  });

  it("never downgrades a success to a failure", () => {
    const merged = mergePublishResults(
      [{ platform: "facebook", postId: "fb_1", ok: true }],
      [{ platform: "facebook", postId: null, ok: false }],
    );
    expect(merged).toEqual([{ platform: "facebook", postId: "fb_1", ok: true }]);
  });

  it("DOES upgrade a previous failure to a success", () => {
    const merged = mergePublishResults(
      [{ platform: "instagram", postId: null, ok: false }],
      [{ platform: "instagram", postId: "ig_9", ok: true }],
    );
    expect(merged).toEqual([{ platform: "instagram", postId: "ig_9", ok: true }]);
  });

  it("adds platforms it has not seen before", () => {
    const merged = mergePublishResults(
      [{ platform: "facebook", postId: "fb_1", ok: true }],
      [{ platform: "instagram", postId: "ig_1", ok: true }],
    );
    expect(merged.map((r) => r.platform).sort()).toEqual(["facebook", "instagram"]);
  });

  it("the full four-step retry sequence still shows Facebook as posted", () => {
    // 1. FB ok, IG fails
    let meta = mergePublishResults([], [
      { platform: "facebook", postId: "fb_1", ok: true },
      { platform: "instagram", postId: null, ok: false },
    ]);
    // 2/3. retry dispatches IG only, and IG fails again
    meta = mergePublishResults(meta, [{ platform: "instagram", postId: null, ok: false }]);

    // 4. what dispatchQueuedPublish reads back
    const alreadyPosted = new Set(meta.filter((r) => r.ok).map((r) => r.platform));
    expect(alreadyPosted.has("facebook")).toBe(true);
    expect(alreadyPosted.has("instagram")).toBe(false);
  });

  it("tolerates junk in the stored history rather than throwing mid-publish", () => {
    const merged = mergePublishResults(
      [null as never, { platform: 42 } as never, { platform: "facebook", ok: true }],
      [{ platform: "instagram", postId: "ig_1", ok: true }],
    );
    expect(merged.map((r) => r.platform)).toEqual(["facebook", "instagram"]);
  });
});

describe("mergePublishUrls", () => {
  it("unions across attempts so a retry cannot wipe an earlier permalink", () => {
    expect(mergePublishUrls(["https://fb/1"], ["https://ig/9"])).toEqual([
      "https://fb/1",
      "https://ig/9",
    ]);
  });

  it("dedupes and drops empties", () => {
    expect(mergePublishUrls(["https://fb/1"], ["https://fb/1", ""])).toEqual(["https://fb/1"]);
  });

  it("survives a non-array prior value", () => {
    expect(mergePublishUrls(null, ["https://ig/9"])).toEqual(["https://ig/9"]);
  });
});

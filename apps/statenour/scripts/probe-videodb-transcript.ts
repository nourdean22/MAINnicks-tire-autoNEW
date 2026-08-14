#!/usr/bin/env tsx
/**
 * READ-ONLY VideoDB probe — verifies the BDN-318 assumption against the
 * live API without consuming any upload quota.
 *
 * What it checks:
 *   1. auth works (GET /collection)
 *   2. what media already exists (GET /video?collection_id=<id>)
 *   3. the ACTUAL transcript response shape for an existing video
 *      (GET /video/{id}/transcription?segmenter=sentence)
 *
 * BDN-318 assumed, from the videodb-python SDK source, that the response
 * carries `word_timestamps: [{start,end,text}]` and `text`. That was read
 * from a primary source but NEVER exercised live. This probe is the
 * check. It prints the top-level keys and one sample element verbatim so
 * the assumption is confirmed or refuted by evidence, not by reading.
 *
 * STRICTLY READ-ONLY: only GETs. No upload, no index, no delete. The free
 * tier's 50-upload limit is untouched.
 *
 * The API key is never printed.
 *
 *   pnpm tsx scripts/probe-videodb-transcript.ts
 */

const BASE = "https://api.videodb.io";

function key(): string {
  const k = process.env.VIDEO_DB_API_KEY;
  if (!k) throw new Error("VIDEO_DB_API_KEY not set in this shell");
  return k;
}

async function get(path: string): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-access-token": key() },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null; the raw text is printed on failure */
  }
  return { status: res.status, json, text };
}

function keysOf(v: unknown): string[] {
  return v && typeof v === "object" ? Object.keys(v as Record<string, unknown>) : [];
}

async function main() {
  console.log("VideoDB READ-ONLY probe · no uploads, no writes\n");

  // 1 · auth
  const cols = await get("/collection");
  console.log(`[1] GET /collection → ${cols.status}`);
  if (cols.status !== 200) {
    console.log(`    body: ${cols.text.slice(0, 300)}`);
    console.log("\n  AUTH FAILED — stopping. Nothing else is meaningful.");
    process.exit(1);
  }
  console.log(`    top-level keys: ${keysOf(cols.json).join(", ") || "(none)"}`);

  // Every response is enveloped as { data, success } — unwrap like the SDK.
  const unwrap = (b: unknown): unknown =>
    b && typeof b === "object" && "data" in (b as Record<string, unknown>)
      ? ((b as { data?: unknown }).data ?? b)
      : b;
  const colList =
    (unwrap(cols.json) as { collections?: Array<{ id?: string; name?: string }> })?.collections ??
    [];
  console.log(`    collections: ${colList.length}`);
  for (const c of colList.slice(0, 5)) console.log(`      · ${c.id} — ${c.name ?? "(unnamed)"}`);
  const collectionId = colList[0]?.id;
  if (!collectionId) {
    console.log("\n  No collections — nothing uploaded yet, so no transcript to inspect.");
    process.exit(0);
  }

  // 2 · existing media
  const vids = await get(`/video?collection_id=${encodeURIComponent(collectionId)}`);
  console.log(`\n[2] GET /video?collection_id=${collectionId} → ${vids.status}`);
  if (vids.status !== 200) {
    console.log(`    body: ${vids.text.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`    top-level keys: ${keysOf(vids.json).join(", ") || "(none)"}`);
  const videos =
    (unwrap(vids.json) as { videos?: Array<{ id?: string; name?: string; length?: number }> })
      ?.videos ?? [];
  console.log(`    videos: ${videos.length}`);
  for (const v of videos.slice(0, 8)) {
    console.log(`      · ${v.id} — ${v.name ?? "(unnamed)"}${v.length ? ` (${v.length}s)` : ""}`);
  }
  if (videos.length === 0) {
    console.log(
      "\n  No existing media. Transcript shape cannot be verified without an upload,\n" +
        "  which would consume free-tier quota — not doing that unprompted.",
    );
    process.exit(0);
  }

  // 3 · THE CHECK — actual transcript shape
  for (const v of videos.slice(0, 3)) {
    const t = await get(`/video/${v.id}/transcription?segmenter=sentence`);
    console.log(`\n[3] GET /videos/${v.id}/transcription?segmenter=sentence → ${t.status}`);
    if (t.status !== 200) {
      console.log(`    body: ${t.text.slice(0, 200)}`);
      continue;
    }
    const top = keysOf(unwrap(t.json));
    console.log(`    top-level keys: ${top.join(", ")}`);

    const obj = unwrap(t.json) as Record<string, unknown>;
    const hasWordTimestamps = Array.isArray(obj.word_timestamps);
    console.log(`    word_timestamps present: ${hasWordTimestamps}`);
    console.log(`    text present: ${typeof obj.text === "string"}`);

    if (hasWordTimestamps) {
      const arr = obj.word_timestamps as unknown[];
      console.log(`    segment count: ${arr.length}`);
      if (arr.length > 0) {
        console.log(`    element keys: ${keysOf(arr[0]).join(", ")}`);
        console.log(`    sample[0]: ${JSON.stringify(arr[0])}`);
      }
    } else {
      console.log(
        "    ** word_timestamps ABSENT — the BDN-318 assumption is WRONG for this response.",
      );
      console.log(`    full shape: ${JSON.stringify(t.json).slice(0, 400)}`);
    }
    // One transcript with data is enough to confirm or refute.
    if (hasWordTimestamps && (obj.word_timestamps as unknown[]).length > 0) break;
  }
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

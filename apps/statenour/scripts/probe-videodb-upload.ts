#!/usr/bin/env tsx
/**
 * LIVE VideoDB upload probe — operator-authorized, 2026-08-14 (BDN-321).
 *
 * ⚠️ THIS WRITES. It uploads one small generated WAV to the operator's
 * VideoDB collection, consuming 1 of the free tier's 50 uploads and
 * leaving a persistent asset. Run only when explicitly asked.
 *
 * WHAT IT CAN PROVE
 *   · POST /collection/{id}/upload  — route + response shape (video_id,
 *     stream_url) through the BDN-321-corrected paths and envelope
 *   · POST /video/{id}/index        — spoken-word index route
 *   · GET  /video/{id}/transcription — route + top-level keys, and
 *     whether `word_timestamps` is present at all
 *
 * WHAT IT CANNOT PROVE
 *   The generated file is a 440 Hz TONE. There is no speech in it, so
 *   there is nothing to transcribe: expect zero segments. That leaves the
 *   ELEMENT shape ({start,end,text}) unverified. Verifying that needs a
 *   clip with actual speech. This is stated up front so a clean run is
 *   not mistaken for full verification — an empty result here is the
 *   EXPECTED result, not a passing one.
 *
 * The asset is named `nour-os-probe-<ts>.wav` so it is findable and
 * deletable. The API key is never printed.
 */

const BASE = "https://api.videodb.io";

function key(): string {
  const k = process.env.VIDEO_DB_API_KEY;
  if (!k) throw new Error("VIDEO_DB_API_KEY not set in this shell");
  return k;
}

/** Unwrap the { data, success } envelope — the BDN-321 finding. */
function unwrap<T>(body: unknown): T {
  if (body && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
    const inner = (body as { data?: unknown }).data;
    if (inner !== null && inner !== undefined) return inner as T;
  }
  return body as T;
}

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; raw: string }> {
  const headers = new Headers(init.headers);
  headers.set("x-access-token", key());
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    /* raw is printed on failure */
  }
  return { status: res.status, body, raw };
}

function keysOf(v: unknown): string[] {
  return v && typeof v === "object" ? Object.keys(v as Record<string, unknown>) : [];
}

/** Minimal 16-bit PCM mono WAV containing a 440 Hz tone. */
function makeToneWav(seconds = 2, sampleRate = 8000): Buffer {
  const n = seconds * sampleRate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000);
    data.writeInt16LE(v, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function main() {
  console.log("VideoDB LIVE UPLOAD probe · operator-authorized · 1 upload\n");

  const cols = await call("/collection");
  const collectionId = unwrap<{ collections?: Array<{ id?: string }> }>(cols.body)
    ?.collections?.[0]?.id;
  if (!collectionId) {
    console.log("no collection — aborting");
    process.exit(1);
  }
  console.log(`collection: ${collectionId}`);

  const wav = makeToneWav();
  const name = `nour-os-probe-${Date.now()}.wav`;
  console.log(`generated: ${name} (${wav.length} bytes, 440Hz tone, NO speech)\n`);

  // BDN-321 · upload is a THREE-STEP PRESIGNED FLOW, per videodb-python
  // _upload.py. The incumbent client's single-step multipart POST to
  // /collection/{id}/upload returns 500 (verified live).
  //   1. GET  /collection/{id}/upload_url?name=  -> { upload_url }
  //   2. POST <upload_url>  multipart file       -> bytes to storage
  //   3. POST /collection/{id}/upload  { url }   -> creates the asset
  const urlRes = await call(
    `/collection/${collectionId}/upload_url?name=${encodeURIComponent(name)}`,
  );
  console.log(`[1] GET /collection/{id}/upload_url → ${urlRes.status}`);
  const uploadUrl = unwrap<{ upload_url?: string }>(urlRes.body)?.upload_url;
  console.log(`    upload_url present: ${Boolean(uploadUrl)}`);
  if (!uploadUrl) {
    console.log(`    body: ${urlRes.raw.slice(0, 300)}`);
    process.exit(1);
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), name);
  const put = await fetch(uploadUrl, { method: "POST", body: form });
  console.log(`
[2] POST <presigned upload_url> → ${put.status}`);
  if (!put.ok) {
    console.log(`    body: ${(await put.text()).slice(0, 300)}`);
    process.exit(1);
  }

  const up = await call(`/collection/${collectionId}/upload`, {
    method: "POST",
    body: JSON.stringify({ url: uploadUrl, name, media_type: "audio" }),
  });
  console.log(`
[3] POST /collection/{id}/upload → ${up.status}`);
  if (up.status >= 400) {
    console.log(`    body: ${up.raw.slice(0, 400)}`);
    process.exit(1);
  }
  const upData = unwrap<Record<string, unknown>>(up.body);
  console.log(`    unwrapped keys: ${keysOf(upData).join(", ")}`);
  const videoId = (upData.video_id ?? upData.id ?? upData.asset_id) as string | undefined;
  console.log(`    asset id: ${videoId ?? "(none)"}`);
  console.log(`    stream_url present: ${typeof upData.stream_url === "string"}`);
  if (!videoId) {
    console.log(`    full: ${JSON.stringify(upData).slice(0, 500)}`);
    process.exit(1);
  }

  const idx = await call(`/video/${videoId}/index`, {
    method: "POST",
    body: JSON.stringify({ index_type: "spoken_word" }),
  });
  console.log(`\n[2] POST /video/{id}/index → ${idx.status}`);
  if (idx.status >= 400) console.log(`    body: ${idx.raw.slice(0, 300)}`);

  console.log("\n[3] GET /video/{id}/transcription?segmenter=sentence");
  for (let attempt = 1; attempt <= 6; attempt++) {
    const t = await call(`/video/${videoId}/transcription?segmenter=sentence`);
    console.log(`    attempt ${attempt} → ${t.status}`);
    if (t.status === 200) {
      const d = unwrap<Record<string, unknown>>(t.body);
      console.log(`    unwrapped keys: ${keysOf(d).join(", ")}`);
      const wt = d.word_timestamps;
      console.log(`    word_timestamps present: ${Array.isArray(wt)}`);
      console.log(`    text present: ${typeof d.text === "string"}`);
      if (Array.isArray(wt)) {
        console.log(`    segment count: ${wt.length}`);
        if (wt.length > 0) {
          console.log(`    element keys: ${keysOf(wt[0]).join(", ")}`);
          console.log(`    sample[0]: ${JSON.stringify(wt[0])}`);
        } else {
          console.log("    (0 segments — EXPECTED for a tone with no speech)");
        }
      }
      console.log(`\n    asset left in the collection: ${videoId} (${name})`);
      return;
    }
    if (t.status >= 400 && t.status !== 404 && t.status !== 425) {
      console.log(`    body: ${t.raw.slice(0, 300)}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  console.log(`\n    transcription never returned 200 · asset: ${videoId} (${name})`);
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

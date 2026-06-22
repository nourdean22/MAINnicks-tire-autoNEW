/**
 * Post a 5-image carousel ad to Instagram via the Meta Graph API (mirrors
 * server/services/metaSocial.ts postInstagramCarousel). Slides must already be
 * hosted publicly (HF). Caption read from reel-factory-out/ad-spec.json.
 *
 *   pnpm exec tsx scratch/post-carousel.ts            # 5 slides, base ad1
 *   pnpm exec tsx scratch/post-carousel.ts ad1 5
 */
import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });
const TOK = process.env.META_PAGE_ACCESS_TOKEN!;
const IGID = process.env.META_IG_USER_ID!;
const GRAPH = "https://graph.facebook.com/v21.0";
const HF = "https://huggingface.co/datasets/nourdean22/nt-reels/resolve/main";
const SPEC = "C:/Users/nourd/reel-factory-out/ad-spec.json";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function graph(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ ...params, access_token: TOK });
  const url = method === "GET" ? `${GRAPH}/${path}?${body}` : `${GRAPH}/${path}`;
  const r = await fetch(url, method === "GET" ? {} : { method: "POST", body });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${JSON.stringify(j).slice(0, 250)}`);
  return j as Record<string, unknown>;
}

async function main() {
  if (!TOK || !IGID) throw new Error("META_PAGE_ACCESS_TOKEN / META_IG_USER_ID missing");
  const base = process.argv[2] || "ad1";
  const count = Number(process.argv[3] || 5);
  const caption = JSON.parse(fs.readFileSync(SPEC, "utf8")).primaryCaption as string;
  if (!caption) throw new Error("no primaryCaption in ad-spec.json");

  const urls = Array.from({ length: count }, (_, i) => `${HF}/${base}-slide${i + 1}.jpg`);
  console.log(`Posting ${count}-slide carousel ad LIVE -> @nicks_tire_euclid`);
  for (const u of urls) {
    const head = await fetch(u, { method: "HEAD" });
    if (!head.ok) throw new Error(`slide not hosted (HTTP ${head.status}): ${u}`);
    console.log(`  hosted: ${u.split("/").pop()}`);
  }

  // Step 1: child containers
  const childIds: string[] = [];
  for (const url of urls) {
    const c = await graph(`${IGID}/media`, { image_url: url, is_carousel_item: "true" }, "POST");
    childIds.push(c.id as string);
  }
  console.log(`  ${childIds.length} child containers created`);

  // Step 2: carousel container
  const container = await graph(`${IGID}/media`, { media_type: "CAROUSEL", children: childIds.join(","), caption }, "POST");
  const creationId = container.id as string;

  // Step 3: publish (retry — children may need a moment to finish processing)
  let pub: Record<string, unknown> | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try { pub = await graph(`${IGID}/media_publish`, { creation_id: creationId }, "POST"); break; }
    catch (e) {
      if (attempt === 5) throw e;
      console.log(`  publish not ready (attempt ${attempt}), waiting...`);
      await sleep(5000);
    }
  }
  let permalink = "";
  try { permalink = ((await graph(`${pub!.id}`, { fields: "permalink" })).permalink as string) || ""; } catch { /* best-effort */ }
  console.log(`\nPOSTED carousel ad ✅  id=${pub!.id}  ${permalink}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("\nCAROUSEL POST FAILED:", e?.message || e); process.exit(1); });

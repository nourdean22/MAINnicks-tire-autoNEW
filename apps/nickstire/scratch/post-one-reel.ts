/**
 * Post ONE reel to Instagram immediately via the Meta REELS API (the proven
 * path that posted reels 1-3 live). Stateless — no campaign state advance.
 * Caption is pulled from reel-factory-out/captions.json by the reel->slug map.
 *
 *   pnpm exec tsx scratch/post-one-reel.ts            # posts reel32 (01-tire-pressure)
 *   pnpm exec tsx scratch/post-one-reel.ts 33         # posts reel33
 */
import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });
const TOK = process.env.META_PAGE_ACCESS_TOKEN!;
const IGID = process.env.META_IG_USER_ID!;
const GRAPH = "https://graph.facebook.com/v21.0";
const HF = "https://huggingface.co/datasets/nourdean22/nt-reels/resolve/main";
const CAPTIONS = "C:/Users/nourd/reel-factory-out/captions.json";

// reel number -> caption slug (32-43 = the 6 PM batch)
const REEL_SLUG: Record<number, string> = {
  32: "01-tire-pressure", 33: "02-tread-depth", 34: "03-brake-pads", 35: "04-alignment",
  36: "05-winter-battery", 37: "06-oil-sludge", 38: "07-wiper-blades", 39: "08-tire-age",
  40: "09-tpms-cold", 41: "10-pothole-rim", 42: "11-rotation", 43: "12-curb-alignment",
};

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
  if (!TOK || !IGID) throw new Error("META_PAGE_ACCESS_TOKEN / META_IG_USER_ID missing from .env");
  const reelNum = Number(process.argv[2] || 32);
  const slug = REEL_SLUG[reelNum];
  if (!slug) throw new Error(`no slug mapped for reel${reelNum}`);
  const caps: Record<string, { caption: string; claimSafe: boolean }> = JSON.parse(fs.readFileSync(CAPTIONS, "utf8"));
  const entry = caps[slug];
  if (!entry?.caption) throw new Error(`no caption for ${slug}`);
  if (!entry.claimSafe) throw new Error(`${slug} caption flagged NOT claim-safe — aborting`);
  const videoUrl = `${HF}/reel${reelNum}.mp4`;
  console.log(`Posting reel${reelNum} (${slug}) LIVE -> @nicks_tire_euclid`);
  console.log(`  ${videoUrl}`);
  console.log(`  "${entry.caption.split("\n")[0]}"`);

  const head = await fetch(videoUrl, { method: "HEAD" });
  if (!head.ok) throw new Error(`reel${reelNum} not hosted (HTTP ${head.status}) — upload to HF first.`);

  const cont = await graph(`${IGID}/media`, { media_type: "REELS", video_url: videoUrl, caption: entry.caption, share_to_feed: "true" }, "POST");
  const creationId = cont.id as string;
  const deadline = Date.now() + 5 * 60 * 1000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await sleep(5000);
    const st = await graph(`${creationId}`, { fields: "status_code" });
    lastStatus = st.status_code as string;
    if (lastStatus === "FINISHED") break;
    if (lastStatus === "ERROR" || lastStatus === "EXPIRED") throw new Error(`processing ${lastStatus} — not published.`);
    process.stdout.write(".");
  }
  if (lastStatus !== "FINISHED") throw new Error("timed out waiting for media processing — not published.");

  const pub = await graph(`${IGID}/media_publish`, { creation_id: creationId }, "POST");
  let permalink = "";
  try { permalink = ((await graph(`${pub.id}`, { fields: "permalink" })).permalink as string) || ""; } catch { /* permalink fetch is best-effort */ }
  console.log(`\nPOSTED reel${reelNum} ✅  id=${pub.id}  ${permalink}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("\nPOST FAILED:", e?.message || e); process.exit(1); });

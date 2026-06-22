/**
 * Post ONE reel to Instagram immediately via Meta REELS API, with the caption
 * read from a file (used for the reel-factory reels whose caption lives in
 * <slug>/caption.txt). Stateless.
 *   pnpm exec tsx scratch/post-reel-caption.ts <reelNum> <captionFilePath>
 */
import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });
const TOK = process.env.META_PAGE_ACCESS_TOKEN!;
const IGID = process.env.META_IG_USER_ID!;
const GRAPH = "https://graph.facebook.com/v21.0";
const HF = "https://huggingface.co/datasets/nourdean22/nt-reels/resolve/main";

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
  if (!TOK || !IGID) throw new Error("META creds missing");
  const reelNum = Number(process.argv[2]);
  const capFile = process.argv[3];
  if (!reelNum || !capFile) throw new Error("usage: post-reel-caption.ts <reelNum> <captionFile>");
  const caption = fs.readFileSync(capFile, "utf8").trim();
  if (!caption) throw new Error("empty caption");
  const videoUrl = `${HF}/reel${reelNum}.mp4`;
  console.log(`Posting reel${reelNum} LIVE -> @nicks_tire_euclid`);
  console.log(`  ${videoUrl}`);
  console.log(`  "${caption.split("\n")[0]}"`);

  const head = await fetch(videoUrl, { method: "HEAD" });
  if (!head.ok) throw new Error(`reel${reelNum} not hosted (HTTP ${head.status})`);

  const cont = await graph(`${IGID}/media`, { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true" }, "POST");
  const creationId = cont.id as string;
  const deadline = Date.now() + 5 * 60 * 1000;
  let st = "";
  while (Date.now() < deadline) {
    await sleep(5000);
    st = (await graph(`${creationId}`, { fields: "status_code" })).status_code as string;
    if (st === "FINISHED") break;
    if (st === "ERROR" || st === "EXPIRED") throw new Error(`processing ${st}`);
    process.stdout.write(".");
  }
  if (st !== "FINISHED") throw new Error("timed out waiting for processing");
  const pub = await graph(`${IGID}/media_publish`, { creation_id: creationId }, "POST");
  let permalink = "";
  try { permalink = ((await graph(`${pub.id}`, { fields: "permalink" })).permalink as string) || ""; } catch { /* best-effort */ }
  console.log(`\nPOSTED reel${reelNum} ✅  id=${pub.id}  ${permalink}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("\nPOST FAILED:", e?.message || e); process.exit(1); });

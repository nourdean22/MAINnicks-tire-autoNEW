// Publish 3 Reels to @nicks_tire_euclid via Meta Graph API. URLs passed as argv (reel1 reel2 reel3).
// Container -> poll status -> media_publish -> permalink.
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });
const TOK = process.env.META_PAGE_ACCESS_TOKEN!;
const IGID = process.env.META_IG_USER_ID!;
const GRAPH = "https://graph.facebook.com/v21.0";

const CAPTIONS = [
  "Your tires have a birthday 🎂 — after about 6 years the rubber ages out even with good tread. Check the little DOT stamp on the sidewall. Not sure how old yours are? Stop by and we'll take a look.\n\n#cartips #tiresafety #euclidohio #clevelandcars #nickstire #cartok",
  "Cleveland potholes don't just rattle you 🕳️ — a hard hit can bend a rim or knock your alignment. If your wheel started pulling, that's a clue. Stop by and we'll take a look.\n\n#cleveland #euclidohio #potholes #alignment #nickstire #cartips",
  "Your tires aren't leaking — winter's robbing them ❄️ About 1 PSI lost per 10°F drop, which is why the light loves cold mornings. Top them off, or stop by and we'll set them right.\n\n#tiretips #euclidohio #clevelandcars #cartok #nickstire",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graph(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET") {
  const body = new URLSearchParams({ ...params, access_token: TOK });
  const url = method === "GET" ? `${GRAPH}/${path}?${body}` : `${GRAPH}/${path}`;
  const r = await fetch(url, method === "GET" ? {} : { method: "POST", body });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j as any;
}

async function postReel(videoUrl: string, caption: string, label: string) {
  console.log(`\n[${label}] creating REELS container...`);
  const cont = await graph(`${IGID}/media`, { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true" }, "POST");
  const creationId = cont.id;
  console.log(`[${label}] container ${creationId} — polling status...`);

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const st = await graph(`${creationId}`, { fields: "status_code,status" });
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new Error(`[${label}] processing ${st.status_code}: ${st.status || ""}`);
    process.stdout.write(`  ${st.status_code}...`);
  }
  console.log(`\n[${label}] publishing...`);
  const pub = await graph(`${IGID}/media_publish`, { creation_id: creationId }, "POST");
  const mediaId = pub.id;
  let permalink = "";
  try { permalink = (await graph(`${mediaId}`, { fields: "permalink" })).permalink || ""; } catch {}
  console.log(`[${label}] PUBLISHED id=${mediaId} ${permalink}`);
  return { label, mediaId, permalink };
}

async function main() {
  const urls = [process.argv[2], process.argv[3], process.argv[4]];
  if (urls.some((u) => !u)) throw new Error("need 3 video URLs as argv");
  const results = [];
  for (let i = 0; i < 3; i++) {
    try { results.push(await postReel(urls[i], CAPTIONS[i], `reel${i + 1}`)); }
    catch (e: any) { console.error(`reel${i + 1} FAILED: ${e.message}`); results.push({ label: `reel${i + 1}`, error: e.message }); }
  }
  console.log("\n===== RESULTS =====");
  console.log(JSON.stringify(results, null, 2));
}
main().catch((e) => { console.error("FATAL:", e?.message || e); process.exit(1); });

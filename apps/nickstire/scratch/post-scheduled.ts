// Daily Nick's Tire reel poster. Posts the NEXT reel in ORDER via Meta REELS API, then advances a state file.
// Self-contained: read META creds from .env, reels pre-hosted on HF dataset nourdean22/nt-reels.
// Run once = post the first/next. Schedule daily = posts one per day until all 27 are done.
import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });
const TOK = process.env.META_PAGE_ACCESS_TOKEN!;
const IGID = process.env.META_IG_USER_ID!;
const GRAPH = "https://graph.facebook.com/v21.0";
const HF = "https://huggingface.co/datasets/nourdean22/nt-reels/resolve/main";
const STATE = resolve("c:/Users/nourd/NOURCITY/apps/nickstire/scratch/out/.post-state.json");

// posting order = calendar day order (reels 1-3 already live; this covers days 2 + 5..30)
const ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];

const CAPTIONS: Record<number, string> = {
  4: "Your tires are hiding a canyon 🪙 The penny test: pop a penny in the tread, Lincoln head-down — see all of his head and the tread's gone, time for new ones. Not sure where yours stand? Stop by, we'll check it free.\n\n#pennytest #tiresafety #cartips #euclidohio #clevelandcars #nickstire",
  5: "Your brakes are on a diet 🍦 Once the pad gets this thin, you're one drive from metal-on-metal — loud and pricey. A free check tells you exactly how much is left.\n\n#brakes #cartips #carmaintenance #euclidohio #clevelandcars #nickstire",
  6: "This oil gave up weeks ago ☕ Old oil turns to sludge and grinds your engine from the inside. A fresh change is the cheapest insurance your car will ever get.\n\n#oilchange #cartips #carcare #euclidohio #clevelandcars #nickstire",
  7: "Your battery hates Cleveland winters ❄️ Cold can cut its cranking power by a third — which is why it dies the first freezing morning. A free test now beats a no-start later.\n\n#carbattery #wintercar #cartips #euclidohio #clevelandcars #nickstire",
  8: "Your wipers are just smearing now 🌧️ When the rubber edge cracks, it streaks right where you need to see. It's a two-minute swap — don't wait for a downpour.\n\n#wiperblades #cartips #rainydays #euclidohio #clevelandcars #nickstire",
  9: "You've been breathing through a dirty sock 🧦 A clogged cabin filter means weak airflow and a musty smell. Swap it and the air's fresh again. Smell something off? Stop by.\n\n#cabinfilter #cartips #carcare #euclidohio #clevelandcars #nickstire",
  10: "We caught the nail 🔨 A nail in the tread is often repairable — in the sidewall, usually not (it flexes too much to patch safely). Picked one up? Stop by and we'll take a look.\n\n#flattire #tirerepair #cartips #euclidohio #clevelandcars #nickstire",
  11: "The tires are having a dispute 🍽️ One's wearing faster than the rest. Rotating every 5 to 7k miles keeps the wear even. Due for one? Stop by and we'll sort it.\n\n#tirerotation #cartips #carmaintenance #euclidohio #clevelandcars #nickstire",
  12: "Why's your wheel doing the laundry? 🌀 An out-of-balance wheel shakes worst around 60 mph. A quick re-balance smooths it right out. Feel a shimmy? Stop by.\n\n#wheelbalance #cartips #carcare #euclidohio #clevelandcars #nickstire",
  13: "That little light isn't lying 💡 The TPMS light means a tire's low on pressure — worth checking soon (low pressure wears tires and kills your mileage). Free pressure check anytime.\n\n#tpms #tirepressure #cartips #euclidohio #clevelandcars #nickstire",
  14: "This tire has a serious comb-over 💈 Feathered, angled tread edges often mean an alignment problem. Catch it early and your tires last longer. Notice odd wear? Stop by.\n\n#wheelalignment #tirewear #cartips #euclidohio #clevelandcars #nickstire",
  15: "Bald tires can't swim 🌊 Low tread can't channel water away, so you hydroplane in the rain. Good tread keeps you gripping the road. Curious where yours stand? Free check.\n\n#hydroplaning #tiresafety #rainydriving #euclidohio #clevelandcars #nickstire",
  16: "Your tires are wearing the wrong shoes ⛸️ Below about 45F, winter tires grip way better — their rubber stays soft in the cold. Drive through real winters? Stop by and we'll talk options.\n\n#wintertires #snowtires #cartips #euclidohio #clevelandcars #nickstire",
  17: "Your spare is a forgotten promise 🛞 Spares lose air and age too — then they're flat the day you need them. Check it before you have to. Stop by and we'll take a look.\n\n#sparetire #cartips #roadtripready #euclidohio #clevelandcars #nickstire",
  18: "Your brake fluid is drinking water 🧽 It quietly absorbs moisture over time and the pedal starts feeling soft. A periodic flush keeps it firm. Pedal feel off? Worth checking.\n\n#brakefluid #brakes #cartips #euclidohio #clevelandcars #nickstire",
  19: "Your engine's about to whistle 🫖 Low or old coolant lets the heat climb until it boils over. A quick level check keeps things calm. Stop by and we'll take a look.\n\n#coolant #overheating #cartips #euclidohio #clevelandcars #nickstire",
  20: "One little belt runs almost everything 🎗️ When it dries out and cracks it can snap and strand you. Caught early, it's a small fix. Worth a quick look anytime.\n\n#serpentinebelt #cartips #carmaintenance #euclidohio #clevelandcars #nickstire",
  21: "Your headlights need reading glasses 👓 As the lens clouds and yellows it quietly steals your night vision. Good news: foggy lenses can be restored. Stop by and we'll take a look.\n\n#headlightrestoration #cartips #nightdriving #euclidohio #clevelandcars #nickstire",
  22: "That highway hum? 🐹 A low roar that grows louder with speed is the classic wheel-bearing sign — and it only gets worse. Hear it? Stop by.\n\n#wheelbearing #cartips #carnoise #euclidohio #clevelandcars #nickstire",
  23: "Your car shouldn't pogo 🦘 Worn struts keep bouncing after a bump — and that bounce stretches your stopping distance. Smooth rides are safer rides. Swing by anytime.\n\n#struts #suspension #cartips #euclidohio #clevelandcars #nickstire",
  24: "It's a riddle, not a death sentence 🔦 The check engine light won't just tell you — don't guess. Scan it for codes and the code points the way. Light on? Stop by and we'll take a look.\n\n#checkenginelight #cartips #cardiagnostics #euclidohio #clevelandcars #nickstire",
  25: "More air isn't better 🎈 Over-inflated tires ride harsh and wear out the center. Match the door-sticker number. Not sure of yours? Stop by and we'll take a look.\n\n#tirepressure #cartips #tiresafety #euclidohio #clevelandcars #nickstire",
  26: "Before the long drive 🧳 Give your car the checklist: tread, tire pressure, the spare, and fluids. A few minutes now means a smoother trip. Heading out? Stop by first.\n\n#roadtrip #cartips #travelready #euclidohio #clevelandcars #nickstire",
  27: "Used tires aren't a gamble — if they're inspected 🃏 Each one we sell gets checked first for tread and damage. Real savings, done right. Curious what fits your car? Stop by.\n\n#usedtires #tiredeals #cartips #euclidohio #clevelandcars #nickstire",
  28: "Pure gloss therapy ✨ But a clean tire isn't just pretty — when the rubber shines, you can spot cracks and damage early. Keep them clean and keep an eye out.\n\n#tiredetailing #oddlysatisfying #carcare #euclidohio #clevelandcars #nickstire",
  29: "Hear that high note? 🎶 That brake squeal is often the built-in wear indicator telling you the pads are getting low. It's a free heads-up. Hearing it? Stop by.\n\n#brakes #cartips #carmaintenance #euclidohio #clevelandcars #nickstire",
  30: "Get your car a winter coat 🧣 Before the cold sets in, check the battery, tires, fluids, and wipers. A little prep keeps winter from catching you off guard. Stop by and we'll get you ready.\n\n#wintercar #carmaintenance #cartips #euclidohio #clevelandcars #nickstire",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function graph(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET") {
  const body = new URLSearchParams({ ...params, access_token: TOK });
  const url = method === "GET" ? `${GRAPH}/${path}?${body}` : `${GRAPH}/${path}`;
  const r = await fetch(url, method === "GET" ? {} : { method: "POST", body });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${JSON.stringify(j).slice(0, 250)}`);
  return j as any;
}

async function main() {
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { nextIndex: 0 };
  const idx = state.nextIndex || 0;
  if (idx >= ORDER.length) { console.log(`ALL DONE — ${ORDER.length}/${ORDER.length} reels posted. Nothing to do.`); return; }
  const reelNum = ORDER[idx];
  const videoUrl = `${HF}/reel${reelNum}.mp4`;
  const caption = CAPTIONS[reelNum];
  console.log(`Posting reel${reelNum} (day-index ${idx + 1}/${ORDER.length}) — ${videoUrl}`);

  // verify hosted
  const head = await fetch(videoUrl, { method: "HEAD" });
  if (!head.ok) throw new Error(`reel${reelNum} not hosted (HTTP ${head.status}) — upload it to HF first; NOT advancing.`);

  // container -> poll -> publish
  const cont = await graph(`${IGID}/media`, { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true" }, "POST");
  const creationId = cont.id;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const st = await graph(`${creationId}`, { fields: "status_code" });
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new Error(`processing ${st.status_code} — NOT advancing.`);
  }
  const pub = await graph(`${IGID}/media_publish`, { creation_id: creationId }, "POST");
  let permalink = "";
  try { permalink = (await graph(`${pub.id}`, { fields: "permalink" })).permalink || ""; } catch {}

  state.nextIndex = idx + 1;
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log(`POSTED reel${reelNum} ✅ ${permalink}  (next index = ${state.nextIndex}/${ORDER.length})`);
}
main().catch((e) => { console.error("POST FAILED (state NOT advanced):", e?.message || e); process.exit(1); });

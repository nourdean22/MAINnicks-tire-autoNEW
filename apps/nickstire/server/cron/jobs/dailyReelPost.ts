/**
 * Daily Instagram Reel auto-poster.
 *
 * Posts one pre-made Nick's Tire reel per morning (reels 5-30 — reel 4 was the
 * manual kickoff), in the 9am ET window, through the ONE gated publish door
 * (`publishToSocial`). Laptop-independent: runs on the always-on Railway server,
 * so a broken laptop never stops the campaign.
 *
 * State lives in the `shop_settings` KV table (no migration):
 *   reel_autopost_index     — index of the NEXT reel into MANIFEST (0..length)
 *   reel_autopost_last_date — YYYY-MM-DD (ET) of the last successful post
 *
 * Two kill switches, both default OFF:
 *   REEL_AUTOPOST_ENABLED  — this job (set true on Railway to arm the schedule)
 *   REEL_PUBLISH_ENABLED   — the publishToSocial reel gate (Phase-0 safety)
 *
 * Idempotency: posts at most once per ET day. On any failure the index is NOT
 * advanced and the date is NOT recorded, so the next eligible tick retries the
 * same reel — never a skip, never a double-post.
 */
import { eq } from "drizzle-orm";
import { createLogger } from "../../lib/logger";
import { shopSettings } from "../../../drizzle/schema";
import { BUSINESS } from "@shared/business";

const log = createLogger("cron:daily-reel-post");

const HF = "https://huggingface.co/datasets/nourdean22/nt-reels/resolve/main";
const POST_HOUR_ET = 9;

// reels 5-30 in calendar order. Captions are claim-safe: no prices, no "free"
// except "free check", no guarantees/best/kill-words. Verified by the unit test.
export const MANIFEST: { reel: number; caption: string }[] = [
  { reel: 5, caption: "Your brakes are on a diet 🍦 Once the pad gets this thin, you're one drive from metal-on-metal — loud and pricey. A free check tells you exactly how much is left.\n\n#brakes #cartips #carmaintenance #euclidohio #clevelandcars #nickstire" },
  { reel: 6, caption: "This oil gave up weeks ago ☕ Old oil turns to sludge and grinds your engine from the inside. A fresh change is the cheapest insurance your car will ever get.\n\n#oilchange #cartips #carcare #euclidohio #clevelandcars #nickstire" },
  { reel: 7, caption: "Your battery hates Cleveland winters ❄️ Cold can cut its cranking power by a third — which is why it dies the first freezing morning. A quick test now beats a no-start later.\n\n#carbattery #wintercar #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 8, caption: "Your wipers are just smearing now 🌧️ When the rubber edge cracks, it streaks right where you need to see. It's a two-minute swap — don't wait for a downpour.\n\n#wiperblades #cartips #rainydays #euclidohio #clevelandcars #nickstire" },
  { reel: 9, caption: "You've been breathing through a dirty sock 🧦 A clogged cabin filter means weak airflow and a musty smell. Swap it and the air's fresh again. Smell something off? Stop by.\n\n#cabinfilter #cartips #carcare #euclidohio #clevelandcars #nickstire" },
  { reel: 10, caption: "We caught the nail 🔨 A nail in the tread is often repairable — in the sidewall, usually not (it flexes too much to patch safely). Picked one up? Stop by and we'll take a look.\n\n#flattire #tirerepair #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 11, caption: "The tires are having a dispute 🍽️ One's wearing faster than the rest. Rotating every 5 to 7k miles keeps the wear even. Due for one? Stop by and we'll sort it.\n\n#tirerotation #cartips #carmaintenance #euclidohio #clevelandcars #nickstire" },
  { reel: 12, caption: "Why's your wheel doing the laundry? 🌀 An out-of-balance wheel shakes worst around 60 mph. A quick re-balance smooths it right out. Feel a shimmy? Stop by.\n\n#wheelbalance #cartips #carcare #euclidohio #clevelandcars #nickstire" },
  { reel: 13, caption: "That little light isn't lying 💡 The TPMS light means a tire's low on pressure — worth checking soon (low pressure wears tires and kills your mileage). Stop by for a free check.\n\n#tpms #tirepressure #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 14, caption: "This tire has a serious comb-over 💈 Feathered, angled tread edges often mean an alignment problem. Catch it early and your tires last longer. Notice odd wear? Stop by.\n\n#wheelalignment #tirewear #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 15, caption: "Bald tires can't swim 🌊 Low tread can't channel water away, so you hydroplane in the rain. Good tread keeps you gripping the road. Curious where yours stand? Free check.\n\n#hydroplaning #tiresafety #rainydriving #euclidohio #clevelandcars #nickstire" },
  { reel: 16, caption: "Your tires are wearing the wrong shoes ⛸️ Below about 45F, winter tires grip way better — their rubber stays soft in the cold. Drive through real winters? Stop by and we'll talk options.\n\n#wintertires #snowtires #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 17, caption: "Your spare is a forgotten promise 🛞 Spares lose air and age too — then they're flat the day you need them. Check it before you have to. Stop by and we'll take a look.\n\n#sparetire #cartips #roadtripready #euclidohio #clevelandcars #nickstire" },
  { reel: 18, caption: "Your brake fluid is drinking water 🧽 It quietly absorbs moisture over time and the pedal starts feeling soft. A periodic flush keeps it firm. Pedal feel off? Worth checking.\n\n#brakefluid #brakes #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 19, caption: "Your engine's about to whistle 🫖 Low or old coolant lets the heat climb until it boils over. A quick level check keeps things calm. Stop by and we'll take a look.\n\n#coolant #overheating #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 20, caption: "One little belt runs almost everything 🎗️ When it dries out and cracks it can snap and strand you. Caught early, it's a small fix. Worth a quick look anytime.\n\n#serpentinebelt #cartips #carmaintenance #euclidohio #clevelandcars #nickstire" },
  { reel: 21, caption: "Your headlights need reading glasses 👓 As the lens clouds and yellows it quietly steals your night vision. Good news: foggy lenses can be restored. Stop by and we'll take a look.\n\n#headlightrestoration #cartips #nightdriving #euclidohio #clevelandcars #nickstire" },
  { reel: 22, caption: "That highway hum? 🐹 A low roar that grows louder with speed is the classic wheel-bearing sign — and it only gets worse. Hear it? Stop by.\n\n#wheelbearing #cartips #carnoise #euclidohio #clevelandcars #nickstire" },
  { reel: 23, caption: "Your car shouldn't pogo 🦘 Worn struts keep bouncing after a bump — and that bounce stretches your stopping distance. Smooth rides are safer rides. Swing by anytime.\n\n#struts #suspension #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 24, caption: "It's a riddle, not a death sentence 🔦 The check engine light won't just tell you — don't guess. Scan it for codes and the code points the way. Light on? Stop by and we'll take a look.\n\n#checkenginelight #cartips #cardiagnostics #euclidohio #clevelandcars #nickstire" },
  { reel: 25, caption: "More air isn't better 🎈 Over-inflated tires ride harsh and wear out the center. Match the door-sticker number. Not sure of yours? Stop by and we'll take a look.\n\n#tirepressure #cartips #tiresafety #euclidohio #clevelandcars #nickstire" },
  { reel: 26, caption: "Before the long drive 🧳 Give your car the checklist: tread, tire pressure, the spare, and fluids. A few minutes now means a smoother trip. Heading out? Stop by first.\n\n#roadtrip #cartips #travelready #euclidohio #clevelandcars #nickstire" },
  { reel: 27, caption: "Used tires aren't a gamble — if they're inspected 🃏 Each one we sell gets checked first for tread and damage. Real savings, done right. Curious what fits your car? Stop by.\n\n#usedtires #tiredeals #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 28, caption: "Pure gloss therapy ✨ But a clean tire isn't just pretty — when the rubber shines, you can spot cracks and damage early. Keep them clean and keep an eye out.\n\n#tiredetailing #oddlysatisfying #carcare #euclidohio #clevelandcars #nickstire" },
  { reel: 29, caption: "Hear that high note? 🎶 That brake squeal is often the built-in wear indicator telling you the pads are getting low. It's a built-in heads-up. Hearing it? Stop by.\n\n#brakes #cartips #carmaintenance #euclidohio #clevelandcars #nickstire" },
  { reel: 30, caption: "Get your car a winter coat 🧣 Before the cold sets in, check the battery, tires, fluids, and wipers. A little prep keeps winter from catching you off guard. Stop by and we'll get you ready.\n\n#wintercar #carmaintenance #cartips #euclidohio #clevelandcars #nickstire" },
];

async function getKv(key: string): Promise<string | null> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return null;
  const rows = await d.select().from(shopSettings).where(eq(shopSettings.key, key)).limit(1);
  return rows.length ? (rows[0].value as string) : null;
}

async function setKv(key: string, value: string, label: string): Promise<void> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return;
  const existing = await d.select().from(shopSettings).where(eq(shopSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await d.update(shopSettings).set({ value, updatedBy: "system" }).where(eq(shopSettings.key, key));
  } else {
    await d.insert(shopSettings).values({ key, value, label, category: "general", updatedBy: "system" });
  }
}

function etNow(): { date: string; hour: number } {
  const now = new Date();
  const date = now.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone }); // YYYY-MM-DD
  const hour = parseInt(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }), 10);
  return { date, hour };
}

export async function runDailyReelPost(): Promise<{ recordsProcessed?: number; details?: string }> {
  if (process.env.REEL_AUTOPOST_ENABLED !== "true") {
    return { recordsProcessed: 0, details: "disabled (REEL_AUTOPOST_ENABLED != true)" };
  }

  const { date, hour } = etNow();
  if (hour !== POST_HOUR_ET) {
    return { recordsProcessed: 0, details: `not post hour (ET ${hour}:00, want ${POST_HOUR_ET}:00)` };
  }

  const lastDate = await getKv("reel_autopost_last_date");
  if (lastDate === date) {
    return { recordsProcessed: 0, details: `already posted today (${date})` };
  }

  const idx = parseInt((await getKv("reel_autopost_index")) || "0", 10) || 0;
  if (idx >= MANIFEST.length) {
    return { recordsProcessed: 0, details: `campaign complete (${MANIFEST.length}/${MANIFEST.length} posted)` };
  }

  const { reel, caption } = MANIFEST[idx];
  const videoUrl = `${HF}/reel${reel}.mp4`;

  // Don't burn the day's slot on a missing file — verify it's hosted first.
  const head = await fetch(videoUrl, { method: "HEAD" }).catch(() => null);
  if (!head || !head.ok) {
    log.error(`reel${reel} not reachable (HTTP ${head?.status ?? "network"})`);
    return { recordsProcessed: 0, details: `reel${reel} not hosted — not advancing` };
  }

  const { publishToSocial } = await import("../../services/socialPublish");
  const outcome = await publishToSocial({ platforms: ["instagram"], videoUrl, caption });
  const ig = outcome.results.find((r) => r.platform === "instagram");
  if (!ig?.success) {
    log.error(`reel${reel} publish failed`, { error: ig?.error });
    return { recordsProcessed: 0, details: `reel${reel} publish failed: ${ig?.error ?? "unknown"} — not advancing` };
  }

  await setKv("reel_autopost_index", String(idx + 1), "Daily reel autopost — next reel index");
  await setKv("reel_autopost_last_date", date, "Daily reel autopost — last post date (ET)");
  log.info(`Posted reel${reel} (${idx + 1}/${MANIFEST.length})`, { postId: ig.postId });
  return { recordsProcessed: 1, details: `posted reel${reel} (${idx + 1}/${MANIFEST.length}) ${ig.postId ?? ""}`.trim() };
}

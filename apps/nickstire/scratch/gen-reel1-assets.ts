// Reel 1 "The Tire That Aged Out" — generate all assets via Higgsfield CLI.
// Seedance 1.5 Pro clips + Inworld VO + Sonilo music. Each asset saved independently.
import dotenv from "dotenv";
import { resolve } from "path";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });
// .env creds expired — use the fresh `hf auth login` session store.
delete process.env.HIGGSFIELD_CREDENTIALS_JSON;
delete process.env.HIGGSFIELD_CREDENTIALS_PATH;

const OUT = resolve("c:/Users/nourd/NOURCITY/apps/nickstire/scratch/out/reel1");
fs.mkdirSync(OUT, { recursive: true });

function findUrl(obj: any, acc: string[] = []): string[] {
  if (!obj) return acc;
  if (typeof obj === "string") {
    if (obj.startsWith("http")) acc.push(obj);
  } else if (Array.isArray(obj)) obj.forEach((o) => findUrl(o, acc));
  else if (typeof obj === "object") Object.values(obj).forEach((o) => findUrl(o, acc));
  return acc;
}

function gen(binPath: string, model: string, params: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const args = ["generate", "create", model, ...params, "--wait", "--wait-timeout", "20m", "--wait-interval", "5s", "--json"];
    const child = spawn(binPath, args, { env: { ...process.env, HIGGSFIELD_INSTALL_METHOD: "npm", HIGGSFIELD_PACKAGE_MANAGER: "pnpm" } });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) return rej(new Error(`exit ${code}: ${err.trim()}`));
      try {
        const urls = findUrl(JSON.parse(out));
        urls[0] ? res(urls[0]) : rej(new Error(`no url in: ${out.slice(0, 300)}`));
      } catch (e: any) { rej(new Error(`parse fail: ${e.message}. raw: ${out.slice(0, 300)}`)); }
    });
  });
}

async function download(url: string, file: string) {
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf.length;
}

// 4 unique Seedance clips (beat 5 reuses clip1 for a seamless loop)
const CLIPS = [
  { id: "clip1", prompt: "lone car tire standing on a dark wooden table, one tiny lit birthday candle stuck in the tread grooves, single moody spotlight from above, slow cinematic push-in, volumetric haze, photoreal, vertical 9:16" },
  { id: "clip2", prompt: "extreme macro of an aged car tire sidewall, fine dust particles drifting through a warm spotlight beam, a birthday candle glowing nearby, shallow depth of field, slow motion, cinematic, vertical 9:16" },
  { id: "clip3", prompt: "extreme macro tracking shot slowly gliding along a tire sidewall toward an embossed oval DOT code stamp, the numbers catching a soft glow, dramatic rim light, cinematic, vertical 9:16" },
  { id: "clip4", prompt: "a single birthday candle gently snuffing out into a thin ribbon of smoke above a car tire in a dark spotlight, smoke curling upward, calm, slow motion, cinematic, vertical 9:16" },
];

const VO_TEXT = "Happy birthday. Plenty of tread... but this rubber's six years old. That little oval stamp? The week and year it was born. Old rubber cracks. Worth a look before a long drive.";
const VO_VOICE = "Mark";
const MUSIC_PROMPT = "warm melancholy lofi music box, gentle, nostalgic, sparse";

async function main() {
  const { ensureHiggsfieldBinary } = await import("../server/services/higgsfieldBinary.ts");
  const bin = await ensureHiggsfieldBinary();
  const results: Record<string, string> = {};

  for (const c of CLIPS) {
    try {
      console.log(`\n[${c.id}] generating (seedance1_5, 4s, 9:16, 1080p)...`);
      const url = await gen(bin, "seedance1_5", ["--prompt", c.prompt, "--aspect_ratio", "9:16", "--duration", "4", "--resolution", "1080p"]);
      const bytes = await download(url, path.join(OUT, `${c.id}.mp4`));
      console.log(`[${c.id}] OK ${bytes}b  ${url}`);
      results[c.id] = "ok";
    } catch (e: any) { console.error(`[${c.id}] FAIL: ${e.message}`); results[c.id] = "fail"; }
  }

  try {
    console.log(`\n[vo] generating (inworld, voice=${VO_VOICE})...`);
    const url = await gen(bin, "inworld_text_to_speech", ["--prompt", VO_TEXT, "--voice", VO_VOICE]);
    const bytes = await download(url, path.join(OUT, "vo.mp3"));
    console.log(`[vo] OK ${bytes}b  ${url}`);
    results.vo = "ok";
  } catch (e: any) { console.error(`[vo] FAIL: ${e.message}`); results.vo = "fail"; }

  try {
    console.log(`\n[music] generating (sonilo, 15s)...`);
    const url = await gen(bin, "sonilo_music", ["--prompt", MUSIC_PROMPT, "--duration", "15"]);
    const bytes = await download(url, path.join(OUT, "music.mp3"));
    console.log(`[music] OK ${bytes}b  ${url}`);
    results.music = "ok";
  } catch (e: any) { console.error(`[music] FAIL: ${e.message}`); results.music = "fail"; }

  console.log("\n===== SUMMARY =====");
  console.log(JSON.stringify(results, null, 2));
  console.log("OUT:", OUT);
}

main().catch((e) => { console.error("FATAL:", e?.message || e); process.exit(1); });

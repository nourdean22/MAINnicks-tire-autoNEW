// Batch-generate clips + music for Reel 2 (Pothole: Witness Protection) and Reel 3 (PSI Heist).
// Seedance 1.5 Pro + Sonilo music. Voice added centrally later (Google Neural2). Each asset saved independently.
import dotenv from "dotenv";
import { resolve } from "path";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });
delete process.env.HIGGSFIELD_CREDENTIALS_JSON;
delete process.env.HIGGSFIELD_CREDENTIALS_PATH;

const BASE = resolve("c:/Users/nourd/NOURCITY/apps/nickstire/scratch/out");

function findUrl(obj: any, acc: string[] = []): string[] {
  if (!obj) return acc;
  if (typeof obj === "string") { if (obj.startsWith("http")) acc.push(obj); }
  else if (Array.isArray(obj)) obj.forEach((o) => findUrl(o, acc));
  else if (typeof obj === "object") Object.values(obj).forEach((o) => findUrl(o, acc));
  return acc;
}
function gen(bin: string, model: string, params: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const args = ["generate", "create", model, ...params, "--wait", "--wait-timeout", "20m", "--wait-interval", "5s", "--json"];
    const child = spawn(bin, args, { env: { ...process.env, HIGGSFIELD_INSTALL_METHOD: "npm", HIGGSFIELD_PACKAGE_MANAGER: "pnpm" } });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) return rej(new Error(`exit ${code}: ${err.trim()}`));
      try { const u = findUrl(JSON.parse(out)); u[0] ? res(u[0]) : rej(new Error(`no url: ${out.slice(0,200)}`)); }
      catch (e: any) { rej(new Error(`parse: ${e.message}`)); }
    });
  });
}
async function dl(url: string, file: string) { const r = await fetch(url); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); return fs.statSync(file).size; }

const REELS = [
  {
    dir: "reel2", music: "tense film-noir jazz, upright bass, sparse, suspense",
    clips: [
      { id: "clip1", prompt: "dark film-noir interrogation room, a jagged chunk of cracked asphalt sitting on a wooden chair under a single harsh overhead spotlight, volumetric haze, deep shadows, slow push-in, photoreal, vertical 9:16" },
      { id: "clip2", prompt: "extreme close-up of a cracked asphalt chunk trembling slightly under a harsh interrogation spotlight, tiny gravel pieces vibrating, deep noir shadows, slow motion, photoreal, vertical 9:16" },
      { id: "clip3", prompt: "POV from a driver seat looking over an empty steering wheel as the car drifts gently to the right on a foggy empty road at dusk, eerie, cinematic, no hands, vertical 9:16" },
      { id: "clip4", prompt: "a single overhead spotlight switching off over a chunk of asphalt on a chair, the room falling into darkness, drifting smoke, film-noir, vertical 9:16" },
    ],
  },
  {
    dir: "reel3", music: "playful pizzicato spy-comedy heist, light, sneaky, bouncy",
    clips: [
      { id: "clip1", prompt: "nighttime macro of a car tire valve stem, a small cartoon snowflake character wearing a black burglar mask sneaking toward it, moody blue rim light, cinematic, vertical 9:16" },
      { id: "clip2", prompt: "a cartoon snowflake character siphoning air from a tire valve with a tiny straw while a round analog tire-pressure gauge needle ticks downward, cold blue night light, slow motion, vertical 9:16" },
      { id: "clip3", prompt: "a car tire looking slightly under-inflated and squishy on frosty pavement at dawn, breath-fog in the cold air, soft morning light, photoreal, cinematic, vertical 9:16" },
      { id: "clip4", prompt: "a round analog tire-pressure gauge needle rising back up while a cartoon snowflake burglar character runs away comically, warm light returning, satisfying, slow motion, vertical 9:16" },
    ],
  },
];

async function main() {
  const { ensureHiggsfieldBinary } = await import("../server/services/higgsfieldBinary.ts");
  const bin = await ensureHiggsfieldBinary();
  const summary: Record<string, string> = {};

  for (const reel of REELS) {
    const out = path.join(BASE, reel.dir);
    fs.mkdirSync(out, { recursive: true });
    for (const c of reel.clips) {
      try {
        console.log(`\n[${reel.dir}/${c.id}] seedance1_5 4s 9:16 1080p...`);
        const url = await gen(bin, "seedance1_5", ["--prompt", c.prompt, "--aspect_ratio", "9:16", "--duration", "4", "--resolution", "1080p"]);
        const b = await dl(url, path.join(out, `${c.id}.mp4`));
        console.log(`[${reel.dir}/${c.id}] OK ${b}b`);
        summary[`${reel.dir}/${c.id}`] = "ok";
      } catch (e: any) { console.error(`[${reel.dir}/${c.id}] FAIL: ${e.message}`); summary[`${reel.dir}/${c.id}`] = "fail"; }
    }
    try {
      console.log(`\n[${reel.dir}/music] sonilo 15s...`);
      const url = await gen(bin, "sonilo_music", ["--prompt", reel.music, "--duration", "15"]);
      const b = await dl(url, path.join(out, "music.mp3"));
      console.log(`[${reel.dir}/music] OK ${b}b`);
      summary[`${reel.dir}/music`] = "ok";
    } catch (e: any) { console.error(`[${reel.dir}/music] FAIL: ${e.message}`); summary[`${reel.dir}/music`] = "fail"; }
  }

  console.log("\n===== SUMMARY =====");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error("FATAL:", e?.message || e); process.exit(1); });

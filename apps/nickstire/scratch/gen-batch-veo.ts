// Batch-generate clips + music for reels 4-8 via Google Veo 3.1 Lite (6 cr/clip, 9:16, 6s).
// Voice/assembly handled separately. Each asset saved independently.
import dotenv from "dotenv";
import { resolve } from "path";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });
delete process.env.HIGGSFIELD_CREDENTIALS_JSON;
delete process.env.HIGGSFIELD_CREDENTIALS_PATH;

const BASE = resolve("c:/Users/nourd/NOURCITY/apps/nickstire/scratch/out");
const MODEL = "veo3_1_lite";

function findUrl(o: any, a: string[] = []): string[] {
  if (!o) return a;
  if (typeof o === "string") { if (o.startsWith("http")) a.push(o); }
  else if (Array.isArray(o)) o.forEach((x) => findUrl(x, a));
  else if (typeof o === "object") Object.values(o).forEach((x) => findUrl(x, a));
  return a;
}
function gen(bin: string, model: string, params: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const args = ["generate", "create", model, ...params, "--wait", "--wait-timeout", "20m", "--wait-interval", "5s", "--json"];
    const c = spawn(bin, args, { env: { ...process.env, HIGGSFIELD_INSTALL_METHOD: "npm", HIGGSFIELD_PACKAGE_MANAGER: "pnpm" } });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d.toString()));
    c.stderr.on("data", (d) => (err += d.toString()));
    c.on("close", (code) => { if (code !== 0) return rej(new Error(`exit ${code}: ${err.trim().slice(0,160)}`)); const u = findUrl(JSON.parse(out)); u[0] ? res(u[0]) : rej(new Error("no url")); });
  });
}
async function dl(url: string, file: string) { const r = await fetch(url); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); return fs.statSync(file).size; }

const REELS = [
  { dir: "reel4", music: "curious bright marimba, playful, light", clips: [
    "extreme macro of a car tire tread, deep grooves like a vast canyon, a tiny shiny Lincoln penny standing at the rim, dramatic light, vertical 9:16",
    "a tiny shiny penny diving head-first into a deep tire tread groove like a canyon diver, macro, cinematic slow motion, vertical 9:16",
    "macro of a penny wedged upright in a tire tread groove, Lincoln's head just above the rubber, soft rim light, vertical 9:16",
    "a smooth bald tire next to a deep-treaded tire side by side on dark wet pavement, cinematic comparison, vertical 9:16" ] },
  { dir: "reel5", music: "tense ticking suspense, minimal, ominous", clips: [
    "a worn car brake pad melting like a chocolate ice cream cone on a dark workshop bench, dramatic spotlight, slow drips, photoreal, vertical 9:16",
    "extreme macro of a thin brake pad worn down close to its metal backing, dramatic side light, dark garage, vertical 9:16",
    "a brake rotor with a dangerously thin pad in a dark garage, cinematic close-up, moody light, vertical 9:16",
    "two brake pads side by side on a dark bench, one thick and new, one worn thin to the metal, spotlight, vertical 9:16" ] },
  { dir: "reel6", music: "slow melancholy piano, sparse, reflective", clips: [
    "a clear glass full of engine oil that looks like cold black sludgy coffee on a dark bench, thick and dark, dramatic light, vertical 9:16",
    "thick black old engine oil slowly pouring, sludgy and dark, macro, slow motion, dark background, vertical 9:16",
    "a clean amber stream of fresh oil pouring next to a pool of dark sludge, contrast, cinematic, vertical 9:16",
    "an oil dipstick pulled out coated in thick dark oil, dramatic spotlight over a dark engine bay, vertical 9:16" ] },
  { dir: "reel7", music: "shivery cold ambient bells, icy, cinematic", clips: [
    "a car battery wearing a tiny knit scarf, shivering on frosty ground at dawn, breath-fog in the cold air, cute, cinematic, vertical 9:16",
    "macro of a car battery with frost forming on its metal terminals, cold blue morning light, vertical 9:16",
    "POV over a dark car dashboard at frozen dawn, dim warning lights flickering weakly, eerie, no people, vertical 9:16",
    "a battery tester clamped to a car battery showing a low weak reading, dark garage, dramatic light, vertical 9:16" ] },
  { dir: "reel8", music: "light rainy lofi, gentle, mellow", clips: [
    "old worn windshield wiper blades that look like frayed old toothbrushes, dramatic macro on a wet windshield at night, vertical 9:16",
    "POV through a rain-soaked windshield as a wiper smears a streak across it, blurry headlights beyond, night, vertical 9:16",
    "extreme macro of a cracked dried-out wiper blade rubber edge peeling apart, dramatic light, vertical 9:16",
    "a clean new wiper sweeping a perfect clear arc across a rainy windshield, satisfying, slow motion, vertical 9:16" ] },
];

async function main() {
  const { ensureHiggsfieldBinary } = await import("../server/services/higgsfieldBinary.ts");
  const bin = await ensureHiggsfieldBinary();
  const summary: Record<string, string> = {};
  for (const reel of REELS) {
    const out = path.join(BASE, reel.dir);
    fs.mkdirSync(out, { recursive: true });
    for (let i = 0; i < reel.clips.length; i++) {
      const id = `clip${i + 1}`;
      try {
        console.log(`\n[${reel.dir}/${id}] ${MODEL} 6s 9:16...`);
        const url = await gen(bin, MODEL, ["--prompt", reel.clips[i], "--aspect_ratio", "9:16", "--duration", "6"]);
        const b = await dl(url, path.join(out, `${id}.mp4`));
        console.log(`[${reel.dir}/${id}] OK ${b}b`); summary[`${reel.dir}/${id}`] = "ok";
      } catch (e: any) { console.error(`[${reel.dir}/${id}] FAIL: ${e.message}`); summary[`${reel.dir}/${id}`] = "fail"; }
    }
    try {
      console.log(`\n[${reel.dir}/music] sonilo 15s...`);
      const url = await gen(bin, "sonilo_music", ["--prompt", reel.music, "--duration", "15"]);
      const b = await dl(url, path.join(out, "music.mp3"));
      console.log(`[${reel.dir}/music] OK ${b}b`); summary[`${reel.dir}/music`] = "ok";
    } catch (e: any) { console.error(`[${reel.dir}/music] FAIL: ${e.message}`); summary[`${reel.dir}/music`] = "fail"; }
  }
  console.log("\n===== SUMMARY =====");
  console.log(JSON.stringify(summary, null, 2));
}
main().catch((e) => { console.error("FATAL:", e?.message || e); process.exit(1); });

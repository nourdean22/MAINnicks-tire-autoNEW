// Batch-generate clips + music for reels 9-30 (from reels-data.ts) via Veo 3.1 Lite.
import dotenv from "dotenv";
import { resolve } from "path";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { REELS } from "./reels-data";

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

async function main() {
  const { ensureHiggsfieldBinary } = await import("../server/services/higgsfieldBinary.ts");
  const bin = await ensureHiggsfieldBinary();
  const summary: Record<string, string> = {};
  for (const reel of REELS) {
    const out = path.join(BASE, reel.dir);
    fs.mkdirSync(out, { recursive: true });
    for (let i = 0; i < reel.clips.length; i++) {
      const id = `clip${i + 1}`;
      const dest = path.join(out, `${id}.mp4`);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 10000) { summary[`${reel.dir}/${id}`] = "skip"; continue; } // resume-safe
      try {
        console.log(`\n[${reel.dir}/${id}] ${MODEL} 6s 9:16...`);
        const url = await gen(bin, MODEL, ["--prompt", reel.clips[i], "--aspect_ratio", "9:16", "--duration", "6"]);
        const b = await dl(url, dest);
        console.log(`[${reel.dir}/${id}] OK ${b}b`); summary[`${reel.dir}/${id}`] = "ok";
      } catch (e: any) { console.error(`[${reel.dir}/${id}] FAIL: ${e.message}`); summary[`${reel.dir}/${id}`] = "fail"; }
    }
    const musicDest = path.join(out, "music.mp3");
    if (fs.existsSync(musicDest) && fs.statSync(musicDest).size > 5000) { summary[`${reel.dir}/music`] = "skip"; continue; }
    try {
      console.log(`\n[${reel.dir}/music] sonilo 15s...`);
      const url = await gen(bin, "sonilo_music", ["--prompt", reel.music, "--duration", "15"]);
      const b = await dl(url, musicDest);
      console.log(`[${reel.dir}/music] OK ${b}b`); summary[`${reel.dir}/music`] = "ok";
    } catch (e: any) { console.error(`[${reel.dir}/music] FAIL: ${e.message}`); summary[`${reel.dir}/music`] = "fail"; }
  }
  console.log("\n===== SUMMARY =====");
  console.log(JSON.stringify(summary, null, 2));
}
main().catch((e) => { console.error("FATAL:", e?.message || e); process.exit(1); });

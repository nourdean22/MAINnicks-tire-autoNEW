// Retry the one clip that 502'd: reel3/clip4. ~12 credits.
import dotenv from "dotenv";
import { resolve } from "path";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });
delete process.env.HIGGSFIELD_CREDENTIALS_JSON;
delete process.env.HIGGSFIELD_CREDENTIALS_PATH;

const OUT = resolve("c:/Users/nourd/NOURCITY/apps/nickstire/scratch/out/reel3/clip4.mp4");
const PROMPT = "a round analog tire-pressure gauge needle rising back up while a cartoon snowflake burglar character runs away comically, warm light returning, satisfying, slow motion, vertical 9:16";

function findUrl(o: any, a: string[] = []): string[] {
  if (!o) return a;
  if (typeof o === "string") { if (o.startsWith("http")) a.push(o); }
  else if (Array.isArray(o)) o.forEach((x) => findUrl(x, a));
  else if (typeof o === "object") Object.values(o).forEach((x) => findUrl(x, a));
  return a;
}

async function main() {
  const { ensureHiggsfieldBinary } = await import("../server/services/higgsfieldBinary.ts");
  const bin = await ensureHiggsfieldBinary();
  const url: string = await new Promise((res, rej) => {
    const c = spawn(bin, ["generate", "create", "seedance1_5", "--prompt", PROMPT, "--aspect_ratio", "9:16", "--duration", "4", "--resolution", "1080p", "--wait", "--wait-timeout", "20m", "--wait-interval", "5s", "--json"],
      { env: { ...process.env, HIGGSFIELD_INSTALL_METHOD: "npm", HIGGSFIELD_PACKAGE_MANAGER: "pnpm" } });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d.toString()));
    c.stderr.on("data", (d) => (err += d.toString()));
    c.on("close", (code) => { if (code !== 0) return rej(new Error(`exit ${code}: ${err.trim()}`)); const u = findUrl(JSON.parse(out)); u[0] ? res(u[0]) : rej(new Error("no url")); });
  });
  const r = await fetch(url);
  fs.writeFileSync(OUT, Buffer.from(await r.arrayBuffer()));
  console.log("RETRY OK:", OUT, `(${fs.statSync(OUT).size}b)`);
}
main().catch((e) => { console.error("RETRY_FAILED:", e?.message || e); process.exit(1); });

// One-off: probe Higgsfield CLI for video models + generate ONE test clip.
// Cost-protective: generates a SINGLE 5s clip, not the full batch.
import dotenv from "dotenv";
import { resolve } from "path";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });
// .env creds are EXPIRED. Drop them so hf.exe uses the fresh `hf auth login` session store.
delete process.env.HIGGSFIELD_CREDENTIALS_JSON;
delete process.env.HIGGSFIELD_CREDENTIALS_PATH;

function probe(binPath: string): Promise<string> {
  return new Promise((res) => {
    const child = spawn(binPath, ["generate", "create", "--help"]);
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("close", () => res(out));
    child.on("error", () => res(""));
  });
}

async function main() {
  const { ensureHiggsfieldBinary } = await import("../server/services/higgsfieldBinary.ts");
  console.log("Ensuring hf binary (download is free, no credits)...");
  const binPath = await ensureHiggsfieldBinary();
  console.log("BINARY:", binPath);

  const help = await probe(binPath);
  const hay = help.toLowerCase();
  console.log("===== model probe =====");
  console.log("SEEDANCE in CLI help:", hay.includes("seedance"));
  console.log("WAN in CLI help:", hay.includes("wan"));
  console.log("--- help (first 2k chars) ---");
  console.log(help.slice(0, 2000));

  console.log("\nGenerating ONE test clip (Reel 1 / Beat 1, model wan2_6) — this spends credits...");
  const { generateReelClipVideo } = await import("../server/services/higgsfieldStudio.ts");
  const prompt =
    "lone car tire on a dark wooden table, one tiny birthday candle flickering in the tread grooves, moody spotlight, slow cinematic push-in, vertical 9:16, photoreal, shallow depth of field";
  const url = await generateReelClipVideo(prompt);
  console.log("CLIP URL:", url);

  const outDir = resolve("c:/Users/nourd/NOURCITY/apps/nickstire/scratch/out");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "reel1-beat1.mp4");
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  console.log("SAVED:", outPath, `(${buf.length} bytes)`);
}

main().catch((e) => {
  console.error("FAILED:", e?.message || e);
  process.exit(1);
});

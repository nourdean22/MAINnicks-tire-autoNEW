// Real AI narration via OpenAI TTS (uses existing OPENAI_API_KEY). Overwrites vo.wav.
import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("no OPENAI_API_KEY"); process.exit(1); }

const OUT = resolve("c:/Users/nourd/NOURCITY/apps/nickstire/scratch/out/reel1/vo.wav");
const TEXT = "Happy birthday. Plenty of tread... but this rubber is six years old. That little oval stamp? The week and year it was born. Old rubber cracks. Worth a look before a long drive.";
const INSTRUCTIONS = "Deadpan, dry, quietly confident narrator with a hint of wry amusement. Natural conversational pacing, as if stating obvious facts. Not an announcer.";

async function tts(model: string, body: Record<string, unknown>) {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, ...body }),
  });
  if (!r.ok) throw new Error(`${model} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  let buf: Buffer;
  try {
    buf = await tts("gpt-4o-mini-tts", { voice: "onyx", input: TEXT, instructions: INSTRUCTIONS, response_format: "wav" });
    console.log("used gpt-4o-mini-tts");
  } catch (e: any) {
    console.warn("gpt-4o-mini-tts failed, falling back to tts-1-hd:", e.message);
    buf = await tts("tts-1-hd", { voice: "onyx", input: TEXT, response_format: "wav" });
    console.log("used tts-1-hd");
  }
  fs.writeFileSync(OUT, buf);
  console.log("WROTE:", OUT, `(${buf.length} bytes)`);
}

main().catch((e) => { console.error("FAILED:", e?.message || e); process.exit(1); });

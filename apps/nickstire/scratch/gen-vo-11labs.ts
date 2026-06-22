// Reel 1 narration via ElevenLabs. Writes out/reel1/vo.wav (mp3 bytes; ffmpeg decodes by content).
import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error("no ELEVENLABS_API_KEY"); process.exit(1); }

const OUT = resolve("c:/Users/nourd/NOURCITY/apps/nickstire/scratch/out/reel1/vo.wav");
const TEXT = "Happy birthday. Plenty of tread, but this rubber is six years old. That little oval stamp? The week and year it was born. Old rubber cracks. Worth a look before a long drive.";

async function main() {
  const vr = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": KEY! } });
  if (!vr.ok) throw new Error(`voices HTTP ${vr.status}: ${(await vr.text()).slice(0, 200)}`);
  const voices: any[] = (await vr.json()).voices || [];
  const prefer = ["Brian", "Bill", "Adam", "Daniel", "George", "Charlie", "Josh"];
  const pick = voices.find((v) => prefer.includes(v.name)) || voices.find((v) => v.labels?.gender === "male") || voices[0];
  if (!pick) throw new Error("no voices available on account");
  console.log("voice:", pick.name, pick.voice_id);

  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${pick.voice_id}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ text: TEXT, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error(`tts HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  fs.writeFileSync(OUT, Buffer.from(await r.arrayBuffer()));
  console.log("WROTE:", OUT, `(${fs.statSync(OUT).size} bytes)`);
}
main().catch((e) => { console.error("ELEVENLABS_FAILED:", e?.message || e); process.exit(1); });

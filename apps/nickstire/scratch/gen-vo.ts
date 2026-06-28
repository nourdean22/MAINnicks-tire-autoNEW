// Parametrized narration generator. Usage: pnpm exec tsx scratch/gen-vo.ts <reel1|reel2|reel3> <google|elevenlabs>
// Writes out/<reel>/vo.wav. Google=Neural2 (free, commercial-clean). ElevenLabs="Roger".
import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";
import { REELS } from "./reels-data";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });

const REEL = process.argv[2] || "reel1";
const PROVIDER = (process.argv[3] || "google").toLowerCase();
const OUT = resolve("c:/Users/nourd/NOURCITY/apps/nickstire/scratch/out", REEL, "vo.wav");

const TEXTS: Record<string, string> = {
  reel1: "Happy birthday. Plenty of tread, but this rubber is six years old. That little oval stamp? The week and year it was born. Old rubber cracks. Worth a look before a long drive.",
  reel2: "We got the pothole to talk. Big hit, and it went straight for the rim. After a hard one, the wheel starts pulling. That is alignment. Worth getting it looked at.",
  reel3: "Something is stealing your air. Every ten degrees colder, you lose about a pound of pressure. Cold mornings, the light pops on. That is why. Top it back off. Case closed.",
  reel4: "Your tire is hiding a canyon. Stick a penny in the groove, Lincoln's head pointing down. If you can see all of his head, the tread is gone — time for new ones. Quick check, big difference.",
  reel5: "Your brakes are on a diet. Once the pad gets this thin, you're one drive from metal on metal — and that gets loud and expensive fast. A free check tells you exactly how much is left.",
  reel6: "This oil gave up weeks ago. Old oil turns to sludge and chews up your engine from the inside. A fresh change is the cheapest insurance your car will ever get.",
  reel7: "Your battery hates Cleveland winters. Cold can cut its cranking power by a third — which is why it dies the first freezing morning. A free test now beats a no-start later.",
  reel8: "Your wipers are just smearing now. When the rubber edge cracks, it streaks right where you need to see. They're a two-minute swap — don't wait for a downpour to find out.",
};

async function google(text: string) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n").replace(/^"|"$/g, "");
  const { google } = await import("googleapis");
  const jwt = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const { token } = await jwt.getAccessToken();
  const r = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: { text }, voice: { languageCode: "en-US", name: "en-US-Neural2-J" }, audioConfig: { audioEncoding: "LINEAR16", speakingRate: 0.97, pitch: -1.5 } }),
  });
  if (!r.ok) throw new Error(`google HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(((await r.json()) as any).audioContent, "base64");
}

async function elevenlabs(text: string) {
  const KEY = process.env.ELEVENLABS_API_KEY!;
  const voiceId = "CwhRBWXzGAHq8TQ4Fs17"; // Roger
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error(`elevenlabs HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  const text = TEXTS[REEL] || REELS.find((r) => r.dir === REEL)?.vo;
  if (!text) throw new Error(`no VO text for ${REEL}`);
  const buf = PROVIDER === "elevenlabs" ? await elevenlabs(text) : await google(text);
  fs.writeFileSync(OUT, buf);
  console.log(`WROTE ${OUT} (${buf.length}b) via ${PROVIDER}`);
}
main().catch((e) => { console.error("VO_FAILED:", e?.message || e); process.exit(1); });

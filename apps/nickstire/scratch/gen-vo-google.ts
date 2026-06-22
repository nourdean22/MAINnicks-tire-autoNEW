// Real AI narration via Google Cloud TTS (Neural2) using the existing service account. Overwrites vo.wav.
import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });

const OUT = resolve("c:/Users/nourd/NOURCITY/apps/nickstire/scratch/out/reel1/vo.wav");
const TEXT = "Happy birthday. Plenty of tread, but this rubber is six years old. That little oval stamp? The week and year it was born. Old rubber cracks. Worth a look before a long drive.";

async function main() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "";
  if (!email || !key) throw new Error("missing GOOGLE_SERVICE_ACCOUNT_EMAIL/KEY");
  key = key.replace(/\\n/g, "\n").replace(/^"|"$/g, "");

  const { google } = await import("googleapis");
  const jwt = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("no access token from service account");

  const body = {
    input: { text: TEXT },
    voice: { languageCode: "en-US", name: "en-US-Neural2-J" }, // deep male
    audioConfig: { audioEncoding: "LINEAR16", speakingRate: 0.97, pitch: -1.5 },
  };
  const r = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`TTS HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { audioContent?: string };
  if (!j.audioContent) throw new Error("no audioContent in response");
  fs.writeFileSync(OUT, Buffer.from(j.audioContent, "base64"));
  console.log("WROTE:", OUT, `(${fs.statSync(OUT).size} bytes)  voice=en-US-Neural2-J`);
}

main().catch((e) => { console.error("GOOGLE_TTS_FAILED:", e?.message || e); process.exit(1); });

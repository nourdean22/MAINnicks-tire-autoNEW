/**
 * reel-voice-candidates.ts [--execute] [--script "<text>"] — render ONE reel
 * voiceover script in the current voice and three Chirp 3 HD candidates so the
 * operator can pick by ear (job 2026-10-16-reel-quality-fixes). The pipeline
 * builds its request with the same googleTtsRequest, so what you hear here is
 * what REEL_GOOGLE_VOICE=<name> would send.
 *
 * Dry run (default): prints the four request bodies; no network, no spend.
 * --execute: four Google TTS calls (a few cents), WAVs written to
 * data/generated/voice-candidates/<voice>.wav. That folder is not gitignored:
 * delete it once a voice is chosen.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/reel-voice-candidates.ts --execute
 */
import fs from "node:fs";
import path from "node:path";
import { googleTtsRequest, googleVoice } from "../server/services/reelVoice";

const CANDIDATES = [
  "en-US-Neural2-J", // today's default
  "en-US-Chirp3-HD-Charon",
  "en-US-Chirp3-HD-Orus",
  "en-US-Chirp3-HD-Enceladus",
] as const;

// Short sentences, a comma where a breath goes: the VO rule the brief generator now carries.
const DEFAULT_SCRIPT =
  "That clunk over every bump is not the road. It is a worn sway bar link, and it gets louder. " +
  "We check it on the lift. Come by Nick's, walk-ins welcome.";

const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
const scriptIdx = argv.indexOf("--script");
const script = scriptIdx >= 0 && argv[scriptIdx + 1] ? argv[scriptIdx + 1] : DEFAULT_SCRIPT;

for (const voice of CANDIDATES) {
  const { body } = googleTtsRequest(script, { ...process.env, REEL_GOOGLE_VOICE: voice });
  process.stdout.write(`--- ${voice}\n${JSON.stringify(body, null, 2)}\n`);
}

if (!EXECUTE) {
  process.stdout.write("DRY RUN: no TTS call. Pass --execute to render the four WAVs.\n");
  process.exit(0);
}
if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  process.stderr.write("GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_KEY are required for --execute\n");
  process.exit(2);
}
const outDir = path.join(process.cwd(), "data", "generated", "voice-candidates");
fs.mkdirSync(outDir, { recursive: true });
for (const voice of CANDIDATES) {
  const wav = await googleVoice(script, { ...process.env, REEL_GOOGLE_VOICE: voice });
  const file = path.join(outDir, `${voice}.wav`);
  fs.writeFileSync(file, wav);
  process.stdout.write(`wrote ${file} (${wav.length} bytes)\n`);
}

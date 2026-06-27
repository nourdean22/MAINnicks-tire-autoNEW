import "dotenv/config";
import { assembleReel } from "./apps/nickstire/server/services/reelAssembly";
import { generateVoiceover } from "./apps/nickstire/server/services/reelVoice";

async function run() {
  console.log("Running reel assembly test...");
  try {
    const text = "Brake squeak is annoying, but it's rarely dangerous. Here's what you need to know about your brakes. First, humidity makes them squeal. Second, new pads can squeak for a few days. Don't panic!";
    // Ensure ElevenLabs is picked
    const tts = await generateVoiceover(text);
    if (!tts) throw new Error("TTS generation failed");
    console.log("Generated TTS + Audio:", tts.provider, tts.alignment ? "Has alignment" : "No alignment");

    const brief = {
      voiceoverScript: text,
      storyboardBeats: [
        {
          beatNumber: 1,
          startSecond: 0,
          endSecond: 3,
          onScreenText: "Brake squeak is annoying,"
        },
        {
          beatNumber: 2,
          startSecond: 3,
          endSecond: 6,
          onScreenText: "but it's rarely dangerous."
        }
      ]
    };
    
    console.log("Assembling reel...");
    const reelResult = await assembleReel(brief, [
      "https://assets.mixkit.co/videos/preview/mixkit-car-mechanic-working-on-a-wheel-42289-large.mp4",
      "https://assets.mixkit.co/videos/preview/mixkit-car-mechanic-working-on-a-wheel-42289-large.mp4"
    ], "test-123");
    
    console.log("Success! Reel URL:", reelResult.mp4Url);
  } catch (e) {
    console.error("Error assembling reel:", e);
  }
}
run();

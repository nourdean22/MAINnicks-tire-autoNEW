import type { StrategicFramework } from "../types";

/**
 * The Authentic Voice (Greene, Mastery Book V) — early work imitates its
 * influences; the influences must be shed even though your own voice
 * initially performs worse than your competent imitation.
 */
export const authenticVoice: StrategicFramework = {
  id: "authentic-voice",
  name: "The Authentic Voice (Greene · Mastery)",
  oneLiner: "Fluent but anonymous output is the imitation phase. Strip the borrowed register and survive the stretch where your own voice reads worse.",
  triggers: [
    /\b(sounds?|reads?|feels?)\s+(like\s+)?(everyone|every\s+other|the\s+same|generic|corporate|ai)\b/i,
    /\b(find|finding|develop)\s+(my|our|his|her|their)\s+(own\s+)?voice\b/i,
    /\b(brand|writing|copy)\s+voice\b/i,
    /\b(cookie.?cutter|boilerplate|derivative|formulaic)\b/i,
    /\b(doesn'?t|does\s+not)\s+sound\s+like\s+(me|us)\b/i,
    /\b(too\s+)?(corporate|sanitized|sterile)\s+(sounding|tone|copy)?\b/i,
    /\bstand\s+out\s+(in|with)\s+(our|my)\s+(writing|content|copy)\b/i,
  ],
  antiTriggers: [
    // Literal audio/voice features, not register.
    /\b(voice\s*(note|memo|message|call|agent|assistant)|text.to.speech|tts|voiceover)\b/i,
  ],
  weight: 0.9,
  lens: `Apply The Authentic Voice. Competent imitation is the expected
output of an apprenticeship, and it is invisible precisely because it is
competent — it earns polite non-reaction, never a strong one. Diagnose
first: name the influence or template the work is imitating, then ask
what survives if every choice traceable to it is deleted. The test is not
"is this good" but "could a competitor have produced this" — if yes, the
piece has not started. Expect the authentic version to read worse at
first; that discomfort is the transition, not a signal to revert. Push
for the one sentence only this operator could write, and build outward
from it.`,
};

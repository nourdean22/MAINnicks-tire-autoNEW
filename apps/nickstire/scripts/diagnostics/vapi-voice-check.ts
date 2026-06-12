import "dotenv/config";

const r = await fetch("https://api.vapi.ai/assistant/150fe622-0b9f-4b03-b8c7-3063812717ae", {
  headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
});
const c = await r.json() as Record<string, unknown>;
const voice = c.voice as Record<string, unknown> | undefined;
const model = c.model as Record<string, unknown> | undefined;

console.log("─── Voice config ───");
console.log("provider:    ", voice?.provider);
console.log("voiceId:     ", voice?.voiceId);
console.log("model:       ", voice?.model);
console.log("stability:   ", voice?.stability);
console.log("similarity:  ", voice?.similarityBoost);
console.log("");
console.log("─── Model ───");
console.log("provider:    ", model?.provider);
console.log("model:       ", model?.model);
console.log("");
console.log("─── First message ───");
console.log("firstMessage:", c.firstMessage);
console.log("firstMessageMode:", c.firstMessageMode);
console.log("");
console.log("─── Other ───");
console.log("silenceTimeoutSeconds:", c.silenceTimeoutSeconds);
console.log("maxDurationSeconds:   ", c.maxDurationSeconds);
console.log("backgroundSound:      ", c.backgroundSound);
console.log("transcriber.provider: ", (c.transcriber as Record<string, unknown> | undefined)?.provider);
console.log("transcriber.language: ", (c.transcriber as Record<string, unknown> | undefined)?.language);

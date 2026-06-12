import "dotenv/config";

// Get the most recent call detail
const r = await fetch("https://api.vapi.ai/call?assistantId=150fe622-0b9f-4b03-b8c7-3063812717ae&limit=1", {
  headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
});
const calls = await r.json() as Array<Record<string, unknown>>;
const callId = calls[0]?.id as string | undefined;
if (!callId) { console.error("No calls found"); process.exit(1); }

const dr = await fetch(`https://api.vapi.ai/call/${callId}`, {
  headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
});
const d = await dr.json() as Record<string, unknown>;
console.log("Full call detail:");
console.log(JSON.stringify(d, null, 2).slice(0, 3000));

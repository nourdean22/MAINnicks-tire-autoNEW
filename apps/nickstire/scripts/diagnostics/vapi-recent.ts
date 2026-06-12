import "dotenv/config";

const r = await fetch("https://api.vapi.ai/call?assistantId=150fe622-0b9f-4b03-b8c7-3063812717ae&limit=5", {
  headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
});
const calls = await r.json() as Array<Record<string, unknown>>;
const newest = calls[0];
console.log("Newest call:");
console.log("  time:", newest.createdAt ? new Date(newest.createdAt as string).toLocaleString("en-US", { timeZone: "America/New_York" }) : "?");
console.log("  reason:", newest.endedReason);
console.log("  cost:", newest.cost);
const cust = newest.customer as Record<string, unknown> | undefined;
console.log("  caller:", cust?.number);
const start = newest.startedAt as string | undefined;
const end = newest.endedAt as string | undefined;
console.log("  duration:", start && end ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000) : 0, "sec");
console.log("Now (ET):", new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));

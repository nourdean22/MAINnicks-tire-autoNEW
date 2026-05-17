/**
 * Probe Venice suggestions endpoint to see WHY it's failing.
 * Replicates the exact payload from app/api/ai/chat/suggestions/route.ts
 * and logs status code, headers, and full response body.
 *
 * Usage: node --env-file=.env.local scripts/probe-venice-suggestions.mjs
 */

const apiKey = (process.env.VENICE_API_KEY || "").trim();
const model =
  (process.env.VENICE_MODEL || "").trim() ||
  "olafangensan-glm-4.7-flash-heretic";

if (!apiKey) {
  console.error("✗ VENICE_API_KEY missing");
  process.exit(1);
}

console.log("→ key length:", apiKey.length, "model:", model);

const body = {
  model,
  messages: [
    {
      role: "system",
      content:
        'You are a reply-suggestion generator for Nick. Given Nour\'s message and Nick\'s reply, propose 3 short follow-ups. Return JSON only: {"suggestions":["...","...","..."]}. No prose, no markdown.',
    },
    {
      role: "user",
      content:
        "NOUR SAID:\nadd a task: walk the dog\n\nNICK REPLIED:\nDone — task created in Inbox.\n\nReturn the JSON.",
    },
  ],
  temperature: 0.6,
  max_tokens: 300,
  venice_parameters: {
    include_venice_system_prompt: false,
    strip_thinking_response: true,
    disable_thinking: true,
    enable_web_search: "off",
  },
};

const t0 = Date.now();
let res;
try {
  res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
} catch (err) {
  console.error("✗ fetch threw:", err.message);
  process.exit(1);
}
const ms = Date.now() - t0;
console.log(`→ ${res.status} ${res.statusText} · ${ms}ms`);
const text = await res.text();
console.log("→ body (first 800):");
console.log(text.slice(0, 800));

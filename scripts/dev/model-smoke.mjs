const base = (process.env.MODEL_BASE_URL || "").replace(/\/$/, "");
const model = process.env.MODEL_ID || "";
const key = process.env.MODEL_API_KEY || "";
const timeoutMs = Number(process.env.MODEL_TIMEOUT_MS || 120000);

if (!base || !model) {
  console.error("MODEL_BASE_URL and MODEL_ID are required");
  process.exit(2);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
const started = performance.now();

try {
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    signal: controller.signal,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly MODEL_SMOKE_OK" }],
      temperature: 0,
      max_tokens: 32,
    }),
  });

  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  const reply = body?.choices?.[0]?.message?.content || "";
  const result = {
    ok: response.ok && reply.includes("MODEL_SMOKE_OK"),
    status: response.status,
    model,
    latencyMs: Math.round(performance.now() - started),
    reply: reply.slice(0, 200),
    usage: body?.usage || null,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    model,
    latencyMs: Math.round(performance.now() - started),
    error: error?.name || String(error),
  }, null, 2));
  process.exit(1);
} finally {
  clearTimeout(timer);
}

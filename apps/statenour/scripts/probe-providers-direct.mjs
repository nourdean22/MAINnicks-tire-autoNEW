/**
 * Direct provider key probe — bypass the cron ping, test the actual
 * API to find if it's a key issue, network issue, or model issue.
 *
 * Read-only. Single tiny test request per provider.
 */
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OLLAMA_KEY = process.env.OLLAMA_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "https://ollama.com";

function clean(v) { return v ? v.replace(/\n|\r/g, "").trim() : v; }

async function probe(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    if (r.ok) console.log(`🟢 ${name.padEnd(12)} ${r.status} · ${ms}ms · model=${r.model || "?"}`);
    else console.log(`🔴 ${name.padEnd(12)} ${r.status} · ${ms}ms · ${(r.body || "").slice(0, 200)}`);
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`🔴 ${name.padEnd(12)} threw · ${ms}ms · ${e.message?.slice(0, 200)}`);
  }
}

async function main() {
  console.log("\n=== Direct provider probe ===\n");
  console.log(`OLLAMA_API_KEY    · ${OLLAMA_KEY ? `set (${clean(OLLAMA_KEY).length}ch)` : "MISSING"}`);
  console.log(`OPENAI_API_KEY    · ${OPENAI_KEY ? `set (${clean(OPENAI_KEY).length}ch)` : "MISSING"}`);
  console.log(`ANTHROPIC_API_KEY · ${ANTHROPIC_KEY ? `set (${clean(ANTHROPIC_KEY).length}ch)` : "MISSING"}`);
  console.log("");

  if (OLLAMA_KEY) {
    await probe("ollama", async () => {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
        headers: { Authorization: `Bearer ${clean(OLLAMA_KEY)}` },
      });
      const body = await res.text();
      let model = "?";
      try { const j = JSON.parse(body); model = j?.models?.[0]?.name || j?.data?.[0]?.id || "?"; } catch {}
      return { ok: res.ok, status: res.status, body, model };
    });
    // Also test the OpenAI-compatible endpoint we actually use
    await probe("ollama-oai", async () => {
      const res = await fetch(`${OLLAMA_BASE}/v1/models`, {
        headers: { Authorization: `Bearer ${clean(OLLAMA_KEY)}` },
      });
      const body = await res.text();
      let model = "?";
      try { const j = JSON.parse(body); model = j?.data?.[0]?.id || "?"; } catch {}
      return { ok: res.ok, status: res.status, body, model };
    });
  }

  if (OPENAI_KEY) {
    await probe("openai", async () => {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${clean(OPENAI_KEY)}` },
      });
      const body = await res.text();
      let model = "?";
      try { const j = JSON.parse(body); model = j?.data?.[0]?.id || "?"; } catch {}
      return { ok: res.ok, status: res.status, body, model };
    });
  }

  if (ANTHROPIC_KEY) {
    await probe("anthropic", async () => {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": clean(ANTHROPIC_KEY),
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "claude-haiku-3.5", max_tokens: 5, messages: [{ role: "user", content: "hi" }] }),
      });
      const body = await res.text();
      return { ok: res.ok, status: res.status, body };
    });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

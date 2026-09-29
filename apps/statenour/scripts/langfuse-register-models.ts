/**
 * scripts/langfuse-register-models.ts · 2026-09-08 (program U6)
 *
 * Registers this app's model price definitions in Langfuse so traces stop
 * reporting cost 0. Idempotent: a definition with the same modelName is
 * deleted and re-created with the current prices.
 *
 *   pnpm tsx scripts/langfuse-register-models.ts --dry-run   # print only
 *   railway run --service statenour-web -- pnpm tsx scripts/langfuse-register-models.ts
 *
 * Needs LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL (optional).
 * Prices come from lib/ai/pricing.ts — never edit them here.
 */
import { LANGFUSE_MODEL_PRICES, RETIRED_LANGFUSE_MODEL_NAMES } from "../lib/ai/pricing";

const dryRun = process.argv.includes("--dry-run");
const pk = process.env.LANGFUSE_PUBLIC_KEY;
const sk = process.env.LANGFUSE_SECRET_KEY;
const base = (process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com").replace(/\/+$/, "");

async function main() {
  console.log(`[langfuse-models] ${LANGFUSE_MODEL_PRICES.length} definitions · ${dryRun ? "DRY RUN" : base}`);
  for (const m of LANGFUSE_MODEL_PRICES) {
    console.log(`  ${m.modelName}  /${m.matchPattern}/  in=$${m.inputPrice}/tok out=$${m.outputPrice}/tok  (e.g. ${m.sample})`);
  }
  if (dryRun) return;
  if (!pk || !sk) {
    console.error("[langfuse-models] LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY missing — nothing sent");
    process.exit(2);
  }
  const auth = "Basic " + Buffer.from(`${pk}:${sk}`).toString("base64");
  const headers = { "content-type": "application/json", authorization: auth };

  const listRes = await fetch(`${base}/api/public/models?limit=100`, { headers });
  if (!listRes.ok) throw new Error(`list models: HTTP ${listRes.status}`);
  const listed = (await listRes.json()) as { data?: Array<{ id: string; modelName: string; isLangfuseManaged?: boolean }> };
  const existing = new Map((listed.data ?? []).filter((d) => !d.isLangfuseManaged).map((d) => [d.modelName, d.id]));

  for (const name of RETIRED_LANGFUSE_MODEL_NAMES) {
    const id = existing.get(name);
    if (!id) continue;
    const del = await fetch(`${base}/api/public/models/${id}`, { method: "DELETE", headers });
    if (!del.ok && del.status !== 404) throw new Error(`delete retired ${name}: HTTP ${del.status}`);
    console.log(`[langfuse-models] deleted retired definition ${name}`);
  }

  let created = 0;
  for (const m of LANGFUSE_MODEL_PRICES) {
    const prior = existing.get(m.modelName);
    if (prior) {
      const del = await fetch(`${base}/api/public/models/${prior}`, { method: "DELETE", headers });
      if (!del.ok && del.status !== 404) throw new Error(`delete ${m.modelName}: HTTP ${del.status}`);
    }
    const res = await fetch(`${base}/api/public/models`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        modelName: m.modelName,
        matchPattern: m.matchPattern,
        unit: "TOKENS",
        inputPrice: m.inputPrice,
        outputPrice: m.outputPrice,
      }),
    });
    if (!res.ok) throw new Error(`create ${m.modelName}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
    created += 1;
  }
  console.log(`[langfuse-models] registered ${created}/${LANGFUSE_MODEL_PRICES.length} (replaced ${[...existing.keys()].filter((k) => LANGFUSE_MODEL_PRICES.some((m) => m.modelName === k)).length})`);
}

main().catch((err) => {
  console.error("[langfuse-models] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

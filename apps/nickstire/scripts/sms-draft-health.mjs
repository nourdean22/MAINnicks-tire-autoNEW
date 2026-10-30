/**
 * sms-draft-health.mjs · READ-ONLY · the W1 proof read for customer SMS drafts.
 *
 * Reads `metadata_json.draft` ({ source, model, completion, finishReason }) that
 * smsOrchestrator writes on every inbound_sms orchestration with an AI draft, and
 * prints, per provider/model: drafts, provider-complete, 5+ words, and both.
 * Baseline before W1 (2026-10, no provenance recorded): 1 of 23 drafts complete.
 * Target: >= 90% complete and 5+ words. Counts only; never prints message text.
 *
 * Usage (from apps/nickstire, prod read via Railway env):
 *   railway run -s MAINnicks-tire-auto -- node scripts/sms-draft-health.mjs [days=14]
 *   node scripts/sms-draft-health.mjs --self-test
 */
import assert from "node:assert/strict";

function summarize(rows) {
  const out = {};
  for (const r of rows) {
    let md = null;
    try { md = typeof r.metadata_json === "string" ? JSON.parse(r.metadata_json) : r.metadata_json; } catch { md = null; }
    const d = md?.draft;
    if (!d) continue; // template replies and pre-W1 rows carry no draft provenance
    const key = `${d.source ?? "?"} | ${d.model ?? "?"}`;
    const s = (out[key] ||= { drafts: 0, complete: 0, fivePlusWords: 0, completeAndFivePlus: 0, finishReasons: {} });
    const words = String(r.message_body ?? "").split(/\s+/).filter(Boolean).length;
    const complete = d.completion === "complete";
    s.drafts++;
    if (complete) s.complete++;
    if (words >= 5) s.fivePlusWords++;
    if (complete && words >= 5) s.completeAndFivePlus++;
    const fr = d.finishReason ?? "(none)";
    s.finishReasons[fr] = (s.finishReasons[fr] || 0) + 1;
  }
  return out;
}

if (process.argv.includes("--self-test")) {
  const res = summarize([
    { metadata_json: JSON.stringify({ draft: { source: "a", model: "m", completion: "complete", finishReason: "stop" } }), message_body: "Yes we do alignments, come by." },
    { metadata_json: JSON.stringify({ draft: { source: "a", model: "m", completion: "truncated", finishReason: "length" } }), message_body: "Hey, this" },
    { metadata_json: JSON.stringify({ router: {} }), message_body: "template reply text here ok" },
    { metadata_json: "not json", message_body: "x" },
  ]);
  assert.deepEqual(res, { "a | m": { drafts: 2, complete: 1, fivePlusWords: 1, completeAndFivePlus: 1, finishReasons: { stop: 1, length: 1 } } });
  console.log("self-test ok");
} else {
  const { default: mysql } = await import("mysql2/promise");
  const days = Number(process.argv[2]) || 14;
  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  const [rows] = await conn.query(
    "SELECT metadata_json, message_body FROM sms_orchestrations WHERE event_type = 'inbound_sms' AND createdAt >= NOW() - INTERVAL ? DAY",
    [days],
  );
  await conn.end();
  console.log(JSON.stringify({ days, inboundOrchestrations: rows.length, byProvider: summarize(rows) }, null, 1));
}

/**
 * memory-counterfactual · which of Nick's memories can reach an answer at all?
 *
 * READ-ONLY. Loads every nick_memory_* row from shop_settings and replays, in
 * memory, the two paths by which a memory reaches the model's prompt
 * (server/services/nickMemory.ts, read 2026-09-22):
 *
 *   warmup   · getWarmupContext(): recall(limit 15) = the top 15 rows by
 *              confidence DESC then lastReinforced/createdAt DESC, re-sorted by
 *              confidence x uses, the first 10 injected. If this is non-empty,
 *              getMemoryContext() is never consulted (routers/nick/intelligence.ts).
 *   relevant · smartRecall(query, 5): the top 50 rows by the same order, scored
 *              keywordOverlap*3 + confidence*2 + uses*0.5 + recency*2, first 5.
 *              Whatever the query, a row outside that top 50 cannot be picked.
 *
 * Counterfactual, per row: remove it, replay warmup — does the injected set
 * change? Per source: remove every row that writer produced — what enters the
 * prompt in their place? Operator mandate 2026-09-22 item 9 (counterfactual
 * memory diagnostic) and item 11 (confidence stays confidence: this script
 * only measures the ranking the code already does, it proposes no scalar).
 *
 *   railway run -s MAINnicks-tire-auto -- node scripts/diagnostics/memory-counterfactual.mjs [--json]
 */
import mysql from "mysql2/promise";

const JSON_OUT = process.argv.includes("--json");
const WARMUP_WINDOW = 15;
const WARMUP_TAKE = 10;
const POOL = 50;
const DAY = 86_400_000;

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("mysql://")) {
  console.error("DATABASE_URL missing — run via: railway run -s MAINnicks-tire-auto -- node scripts/diagnostics/memory-counterfactual.mjs");
  process.exit(1);
}
const c = await mysql.createConnection(url);
const [raw] = await c.query("SELECT id, `key`, value FROM shop_settings WHERE `key` LIKE 'nick_memory_%'");
await c.end();

const rows = [];
for (const r of raw) {
  try {
    const d = JSON.parse(r.value);
    rows.push({
      id: Number(r.id),
      type: d.type ?? "insight",
      source: d.source ?? "?",
      identity: typeof d.identity === "string" ? d.identity : null,
      confidence: Number(d.confidence ?? 0.7),
      uses: Number(d.uses ?? 1),
      createdAt: new Date(d.createdAt ?? 0).getTime(),
      lastReinforced: new Date(d.lastReinforced ?? d.createdAt ?? 0).getTime(),
      content: String(d.content ?? ""),
    });
  } catch {
    // an unparsable row is skipped by recall() too (it logs and drops it)
  }
}

// ── the production ranking, verbatim in shape ────────────────────────────
const recallOrder = (a, b) => b.confidence - a.confidence || b.lastReinforced - a.lastReinforced || a.id - b.id;
const utility = (m) => m.confidence * m.uses;
const warmupSet = (pool) => {
  const top = [...pool].sort(recallOrder).slice(0, WARMUP_WINDOW);
  top.sort((a, b) => utility(b) - utility(a));
  return top.slice(0, WARMUP_TAKE);
};
const poolSet = (pool) => [...pool].sort(recallOrder).slice(0, POOL);
const ids = (set) => new Set(set.map((m) => m.id));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

const baseWarmup = warmupSet(rows);
const baseWarmupIds = ids(baseWarmup);
const basePoolIds = ids(poolSet(rows));

// ── per-row counterfactual ───────────────────────────────────────────────
let loadBearing = 0; // removing it changes the injected 10
let inWarmup = 0;
let inPoolOnly = 0; // reachable by smartRecall for some query, never by warmup
let unreachable = 0;
const outsideWarmupButLoadBearing = [];
for (const m of rows) {
  const without = rows.filter((x) => x.id !== m.id);
  const changed = !sameSet(ids(warmupSet(without)), baseWarmupIds);
  if (changed) loadBearing++;
  if (baseWarmupIds.has(m.id)) inWarmup++;
  else if (basePoolIds.has(m.id)) inPoolOnly++;
  else unreachable++;
  if (changed && !baseWarmupIds.has(m.id)) outsideWarmupButLoadBearing.push(m);
}

// ── per-source counterfactual ────────────────────────────────────────────
const bySource = new Map();
for (const m of rows) bySource.set(m.source, (bySource.get(m.source) ?? 0) + 1);
const sourceEffects = [];
for (const [source, n] of bySource) {
  const without = rows.filter((x) => x.source !== source);
  const after = warmupSet(without);
  const afterIds = ids(after);
  const removedFromPrompt = baseWarmup.filter((m) => !afterIds.has(m.id)).length;
  const entered = after.filter((m) => !baseWarmupIds.has(m.id));
  sourceEffects.push({ source, rows: n, inWarmup: baseWarmup.filter((m) => m.source === source).length, removedFromPrompt, entered: entered.map((m) => `${m.source}#${m.id}`) });
}
sourceEffects.sort((a, b) => b.inWarmup - a.inWarmup || b.rows - a.rows);

// ── the margin: what is one reinforcement away from entering the prompt ─
const tenth = baseWarmup[baseWarmup.length - 1];
const oneAway = rows.filter((m) => {
  if (baseWarmupIds.has(m.id)) return false;
  const boosted = { ...m, confidence: Math.min(1, m.confidence + 0.05), uses: m.uses + 1, lastReinforced: Date.now() };
  const withBoost = rows.map((x) => (x.id === m.id ? boosted : x));
  return ids(warmupSet(withBoost)).has(m.id);
}).length;

// ── what the prompt would hold under two alternative warmup orderings ────
// (item 11: measured, not proposed — the operator decides; confidence stays confidence)
const altWarmup = (order) => {
  const top = [...rows].sort(recallOrder).slice(0, WARMUP_WINDOW);
  top.sort(order);
  return top.slice(0, WARMUP_TAKE);
};
const altRecallOnly = altWarmup(recallOrder); // confidence, then most recently reinforced
const altLogUses = altWarmup((a, b) => b.confidence * Math.log2(b.uses + 1) - a.confidence * Math.log2(a.uses + 1) || recallOrder(a, b));

const now = Date.now();
const describe = (m) => `[${m.type}|${Math.round(m.confidence * 100)}%|${m.uses}x|${m.identity ? "identity " + m.identity : m.source}|${Math.round((now - m.lastReinforced) / DAY)}d] ${m.content.replace(/\s+/g, " ").slice(0, 90)}`;

const report = {
  storeRows: rows.length,
  identityRows: rows.filter((m) => m.identity).length,
  warmup: baseWarmup.map((m) => ({ id: m.id, type: m.type, source: m.source, identity: m.identity, confidence: m.confidence, uses: m.uses, utility: utility(m) })),
  reach: { inWarmup, inPoolOnly, unreachable },
  loadBearing,
  outsideWarmupButLoadBearing: outsideWarmupButLoadBearing.map((m) => m.id),
  tenthUtility: tenth ? utility(tenth) : null,
  oneReinforcementAway: oneAway,
  sourceEffects,
  altRecallOnly: altRecallOnly.map((m) => m.id),
  altLogUses: altLogUses.map((m) => m.id),
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`store: ${rows.length} rows (${report.identityRows} identity rows)`);
  console.log(`\nTHE PROMPT TODAY — getWarmupContext() injects these ${baseWarmup.length} (top ${WARMUP_WINDOW} by confidence, re-sorted by confidence x uses):`);
  for (const m of baseWarmup) console.log(`  ${describe(m)}`);
  console.log(`\nREACH (for ANY query):`);
  console.log(`  ${inWarmup} rows reach the prompt on every turn (warmup)`);
  console.log(`  ${inPoolOnly} rows can reach it only through smartRecall's keyword score (they sit in the top ${POOL})`);
  console.log(`  ${unreachable} rows cannot influence any answer, whatever they say, until their confidence rank changes`);
  console.log(`\nCOUNTERFACTUAL, per row: removing one row changes the injected set for ${loadBearing} rows (${inWarmup} are the set itself; ${outsideWarmupButLoadBearing.length} outside it move the window).`);
  console.log(`  utility of the 10th row: ${tenth ? utility(tenth).toFixed(2) : "-"} · rows one reinforcement (+0.05, +1 use) away from entering: ${oneAway}`);
  console.log(`\nIF THE WARMUP RE-SORT WERE DROPPED (confidence, then most recently reinforced — recall()'s own order):`);
  for (const m of altRecallOnly) console.log(`  ${describe(m)}`);
  console.log(`\nIF USES COUNTED LOGARITHMICALLY (confidence x log2(uses+1)):`);
  for (const m of altLogUses) console.log(`  ${describe(m)}`);
  console.log(`\nCOUNTERFACTUAL, per source (remove every row that writer produced):`);
  for (const s of sourceEffects.slice(0, 12)) {
    console.log(`  ${s.source.padEnd(28)} rows ${String(s.rows).padStart(4)} · in prompt ${s.inWarmup} · removing it evicts ${s.removedFromPrompt} from the prompt${s.entered.length ? ", admits " + s.entered.join(", ") : ""}`);
  }
}

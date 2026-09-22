/**
 * memory-eviction-simulation · what would Nick forget under each eviction policy?
 *
 * READ-ONLY. Loads every nick_memory_* row from shop_settings, derives the inflow
 * (rows created in the last 30 days, per source, with the confidence they entered
 * at) and the reinforcement rate (uses over age), then replays 30 simulated days
 * of inserts, reinforcements and decay under each candidate policy — in memory,
 * never writing a row. Operator mandate 2026-09-22 item 10: simulate eviction
 * policies against the real distribution before changing production; item 11:
 * never collapse confidence into a single utility scalar (every policy below
 * keeps confidence as confidence and changes only WHO is chosen at the cap).
 *
 * The production rules replayed exactly (server/services/nickMemory.ts):
 *   insert     · at >= 500 rows, delete ONE non-preference row ordered by
 *                confidence ASC then lastReinforced/createdAt ASC, then insert
 *                (confidence = writer's value or 0.7, uses 1)
 *   reinforce  · hash hit: uses+1, confidence = min(1, +0.05), original = that,
 *                lastReinforced = now
 *   decay      · original - 0.05 per full 30 days since last reinforcement,
 *                floor 0.10; prune (non-preference) below 0.15 after 90 days
 *   recall     · top N by confidence DESC then lastReinforced DESC
 *
 *   railway run -s MAINnicks-tire-auto -- node scripts/diagnostics/memory-eviction-simulation.mjs [--days 30] [--seed 7]
 */
import mysql from "mysql2/promise";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DAYS = Number(opt("days", "30"));
const SEED = Number(opt("seed", "7"));
const DAY = 86_400_000;
const STEP = 30 * DAY;
const CAP = 500;

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("mysql://")) {
  console.error("DATABASE_URL missing — run via: railway run -s MAINnicks-tire-auto -- node scripts/diagnostics/memory-eviction-simulation.mjs");
  process.exit(1);
}
const c = await mysql.createConnection(url);
const [raw] = await c.query("SELECT id, `key`, value FROM shop_settings WHERE `key` LIKE 'nick_memory_%'");
await c.end();

const now = Date.now();
const rows = [];
for (const r of raw) {
  try {
    const d = JSON.parse(r.value);
    rows.push({
      id: Number(r.id),
      type: d.type ?? "insight",
      source: d.source ?? "?",
      confidence: Number(d.confidence ?? 0.7),
      original: Number(d.originalConfidence ?? d.confidence ?? 0.7),
      uses: Number(d.uses ?? 1),
      createdAt: new Date(d.createdAt ?? 0).getTime(),
      lastReinforced: new Date(d.lastReinforced ?? d.createdAt ?? 0).getTime(),
      health: typeof d.content === "string" && d.content.startsWith("System health:"),
    });
  } catch {
    // an unparsable row cannot be modelled; it is also not evictable by the real code
  }
}

// ── production rules, verbatim in shape ──────────────────────────────────
const decayed = (original, ageMs) =>
  ageMs <= STEP ? original : Math.max(0.1, Math.round((original - Math.floor(ageMs / STEP) * 0.05) * 100) / 100);
const prunable = (row, ageMs) => row.type !== "preference" && row.confidence < 0.15 && ageMs > STEP * 3;
const evictionOrder = (a, b) => a.confidence - b.confidence || a.lastReinforced - b.lastReinforced;
const recallOrder = (a, b) => b.confidence - a.confidence || b.lastReinforced - a.lastReinforced;

// ── the observed inflow and reinforcement rates ──────────────────────────
const recent = rows.filter((r) => now - r.createdAt <= 30 * DAY);
const inflow = new Map(); // source → { perDay, entryConfidences[] }
for (const r of recent) {
  const e = inflow.get(r.source) ?? { count: 0, entry: [] };
  e.count += 1;
  // a row with one use and no decay yet still carries its entry confidence
  if (r.uses === 1 && now - r.lastReinforced <= STEP) e.entry.push(r.confidence);
  inflow.set(r.source, e);
}
// the self-healing bridge is cut (#2520): its inflow is zero from here on
inflow.delete("self_healing");
const inflowRows = [...inflow].map(([source, e]) => ({
  source,
  perDay: e.count / 30,
  entry: e.entry.length ? e.entry : [0.7],
}));

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── policies: each returns { name, evictAt(store, incoming), admit(store, incoming), reinforceCap, prepare(store) } ──
const lowestEvictable = (store, pred = () => true) => {
  let best = null;
  for (const r of store) if (r.type !== "preference" && pred(r) && (!best || evictionOrder(r, best) < 0)) best = r;
  return best;
};
const policies = [
  {
    name: "P0 current",
    evict: (store) => lowestEvictable(store),
  },
  {
    name: "P1 admission floor (refuse below the row it would evict)",
    admit: (store, incoming) => {
      if (store.length < CAP) return true;
      const floor = lowestEvictable(store);
      return !floor || incoming.confidence > floor.confidence;
    },
    evict: (store) => lowestEvictable(store),
  },
  {
    name: "P2 shrink to 500 once (current order), then current",
    prepare: (store) => {
      let n = 0;
      while (store.length > CAP) { const v = lowestEvictable(store); if (!v) break; store.splice(store.indexOf(v), 1); n += 1; }
      return `shrank by ${n}`;
    },
    evict: (store) => lowestEvictable(store),
  },
  {
    name: "P3 LRU (least recently reinforced, confidence ignored)",
    evict: (store) => {
      let best = null;
      for (const r of store) if (r.type !== "preference" && (!best || r.lastReinforced < best.lastReinforced)) best = r;
      return best;
    },
  },
  {
    name: "P4 reinforcement cap 0.95 (no immortals), otherwise current",
    reinforceCap: 0.95,
    prepare: (store) => { let n = 0; for (const r of store) if (r.confidence > 0.95) { r.confidence = 0.95; r.original = 0.95; n += 1; } return `capped ${n} rows at 0.95`; },
    evict: (store) => lowestEvictable(store),
  },
  {
    name: "P5 per-source share cap 30 % (evict from the crowding source first)",
    evict: (store, incoming) => {
      const share = store.filter((r) => r.source === incoming.source).length / store.length;
      return (share > 0.3 && lowestEvictable(store, (r) => r.source === incoming.source)) || lowestEvictable(store);
    },
  },
  {
    name: "P6 prune the 'System health' rows first (the operator script), then current",
    prepare: (store) => { const n = store.length; for (let i = store.length - 1; i >= 0; i -= 1) if (store[i].health) store.splice(i, 1); return `pruned ${n - store.length} health rows`; },
    evict: (store) => lowestEvictable(store),
  },
];

function simulate(policy) {
  const rnd = mulberry32(SEED);
  const store = rows.map((r) => ({ ...r }));
  const prepared = policy.prepare ? policy.prepare(store) : "";
  const startIds = new Set(store.map((r) => r.id));
  const evicted = [];
  const refused = [];
  const inserted = [];
  let nextId = -1;
  for (let day = 1; day <= DAYS; day += 1) {
    const t = now + day * DAY;
    // reinforcements at each row's historical rate — never for the health rows:
    // their only writer (the self-healing bridge) is gone (#2520), so their
    // past reinforcements say nothing about their future
    for (const r of store) {
      if (r.uses < 2 || r.health) continue;
      const rate = (r.uses - 1) / Math.max(1, (now - r.createdAt) / DAY);
      if (rnd() < Math.min(1, rate)) {
        r.uses += 1;
        r.confidence = Math.min(policy.reinforceCap ?? 1.0, Math.round((r.confidence + 0.05) * 100) / 100);
        r.original = r.confidence;
        r.lastReinforced = t;
      }
    }
    // inserts at the observed per-source rate
    for (const src of inflowRows) {
      let n = Math.floor(src.perDay);
      if (rnd() < src.perDay - n) n += 1;
      for (let k = 0; k < n; k += 1) {
        const incoming = { id: nextId--, type: "insight", source: src.source, confidence: src.entry[Math.floor(rnd() * src.entry.length)], uses: 1, createdAt: t, lastReinforced: t, health: false };
        incoming.original = incoming.confidence;
        if (policy.admit && !policy.admit(store, incoming)) { refused.push(incoming); continue; }
        if (store.length >= CAP) {
          const v = policy.evict(store, incoming);
          if (v) { store.splice(store.indexOf(v), 1); evicted.push({ ...v, evictedOn: day }); }
        }
        store.push(incoming);
        inserted.push(incoming);
      }
    }
    // daily decay + prune (production runs it every hourly pass)
    for (let i = store.length - 1; i >= 0; i -= 1) {
      const r = store[i];
      const age = t - r.lastReinforced;
      r.confidence = decayed(r.original, age);
      if (prunable(r, age)) { store.splice(i, 1); evicted.push({ ...r, evictedOn: day, pruned: true }); }
    }
  }
  const survivingNew = inserted.filter((r) => store.includes(r)).length;
  const lostOriginal = rows.length - store.filter((r) => startIds.has(r.id)).length;
  const bySource = (list) => { const m = new Map(); for (const r of list) m.set(r.source, (m.get(r.source) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
  const top50 = [...store].sort(recallOrder).slice(0, 50);
  const medianAgeEvicted = evicted.length ? Math.round(evicted.map((r) => (now - r.createdAt) / DAY).sort((a, b) => a - b)[Math.floor(evicted.length / 2)]) : null;
  return {
    name: policy.name, prepared, size: store.length,
    inserted: inserted.length, refused: refused.length, survivingNew,
    evicted: evicted.length, pruned: evicted.filter((r) => r.pruned).length, lostOriginal, medianAgeEvicted,
    evictedBySource: bySource(evicted).slice(0, 5), immortals: store.filter((r) => r.confidence >= 1).length,
    top50: bySource(top50).slice(0, 5), healthLeft: store.filter((r) => r.health).length,
    prefs: store.filter((r) => r.type === "preference").length,
  };
}

// ── report ───────────────────────────────────────────────────────────────
const fmt = (pairs) => pairs.map(([k, v]) => `${k} ${v}`).join(" · ");
const bucket = new Map();
for (const r of rows) bucket.set(r.confidence, (bucket.get(r.confidence) ?? 0) + 1);
console.log(`store now: ${rows.length} rows · cap ${CAP} · preference ${rows.filter((r) => r.type === "preference").length} · health ${rows.filter((r) => r.health).length} · at 1.0: ${rows.filter((r) => r.confidence >= 1).length}`);
console.log("confidence: " + [...bucket].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}×${v}`).join(" "));
console.log("by source: " + fmt((() => { const m = new Map(); for (const r of rows) m.set(r.source, (m.get(r.source) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 10); })()));
console.log(`inflow (rows created in the last 30 d, evicted ones invisible — a lower bound): ${recent.length} rows = ${(recent.length / 30).toFixed(1)}/day`);
for (const s of inflowRows.sort((a, b) => b.perDay - a.perDay)) console.log(`  ${s.source.padEnd(28)} ${s.perDay.toFixed(2)}/day · entry confidence ${[...new Set(s.entry)].sort().join("/")}`);
console.log(`reinforcing rows (uses ≥ 2): ${rows.filter((r) => r.uses >= 2).length} · simulated ${DAYS} days, seed ${SEED}`);
// what recall() hands the prompt TODAY, before any simulation
const nowTop = [...rows].sort(recallOrder);
const nowTop50 = nowTop.slice(0, 50);
const nowTop20 = nowTop.slice(0, 20);
console.log(`recall top-50 TODAY by source: ${fmt((() => { const m = new Map(); for (const r of nowTop50) m.set(r.source, (m.get(r.source) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 6); })())}`);
console.log(`recall top-20 TODAY (what smartRecall/warmup see): health ${nowTop20.filter((r) => r.health).length} · by source ${fmt((() => { const m = new Map(); for (const r of nowTop20) m.set(r.source, (m.get(r.source) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); })())}\n`);
console.log("| policy | prepared | size | inserted | refused | new rows surviving | evicted (pruned) | original rows lost | median age of evicted (d) | evicted by source | immortals (1.0) | recall top-50 by source | health left |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const p of policies) {
  const r = simulate(p);
  console.log(`| ${r.name} | ${r.prepared || "—"} | ${r.size} | ${r.inserted} | ${r.refused} | ${r.survivingNew} of ${r.inserted} | ${r.evicted} (${r.pruned}) | ${r.lostOriginal} | ${r.medianAgeEvicted ?? "—"} | ${fmt(r.evictedBySource) || "—"} | ${r.immortals} | ${fmt(r.top50)} | ${r.healthLeft} |`);
}

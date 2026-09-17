/**
 * What is Langfuse reporting from production?
 *
 * Langfuse is the trace sink for AI SDK calls (lib/observability/langfuse.ts,
 * OTEL -> ${LANGFUSE_BASE_URL}/api/public/otel). This reads the PUBLIC API back
 * out: recent traces, and observations whose level is WARNING/ERROR.
 *
 * ⚠ SILENCE IS NOT HEALTH — and here it has THREE causes, not two:
 *   · nothing errored;
 *   · nothing was TRACED (exporter down, keys missing, flag off);
 *   · the query reached the wrong project.
 * The control below prints total recent traces first. Zero errors against zero
 * traces says nothing at all; zero errors against N traces is a real result.
 *
 * ⚠ NEVER PRINTS THE KEYS. Presence and length only.
 *
 * READ-ONLY against Langfuse; touches no database.
 * Usage: railway run -s statenour-web -- node apps/statenour/scripts/probe-langfuse-errors.mjs
 */
const PUB = process.env.LANGFUSE_PUBLIC_KEY;
const SEC = process.env.LANGFUSE_SECRET_KEY;
const BASE = (process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com").replace(/\/+$/, "");
const DAYS = Number(process.env.DAYS ?? 7);
const TIMEOUT_MS = 20_000;

if (!PUB || !SEC) {
  console.error(
    "LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY absent — refusing to guess a project.\n" +
      "(That absence is itself the finding: tracing cannot be exporting either.)",
  );
  process.exit(2);
}
console.log(
  `base: ${BASE}  ·  public key present (${PUB.length} chars) · secret present (${SEC.length} chars), neither shown`,
);

const auth = "Basic " + Buffer.from(`${PUB}:${SEC}`).toString("base64");
const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

async function api(path) {
  const res = await fetch(`${BASE}/api/public${path}`, {
    headers: { Authorization: auth, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, body: (await res.text()).slice(0, 200) };
  }
  return { ok: true, json: await res.json() };
}

async function main() {
  // ── CONTROL: is anything being traced at all? ───────────────────────
  const traces = await api(`/traces?fromTimestamp=${encodeURIComponent(since)}&limit=100`);
  if (!traces.ok) {
    console.error(
      `\nABORT — /traces returned ${traces.status}. Cannot distinguish "no errors" from\n` +
        `        "no access". Body: ${traces.body}`,
    );
    process.exit(2);
  }
  const list = traces.json?.data ?? [];
  const meta = traces.json?.meta ?? {};
  console.log(`\ncontrol: ${meta.totalItems ?? list.length} trace(s) in the last ${DAYS}d`);
  if ((meta.totalItems ?? list.length) === 0) {
    console.log(
      "\nVERDICT: ZERO traces in the window. This says NOTHING about error rates —\n" +
        "         it says the exporter, the keys, or the project selection is the\n" +
        "         thing to check first. Do not read it as a clean bill of health.",
    );
    return;
  }

  // Trace-level names, so a failing surface is identifiable.
  const byName = new Map();
  for (const t of list) {
    const k = t.name ?? "(unnamed)";
    byName.set(k, (byName.get(k) ?? 0) + 1);
  }
  console.log(`\n── recent trace names (sample of ${list.length}) ──`);
  for (const [n, c] of [...byName].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(c).padStart(4)}x ${n}`);
  }

  // ── ERROR / WARNING observations ────────────────────────────────────
  for (const level of ["ERROR", "WARNING"]) {
    // Several pages, because ONE page of 50 out of thousands is a sample of
    // whatever sorted first — and reporting "all errors are X" from it would
    // be a conclusion about pagination, not about production.
    const rows = [];
    let total = null;
    for (let page = 1; page <= 6; page++) {
      const obs = await api(
        `/observations?fromStartTime=${encodeURIComponent(since)}&level=${level}&limit=100&page=${page}`,
      );
      if (!obs.ok) {
        console.log(`\n⚠ /observations?level=${level} p${page} returned ${obs.status} — UNKNOWN, not zero.`);
        break;
      }
      total ??= obs.json?.meta?.totalItems ?? null;
      const batch = obs.json?.data ?? [];
      rows.push(...batch);
      if (batch.length < 100) break;
    }
    total ??= rows.length;
    console.log(`\n── ${level}: ${total} total · ${rows.length} sampled ──`);
    // WHICH SURFACE is failing decides whether this is contained or systemic.
    const bySurface = new Map();
    for (const o of rows) {
      const s = String(o.name ?? "(unnamed)").split(":")[0];
      bySurface.set(s, (bySurface.get(s) ?? 0) + 1);
    }
    for (const [s, c] of [...bySurface].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`  surface ${String(c).padStart(5)}x ${s}`);
    }
    const cluster = new Map();
    for (const o of rows) {
      const key = `${o.name ?? "(unnamed)"} · ${String(o.statusMessage ?? "").slice(0, 70).replace(/\s+/g, " ")}`;
      cluster.set(key, (cluster.get(key) ?? 0) + 1);
    }
    if (cluster.size === 0) console.log("  none in the sampled page.");
    for (const [k, c] of [...cluster].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${String(c).padStart(4)}x ${k}`);
    }
  }
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});

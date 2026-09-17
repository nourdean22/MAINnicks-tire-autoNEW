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
import { assessTraceControl, assessSampleCoverage, countBy, traceIdentity } from "./lib/error-visibility.mjs";

const PUB = process.env.LANGFUSE_PUBLIC_KEY;
const SEC = process.env.LANGFUSE_SECRET_KEY;
const BASE = (process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com").replace(/\/+$/, "");
const DAYS = Number(process.env.DAYS ?? 7);
const TIMEOUT_MS = 20_000;

/**
 * ⚠ SCOPE THE QUERY TO ONE ENVIRONMENT.
 *
 * The exporter tags every span (`resolveLangfuseEnvironment`, langfuse.ts). A
 * project-wide query counts local, preview and staging spans as production:
 * non-production traffic can inflate error totals, and worse, it can make the
 * TRACE CONTROL look alive while production export is actually dead — the
 * control would then vouch for a number it never measured.
 *
 * Precedence mirrors the exporter. If it resolves to the wrong value the
 * control catches it honestly: the run reports "0 traces — check the exporter,
 * keys or environment", which is the correct answer rather than a false zero.
 */
const ENVIRONMENT = (
  process.env.LANGFUSE_QUERY_ENVIRONMENT ||
  process.env.LANGFUSE_TRACING_ENVIRONMENT ||
  process.env.RAILWAY_ENVIRONMENT_NAME ||
  process.env.NODE_ENV ||
  "default"
)
  .trim()
  .toLowerCase();
const ENV_Q = `&environment=${encodeURIComponent(ENVIRONMENT)}`;

if (!PUB || !SEC) {
  console.error(
    "LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY absent — refusing to guess a project.\n" +
      "(That absence is itself the finding: tracing cannot be exporting either.)",
  );
  process.exit(2);
}
console.log(
  `base: ${BASE}  ·  public key present (${PUB.length} chars) · secret present (${SEC.length} chars), neither shown
  environment filter: ${ENVIRONMENT}`,
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
  const traces = await api(`/traces?fromTimestamp=${encodeURIComponent(since)}&limit=100${ENV_Q}`);
  if (!traces.ok) {
    console.error(
      `\nABORT — /traces returned ${traces.status}. Cannot distinguish "no errors" from\n` +
        `        "no access". Body: ${traces.body}`,
    );
    process.exit(2);
  }
  const list = traces.json?.data ?? [];
  const meta = traces.json?.meta ?? {};
  const totalTraces = meta.totalItems ?? list.length;
  const traceControl = assessTraceControl({ totalTraces });
  console.log(`\ncontrol: ${totalTraces} trace(s) in the last ${DAYS}d · env=${ENVIRONMENT}`);
  if (!traceControl.trustZeroErrors) {
    console.log(
      "\nVERDICT: ZERO traces in the window. This says NOTHING about error rates —\n" +
        "         it says the exporter, the keys, or the project selection is the\n" +
        "         thing to check first. Do not read it as a clean bill of health.",
    );
    return;
  }

  // ── Trace identity, so a failing surface is identifiable ────────────
  //
  // ⚠ This section used to read `t.name ?? "(unnamed)"` and was WRONG in a way
  // that hid its own failure: production sends the name as `""`, not null, so
  // the nullish coalesce passed it through and printed a blank label beside a
  // count — which reads as a name too faint to see rather than as no name at
  // all. traceIdentity() makes emptiness explicit and reports what identity
  // SURVIVES instead. Measured: 0/50 named, but metadata.source on every row.
  const named = list.filter((t) => traceIdentity(t).named).length;
  console.log(`\n── trace identity (sample of ${list.length}) ──`);
  console.log(`  named: ${named}/${list.length}`);
  if (named === 0 && list.length > 0) {
    console.log(
      "  ⚠ NO trace carries a name. `functionId` names the OBSERVATION, not the\n" +
        "    trace — naming traces needs propagateAttributes({ traceName }) from\n" +
        "    @langfuse/tracing, which is not installed. Identity below is the\n" +
        "    fallback, and it is what the Langfuse UI cannot filter on.",
    );
  }
  for (const [n, c] of countBy(list, (t) => traceIdentity(t).label).slice(0, 12)) {
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
        `/observations?fromStartTime=${encodeURIComponent(since)}&level=${level}&limit=100&page=${page}${ENV_Q}`,
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
    // A partial page must not masquerade as the whole population.
    const cov = assessSampleCoverage({ total, sampled: rows.length });
    const covNote = cov.complete
      ? " · COMPLETE"
      : cov.representative
        ? " · partial but representative"
        : " · ⚠ THIN SAMPLE, do not generalise";
    console.log(
      `\n── ${level}: ${total} total · ${rows.length} sampled (${cov.pct.toFixed(0)}%)${covNote} ──`,
    );
    // WHICH SURFACE is failing decides whether this is contained or systemic.
    const bySurface = new Map();
    for (const o of rows) {
      const s = String(o.name ?? "(unnamed)").split(":")[0];
      bySurface.set(s, (bySurface.get(s) ?? 0) + 1);
    }
    for (const [s, c] of [...bySurface].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`  surface ${String(c).padStart(5)}x ${s}`);
    }
    // WHICH MODEL failed matters as much as which surface. The provider chain
    // is ordered (funded Ollama first, metered rescue as a tail), so the set of
    // models appearing here says how FAR down the chain a call got.
    //
    // ⚠⚠ DO NOT READ ABSENCE FROM THIS LIST. A provider missing here has TWO
    // opposite explanations — it was never reached, or it SUCCEEDED and so
    // produced no error. This file previously asserted the first, and the
    // conclusion drawn from it ("Ollama is never reached for brain calls") was
    // wrong and had to be retracted: querying ALL levels showed 106 successful
    // Ollama calls on the same surface. To decide which it is, drop the `level`
    // filter and group by model across every level, not just ERROR.
    const byModel = new Map();
    for (const o of rows) {
      const m = o.model ?? "(no model)";
      byModel.set(m, (byModel.get(m) ?? 0) + 1);
    }
    console.log(`  ── by model (how far down the provider chain calls got) ──`);
    for (const [m, c] of [...byModel].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  model   ${String(c).padStart(5)}x ${m}`);
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

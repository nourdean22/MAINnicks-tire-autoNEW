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
import { buildObservationsPath, collectPages, groupByTrace } from "./lib/langfuse-v2.mjs";
import { assessTraceControl, countBy, traceIdentity } from "./lib/error-visibility.mjs";

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
const until = new Date().toISOString();
const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

/** One v2 read, paged by meta.cursor. A non-2xx comes back as `failure`. */
const readV2 = (extra, maxPages) =>
  collectPages(
    (cursor) => api(buildObservationsPath({ since, until, environment: ENVIRONMENT, cursor, ...extra })),
    { maxPages },
  );

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
  // v2 has no trace list and no totalItems: read observations with the trace
  // groups the identity section needs, then group by traceId here.
  const tr = await readV2({ limit: 1000, fields: ["core", "basic", "trace_context", "metadata"] }, 6);
  if (tr.failure) {
    console.error(
      `\nABORT — /v2/observations returned ${tr.failure.status}. Cannot distinguish "no errors" from\n` +
        `        "no access". Body: ${tr.failure.body}`,
    );
    process.exit(2);
  }
  const list = groupByTrace(tr.rows);
  const totalTraces = list.length; // exact only when tr.complete
  const traceControl = assessTraceControl({ totalTraces });
  console.log(
    `\ncontrol: ${totalTraces} trace(s) in the last ${DAYS}d · env=${ENVIRONMENT}` +
      (tr.complete ? "" : ` · LOWER BOUND (read capped at ${tr.rows.length} observations, window not exhausted)`),
  );
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
  // ⚠⚠ SCOPE THE VERDICT TO WHAT WAS ACTUALLY READ. The page is capped at 100
  // while the window held 341-672, so `named === 0` proves nothing about the
  // traces we never fetched — in a mixed window (tracing changed between
  // deploys) named traces could sit entirely outside the page. Printing "NO
  // trace carries a name" from one page is a conclusion about PAGINATION, the
  // very rule this file's own header states and this section then broke.
  const nameCoverage = { complete: tr.complete };
  const named = list.filter((t) => traceIdentity(t).named).length;
  const scope = nameCoverage.complete
    ? `all ${totalTraces} in window`
    : `first ${list.length} traces seen; window not exhausted`;
  console.log(`\n── trace identity (${scope}) ──`);
  console.log(`  named: ${named}/${list.length}`);
  if (named === 0 && list.length > 0) {
    console.log(
      (nameCoverage.complete
        ? "  ⚠ NO trace in the window carries a name.\n"
        : "  ⚠ No trace IN THIS SAMPLE carries a name (the window was not exhausted;\n" +
          "    the rest were not fetched, so this is not a claim about them).\n") +
        "    `functionId` names the OBSERVATION, not the trace — naming traces\n" +
        "    needs propagateAttributes({ traceName }) from @langfuse/tracing,\n" +
        "    which is not installed. Identity below is the fallback, and it is\n" +
        "    what the Langfuse UI cannot filter on.",
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
    const read = await readV2({ limit: 100, level, fields: ["core", "basic", "model"] }, 6);
    if (read.failure) {
      console.log(`\n⚠ /v2/observations?level=${level} returned ${read.failure.status} — UNKNOWN, not zero.`);
      if (read.rows.length === 0) continue; // nothing read: print no counts at all
    }
    const rows = read.rows;
    // v2 reports no total: a cursor that ran out IS the total, a capped read is a lower bound.
    const covNote = read.complete ? " · COMPLETE" : " · ⚠ NOT EXHAUSTED (lower bound), do not generalise";
    console.log(
      `\n── ${level}: ${read.complete ? rows.length : `>= ${rows.length}`} total · ${rows.length} sampled${covNote} ──`,
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

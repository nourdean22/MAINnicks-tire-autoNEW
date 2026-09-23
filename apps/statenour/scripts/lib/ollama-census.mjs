/**
 * Which Ollama models can THIS ACCOUNT actually serve?
 *
 * ⚠ THE WHOLE POINT: a model appearing in the public ollama.com catalog is NOT
 * evidence that this key can serve it. That distinction has already cost real
 * outages — `lib/ai/model-liveness.ts` records two silent retirements
 * (qwen3-vl:235b, deepseek-v3.1:671b) and a SIX-WEEK vision outage where a
 * Railway env override pinned a retired id and every image turn 410'd.
 *
 * Extracted from the probe so the parts that can LIE — status classification,
 * listing parsing, and the positive control — are testable with an injected
 * fetch. The probe itself is then thin I/O. Review's point was that the
 * embedded incumbent check is a RUNTIME control, not a canary: it cannot catch
 * a parsing or classification regression before an operator acts on the census.
 */

/** A hung provider is exactly the failure this diagnostic investigates. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * ⚠ Without a bound, a provider that accepts the connection and never responds
 * makes the sequential loop hang forever — the probe never reaches its verdict
 * and a Railway invocation never exits. A timeout is reported as ERROR, which
 * is distinct from DEAD: "it did not answer" is not "it is retired".
 */
async function boundedFetch(fetchImpl, url, init, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetchImpl(url, { ...init, signal });
}

/**
 * Models this key can see. Tries both API shapes.
 * @returns {{path: string|null, names: string[]}} — `path: null` means NO
 *   endpoint answered, which is UNKNOWN, not "no models".
 */
export async function listModels({ base, key, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  for (const path of ["/api/tags", "/v1/models"]) {
    try {
      const res = await boundedFetch(
        fetchImpl,
        `${base}${path}`,
        { headers: { Authorization: `Bearer ${key}` } },
        timeoutMs,
      );
      if (!res.ok) continue;
      const j = await res.json();
      const names = (j.models ?? j.data ?? [])
        .map((m) => m.name ?? m.id ?? m.model)
        .filter(Boolean);
      if (names.length) return { path, names };
    } catch {
      /* try the next shape — a throw here is not evidence of absence */
    }
  }
  return { path: null, names: [] };
}

/**
 * One token, discarded. ALIVE / DEAD / ERROR are three different answers:
 *   ALIVE — served
 *   DEAD  — answered with a refusal status (402 plan, 404/410 retired, 401 auth)
 *   ERROR — never answered (timeout, network). NOT evidence of retirement.
 */
export async function probeLiveness({
  base,
  key,
  model,
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => Date.now(),
}) {
  const started = now();
  try {
    const res = await boundedFetch(
      fetchImpl,
      `${base}/api/chat`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "hi" }],
          stream: false,
          options: { num_predict: 1 },
        }),
      },
      timeoutMs,
    );
    const ms = now() - started;
    return { state: res.ok ? "ALIVE" : "DEAD", status: res.status, ms };
  } catch (e) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    return {
      state: "ERROR",
      status: timedOut ? "timeout" : String(e?.message ?? e).slice(0, 60),
      ms: now() - started,
    };
  }
}

/**
 * @returns {{ listing, rows, controlOk, newlyAlive }} — `controlOk` false means
 *   the probe is broken, not the catalog, and NOTHING below it may be acted on.
 */
export async function runCensus({
  base,
  key,
  incumbents,
  candidates,
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now,
}) {
  const listing = await listModels({ base, key, fetchImpl, timeoutMs });
  const rows = [];
  for (const model of [...incumbents, ...candidates]) {
    const r = await probeLiveness({ base, key, model, fetchImpl, timeoutMs, now });
    rows.push({
      model,
      incumbent: incumbents.includes(model),
      // ⚠ A model can answer 200 while ABSENT from the listing
      // (deepseek-v4-pro did). So "no" is not evidence of unavailability, and
      // when no endpoint answered at all this is "?" rather than "no".
      listed: listing.path ? (listing.names.includes(model) ? "yes" : "no") : "?",
      ...r,
    });
  }
  const controlOk = rows.some((r) => r.incumbent && r.state === "ALIVE");
  const newlyAlive = rows.filter((r) => !r.incumbent && r.state === "ALIVE").map((r) => r.model);
  return { listing, rows, controlOk, newlyAlive };
}

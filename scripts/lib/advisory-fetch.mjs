/**
 * Bounded JSON fetch retry for CI controls.
 *
 * Retries only transient transport failures:
 * - network/Fetch exceptions
 * - HTTP 429
 * - HTTP 5xx
 *
 * Permanent 4xx responses fail immediately. Exhausted transient failures still fail
 * closed; this helper only distinguishes "registry had a bad minute" from "security
 * scanner is healthy", it never converts an unknown audit into success.
 */
export async function fetchJsonWithRetry(
  url,
  options = {},
  {
    fetchImpl = globalThis.fetch,
    maxAttempts = 4,
    baseDelayMs = 750,
    maxDelayMs = 5000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    onRetry = () => {},
  } = {},
) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be >= 1");
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetchImpl(url, options);
      if (res.ok) return await res.json();

      const body = (await res.text()).slice(0, 300);
      const error = new Error(
        `endpoint responded ${res.status}: ${body}`,
      );
      error.status = res.status;

      const transient = res.status === 429 || res.status >= 500;
      if (!transient || attempt === maxAttempts) throw error;
      lastError = error;

      const retryAfter = parseRetryAfterMs(res.headers?.get?.("retry-after"));
      const delayMs = retryAfter ?? backoffMs(attempt, baseDelayMs, maxDelayMs, random);
      onRetry({ attempt, maxAttempts, delayMs, error });
      await sleep(delayMs);
      continue;
    } catch (error) {
      // HTTP failures created above carry a status. Permanent HTTP failures should
      // never be retried through this catch path.
      if (error?.status && error.status !== 429 && error.status < 500) throw error;
      if (attempt === maxAttempts) throw error;
      lastError = error;
      const delayMs = backoffMs(attempt, baseDelayMs, maxDelayMs, random);
      onRetry({ attempt, maxAttempts, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error("fetch retry exhausted without a result");
}

export function parseRetryAfterMs(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const value = String(raw).trim();
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - Date.now());
}

export function backoffMs(attempt, baseDelayMs, maxDelayMs, random = Math.random) {
  const base = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  // 0-20% jitter prevents parallel CI jobs from retrying the same upstream on the
  // same millisecond while keeping the budget bounded and tests injectable.
  const jitter = Math.round(base * 0.2 * Math.max(0, Math.min(1, Number(random()) || 0)));
  return Math.min(maxDelayMs, base + jitter);
}

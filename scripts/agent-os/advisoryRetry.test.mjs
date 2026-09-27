import test from "node:test";
import assert from "node:assert/strict";
import { backoffMs, fetchJsonWithRetry, parseRetryAfterMs } from "../lib/advisory-fetch.mjs";

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test("success returns immediately without sleeping", async () => {
  let calls = 0;
  const sleeps = [];
  const value = await fetchJsonWithRetry("https://example.invalid", {}, {
    fetchImpl: async () => {
      calls += 1;
      return response(200, { ok: true });
    },
    sleep: async (ms) => sleeps.push(ms),
    random: () => 0,
  });
  assert.deepEqual(value, { ok: true });
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("503 retries and eventually returns the real verdict", async () => {
  const statuses = [503, 503, 200];
  const sleeps = [];
  const retries = [];
  const value = await fetchJsonWithRetry("https://example.invalid", {}, {
    fetchImpl: async () => response(statuses.shift(), { clean: true }),
    sleep: async (ms) => sleeps.push(ms),
    random: () => 0,
    baseDelayMs: 10,
    maxDelayMs: 100,
    onRetry: (row) => retries.push(row),
  });
  assert.deepEqual(value, { clean: true });
  assert.deepEqual(sleeps, [10, 20]);
  assert.equal(retries.length, 2);
});

test("429 honors Retry-After", async () => {
  let calls = 0;
  const sleeps = [];
  await fetchJsonWithRetry("https://example.invalid", {}, {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? response(429, {}, { "retry-after": "2" })
        : response(200, { ok: true });
    },
    sleep: async (ms) => sleeps.push(ms),
    random: () => 0,
  });
  assert.deepEqual(sleeps, [2000]);
});

test("permanent 4xx fails immediately and is never retried", async () => {
  let calls = 0;
  await assert.rejects(
    fetchJsonWithRetry("https://example.invalid", {}, {
      fetchImpl: async () => {
        calls += 1;
        return response(401, { error: "unauthorized" });
      },
      sleep: async () => assert.fail("must not sleep for permanent 4xx"),
      random: () => 0,
    }),
    /responded 401/,
  );
  assert.equal(calls, 1);
});

test("network errors retry but exhausted uncertainty still fails closed", async () => {
  let calls = 0;
  const sleeps = [];
  await assert.rejects(
    fetchJsonWithRetry("https://example.invalid", {}, {
      fetchImpl: async () => {
        calls += 1;
        throw new Error("socket reset");
      },
      maxAttempts: 3,
      baseDelayMs: 5,
      maxDelayMs: 50,
      sleep: async (ms) => sleeps.push(ms),
      random: () => 0,
    }),
    /socket reset/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [5, 10]);
});

test("backoff remains bounded and Retry-After parser rejects junk", () => {
  assert.equal(backoffMs(1, 100, 1000, () => 0), 100);
  assert.equal(backoffMs(5, 100, 1000, () => 1), 1000);
  assert.equal(parseRetryAfterMs("1.5"), 1500);
  assert.equal(parseRetryAfterMs("not-a-date"), null);
});

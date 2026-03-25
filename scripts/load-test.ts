/**
 * Load Test Script — Quick endpoint performance check
 * Usage: npx tsx scripts/load-test.ts
 */

const BASE_URL = process.env.TEST_URL || "http://localhost:3000";
const CONCURRENT = 10;
const TOTAL_REQUESTS = 50;

const ENDPOINTS = [
  { method: "GET" as const, path: "/api/health" },
  { method: "GET" as const, path: "/api/ping" },
  { method: "GET" as const, path: "/api/ready" },
];

async function testEndpoint(endpoint: { method: string; path: string }) {
  const times: number[] = [];
  let errors = 0;

  for (let batch = 0; batch < TOTAL_REQUESTS / CONCURRENT; batch++) {
    const promises = Array.from({ length: CONCURRENT }, async () => {
      const start = Date.now();
      try {
        const res = await fetch(`${BASE_URL}${endpoint.path}`, { method: endpoint.method });
        if (!res.ok) errors++;
        times.push(Date.now() - start);
      } catch {
        errors++;
      }
    });
    await Promise.all(promises);
  }

  times.sort((a, b) => a - b);
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / (times.length || 1));
  const p50 = times[Math.floor(times.length * 0.5)] || 0;
  const p95 = times[Math.floor(times.length * 0.95)] || 0;
  const p99 = times[Math.floor(times.length * 0.99)] || 0;

  console.log(`${endpoint.method} ${endpoint.path}:`);
  console.log(`  Avg: ${avg}ms | P50: ${p50}ms | P95: ${p95}ms | P99: ${p99}ms`);
  console.log(`  Errors: ${errors}/${TOTAL_REQUESTS}`);
  console.log();
}

async function main() {
  console.log(`\nLoad testing ${BASE_URL} — ${TOTAL_REQUESTS} requests, ${CONCURRENT} concurrent\n`);
  for (const ep of ENDPOINTS) {
    await testEndpoint(ep);
  }
}

main().catch(console.error);

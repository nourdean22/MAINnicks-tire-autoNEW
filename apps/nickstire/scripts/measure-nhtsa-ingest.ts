/**
 * ADR-0021 §9 2a.5 · measure the NHTSA warranty ingest's parse on a real chunk, with NO database.
 *
 * Runs the production code path (whole-zip download, central-directory read, InflateRaw,
 * line split, classifier, CRC check) against static.nhtsa.gov and prints wall time, peak RSS,
 * and the event-loop delay while it ran. It opens no database connection and writes nothing,
 * so prod-db-guard does not apply.
 *
 * The flag `nhtsa_warranty_ingest` stays OFF until the max event-loop delay is under 250 ms
 * on the hardware that will run it (Railway), because the job shares the web process with the
 * Vapi and SMS webhooks.
 *
 *   pnpm exec tsx scripts/measure-nhtsa-ingest.ts            # the current chunk
 *   pnpm exec tsx scripts/measure-nhtsa-ingest.ts 2015-2019  # a named chunk (the largest: 876 MB inflated)
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import { downloadChunk, entryOf, resolveOpenChunk, parseZipStream } from "../server/services/nhtsaWarrantyIngest";

async function main(): Promise<void> {
  const range = process.argv[2] ?? (await resolveOpenChunk((u, i) => fetch(u, i), new Date()));
  const fetchImpl = (u: string, i?: RequestInit) => fetch(u, i);
  let peakRss = 0;
  const rssTimer = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 50);
  const h = monitorEventLoopDelay({ resolution: 10 });
  const rssBefore = process.memoryUsage().rss;
  h.enable();
  const t0 = performance.now();

  const zip = await downloadChunk(fetchImpl, range);
  const downloadMs = performance.now() - t0;
  const entry = entryOf(zip);
  async function* slices() {
    for (let i = 0; i < zip.length; i += 256 * 1024) yield zip.subarray(i, Math.min(i + 256 * 1024, zip.length));
  }
  const parsed = await parseZipStream(slices(), entry);

  const wallMs = performance.now() - t0;
  h.disable();
  clearInterval(rssTimer);
  const bySignal = { nhtsa_type: 0, summary_text: 0, both: 0 };
  for (const c of parsed.comms.values()) bySignal[c.signal]++;

  const ms = (ns: number) => Math.round(ns / 1e5) / 10;
  console.info(
    JSON.stringify(
      {
        chunk: range,
        zipBytes: zip.length,
        downloadSeconds: Math.round(downloadMs / 100) / 10,
        inflatedBytes: entry.uncompressedSize,
        wallSeconds: Math.round(wallMs / 100) / 10,
        rssBeforeMB: Math.round(rssBefore / 1048576),
        peakRssMB: Math.round(peakRss / 1048576),
        eventLoopDelayMs: { p50: ms(h.percentile(50)), p99: ms(h.percentile(99)), max: ms(h.max) },
        rowsRead: parsed.rowsRead,
        rowsMalformed: parsed.rowsMalformed,
        commsKept: parsed.comms.size,
        bySignal,
        products: parsed.products.size,
        node: process.version,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

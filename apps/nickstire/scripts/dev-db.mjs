/**
 * Start a local dev MySQL with the full nickstire schema and keep it running.
 *
 *   node scripts/dev-db.mjs
 *
 * Prints a DATABASE_URL. Point a dev server or a one-off script at it:
 *
 *   DATABASE_URL=<printed> REEL_GENERATION_ENABLED=true pnpm exec tsx some-script.ts
 *
 * The database lives only as long as this process — Ctrl-C tears it down. It is
 * never the prod TiDB in .env, so anything you run against it is safe to break.
 */
import { startDevDb } from "./lib/dev-db.mjs";

const { url, stop } = await startDevDb();

console.log("\n" + "=".repeat(64));
console.log("  DATABASE_URL=" + url);
console.log("  (fresh, empty schema — Ctrl-C to tear down)");
console.log("=".repeat(64) + "\n");

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log("\n[dev-db] stopping...");
  await stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Hold the process open.
await new Promise(() => {});

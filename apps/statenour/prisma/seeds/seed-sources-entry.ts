/**
 * SAFE entrypoint for the intelligence-source registry — `pnpm db:seed:sources`.
 *
 * seedSources() is idempotent and purely additive: it upserts by `url`, and on
 * an existing row it deliberately preserves the LEARNED authScore that the
 * closed-loop experiment resolver mutates over time. It deletes nothing.
 *
 * It existed only inside prisma/seed.ts's main(), four lines above a run of
 * deleteMany() calls on tasks, task events, personal daily logs and missions —
 * so the only way to register a new source was to run a script that wipes real
 * operator data. That coupling is why activating the weather source (PR #1969)
 * had to be done with a hand-written throwaway script instead of the seed.
 *
 * This entrypoint is intentionally NOT behind the destructive-seed guard: there
 * is nothing here to guard. It is safe to run against production, and that is
 * the point. It prints the target host so the operator can see where it landed.
 */
import { prisma } from "../../lib/prisma";
import { hostFromDatabaseUrl } from "../seed-guard";
import { seedSources } from "./seed-sources";

async function main() {
  const host = hostFromDatabaseUrl(process.env.DATABASE_URL);
  if (!host) {
    console.error("[seed:sources] DATABASE_URL is unset or unparseable — refusing to run blind.");
    process.exit(1);
  }
  console.log(`[seed:sources] additive upsert against "${host}" — no rows are deleted.`);
  await seedSources(prisma);
  const total = await prisma.registeredSource.count();
  console.log(`[seed:sources] done · ${total} registered sources present.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("[seed:sources] failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });

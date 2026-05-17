// One-shot manual trigger of audit-retention TTL purge.
// Same body the cron route runs — just bypasses the auth guard since
// we're invoking server code directly from a tsx process.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { runAuditRetention } from "@/lib/db/audit-retention";

(async () => {
  console.log("Starting audit-retention purge…");
  const r = await runAuditRetention();
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

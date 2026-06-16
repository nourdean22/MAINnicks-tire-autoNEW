import { prisma } from "../lib/prisma";
import {
  listConfiguredAccounts,
  integrationNameFor,
} from "../lib/services/google-oauth";

async function main() {
  console.log("==================================================");
  console.log("Statenour Google OAuth Diagnostics");
  console.log("==================================================\n");

  try {
    const accounts = await listConfiguredAccounts();

    if (accounts.length === 0) {
      console.log("No Google OAuth integrations found in the database.");
      console.log("To configure a new account, visit one of the start URLs below.");
    } else {
      console.log(`Found ${accounts.length} configured account(s):\n`);

      for (const acct of accounts) {
        const row = await prisma.integration.findUnique({
          where: { name: acct.integrationName },
        });

        if (!row) {
          console.log(`- Account key: "${acct.accountKey}"`);
          console.log("  WARNING: Integration metadata row missing in database.");
          continue;
        }

        const config = row.config as any;
        const grantedAt = config?.grantedAt ? new Date(config.grantedAt).toLocaleString() : "Unknown";
        const lastRefreshAt = config?.lastRefreshAt ? new Date(config.lastRefreshAt).toLocaleString() : "Never";
        const lastSync = row.lastSyncAt ? new Date(row.lastSyncAt).toLocaleString() : "Never";

        console.log(`* Account key: "${acct.accountKey}"`);
        console.log(`  Email:       ${acct.email || "Unknown"}`);
        console.log(`  Name in DB:  ${row.name}`);
        console.log(`  Status:      ${row.status?.toUpperCase() || "UNKNOWN"}`);
        console.log(`  Enabled:     ${row.enabled ? "YES" : "NO"}`);
        console.log(`  Failures:    ${row.consecutiveFailures ?? 0} consecutive (Total: ${row.errorCount ?? 0})`);
        console.log(`  Granted At:  ${grantedAt}`);
        console.log(`  Refreshed:   ${lastRefreshAt}`);
        console.log(`  Last Sync:   ${lastSync}`);
        console.log("  Re-auth URLs:");
        console.log(`    Local:      http://localhost:3000/api/oauth/google-data/start?account=${acct.accountKey}`);
        console.log(`    Production: https://bdnick.info/api/oauth/google-data/start?account=${acct.accountKey}`);
        console.log("");
      }
    }

    console.log("--------------------------------------------------");
    console.log("To add/re-authenticate accounts:");
    console.log("- Primary account (moeseuclid@gmail.com):");
    console.log("  Local:      http://localhost:3000/api/oauth/google-data/start?account=primary");
    console.log("  Production: https://bdnick.info/api/oauth/google-data/start?account=primary");
    console.log("- Personal account (nourdean22@gmail.com):");
    console.log("  Local:      http://localhost:3000/api/oauth/google-data/start?account=personal");
    console.log("  Production: https://bdnick.info/api/oauth/google-data/start?account=personal");
    console.log("==================================================");
  } catch (err) {
    console.error("Diagnostics execution failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Unhandled error in main:", err);
  process.exit(1);
});

/**
 * Read-only Higgsfield provider history — the reconciliation step the
 * pipeline's own LOCAL_TIMEOUT_REMOTE_UNKNOWN verdict tells you to perform
 * ("the remote job may still be running and billing — reconcile provider
 * history before paying again") and which nothing in this repo could do.
 *
 * Answers one question for the reels whose beats timed out locally: did the
 * remote generation actually finish? A local timeout only means WE stopped
 * polling. Higgsfield bills at SUBMIT (verified against `account
 * transactions`: every spend lands 4-5s after a submit, not on completion),
 * so the credits are gone either way — but a completed job means the footage
 * exists and can be recovered instead of re-paying to make it again.
 *
 * Uses runHiggsfieldCliReadOnly so the token rotation is persisted correctly.
 * Do NOT hand-roll the CLI spawn here; see that function's comment for what
 * that costs.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

import { runHiggsfieldCliReadOnly } from "../../server/services/higgsfieldStudio";

interface GenJob {
  id?: string;
  status?: string;
  display_name?: string;
  created_at?: number | string;
  result_url?: string;
}

function when(raw: number | string | undefined): string {
  if (raw === undefined) return "(no timestamp)";
  const ms = typeof raw === "number" ? raw * 1000 : Date.parse(String(raw));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : String(raw);
}

async function main() {
  const size = process.argv.find((a) => a.startsWith("--size="))?.split("=")[1] ?? "60";
  console.log(`Fetching the last ${size} Higgsfield generation jobs (read-only)...\n`);

  const res = await runHiggsfieldCliReadOnly(["generate", "list", "--size", size, "--json"], 45_000);
  if (!res.ok) {
    console.error(`FAILED (exit ${res.code}): ${(res.stderr || res.stdout).trim().slice(0, 400)}`);
    console.error("\nIf this says 'Session expired', the credential needs a device re-login —");
    console.error("see apps/nickstire/docs/runbooks/higgsfield-session.md step 1.");
    process.exit(1);
  }

  let jobs: GenJob[];
  try {
    const parsed = JSON.parse(res.stdout);
    jobs = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { data?: GenJob[] })?.data) ? (parsed as { data: GenJob[] }).data : [];
  } catch {
    console.error("Could not parse the CLI's JSON. Raw head:\n", res.stdout.slice(0, 600));
    process.exit(1);
  }

  console.log(`${jobs.length} job(s) returned.\n`);
  const byStatus: Record<string, number> = {};
  for (const j of jobs) byStatus[j.status ?? "(none)"] = (byStatus[j.status ?? "(none)"] ?? 0) + 1;
  console.log("status tally:", JSON.stringify(byStatus), "\n");

  // The window the three timed-out reels submitted in (2026-08-20 20:29-20:53 UTC).
  const WINDOW_START = Date.parse("2026-08-20T20:25:00Z");
  const WINDOW_END = Date.parse("2026-08-20T21:00:00Z");

  const inWindow = jobs.filter((j) => {
    const raw = j.created_at;
    const ms = typeof raw === "number" ? raw * 1000 : Date.parse(String(raw ?? ""));
    return Number.isFinite(ms) && ms >= WINDOW_START && ms <= WINDOW_END;
  });

  console.log(`--- jobs created in the timed-out window (${new Date(WINDOW_START).toISOString()} .. ${new Date(WINDOW_END).toISOString()}) ---`);
  if (inWindow.length === 0) {
    console.log("  none returned in that window — the CLI's list may not reach back that far.");
    console.log("  Falling back to the full listing below.\n");
  }
  for (const j of inWindow) {
    console.log(`  ${when(j.created_at)}  status=${j.status}  url=${j.result_url ? "PRESENT" : "(empty)"}  id=${j.id}`);
  }

  console.log("\n--- full listing (newest first) ---");
  for (const j of jobs) {
    console.log(`  ${when(j.created_at)}  status=${j.status}  url=${j.result_url ? "PRESENT" : "(empty)"}  ${j.display_name ?? ""}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("provider-history failed:", err);
  process.exit(1);
});

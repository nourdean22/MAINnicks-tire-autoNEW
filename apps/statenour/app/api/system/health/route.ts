import { apiHandler } from "@/lib/utils/http";
import { getSystemHealthSnapshot } from "@/lib/services/runner-state";

// v9.1.23 · CRITICAL fix from Round-2 audit. Previously marked
// `// public:` on the assumption it returned only coarse health
// flags. Audit revealed getSystemHealthSnapshot() actually returns:
//   - filesystem paths (e.g. C:\NOUR_OS\...)
//   - recovery item details (summary, priority_score, entity_key)
//   - ALE session status, runner node detail, nightly-build mode
//   - SQLite table counts, watch event payloads, queue counts
//   - full integrations + services detail blocks
// That's an internal system map readable by any unauthenticated
// HTTP client — not "coarse health." Now session-gated.
//
// External uptime monitors should use /api/system/heartbeat instead,
// which returns ONLY `{ status, db_latency_ms }` and stays public.
//
// v10.0.529.106 · Wave 79 · migrated to apiHandler. The only client
// consumer (today-pulse-strip via useUltronFetch) already unwraps
// the {data:...} envelope, so the wrapper change is transparent.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler(
  async () => getSystemHealthSnapshot(),
  { auth: "owner" },
);

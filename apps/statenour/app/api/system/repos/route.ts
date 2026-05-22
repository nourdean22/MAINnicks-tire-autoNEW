/**
 * GET /api/system/repos · v10 Track E.2 · Apr 30.
 *
 * Reads the `config/repos.ts` manifest and (when GITHUB_TOKEN is
 * configured) augments each monitored repo with live state from
 * GitHub: last commit SHA + age, last push timestamp, default branch
 * status. Returns a single payload the /system/repos dashboard can
 * render directly.
 *
 * Without GITHUB_TOKEN, falls back to manifest-only data — every
 * repo still renders, just without "last commit Xh ago" detail.
 *
 * Owner-gated per v9.1.14 sensitive-GET requirement.
 *
 * Phase B.7b (2026-05-22 · legacy-modernizer REST→tRPC system-pages
 * slice) · the manifest-merge + GitHub-augment logic (and its 60s
 * cache) moved to the shared `lib/services/system-pages-b.buildReposOverview`
 * service · this route AND the new `trpc.system.reposOverview`
 * procedure call the same function · drift impossible. The route stays
 * mounted as the rollback path.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildReposOverview } from "@/lib/services/system-pages-b";

export const GET = apiHandler(
  async () => {
    return buildReposOverview();
  },
  { auth: "owner" }, // v9.1.14 sensitive-GET gate
);

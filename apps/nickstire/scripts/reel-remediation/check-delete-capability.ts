/**
 * Can this account actually DELETE a published Instagram reel? Read-only.
 *
 * Phase 5 of the Higgsfield stock-fallback remediation deletes stock-substituted
 * reels from Instagram and reposts real ones. That phase was previously believed
 * IMPOSSIBLE — sessions (including mine, 2026-08-21) concluded "the Instagram
 * Graph API has no delete endpoint" from the fact that nothing in this repo
 * calls one.
 *
 * That was wrong, and it is the same mistake AGENTS.md already records for the
 * Higgsfield REST API: "Not in the repo is a fact about the repo, not the
 * world." Meta documents it plainly:
 *
 *   DELETE /<IG_MEDIA_ID>
 *   permissions: instagram_basic + instagram_manage_contents
 *   "Non-ad posts, Stories, Reels and entire carousel albums are supported."
 *   Instagram API with Facebook login ONLY (no Instagram Login variant).
 *   https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/
 *
 * So the real question is not "does the endpoint exist" but "does OUR token
 * carry instagram_manage_contents". A token's scopes are not knowable from the
 * token, so this asks Graph directly rather than assuming either way.
 *
 * This script NEVER deletes anything. It reports capability only.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

import { getGrantedPermissions } from "../../server/services/metaSocial";

/** Exactly what Meta's IG Media reference lists for the DELETE operation. */
const REQUIRED_FOR_DELETE = ["instagram_basic", "instagram_manage_contents"];

async function main() {
  const perms = await getGrantedPermissions();
  if (!perms.ok) {
    console.error(`Could not read token permissions: ${perms.error}`);
    process.exit(1);
  }

  console.log(`\ngranted (${perms.granted.length}):`);
  for (const p of perms.granted) console.log(`   ${p}`);
  if (perms.declined.length) {
    console.log(`\ndeclined/expired (${perms.declined.length}):`);
    for (const p of perms.declined) console.log(`   ${p}`);
  }

  const missing = REQUIRED_FOR_DELETE.filter((p) => !perms.granted.includes(p));
  console.log(`\n--- DELETE /<IG_MEDIA_ID> capability ---`);
  for (const p of REQUIRED_FOR_DELETE) {
    console.log(`  ${perms.granted.includes(p) ? "GRANTED " : "MISSING "} ${p}`);
  }

  if (missing.length === 0) {
    console.log(`\nPhase 5 takedown is TECHNICALLY POSSIBLE with the current token.`);
    console.log(`Deletion is irreversible and customer-facing — it stays operator-gated regardless.`);
    process.exit(0);
  }

  console.log(`\nPhase 5 takedown is BLOCKED: missing ${missing.join(", ")}.`);
  console.log(`Fix is a re-auth requesting those scopes (an operator action in Meta's`);
  console.log(`app settings / App Review), NOT a code change — the endpoint itself exists.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("check-delete-capability failed:", err);
  process.exit(1);
});

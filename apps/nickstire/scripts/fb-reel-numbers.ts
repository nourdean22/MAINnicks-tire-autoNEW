/**
 * READ-ONLY: print the Facebook numbers (plays, average watch time, reactions, comments) of reels you give by
 * VIDEO id, through the same function the nightly lane uses (`fetchFacebookReelInsights`). It writes nothing
 * and posts nothing; the only database access is the app's own read of the persisted Page token. For reels
 * posted by hand, which the nightly lane does not know about (it reads the publish ledger).
 *
 * A number Facebook did not return prints "unknown", never 0; a failed read prints UNKNOWN with Meta's
 * message and exits 1.
 *
 *   railway run -s MAINnicks-tire-auto -- node apps/nickstire/node_modules/tsx/dist/cli.mjs --tsconfig apps/nickstire/tsconfig.json apps/nickstire/scripts/fb-reel-numbers.ts --video <video id>,<video id>
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const ids = (arg("video") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (ids.length === 0) {
  console.error("usage: fb-reel-numbers.ts --video <video id>[,<video id>...]");
  process.exit(1);
}

const { fetchFacebookReelInsights } = await import("../server/services/metaSocial");
const show = (value: number | undefined, unit = "") => (value === undefined ? "unknown" : `${value}${unit}`);
let failed = 0;
for (const id of ids) {
  const r = await fetchFacebookReelInsights(id);
  if (!r.ok) {
    failed++;
    console.log(`${id}: UNKNOWN (${r.error})`);
    continue;
  }
  console.log(`${id}: plays ${show(r.plays)}, avg watch ${show(r.avgWatchMs, " ms")}, reactions ${show(r.reactions)}, comments ${show(r.comments)}`);
}
// The app's database pool keeps the process alive after the token read: exit explicitly.
process.exit(failed ? 1 : 0);

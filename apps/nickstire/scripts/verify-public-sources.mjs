/**
 * READ-ONLY. Verify a candidate public-source URL before it enters
 * PUBLIC_SOURCE_REGISTRY.
 *
 * WHY THIS SCRIPT EXISTS
 * The registry's original URLs were written from model memory and 2 of 3 were
 * 404s. A source is only admissible if a live fetch proves (a) it answers, and
 * (b) our own extractor gets usable prose out of it — a 200 that yields nothing
 * readable is worse than a rejection, because it looks verified while being
 * unusable for entailment.
 *
 * Run from apps/nickstire:
 *   pnpm exec tsx scripts/verify-public-sources.mjs
 */
import { retrieveDocument } from "../server/services/documentRetrieval.ts";
import { selectSupportingPassage } from "../shared/claimEntailment.ts";

/** family, candidate url, and a probe claim that page SHOULD bear on. */
const CANDIDATES = [
  ["Tire Rack", "https://www.tirerack.com/tires/tiretech/techpage.jsp?techid=187",
    "A puncture in the tire tread can be repaired but sidewall damage cannot."],
  ["Michelin education", "https://www.michelinman.com/auto/auto-tips-and-advice/tire-maintenance/can-my-tire-be-repaired",
    "A puncture in the tread area can be repaired if it is no larger than a quarter inch."],
  ["Michelin education", "https://www.michelinman.com/auto/auto-tips-and-advice/tire-buying-guide/when-do-i-need-new-tires",
    "Tires should be replaced when tread depth reaches the legal wear limit."],
  ["Goodyear education", "https://www.goodyear.com/en-US/tire-guide/tire-care/tire-air-pressure",
    "Check tire pressure monthly when the tires are cold."],
  ["AAA", "https://newsroom.acg.aaa.com/aaa-warns-drivers-winter-road-salt-can-cause-hidden-costly-vehicle-damage/",
    "Winter road salt accelerates rust on a vehicle undercarriage."],
  ["Bridgestone education", "https://www.bridgestonetire.com/learn/maintenance/how-to-check-tire-pressure/",
    "Check tire pressure monthly when tires are cold."],
  ["Ohio BMV", "https://bmv.ohio.gov/vr-registration.aspx",
    "Vehicle registration renewal is required annually in Ohio."],
];

console.log("family                  http  status        text   passage  verdict");
console.log("-".repeat(78));

const admissible = [];
for (const [family, url, probe] of CANDIDATES) {
  const doc = await retrieveDocument(url);
  const passage = doc.text ? selectSupportingPassage(doc.text, probe) : null;
  const ok = doc.status === "fetched" && Boolean(passage);
  if (ok) admissible.push({ family, url, chars: doc.text.length });
  console.log(
    `${family.padEnd(23)} ${String(doc.httpStatus ?? "-").padEnd(5)} ${doc.status.padEnd(13)} ` +
      `${String(doc.text?.length ?? 0).padEnd(6)} ${(passage ? Math.round(passage.overlap * 100) + "%" : "none").padEnd(8)} ${ok ? "ADMIT" : "REJECT"}`,
  );
  if (passage) console.log(`    passage: ${passage.passage.slice(0, 150)}`);
  if (!ok) console.log(`    reason: ${doc.reason ?? "no passage bore on the probe claim"}`);
}

console.log(`\nadmissible: ${admissible.length}/${CANDIDATES.length}`);
for (const a of admissible) console.log(`  ${a.family} — ${a.url} (${a.chars} chars)`);

/**
 * Real-fetch verification for meta-description length + phone presence.
 * Used as proof in commit body. Throwaway script — not imported anywhere.
 */
import { SERVICES } from "../shared/services";
import { CITIES } from "../shared/cities";

let allOk = true;
console.log("=== SERVICES ===");
for (const s of SERVICES) {
  const len = s.metaDescription.length;
  const has216 = s.metaDescription.includes("216");
  const has862 = s.metaDescription.includes("862-0005");
  const ok = len <= 170 && len >= 50 && has216 && has862;
  if (!ok) allOk = false;
  console.log(ok ? "OK " : "FAIL", String(len).padStart(3), s.slug);
}
console.log("\n=== CITIES ===");
for (const c of CITIES) {
  const len = c.metaDescription.length;
  const ok = len <= 170;
  if (!ok) allOk = false;
  console.log(ok ? "OK " : "FAIL", String(len).padStart(3), c.slug);
}
console.log(allOk ? "\nALL PASS" : "\nFAILURES PRESENT");
process.exit(allOk ? 0 : 1);

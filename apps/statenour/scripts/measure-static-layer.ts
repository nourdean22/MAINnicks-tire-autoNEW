#!/usr/bin/env tsx
/**
 * measure-static-layer.ts — Layer 1 size, measured WITHOUT the database.
 *
 * `measure-prompt-size.ts` builds the FULL prompt and therefore requires a
 * live Neon connection; its safety wrapper (correctly) treats that as a
 * production lane and refuses without CONFIRM_PROD=1. That makes it the
 * wrong instrument for a question about the STATIC half.
 *
 * Layer 1 (identity + profile + rules + style + processing + operator
 * policy + tools + builder mode) is pure string assembly with no I/O, so
 * its exact size is knowable offline at zero risk. That is also the only
 * surface a prompt trim would touch — Layer 2 is live data we would never
 * cut.
 *
 *   pnpm tsx scripts/measure-static-layer.ts
 */
import { buildStaticPrefix } from "@/lib/ai/prompt/static";
import { getOperatorPolicyBlock } from "@/lib/ai/prompt/policy/operator-rules";
import { SPAR_MODE } from "@/lib/ai/prompt/policy/spar-mode";

const prefix = buildStaticPrefix();
const policy = getOperatorPolicyBlock();

// ~4 chars/token is the house estimate used by measure-prompt-size.ts.
const tok = (s: string) => Math.round(s.length / 4);

const sections = prefix.split(/\n(?=## |# )/);

console.log("LAYER 1 (static prefix, no DB)");
console.log(`  total          ${prefix.length} chars  ~${tok(prefix)} tokens`);
console.log(`  operator policy ${policy.length} chars  ~${tok(policy)} tokens  (${Math.round((policy.length / prefix.length) * 100)}% of Layer 1)`);
console.log(`  SPAR (conditional, not always injected) ${SPAR_MODE.length} chars  ~${tok(SPAR_MODE)} tokens`);
console.log("\nSECTIONS (largest first)");
for (const s of [...sections].sort((a, b) => b.length - a.length)) {
  const title = s.split("\n")[0].slice(0, 58);
  console.log(`  ${String(s.length).padStart(6)} chars  ~${String(tok(s)).padStart(5)} tok  ${title}`);
}

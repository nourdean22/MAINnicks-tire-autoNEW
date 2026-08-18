/**
 * lib/ai/tools/catalog-claims.ts · GATE-2026-08-14 item #6 (2026-08-18).
 *
 * "Tool metadata is an untrusted claim" — Scan B's finding, the last
 * unbuilt gate item. The catalog's labels are not decoration: strict
 * mode gates approval on `sideEffecting`, mode pruning trusts `battle`,
 * and the reasoning engine's whole safety story is a whitelist that
 * CLAIMS read-only. Membership drift is already pinned
 * (tests/ai/catalog-integrity.test.ts, both directions); what nothing
 * verified until now is the SEMANTIC claims — the flags themselves.
 *
 * This module turns each trusted claim into a checked invariant:
 *
 *   W1 · every reasoning-whitelist entry exists in the catalog — a
 *        typo'd or stale entry silently vanishes at runtime (the
 *        getReasoningTools skip is deliberately defensive), which is
 *        the built-tested-unwired failure class: the engine loses a
 *        grounding tool and nobody notices.
 *   W2 · no reasoning-whitelist entry is `sideEffecting` — the engine
 *        OBSERVES, never ACTS. A mutating tool here means the
 *        multi-step engine fires side effects nobody approved.
 *   B1 · no entry claims `battle` AND `sideEffecting` — battle mode's
 *        contract is fast READ-ONLY; both flags at once is the catalog
 *        contradicting itself.
 *   C1 · `business_write` tools must carry `sideEffecting: true` —
 *        strict-mode approval keys off the flag, so an external-write
 *        tool without it BYPASSES approval. Scope matches the field's
 *        DOCUMENTED semantic exactly ("mutate external state (business
 *        writes, SMS, payment)"): personal_write mutates Nick's own DB
 *        (internal, operator-visible) and comms contains pure reads
 *        (arsenalGmailInbox) — the first live probe proved a broader
 *        rule mislabels 25 tools, and an invariant that cries wolf
 *        gets excepted into blindness.
 *   C2 · read-shaped categories (*_read) must NOT carry
 *        `sideEffecting` — the mirror contradiction.
 *   E1 · `requiredEnv` lists contain no blank names — a "" entry can
 *        never be satisfied or checked.
 *
 * Pure: no I/O, no env, no imports beyond types. The live assertion
 * (zero violations against the real catalog + real whitelist) runs in
 * tests/ai/catalog-claims.test.ts on every `pnpm test`, which
 * verify:hard already runs — drift now fails the gate instead of
 * shipping.
 */

import type { ToolMeta } from "@/lib/ai/tools/catalog";

export interface CatalogClaimViolation {
  rule: "W1" | "W2" | "B1" | "C1" | "C2" | "E1";
  tool: string;
  detail: string;
}

// C1 scope — see the header: only the category whose docstring promises
// external mutation for every member.
const WRITE_CATEGORIES = new Set(["business_write"]);

export interface VerifyCatalogClaimsInput {
  catalog: readonly ToolMeta[];
  reasoningWhitelist: readonly string[];
  /**
   * Explicit, REVIEWED exceptions keyed by `rule:tool`. An exception is
   * a documented decision, not an escape hatch — every entry must carry
   * the reason a human accepted the deviation. Unused exceptions are
   * themselves violations (they rot into blind spots otherwise).
   */
  exceptions?: Readonly<Record<string, string>>;
}

export interface CatalogClaimsResult {
  violations: CatalogClaimViolation[];
  /** Exceptions that matched nothing — stale, must be removed. */
  unusedExceptions: string[];
  checkedTools: number;
  checkedWhitelist: number;
}

export function verifyCatalogClaims(input: VerifyCatalogClaimsInput): CatalogClaimsResult {
  const { catalog, reasoningWhitelist } = input;
  const exceptions = input.exceptions ?? {};
  const byName = new Map(catalog.map((m) => [m.name, m]));
  const raw: CatalogClaimViolation[] = [];

  for (const name of reasoningWhitelist) {
    const meta = byName.get(name);
    if (!meta) {
      raw.push({
        rule: "W1",
        tool: name,
        detail: "reasoning-whitelist entry has no catalog entry — it silently vanishes at runtime",
      });
      continue;
    }
    if (meta.sideEffecting) {
      raw.push({
        rule: "W2",
        tool: name,
        detail: "sideEffecting tool inside the read-only reasoning whitelist — the engine would ACT",
      });
    }
  }

  for (const meta of catalog) {
    if (meta.battle && meta.sideEffecting) {
      raw.push({
        rule: "B1",
        tool: meta.name,
        detail: "battle (fast read-only) and sideEffecting claimed together — the catalog contradicts itself",
      });
    }
    if (WRITE_CATEGORIES.has(meta.category) && !meta.sideEffecting) {
      raw.push({
        rule: "C1",
        tool: meta.name,
        detail: `category '${meta.category}' implies mutation but sideEffecting is not set — strict-mode approval is BYPASSED`,
      });
    }
    if (meta.category.endsWith("_read") && meta.sideEffecting) {
      raw.push({
        rule: "C2",
        tool: meta.name,
        detail: `category '${meta.category}' claims read but sideEffecting is set — one of them is lying`,
      });
    }
    for (const env of meta.requiredEnv ?? []) {
      if (!env || env.trim() === "") {
        raw.push({
          rule: "E1",
          tool: meta.name,
          detail: "blank requiredEnv entry — unsatisfiable and uncheckable",
        });
      }
    }
  }

  const usedExceptions = new Set<string>();
  const violations = raw.filter((v) => {
    const key = `${v.rule}:${v.tool}`;
    if (key in exceptions) {
      usedExceptions.add(key);
      return false;
    }
    return true;
  });
  const unusedExceptions = Object.keys(exceptions).filter((k) => !usedExceptions.has(k));

  return {
    violations,
    unusedExceptions,
    checkedTools: catalog.length,
    checkedWhitelist: reasoningWhitelist.length,
  };
}

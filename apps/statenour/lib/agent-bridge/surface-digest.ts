/**
 * lib/agent-bridge/surface-digest.ts — MCP published-surface pin (2026-08-03).
 *
 * The rug-pull mechanism, taken as a PATTERN rather than as the
 * `mcp-scan` dependency (see docs/UPSTREAMS.md), and re-pointed at the
 * surface that actually exists here.
 *
 * The proposal was to scan MCP servers this app CONSUMES for poisoned
 * tool descriptions. That surface is ~empty: the one MCP client only
 * ever calls a tool by name, never enumerates descriptions. What this
 * repo actually has is the opposite exposure — it PUBLISHES an MCP
 * server, and `MCP_V1_TOOLS` is `TOOL_CATALOG.map(t => t.name)`, so
 * every tool added to the catalog is auto-published over POST /api/mcp
 * with no review step. (Contrast CHATGPT_ACTIONS_V1_TOOLS, a hand-listed
 * subset pinned by a length invariant.)
 *
 * A tool description is not documentation — it is text the calling model
 * reads as instructions. That makes "a description changed" and "a tool
 * appeared" the same class of event as an upstream rug-pull, and the
 * same fix applies: hash the surface, commit the hashes, diff on every
 * run.
 *
 * WHAT THIS DOES NOT DO: it does not judge whether a description is
 * malicious. It makes every change to the published surface VISIBLE and
 * reviewable. That is deliberate — a heuristic "is this text an
 * injection" classifier would fail open and give false comfort, whereas
 * a diff cannot silently pass.
 *
 * NOTE ON RISK POSTURE: `assertBridgeToolAllowed` intentionally permits
 * write/side-effecting/high-risk tools ("the operator assumes full
 * responsibility"). That is a signed operator decision and this module
 * does NOT override it. The pin gives visibility, not veto: if a new
 * critical tool joins the surface, the diff surfaces it for review
 * instead of quietly shipping.
 */

import { createHash } from "node:crypto";
import { getBridgeSafeTools } from "./tool-adapter";
import { getToolRiskClass } from "@/lib/ai/tools/catalog";

export interface SurfaceEntry {
  /** snake_case name as published over MCP. */
  name: string;
  /** camelCase name in the catalog. */
  camelName: string;
  category: string;
  /** EFFECTIVE risk (getToolRiskClass), i.e. what the audit will record. */
  riskClass: string;
  /** False = the class above is a DERIVED default nobody ratified. */
  riskDeclared: boolean;
  sideEffecting: boolean;
  requiredEnv: string[];
  /** The model-readable instruction text. THE injection vector. */
  descriptionSha256: string;
  /** Argument contract — a widened schema is also a surface change. */
  inputSchemaSha256: string;
}

const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex").slice(0, 16);

/** Stable stringify so key order can never produce a spurious diff. */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
    .join(",")}}`;
}

/**
 * Compute the CURRENT published MCP surface.
 *
 * Sorted by name so the snapshot diff reflects real change rather than
 * catalog ordering.
 */
export function computeMcpSurface(): SurfaceEntry[] {
  return getBridgeSafeTools("mcp")
    .map((t): SurfaceEntry => {
      const meta = (t.meta ?? {}) as {
        category?: string;
        riskClass?: string;
        sideEffecting?: boolean;
        requiredEnv?: string[];
      };
      return {
        name: String(t.name),
        camelName: String(t.camelName),
        category: meta.category ?? "(unset)",
        // EFFECTIVE risk — what the bridge audit will actually record — not the
        // raw field. 138 of 177 entries declare no riskClass, so pinning the
        // raw value published "(unset)" for them and hid the real exposure
        // (e.g. sendOpportunitySms resolves to "high", runDeviceCommand to
        // "critical"). riskDeclared keeps the deliberate-vs-derived distinction
        // a reviewer needs: a value that is merely DERIVED is a default nobody
        // has ratified, and that is different from one somebody chose.
        riskClass: getToolRiskClass(String(t.camelName), t.meta),
        riskDeclared: meta.riskClass != null,
        sideEffecting: meta.sideEffecting === true,
        requiredEnv: [...(meta.requiredEnv ?? [])].sort(),
        descriptionSha256: sha256(String(t.description ?? "")),
        inputSchemaSha256: sha256(stable(t.inputSchema)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SurfaceDiff {
  added: string[];
  removed: string[];
  /** name -> the fields that changed. */
  changed: Record<string, string[]>;
}

export function diffSurface(
  pinned: readonly SurfaceEntry[],
  current: readonly SurfaceEntry[],
): SurfaceDiff {
  const byName = (xs: readonly SurfaceEntry[]) => new Map(xs.map((e) => [e.name, e]));
  const [p, c] = [byName(pinned), byName(current)];

  const changed: Record<string, string[]> = {};
  for (const [name, cur] of c) {
    const prev = p.get(name);
    if (!prev) continue;
    const fields = (Object.keys(cur) as (keyof SurfaceEntry)[]).filter(
      (k) => stable(prev[k]) !== stable(cur[k]),
    );
    if (fields.length) changed[name] = fields;
  }

  return {
    added: [...c.keys()].filter((n) => !p.has(n)).sort(),
    removed: [...p.keys()].filter((n) => !c.has(n)).sort(),
    changed,
  };
}

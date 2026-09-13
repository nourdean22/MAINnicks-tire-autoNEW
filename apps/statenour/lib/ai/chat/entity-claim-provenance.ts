/**
 * ENTITY-CLAIM PROVENANCE — 2026-09-13.
 *
 * Action verbs answer "did Nick claim he did something?". They do not answer
 * a different failure class: "did Nick present a plausible-looking internal ID
 * as system state even though no source emitted that ID?"
 *
 * This helper is deliberately narrow. It only treats an identifier as a
 * structured-state claim when the reply labels it as an entity ID/reference.
 * That avoids flagging hashes, package versions, filenames, URLs, or example
 * identifiers in unrelated technical prose.
 */

export type EntityClaimKind =
  | "task"
  | "lead"
  | "customer"
  | "event"
  | "message"
  | "conversation"
  | "memory"
  | "mission"
  | "goal";

export interface EntityClaim {
  kind: EntityClaimKind;
  id: string;
  raw: string;
  start: number;
  end: number;
  supported: boolean;
  support: "USER_INPUT" | "TOOL_RESULT" | "NONE";
}

export interface EntityClaimReport {
  claims: EntityClaim[];
  unsupported: EntityClaim[];
}

const KIND = "task|lead|customer|event|message|conversation|memory|mission|goal";

/**
 * Accept common Prisma cuid/UUID/provider-ish IDs, but ONLY behind an explicit
 * entity label. Examples:
 *   task #cmtyj6qr308v1mj011ae54upe
 *   event id: 550e8400-e29b-41d4-a716-446655440000
 *   conversation: cmabc123...
 */
const ENTITY_ID_RE = new RegExp(
  `\\b(${KIND})\\s*(?:#|id\\s*[:=#]?|ref(?:erence)?\\s*[:=#]?|[:=])\\s*` +
    "[`\"']?([A-Za-z0-9][A-Za-z0-9._:-]{7,191})[`\"']?",
  "gi",
);

function normalizeId(value: string): string {
  return value.trim().replace(/^[`"']+|[`"'.,;!?)]*$/g, "").toLowerCase();
}

function containsId(haystack: string, id: string): boolean {
  if (!haystack || !id) return false;
  return haystack.toLowerCase().includes(id.toLowerCase());
}

export function checkEntityClaimProvenance(
  reply: string,
  evidence: {
    userText?: string;
    toolResultDigests?: readonly string[];
  },
): EntityClaimReport {
  const claims: EntityClaim[] = [];
  ENTITY_ID_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ENTITY_ID_RE.exec(reply)) !== null) {
    const kind = match[1].toLowerCase() as EntityClaimKind;
    const id = normalizeId(match[2]);
    if (!id) continue;

    const fromUser = containsId(evidence.userText ?? "", id);
    const fromTool = (evidence.toolResultDigests ?? []).some((digest) => containsId(digest, id));
    const support = fromUser ? "USER_INPUT" : fromTool ? "TOOL_RESULT" : "NONE";

    claims.push({
      kind,
      id,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
      supported: support !== "NONE",
      support,
    });
  }

  return {
    claims,
    unsupported: claims.filter((claim) => !claim.supported),
  };
}

/**
 * Deterministic repair for the narrow structured-state claim. We remove the
 * whole sentence/line containing an unsupported ID rather than deleting only
 * the token and leaving behind a false statement like "Task created.".
 */
export function removeUnsupportedEntityClaims(
  reply: string,
  report: EntityClaimReport,
): { text: string; removed: number } {
  if (report.unsupported.length === 0) return { text: reply, removed: 0 };
  const ids = new Set(report.unsupported.map((c) => c.id));
  let removed = 0;

  const lines = reply.split("\n").map((line) => {
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((sentence) => {
      const normalized = sentence.toLowerCase();
      const hit = [...ids].some((id) => normalized.includes(id));
      if (hit) removed += 1;
      return !hit;
    });
    return kept.join(" ");
  });

  return {
    text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    removed,
  };
}

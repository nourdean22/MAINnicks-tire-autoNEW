/**
 * The finite brief (UI v3 W2, 2026-10-16): the server brief as at most BRIEF_ROW_CAP ruled rows.
 *
 * Order is the attention order: the lead CTA first, then the judgment items in the order the
 * builder ranked them (approvals expand to the live rows the brief carries, then one remainder row
 * for the Review link), then horizon slots fill whatever is left. `hidden` is the device-local Less
 * filter (lib/ui/brief-feedback.ts): a hidden KIND contributes no rows and the next kind moves up,
 * except a PINNED lead (an unreadable board or a decide-first lead): those stay whatever the filter
 * says, because hiding "Open system" for seven days is a lockout, not a preference. `total` is the
 * number of rows after the filter and before the cap, so the page can say "N more" instead of
 * dropping rows silently. Pure, so tests/home/brief-rows.test.ts pins all of it without React.
 */
// TYPE imports only: operator-brief.ts is server code (prisma), and this module is imported by a
// "use client" component. A value import here put the whole server graph in the browser bundle and
// broke `next build` on PR #3073 (tests/repo/client-server-boundary.test.ts pins the rule).
import type {
  BriefHorizonSection,
  BriefJudgmentSection,
  BriefLeadSection,
  HorizonSlot,
  JudgmentItem,
  PendingApproval,
} from "./operator-brief";

/** The attention budget (operator-brief.ts ATTENTION_CAP), spelled here so the client never imports the builder. */
export const BRIEF_ROW_CAP = 7;

export type BriefRowKind = "lead" | "approval" | "commitment" | "followup" | "contradiction" | "horizon";

/** Lead kinds Less can never hide. */
export const PINNED_LEAD_KINDS: ReadonlySet<BriefLeadSection["kind"]> = new Set(["error", "decide"]);

export type BriefRow =
  | { key: string; kind: "lead"; pinned: boolean; lead: BriefLeadSection & { cta: NonNullable<BriefLeadSection["cta"]> } }
  | { key: string; kind: "approval"; item: PendingApproval; href: string }
  | { key: string; kind: "approval"; more: number; expired: number; href: string }
  | { key: string; kind: "commitment"; item: Extract<JudgmentItem, { kind: "commitment" }> }
  | { key: string; kind: "followup"; item: Extract<JudgmentItem, { kind: "followup" }> }
  | { key: string; kind: "contradiction"; item: Extract<JudgmentItem, { kind: "contradiction" }> }
  | { key: string; kind: "horizon"; slot: HorizonSlot };

export interface BriefRowsInput {
  lead: BriefLeadSection | null;
  judgment: BriefJudgmentSection | null;
  horizon: BriefHorizonSection | null;
}

export interface ComposedBrief {
  /** The rows to render, in order, at most `cap`. */
  rows: BriefRow[];
  /** Rows that survived the Less filter, before the cap. `total - rows.length` is "N more". */
  total: number;
}

export function composeBriefRows(brief: BriefRowsInput, hidden: ReadonlySet<string>, cap = BRIEF_ROW_CAP): ComposedBrief {
  const all: BriefRow[] = [];
  const push = (row: BriefRow) => {
    if (row.kind === "lead" && row.pinned) return void all.push(row);
    if (!hidden.has(row.kind)) all.push(row);
  };

  const lead = brief.lead;
  // A lead without a CTA has nothing to act on, and a row is one line plus one action.
  if (lead?.cta) push({ key: "lead", kind: "lead", pinned: PINNED_LEAD_KINDS.has(lead.kind), lead: { ...lead, cta: lead.cta } });

  for (const item of brief.judgment?.items ?? []) {
    switch (item.kind) {
      case "approvals": {
        for (const p of item.pending) push({ key: `approval:${p.id}`, kind: "approval", item: p, href: item.href });
        const more = item.count + item.expired - item.pending.length;
        if (more > 0) push({ key: "approval:more", kind: "approval", more, expired: item.expired, href: item.href });
        break;
      }
      case "commitment":
        push({ key: `commitment:${item.id}`, kind: "commitment", item });
        break;
      case "followup":
        push({ key: `followup:${item.id}`, kind: "followup", item });
        break;
      case "contradiction":
        push({ key: `contradiction:${item.key}`, kind: "contradiction", item });
        break;
    }
  }

  for (const slot of brief.horizon?.measured ? brief.horizon.slots : []) {
    push({ key: `horizon:${slot.scope}`, kind: "horizon", slot });
  }

  return { rows: all.slice(0, cap), total: all.length };
}

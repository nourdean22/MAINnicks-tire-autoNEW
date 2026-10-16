/**
 * The finite brief (UI v3 W2, 2026-10-16): the server brief as at most BRIEF_ROW_CAP ruled rows.
 *
 * Order is the attention order: the lead CTA first, then the judgment items in the order the
 * builder ranked them (approvals expand to the live rows the brief carries, then one remainder row
 * for the Review link), then horizon slots fill whatever is left. `hidden` is the device-local Less
 * filter (lib/ui/brief-feedback.ts): a hidden KIND contributes no rows and the next kind moves up.
 * Pure, so tests/home/brief-rows.test.ts pins the order, the cap and the filter without React.
 */
import {
  ATTENTION_CAP,
  type BriefHorizonSection,
  type BriefJudgmentSection,
  type BriefLeadSection,
  type HorizonSlot,
  type JudgmentItem,
  type PendingApproval,
} from "./operator-brief";

export const BRIEF_ROW_CAP = ATTENTION_CAP;

export type BriefRowKind = "lead" | "approval" | "commitment" | "followup" | "contradiction" | "horizon";

export type BriefRow =
  | { key: string; kind: "lead"; lead: BriefLeadSection & { cta: NonNullable<BriefLeadSection["cta"]> } }
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

export function composeBriefRows(brief: BriefRowsInput, hidden: ReadonlySet<string>, cap = BRIEF_ROW_CAP): BriefRow[] {
  const rows: BriefRow[] = [];
  const push = (row: BriefRow) => {
    if (!hidden.has(row.kind)) rows.push(row);
  };

  const lead = brief.lead;
  // A lead without a CTA has nothing to act on, and a row is one line plus one action.
  if (lead?.cta) push({ key: "lead", kind: "lead", lead: { ...lead, cta: lead.cta } });

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

  return rows.slice(0, cap);
}

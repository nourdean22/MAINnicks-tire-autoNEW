/**
 * The reason chips on the Approvals "Turn down" sheet. A turned-down proposal's note is either one
 * of these, a chip followed by a spaced middle dot and typed text, or free text. The server counts reasons by chip
 * (services/proposalDecisionSummary.ts), so the sheet and the summary read one list.
 */
export const PROPOSAL_REASON_CHIPS = [
  "Walk-in, no booking needed",
  "Not a real request",
  "Already handled",
  "Duplicate",
  "Other",
] as const;

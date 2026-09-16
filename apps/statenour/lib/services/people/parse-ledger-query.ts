/**
 * The ledger's one-line grammar: `<name> <+n|-n> [note]` · pure, no imports.
 *
 * Moved out of components/command-palette/relationship-log-action.tsx on
 * 2026-09-16 so the phone (Telegram `/log`) and the desktop (⌘K "Log ledger")
 * parse the same line the same way. Keep this file dependency-free: the ⌘K
 * component is a client module and must never pull a server import through it.
 *
 *   - Leading tokens up to the signed amount are the name ("mary jane +5 hi").
 *   - The amount token must match /^[+-]\d{1,3}$/ and lie within ±100.
 *   - Everything after the amount is the note; empty → "manual log".
 *
 * Returns null when no signed-amount token is found (or it comes first).
 */

export interface ParsedLedgerQuery {
  rawName: string;
  /** Signed. */
  amount: number;
  note: string;
}

export const LEDGER_QUERY_AMOUNT_MAX = 100;

export function parseLedgerQuery(input: string): ParsedLedgerQuery | null {
  const tokens = input.trim().split(/\s+/);
  if (tokens.length < 2) return null;

  const amountIdx = tokens.findIndex((t) => /^[+-]\d{1,3}$/.test(t));
  if (amountIdx <= 0) return null;

  const amount = parseInt(tokens[amountIdx], 10);
  if (
    !Number.isFinite(amount) ||
    amount < -LEDGER_QUERY_AMOUNT_MAX ||
    amount > LEDGER_QUERY_AMOUNT_MAX
  ) {
    return null;
  }

  const rawName = tokens.slice(0, amountIdx).join(" ").trim();
  if (!rawName) return null;

  const note = tokens.slice(amountIdx + 1).join(" ").trim() || "manual log";
  return { rawName, amount, note };
}

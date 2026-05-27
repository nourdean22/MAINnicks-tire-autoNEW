"use client";

/**
 * <RelationshipLogAction> · 2026-05-27 · Power Atlas Phase 1 Task 1.10
 *
 * Cmd+K log-anywhere action. Parses `<name> <+|-><number> [<note>]` and
 * fuzzy-resolves the name against `PersonProfile` rows. Single
 * high-confidence match → auto-logs. Multiple → disambiguation surface
 * via a sub-list of CommandItems (operator picks). Calls
 * `trpcVanilla.task.logLedger.mutate({ personId, amount, note, source })`.
 *
 * Rendered inline inside CommandPalette as a dedicated CommandGroup
 * (heading: "Log ledger") · only appears when the parsed query has a
 * valid `name + signedAmount` shape.
 *
 * Source: passes "manual" since Cmd+K is operator-initiated typing.
 *
 * Future Phase 2: amount=0 + note-only → emits a power_play ledger row.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { trpcVanilla } from "@/lib/trpc/vanilla-client";

interface PersonLite {
  id: string;
  name: string;
  role: string;
}

interface ParsedQuery {
  rawName: string;
  amount: number; // signed
  note: string;
}

/**
 * Parser · "<name> <+|-><number> [<note>]"
 *   - First whitespace-delimited token = name
 *     · multi-word names: any leading tokens until we hit the signed
 *       amount token are joined as the name. "mary jane +5 hi" works.
 *   - Signed-amount token must match /^[+-]\d{1,3}$/  (cap magnitude 100)
 *   - Remaining tokens after the amount = note (may be empty)
 *
 * Returns null when no signed-amount token is found.
 */
export function parseLedgerQuery(input: string): ParsedQuery | null {
  const tokens = input.trim().split(/\s+/);
  if (tokens.length < 2) return null;

  const amountIdx = tokens.findIndex((t) => /^[+-]\d{1,3}$/.test(t));
  if (amountIdx <= 0) return null;

  const amount = parseInt(tokens[amountIdx], 10);
  if (!Number.isFinite(amount) || amount < -100 || amount > 100) return null;

  const rawName = tokens.slice(0, amountIdx).join(" ").trim();
  if (!rawName) return null;

  const note = tokens.slice(amountIdx + 1).join(" ").trim() || "manual log";
  return { rawName, amount, note };
}

/**
 * Fuzzy-rank PersonProfile rows by similarity to `rawName`. The match
 * scoring is simple and predictable so the operator's muscle memory
 * stays consistent:
 *   - exact (case-insensitive) match → 1.0
 *   - prefix match → 0.85
 *   - substring match → 0.7
 *   - none → filtered out
 *
 * If the top score is ≥0.85 AND second-best is <0.6, treat as
 * single-high-confidence match (auto-log eligible).
 */
function rankCandidates(
  rawName: string,
  people: PersonLite[],
): Array<PersonLite & { score: number }> {
  const needle = rawName.toLowerCase();
  return people
    .map((p) => {
      const hay = p.name.toLowerCase();
      let score = 0;
      if (hay === needle) score = 1;
      else if (hay.startsWith(needle)) score = 0.85;
      else if (hay.includes(needle)) score = 0.7;
      return { ...p, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

interface Props {
  /** Current cmdk input value (query.trim()). */
  query: string;
  /** Called after a successful auto-log so the palette closes. */
  onLogged?: () => void;
}

export default function RelationshipLogAction({ query, onLogged }: Props) {
  const parsed = useMemo(() => parseLedgerQuery(query), [query]);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const lastFetchedRef = useRef<string>("");

  // Lazy-fetch the people list when the parser matches. We pull from
  // /api/people (already auth-guarded) · 100 cap matches the
  // /relationships page. Re-fetch on each new parsed name so the list
  // stays fresh, but skip if same name as last fetch.
  useEffect(() => {
    if (!parsed) {
      setPeople([]);
      return;
    }
    if (lastFetchedRef.current === parsed.rawName.toLowerCase()) return;
    lastFetchedRef.current = parsed.rawName.toLowerCase();

    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/people?sort=recent&limit=100`, {
      signal: controller.signal,
      credentials: "same-origin",
    })
      .then((r) => r.json())
      .then((payload: { data?: { people?: PersonLite[] } }) => {
        setPeople(payload.data?.people ?? []);
      })
      .catch(() => setPeople([]))
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [parsed]);

  const candidates = useMemo(() => {
    if (!parsed) return [];
    return rankCandidates(parsed.rawName, people);
  }, [parsed, people]);

  if (!parsed) return null;

  const sign = parsed.amount > 0 ? `+${parsed.amount}` : `${parsed.amount}`;
  const headingNote =
    candidates.length === 0
      ? loading
        ? "Searching people…"
        : `No matches for "${parsed.rawName}"`
      : candidates.length === 1
        ? `Log ledger · ${sign} for ${candidates[0].name}`
        : `Log ledger · ${sign} · ${candidates.length} matches`;

  const doLog = async (person: PersonLite) => {
    setSubmitting(person.id);
    try {
      await trpcVanilla.task.logLedger.mutate({
        personId: person.id,
        amount: parsed.amount,
        note: parsed.note,
        source: "manual",
      });
      toast.success("ledger logged", {
        description: `${sign} for ${person.name} · ${parsed.note}`,
      });
      onLogged?.();
    } catch (err) {
      toast.error("log failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <CommandGroup heading={headingNote}>
      {candidates.length === 0 && !loading && (
        <CommandItem disabled value="ledger-no-match">
          <span className="text-[var(--text-tertiary)]">
            No PersonProfile matches that name · open /relationships first to
            create one.
          </span>
        </CommandItem>
      )}
      {candidates.map((p) => (
        <CommandItem
          key={`ledger-${p.id}`}
          value={`ledger-${p.id}-${p.name}`}
          onSelect={() => void doLog(p)}
          disabled={submitting !== null}
        >
          <span className="font-mono text-xs text-[var(--gold)] tabular-nums w-12">
            {sign}
          </span>
          <span>
            {submitting === p.id ? "logging…" : p.name}
            <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              {p.role}
            </span>
          </span>
          <span className="ml-auto text-[10px] text-[var(--text-tertiary)] tabular-nums">
            match {Math.round(p.score * 100)}%
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

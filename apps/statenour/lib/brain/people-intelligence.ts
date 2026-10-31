/**
 * People Intelligence Engine — Layer 11 (Auto-Generated)
 *
 * Extracts, builds, and maintains profiles of people in Nour's life
 * from conversations, business data, and explicit input.
 *
 * Produces:
 * - Auto-profiles from conversation mentions
 * - Trust score evolution over time
 * - "You haven't talked to X in 2 weeks" alerts
 * - Relationship leverage analysis
 * - People most relevant to current goals
 */

import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("people-intelligence");
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { daysAgo, today } from "@/lib/utils/datetime";
import { isNeglected } from "@/lib/services/people/neglect";
import { contactRowsOnly } from "@/lib/services/people/contact-rows";
import { PERSON_ROLE_PROMPT_LIST, isPersonRole } from "./person-roles";
import { logError } from "@/lib/utils/error-log";

/**
 * Operator opened/edited the dossier within `days` — a "reviewed" signal
 * distinct from real CONTACT (lastInteraction, moved ONLY by a ledger write
 * through lib/services/people/record-interaction: the modal / ⌘K, Telegram
 * /log, Nick's person.logInteraction, the picks outreach button, or a
 * digest-extracted interaction — since 2026-09-16 a mere chat MENTION no
 * longer counts). A dossier edit deliberately does NOT bump lastInteraction,
 * so we use this to avoid crying "neglected" right after the operator
 * engaged with someone's record.
 */
function reviewedWithin(
  dossierUpdatedAt: Date | null | undefined,
  days = 14,
): boolean {
  return !!dossierUpdatedAt && new Date(dossierUpdatedAt) > daysAgo(days);
}

/**
 * Run a people intelligence scan — analyzes recent interactions,
 * finds neglected relationships, and surfaces people relevant to goals.
 */
export async function runPeopleIntelligence(): Promise<{
  profilesUpdated: number;
  alerts: string[];
  /** Set when the enrich pass could not read its context: 0 updates then means UNKNOWN, not a quiet day. */
  enrich?: "ledger_read_failed";
  /** People W2: cadence proposals parked for his accept this run. */
  cadenceProposed?: number;
  /** Set when the cadence pass could not read the ledger: no proposal was guessed. */
  cadence?: "ledger_read_failed";
}> {
  const alerts: string[] = [];

  // Get all known people · Wave AM · 2026-05-28 · CRITICAL soft-delete
  // gap · this is the engine that feeds every chat turn the operator's
  // people context. Pre-fix it returned soft-deleted profiles · operator
  // would delete person X · Nick would keep referencing X in chat replies.
  const people = await prisma.personProfile.findMany({
    where: { deletedAt: null },
    // W8 · honest counters changed what this ordering MEANS. Before the
    // 2026-09-16 reconcile `interactionCount` ran to 69 and sorted people
    // meaningfully; the true figures run 0–4, with 13 of 20 live profiles
    // never logged at all, so a bare count ordering is now mostly an
    // arbitrary tie-break over people the ledger has never seen. Recency
    // still discriminates (7 profiles carry a real date), so it leads —
    // NULLS LAST, because never-logged is unknown, not oldest — and the
    // count breaks ties beneath it. No new threshold, no invented weight.
    orderBy: [{ lastInteraction: { sort: "desc", nulls: "last" } }, { interactionCount: "desc" }],
    select: {
      id: true,
      name: true,
      role: true,
      relationship: true,
      trustScore: true,
      lastInteraction: true,
      dossierUpdatedAt: true,
      interactionCount: true,
      cadenceDays: true,
      leverageNotes: true,
      metadata: true,
      pendingClassification: true,
    },
  });

  if (people.length === 0) return { profilesUpdated: 0, alerts: [] };

  // Detect neglected relationships — no real CONTACT in NEGLECT_AFTER_DAYS.
  // Someone whose dossier the operator just reviewed is still tracked, not
  // neglected. W8: the "regularly" half (interactionCount >= 3) moved into
  // lib/services/people/neglect.ts, one definition for all three consumers,
  // and dropped to >= 1 — see that file's header for the prod measurement
  // that made 3 the wrong number.
  const neglected = people.filter((p) => isNeglected(p) && !reviewedWithin(p.dossierUpdatedAt));

  for (const n of neglected) {
    const daysSince = Math.round(
      (Date.now() - new Date(n.lastInteraction!).getTime()) /
        (24 * 60 * 60 * 1000)
    );
    alerts.push(
      `Haven't interacted with ${n.name} (${n.role}) in ${daysSince} days — ${n.relationship.slice(0, 60)}`
    );
  }

  // Propose enrichment for profiles that are too sparse — but skip any
  // that ALREADY have a suggestion waiting for the operator (don't burn
  // AI calls re-proposing the same thing, and don't clobber a pending one).
  const sparse = people.filter(
    (p) => (p.role === "unknown" || !p.leverageNotes) && !p.pendingClassification
  );

  let updated = 0;
  let ledgerReadFailed = false;
  const suggestedNow = new Set<string>();
  if (sparse.length > 0) {
    // People W0 (2026-10-30): the context is the person's own ledger notes.
    // This used to read payload.peopleMentioned off conversation_digest audit
    // rows, which the digest strips before insert (AuditEvent has no row-level
    // access control, v10.0.35), so it always read nothing; a `<= 10` sparse
    // gate also kept it from running on prod's 12. A failed read is no
    // context at all, never a guess.
    const notes = await prisma.relationshipLedger
      .findMany({
        where: { personId: { in: sparse.map((p) => p.id) } },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { personId: true, note: true, metadata: true },
      })
      // Only real contacts are context: a status-flip or synthetic row is not an interaction.
      .then(contactRowsOnly)
      .catch((err) => {
        logError("brain.people-intelligence", err, { fn: "runPeopleIntelligence.findLedgerNotes" });
        ledgerReadFailed = true;
        return null;
      });

    const ledgerContext: Record<string, string[]> = {};
    for (const n of notes ?? []) {
      const list = (ledgerContext[n.personId] ??= []);
      if (list.length < 3 && n.note.trim()) list.push(n.note.trim().slice(0, 200));
    }

    let enrichFailCount = 0;
    // Nothing on record means nothing to ground a suggestion in: no call.
    for (const person of sparse.filter((p) => ledgerContext[p.id]?.length).slice(0, 5)) {
      const contexts = ledgerContext[person.id];

      const enrichResult = await aiChat(
        [
          {
            role: "system",
            content: `Based on these logged interactions, determine this person's role and strategic relevance to Nour (CEO of an auto repair shop).

Pick the role from EXACTLY this list (use the closest fit; do not invent one):
${PERSON_ROLE_PROMPT_LIST}

Return ONLY JSON:
{
  "role": "<one value from the list above>",
  "leverageNotes": "How this person can help Nour or how Nour should manage this relationship",
  "trustAdjustment": 0 (no change) or -0.1 to +0.1
}`,
          },
          {
            role: "user",
            content: `Person: ${person.name}\nCurrent role: ${person.role}\nRelationship: ${person.relationship}\nLogged interactions: ${contexts.join("; ")}\nInteraction count: ${person.interactionCount}`,
          },
        ],
        "fast"
      );

       
      const enrichExtracted = extractJsonObject<any>(enrichResult.content);
      if (enrichExtracted.ok) {
        try {
          const enriched = enrichExtracted.value;
          // SUGGEST, don't clobber. Validate the role against the canonical
          // list; only propose a role change if it's valid AND differs from
          // what's there. Write the whole proposal to pendingClassification
          // for the operator to accept/dismiss on /people — role,
          // leverageNotes, and trustScore are NEVER silently overwritten.
          const suggestedRole =
            isPersonRole(enriched.role) && enriched.role !== person.role
              ? enriched.role
              : null;
          const suggestedNotes =
            typeof enriched.leverageNotes === "string" &&
            enriched.leverageNotes.trim() &&
            enriched.leverageNotes.trim() !== (person.leverageNotes ?? "").trim()
              ? enriched.leverageNotes.trim().slice(0, 2000)
              : null;
          const rawAdj = Number(enriched.trustAdjustment);
          const trustAdjustment = Number.isFinite(rawAdj)
            ? Math.max(-0.1, Math.min(0.1, rawAdj))
            : 0;

          // Nothing worth surfacing? Skip — don't park an empty suggestion.
          if (suggestedRole || suggestedNotes || trustAdjustment !== 0) {
            await prisma.personProfile.update({
              where: { id: person.id },
              data: {
                pendingClassification: {
                  role: suggestedRole,
                  leverageNotes: suggestedNotes,
                  trustAdjustment,
                  basis: contexts.join("; ").slice(0, 400),
                  suggestedAt: today(),
                } as object,
              },
            });
            updated++;
            suggestedNow.add(person.id);
          }
        } catch {
          enrichFailCount++;
        }
      }
    }
    
    if (enrichFailCount > 0) {
      logError("brain.people-intelligence", new Error(`${enrichFailCount} people enrichment failures`), { fn: "runPeopleIntelligence.enrich" });
    }
  }

  const cadence = await proposeCadences(
    people.filter((p) => !p.cadenceDays && !p.pendingClassification && !suggestedNow.has(p.id)),
  );

  return {
    profilesUpdated: updated,
    alerts,
    ...(ledgerReadFailed ? { enrich: "ledger_read_failed" as const } : {}),
    cadenceProposed: cadence.proposed,
    ...(cadence.readFailed ? { cadence: "ledger_read_failed" as const } : {}),
  };
}

const CADENCE_REPROPOSE_DAYS = 30;

/**
 * People W2 (2026-10-30): park a cadence PROPOSAL for people with none, for his
 * accept or dismiss on /people. Never writes cadenceDays. A dismissed proposal
 * stays away for 30 days (metadata.cadenceProposedAt), so it does not nag.
 */
async function proposeCadences(
  candidates: ReadonlyArray<{ id: string; role: string; metadata: unknown }>,
): Promise<{ proposed: number; readFailed: boolean }> {
  const cutoff = Date.now() - CADENCE_REPROPOSE_DAYS * 86_400_000;
  const due = candidates.filter((p) => {
    const at = (p.metadata as { cadenceProposedAt?: unknown } | null)?.cadenceProposedAt;
    const ms = typeof at === "string" ? Date.parse(at) : NaN;
    return !(Number.isFinite(ms) && ms > cutoff);
  });
  if (due.length === 0) return { proposed: 0, readFailed: false };

  const rows = await prisma.relationshipLedger
    .findMany({
      where: { personId: { in: due.map((p) => p.id) } },
      select: { personId: true, createdAt: true, metadata: true },
    })
    // Only real contacts set his rhythm: a status flip or a synthetic row is not one.
    .then(contactRowsOnly)
    .catch((err) => {
      logError("brain.people-intelligence", err, { fn: "proposeCadences.findLedger" });
      return null;
    });
  if (!rows) return { proposed: 0, readFailed: true };

  const contactsBy = new Map<string, Date[]>();
  for (const r of rows) (contactsBy.get(r.personId) ?? contactsBy.set(r.personId, []).get(r.personId)!).push(r.createdAt);

  const { suggestCadence } = await import("@/lib/services/people/cadence-suggest");
  let proposed = 0;
  for (const p of due) {
    const s = suggestCadence({ role: p.role, contacts: contactsBy.get(p.id) ?? [] });
    if (!s) continue;
    const meta = p.metadata && typeof p.metadata === "object" && !Array.isArray(p.metadata) ? (p.metadata as Record<string, unknown>) : {};
    try {
      await prisma.personProfile.update({
        where: { id: p.id },
        data: {
          pendingClassification: { cadenceDays: s.days, basis: s.basis, suggestedAt: today() } as object,
          metadata: { ...meta, cadenceProposedAt: new Date().toISOString() } as object,
        },
      });
      proposed++;
    } catch (err) {
      logError("brain.people-intelligence", err, { fn: "proposeCadences.update" });
    }
  }
  return { proposed, readFailed: false };
}

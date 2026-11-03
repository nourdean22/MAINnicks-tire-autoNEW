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

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("people-intelligence");
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { daysAgo, today } from "@/lib/utils/datetime";
import { isNeglected } from "@/lib/services/people/neglect";
import { contactRowsOnly } from "@/lib/services/people/contact-rows";
import { nameMatcher } from "@/lib/services/people/backfill-plan";
import { PERSON_ROLE_PROMPT_LIST, isPersonRole } from "./person-roles";
import { logError } from "@/lib/utils/error-log";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/people-intelligence");

/** The fallback note both chat writers use when the digest gave no detail: it records a contact, nothing about the person. */
const GENERIC_NOTE = /^interaction reported in chat \(/i;
const CONTEXT_MAX = 3;
/** A dismissed role/notes suggestion stays away this long, like a dismissed cadence (second reader on 3519). */
const ENRICH_REPROPOSE_DAYS = 30;
/** Model calls per run (W8b: one named cap; the rest of the sparse list is reported as `enrichDeferred`). */
export const ENRICH_CALLS_PER_RUN = 5;
/** A person whose call parked nothing is not called again within this many days (W8b: `metadata.enrichTriedAt`). */
export const ENRICH_RETRY_DAYS = 7;
const CADENCE_REPROPOSE_DAYS = 30;

function proposedWithin(metadata: unknown, key: string, days: number): boolean {
  const at = (metadata as Record<string, unknown> | null)?.[key];
  const ms = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(ms) && ms > Date.now() - days * 86_400_000;
}

/**
 * A waiting suggestion that already proposes a role, notes or a trust change. A cadence-only
 * one (W2) does not count: on 2026-11-02 it was blocking 9 of the 10 "Needs info" people.
 */
function hasEnrichProposal(pc: unknown): boolean {
  const o = pc as { role?: unknown; leverageNotes?: unknown; trustAdjustment?: unknown } | null;
  return !!o && (!!o.role || !!o.leverageNotes || (typeof o.trustAdjustment === "number" && o.trustAdjustment !== 0));
}

/** Up to `max` snippets of HIS OWN chat messages naming the person (whole word), newest first. */
async function chatSnippets(name: string, max: number): Promise<string[]> {
  const re = nameMatcher(name);
  // shortcut: a short name inside many longer words can fill the 20 rows with non-matches; widen take if a name that short appears.
  const rows = await prisma.chatMessage.findMany({
    where: { role: "user", content: { contains: name.trim(), mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { content: true },
  });
  const out: string[] = [];
  for (const r of rows) {
    const m = re.exec(r.content);
    if (!m) continue;
    const from = Math.max(0, m.index - 80);
    out.push(r.content.slice(from, from + 200).replace(/\s+/g, " ").trim());
    if (out.length >= max) break;
  }
  return out;
}

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
  enrich?: "ledger_read_failed" | "chat_read_failed";
  /** People W2: cadence proposals parked for his accept this run. */
  cadenceProposed?: number;
  /** Set when the cadence pass could not read the ledger: no proposal was guessed. */
  cadence?: "ledger_read_failed";
  /** W8b: sparse people with context the per-run cap left for a later run (0 = everyone due was tried). */
  enrichDeferred?: number;
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
  // that ALREADY have a role/notes suggestion waiting for the operator (don't
  // burn AI calls re-proposing the same thing). A cadence-only one is merged into.
  const sparse = people.filter(
    (p) =>
      (p.role === "unknown" || !p.leverageNotes) &&
      !hasEnrichProposal(p.pendingClassification) &&
      !proposedWithin(p.metadata, "enrichProposedAt", ENRICH_REPROPOSE_DAYS) &&
      !proposedWithin(p.metadata, "enrichTriedAt", ENRICH_RETRY_DAYS)
  );

  let updated = 0;
  let ledgerReadFailed = false;
  let chatReadFailed = false;
  let tried = 0;
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
      const note = n.note.trim();
      if (list.length < CONTEXT_MAX && note && !GENERIC_NOTE.test(note)) list.push(note.slice(0, 200));
    }

    let enrichFailCount = 0;
    let calls = 0;
    // Nothing on record and nothing he wrote means nothing to ground a suggestion in: no call.
    for (const person of ledgerReadFailed ? [] : sparse) {
      if (calls >= ENRICH_CALLS_PER_RUN) break;
      const logged = ledgerContext[person.id] ?? [];
      const said =
        logged.length < CONTEXT_MAX
          ? await chatSnippets(person.name, CONTEXT_MAX - logged.length).catch((err) => {
              logError("brain.people-intelligence", err, { fn: "runPeopleIntelligence.chatSnippets" });
              chatReadFailed = true;
              return [] as string[];
            })
          : [];
      const contexts = [...logged, ...said];
      if (contexts.length === 0) continue;
      calls++;
      tried++;
      const meta =
        person.metadata && typeof person.metadata === "object" && !Array.isArray(person.metadata)
          ? (person.metadata as Record<string, unknown>)
          : {};
      const triedAt = new Date().toISOString();
      // Stamped on EVERY call, before the proposal write: a call that parks nothing still spent the slot,
      // and without the stamp the same quiet person was retried every run (audit B6).
      let stamped = false;

      const enrichResult = await aiChat(
        [
          {
            role: "system",
            content: `Based on these logged interactions and what Nour wrote about this person in chat, determine this person's role and strategic relevance to Nour (CEO of an auto repair shop).

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
            content: `Person: ${person.name}\nCurrent role: ${person.role}\nRelationship: ${person.relationship}\nLogged interactions: ${logged.join("; ") || "none"}\nWhat Nour wrote in chat: ${said.join(" | ") || "none"}\nInteraction count: ${person.interactionCount}`,
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
            // Keep a waiting cadence proposal: one banner, and his Accept applies both.
            const prior = person.pendingClassification;
            const keep = prior && typeof prior === "object" && !Array.isArray(prior) ? (prior as Record<string, unknown>) : {};
            // Compare-and-swap on the slot this run read: if he accepted or dismissed it during
            // the model call, the write matches nothing (P2025) and is skipped below.
            await prisma.personProfile.update({
              where: {
                id: person.id,
                pendingClassification: { equals: (prior ?? Prisma.AnyNull) as Prisma.InputJsonValue },
              },
              data: {
                metadata: { ...meta, enrichProposedAt: triedAt, enrichTriedAt: triedAt } as object,
                pendingClassification: {
                  ...keep,
                  // The cadence's own reasoning survives beside the enrich basis (audit B13).
                  ...(typeof keep.basis === "string" && keep.cadenceDays !== undefined ? { cadenceBasis: keep.basis } : {}),
                  role: suggestedRole,
                  leverageNotes: suggestedNotes,
                  trustAdjustment,
                  basis: contexts.join("; ").slice(0, 400),
                  suggestedAt: today(),
                } as object,
              },
            });
            stamped = true;
            updated++;
            suggestedNow.add(person.id);
          }
        } catch (err) {
          // Lost the swap: he answered the banner mid-run. His answer stands; not a failure.
          if ((err as { code?: unknown } | null)?.code !== "P2025") enrichFailCount++;
        }
      }
      if (!stamped) {
        await prisma.personProfile
          .update({ where: { id: person.id }, data: { metadata: { ...meta, enrichTriedAt: triedAt } as object } })
          .catch((err) => logError("brain.people-intelligence", err, { fn: "runPeopleIntelligence.stampTried" }));
      }
    }

    if (enrichFailCount > 0) {
      logError("brain.people-intelligence", new Error(`${enrichFailCount} people enrichment failures`), { fn: "runPeopleIntelligence.enrich" });
    }
  }

  const cadence = await proposeCadences(
    people.filter((p) => !p.cadenceDays && !p.pendingClassification && !suggestedNow.has(p.id)),
  );

  const enrichDeferred = ledgerReadFailed ? 0 : Math.max(0, sparse.length - tried);
  if (enrichDeferred > 0) log.info("people_enrich_deferred", { enrichDeferred, tried, cap: ENRICH_CALLS_PER_RUN });

  return {
    profilesUpdated: updated,
    alerts,
    enrichDeferred,
    ...(ledgerReadFailed
      ? { enrich: "ledger_read_failed" as const }
      : chatReadFailed
        ? { enrich: "chat_read_failed" as const }
        : {}),
    cadenceProposed: cadence.proposed,
    ...(cadence.readFailed ? { cadence: "ledger_read_failed" as const } : {}),
  };
}

/**
 * People W2 (2026-10-30): park a cadence PROPOSAL for people with none, for his
 * accept or dismiss on /people. Never writes cadenceDays. A dismissed proposal
 * stays away for 30 days (metadata.cadenceProposedAt), so it does not nag.
 */
async function proposeCadences(
  candidates: ReadonlyArray<{ id: string; role: string; metadata: unknown }>,
): Promise<{ proposed: number; readFailed: boolean }> {
  const due = candidates.filter((p) => !proposedWithin(p.metadata, "cadenceProposedAt", CADENCE_REPROPOSE_DAYS));
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
      // Compare-and-swap on the EMPTY slot this run read (audit B5): a proposal that landed since (Nick's
      // person.update, the enrich pass) matches nothing (P2025) and is kept, not overwritten.
      await prisma.personProfile.update({
        where: { id: p.id, pendingClassification: { equals: Prisma.AnyNull } },
        data: {
          pendingClassification: { cadenceDays: s.days, basis: s.basis, suggestedAt: today() } as object,
          metadata: { ...meta, cadenceProposedAt: new Date().toISOString() } as object,
        },
      });
      proposed++;
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code !== "P2025") logError("brain.people-intelligence", err, { fn: "proposeCadences.update" });
    }
  }
  return { proposed, readFailed: false };
}

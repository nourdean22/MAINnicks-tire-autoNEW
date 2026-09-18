/**
 * 2026-05-27 · Power Atlas Phase 0 · auto-embed hook.
 *
 * On any PersonProfile.update that touches dossierMd OR
 * psychographicLadder OR behavioralFingerprint, write a
 * VectorEmbedding row (sourceType="person_profile", sourceId=personId)
 * so /api/people/search hybrid query can cosine-rank against the
 * dossier text.
 *
 * On any RelationshipLedger.create where note.length >= 20, the same
 * for sourceType="relationship_ledger".
 *
 * Note on architecture choice: the existing embed-backfill cron only
 * enumerates a fixed list of sourceType values (brain_memory, brain_dump,
 * reflection, strategic_law, chat_message). It does NOT iterate the
 * person_profile or relationship_ledger tables, so we cannot rely on
 * it to pick up unembedded rows. Instead we generate the embedding
 * inline + persist directly. Non-blocking — failures are logged but
 * don't break the caller. Same pattern as
 * lib/brain/embedding-utils.ts → storeGenericEmbedding().
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { getEmbedding } from "@/lib/ai/provider";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("brain/people-embed-hook");

/**
 * Embed (or re-embed) a PersonProfile row. Called from the tRPC
 * people procedures + any cron that mutates the dossier. Idempotent ·
 * skips the embedding-provider call when content is byte-identical to
 * the existing row (same gate storeGenericEmbedding uses).
 */
export async function enqueuePersonEmbed(personId: string): Promise<void> {
  try {
    // Wave AM · 2026-05-28 · soft-delete safety · don't enqueue embeds
    // for deleted people · they shouldn't bleed into semantic search.
    const person = await prisma.personProfile.findFirst({
      where: { id: personId, deletedAt: null },
      select: {
        name: true,
        role: true,
        relationship: true,
        dossierMd: true,
        leverageNotes: true,
      },
    });
    if (!person) return;

    // Compose the document the search route ranks against. Mirrors
    // the BM25 to_tsvector columns in app/api/people/search/route.ts.
    const content = [
      person.name,
      `Role: ${person.role}`,
      person.relationship,
      person.dossierMd ?? "",
      person.leverageNotes ?? "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 8000);

    if (content.length < 10) return;

    // Power Atlas fix 2026-06-02: mirror the dossier into brain_memories so
    // Nick's CHAT recall (searchMemories FTS + getContextualMemories) can
    // surface what the operator wrote on /people. Previously the dossier
    // only reached vector_embeddings (the /people search bar) — invisible
    // to chat, so editing a dossier didn't make it recallable. Stable key
    // → exactly one row per person, refreshed on every dossier save. The
    // brain-memory embed-backfill cron then gives it a semantic vector too.
    await prisma.brainMemory
      .upsert({
        where: {
          category_key: {
            category: BRAIN_CATEGORIES.RELATIONSHIPS,
            key: `person_dossier:${personId}`,
          },
        },
        create: {
          category: BRAIN_CATEGORIES.RELATIONSHIPS,
          key: `person_dossier:${personId}`,
          content,
          confidence: 0.9,
          source: "people:dossier",
          metadata: { personId, kind: "dossier" },
        },
        update: { content, lastSeen: new Date() },
      })
      .catch((e) =>
        log.warn("person_dossier_memory_failed", {
          personId,
          err: e instanceof Error ? e.message : String(e),
        }),
      );

    const existing = await prisma.vectorEmbedding.findFirst({
      where: { sourceType: "person_profile", sourceId: personId },
      select: { id: true, content: true },
    });

    if (existing && existing.content === content) return;

    const vec = await getEmbedding(content);
    if (vec.length === 0) return; // provider unavailable · degrade silently

    if (existing) {
      await prisma.vectorEmbedding.update({
        where: { id: existing.id },
        data: { content, embedding: JSON.stringify(vec) },
      });
    } else {
      await prisma.vectorEmbedding.create({
        data: {
          sourceType: "person_profile",
          sourceId: personId,
          content,
          embedding: JSON.stringify(vec),
        },
      });
    }
  } catch (err) {
    log.warn("person_embed_failed", {
      personId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Same for ledger entries. Skips short notes (<20 chars · no signal).
 */
export async function enqueueLedgerEmbed(ledgerId: string, note: string): Promise<void> {
  if (note.length < 20) return;
  try {
    const vec = await getEmbedding(note);
    if (vec.length === 0) return;

    // ⚠ RE-CHECK THE LEDGER ROW AFTER THE EMBEDDING CALL, NOT BEFORE IT.
    //
    // This runs fire-and-forget from record-interaction.ts:201
    // (`void (async () => { await enqueueLedgerEmbed(...) })()`), and
    // `getEmbedding` is a network round-trip to a provider — SECONDS, not
    // milliseconds. Delete the note in that window and the old code still wrote
    // the embedding afterwards: deleteLedgerRow's tombstone had already run, so
    // the deleted note stayed searchable with no row behind it. A delete that
    // loses a race to a writer it never knew about is not a delete.
    //
    // Checking INSIDE the same transaction as the write is what makes this
    // worth doing — a check outside it would just be a second place to be
    // stale. Neon is READ COMMITTED, so this narrows the window from the
    // provider call to one statement boundary rather than closing it to zero;
    // full closure would need a row lock on a hot fire-and-forget path. The
    // residual is bounded and SELF-HEALING: an embedding that wins that
    // sub-millisecond race is marked `row_absent` by the nightly
    // lib/db/embedding-shadow sweep and stops surfacing in recall. Stating the
    // limit rather than claiming the race is gone.
    await prisma.$transaction(async (tx) => {
      const live = await tx.relationshipLedger.findUnique({
        where: { id: ledgerId },
        select: { id: true },
      });
      if (!live) return; // deleted while we were embedding — write nothing

      const existing = await tx.vectorEmbedding.findFirst({
        where: { sourceType: "relationship_ledger", sourceId: ledgerId },
        select: { id: true },
      });

      if (existing) {
        await tx.vectorEmbedding.update({
          where: { id: existing.id },
          data: { content: note, embedding: JSON.stringify(vec) },
        });
      } else {
        await tx.vectorEmbedding.create({
          data: {
            sourceType: "relationship_ledger",
            sourceId: ledgerId,
            content: note,
            embedding: JSON.stringify(vec),
          },
        });
      }
    });
  } catch (err) {
    log.warn("ledger_embed_failed", {
      ledgerId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

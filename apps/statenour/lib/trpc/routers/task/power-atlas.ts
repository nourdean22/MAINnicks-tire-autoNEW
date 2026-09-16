/**
 * lib/trpc/routers/task/power-atlas.ts
 *
 * Power Atlas (people / relationship / ledger / power-balance / alpha-
 * moment / power-play) slice of the task router (mechanical split ·
 * 2026-06-04). Exports a plain procedure-object that task.ts spreads
 * back into `taskRouter` — the client paths stay FLAT as
 * `trpc.task.<proc>`. Procedures moved VERBATIM · no behavior / input-
 * schema / middleware change. See task.ts for the recomposition.
 */

import { z } from "zod";
import { operatorProcedure } from "../../trpc";
import { TaskStatus } from "@prisma/client";
import { PERSON_ROLES } from "@/lib/brain/person-roles";
import { prisma } from "@/lib/prisma";
import { buildPeopleChangesSince } from "@/lib/services/people/changes-since";
import { PersonNotFoundError, recordInteraction } from "@/lib/services/people/record-interaction";
import { LedgerRowNotFoundError, deleteLedgerRow } from "@/lib/services/people/delete-ledger-row";
import { writableLedgerMetadata } from "@/lib/services/people/contact-rows";

export const powerAtlasProcedures = {
  /**
   * 2026-09-16 · "since your last visit" for /people — the ChangeSet
   * primitive's third consumer. `since` is the caller's per-device cursor
   * (ms epoch); the service clamps it to 7 days and says so.
   */
  peopleChangesSince: operatorProcedure
    .input(z.object({ since: z.number().int().nonnegative() }))
    .query(async ({ input }) => buildPeopleChangesSince(input.since)),

  // ─── Power Atlas · 2026-05-27 ───────────────────────────────
  personProfile: operatorProcedure
    .input(z.object({ personId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const person = await prisma.personProfile.findUnique({
        where: { id: input.personId },
      });
      if (!person) return null;
      const ledger = await prisma.relationshipLedger.findMany({
        where: { personId: input.personId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      const plays = await prisma.relationshipPlay.findMany({
        where: { personId: input.personId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      const applicableLawTexts = person.applicableLaws.length
        ? await prisma.brainMemory.findMany({
            where: {
              category: "greene_law",
              key: { in: person.applicableLaws.map((n) => `law_${n}`) },
            },
            select: { key: true, content: true },
          })
        : [];
      // 2026-06-01 · people↔tasks correlation. Open promises/commitments
      // to this person — linked via the personId FK OR (transitional) a
      // free-text promiseTo that matches the name but predates the link.
      // This is what makes /people actually READ the task list.
      const openTasks = await prisma.task.findMany({
        where: {
          deletedAt: null,
          status: { notIn: [TaskStatus.DONE, TaskStatus.ARCHIVED] },
          OR: [
            { personId: input.personId },
            // Transitional name-match for tasks created before the FK link.
            // Guarded against a blank/too-short profile name so it can't
            // vacuum up unrelated promiseTo="" rows across all people.
            ...(person.name.trim().length >= 2
              ? [
                  {
                    promiseTo: {
                      equals: person.name,
                      mode: "insensitive" as const,
                    },
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take: 25,
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          loopKind: true,
          promiseTo: true,
        },
      });
      // 2026-06-01 · what this relationship has earned (deposits + plays).
      const { peopleXpForPerson } = await import("@/lib/mastery/people-credit");
      const xp = await peopleXpForPerson(input.personId);
      return { person, ledger, plays, applicableLawTexts, openTasks, xp };
    }),

  logLedger: operatorProcedure
    .input(
      z.object({
        personId: z.string().min(1).max(64),
        amount: z.number().int().min(-100).max(100),
        note: z.string().min(1).max(2000),
        source: z
          .enum([
            "gmail",
            "calendar",
            "chat",
            "telegram",
            "manual",
            "auto",
            "greene_play",
          ])
          .default("manual"),
        // W8 (Codex P2 on #2348): this procedure writes through the CONTACT
        // seam, which increments interactionCount — so it may not stamp a
        // marker that excludes its own row from the counters. Refused here so
        // the caller gets a BAD_REQUEST naming the key, rather than the seam's
        // throw surfacing as an internal error.
        metadata: writableLedgerMetadata.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // 2026-09-16 · every ledger write goes through the seam: row + both
      // counters in ONE transaction, embed + XP after the commit. This
      // procedure used to carry its own copy of the counter bump (and a
      // `.catch(() => null)` that could leave a row with no bump).
      try {
        const recorded = await recordInteraction({
          personId: input.personId,
          amount: input.amount,
          note: input.note,
          source: input.source,
          metadata: input.metadata,
        });
        return {
          ok: true,
          ledger: {
            id: recorded.ledgerId,
            personId: recorded.personId,
            amount: recorded.amount,
            note: recorded.note,
            source: recorded.source,
            createdAt: recorded.at,
            metadata: input.metadata ?? null,
          },
        };
      } catch (err) {
        if (err instanceof PersonNotFoundError) throw new Error("Person not found");
        throw err;
      }
    }),

  flipPersonStatus: operatorProcedure
    .input(
      z.object({
        personId: z.string().min(1).max(64),
        status: z.enum(["active", "cooling", "dormant", "blown_up"]),
        blowUpReason: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const before = await prisma.personProfile.findUnique({
        where: { id: input.personId },
      });
      if (!before) throw new Error("Person not found");

      if (
        input.status === "blown_up" &&
        (!input.blowUpReason || input.blowUpReason.length < 5)
      ) {
        throw new Error("Blow-up requires a reason (min 5 chars)");
      }

      const data: Record<string, unknown> = { status: input.status };
      if (input.status === "blown_up") {
        data.blownUpAt = new Date();
        data.blowUpReason = input.blowUpReason;
      } else if (before.status === "blown_up") {
        // Revive · keep blownUpAt + reason as history but clear status
        data.blownUpAt = null;
      }

      const after = await prisma.personProfile.update({
        where: { id: input.personId },
        data,
      });

      // Log the status flip as a ledger event for audit trail
      const reasonSuffix = input.blowUpReason
        ? `: ${input.blowUpReason.slice(0, 200)}`
        : "";
      await prisma.relationshipLedger
        .create({
          data: {
            personId: input.personId,
            amount:
              input.status === "blown_up" ? -50 : input.status === "active" ? 0 : -5,
            note: `Status: ${before.status} → ${input.status}${reasonSuffix}`,
            source: "manual",
            metadata: {
              kind: "status_flip",
              before: before.status,
              after: input.status,
            } as never,
          },
        })
        .catch(() => null);

      return { ok: true, before: before.status, after: after.status };
    }),

  updateDossier: operatorProcedure
    .input(
      z.object({
        personId: z.string().min(1).max(64),
        dossierMd: z.string().max(20000),
      }),
    )
    .mutation(async ({ input }) => {
      const { enqueuePersonEmbed } = await import(
        "@/lib/brain/people-embed-hook"
      );
      await prisma.personProfile.update({
        where: { id: input.personId },
        data: {
          dossierMd: input.dossierMd,
          dossierUpdatedAt: new Date(),
        },
      });
      void enqueuePersonEmbed(input.personId);
      return { ok: true };
    }),

  /**
   * 2026-06-01 · suggest-then-approve · accept the people-intelligence
   * engine's pending classification: apply the proposed role /
   * leverageNotes / trust adjustment to the REAL fields, then clear the
   * suggestion. The operator's explicit yes is the only thing that ever
   * writes these fields from the AI — no more silent overwrite.
   */
  acceptClassification: operatorProcedure
    .input(z.object({ personId: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const person = await prisma.personProfile.findUnique({
        where: { id: input.personId },
        select: {
          trustScore: true,
          role: true,
          leverageNotes: true,
          pendingClassification: true,
        },
      });
      if (!person) throw new Error("Person not found");
      const pc = (person.pendingClassification ?? null) as {
        role?: string | null;
        leverageNotes?: string | null;
        trustAdjustment?: number;
      } | null;
      if (!pc) return { ok: true, noop: true };

      const { isPersonRole } = await import("@/lib/brain/person-roles");
      const data: Record<string, unknown> = { pendingClassification: null };
      if (pc.role && isPersonRole(pc.role)) data.role = pc.role;
      if (pc.leverageNotes && pc.leverageNotes.trim())
        data.leverageNotes = pc.leverageNotes.trim().slice(0, 2000);
      if (Number.isFinite(pc.trustAdjustment) && pc.trustAdjustment !== 0) {
        data.trustScore = Math.max(
          0,
          Math.min(1, person.trustScore + (pc.trustAdjustment as number)),
        );
      }
      await prisma.personProfile.update({ where: { id: input.personId }, data });
      return {
        ok: true,
        applied: {
          role: (data.role as string | undefined) ?? null,
          leverageNotes: (data.leverageNotes as string | undefined) ?? null,
          trustScore: (data.trustScore as number | undefined) ?? null,
        },
      };
    }),

  /**
   * 2026-06-01 · suggest-then-approve · dismiss the pending classification
   * without applying anything (clears the suggestion only).
   */
  dismissClassification: operatorProcedure
    .input(z.object({ personId: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      // Record<string,unknown> matches the file's update idiom and lets
      // Prisma accept the JSON-column null clear (raw `null` is rejected
      // by the strict NullableJsonNullValueInput literal type).
      const data: Record<string, unknown> = { pendingClassification: null };
      // Surface a real failure instead of a false { ok: true } — a swallowed
      // error would leave pendingClassification set, and the engine skips any
      // profile that already has a suggestion, so a stale one would persist
      // forever (never re-classified, never clearable).
      const updated = await prisma.personProfile
        .update({ where: { id: input.personId }, data })
        .catch(() => null);
      if (!updated) throw new Error("Person not found");
      return { ok: true };
    }),

  /**
   * 2026-06-01 · people-credit scoring config · the active XP weights
   * (defaults + operator overrides merged) for the settings card.
   */
  getPeopleXpConfig: operatorProcedure.query(async () => {
    const { resolvePeopleXp } = await import("@/lib/mastery/people-credit");
    return resolvePeopleXp();
  }),

  /**
   * 2026-06-01 · persist operator overrides for the people-credit XP
   * weights. Self-contained — does NOT touch the task-side scoring config.
   */
  setPeopleXpConfig: operatorProcedure
    .input(
      z.object({
        depositBase: z.number().min(0).max(5),
        depositPerAmount: z.number().min(0).max(1),
        depositMax: z.number().min(0).max(10),
        reconnectBonus: z.number().min(0).max(5),
        play: z.number().min(0).max(10),
      }),
    )
    .mutation(async ({ input }) => {
      const { setSetting } = await import("@/lib/services/settings");
      const { PEOPLE_XP_SETTING_KEY } = await import(
        "@/lib/mastery/people-credit"
      );
      await setSetting(PEOPLE_XP_SETTING_KEY, input, "mastery");
      return { ok: true };
    }),

  /**
   * 2026-06-01 · one-time idempotent backfill — credit XP for existing
   * relationship reps (positive ledger deposits + executed power-plays)
   * so the feature isn't empty at launch. Safe to re-run (sourceKeys
   * dedup). Operator-triggered.
   */
  backfillPeopleXp: operatorProcedure.mutation(async () => {
    const { backfillPeopleXp } = await import("@/lib/mastery/people-credit");
    return backfillPeopleXp();
  }),

  /**
   * 2026-05-28 · Wave AB.b · operator-grade CREATE PersonProfile.
   *
   * The people-intelligence engine auto-creates profiles from chat
   * mentions · this mutation lets the operator add one manually (e.g.
   * "I just met X" before any chat references). Uses the fuzzy
   * resolver to prevent dupes against existing names.
   */
  createPerson: operatorProcedure
    .input(
      z.object({
        name: z.string().min(2).max(120),
        role: z.enum(PERSON_ROLES).default("acquaintance"),
        relationship: z.string().max(2000).default(""),
        leverageNotes: z.string().max(2000).optional(),
        birthday: z.string().optional(),
        anniversary: z.string().optional(),
        cadenceDays: z.number().int().min(1).max(365).optional(),
        phone: z.string().max(40).optional(),
        email: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { resolvePersonByName } = await import(
        "@/lib/brain/person-profile-fuzzy"
      );
      const resolved = await resolvePersonByName(input.name, {
        role: input.role,
        relationship: input.relationship,
        source: "operator",
        phone: input.phone,
        email: input.email,
      });
      // 2026-06-06 · resolver returns person:null for a pronoun/descriptor
      // name (createIfMissing defaults true here, so this only triggers on a
      // rejected non-name). Surface a friendly error instead of crashing.
      if (!resolved.person) {
        throw new Error("Please enter a real person's name.");
      }
      // If the fuzzy resolver MATCHED an existing person we update its
      // metadata fields the operator passed in. If it CREATED a new
      // one, we still apply the optional fields (the resolver's create
      // path only takes role / relationship / trustScore / metadata).
      const fieldsToApply: Record<string, unknown> = {};
      if (input.leverageNotes !== undefined)
        fieldsToApply.leverageNotes = input.leverageNotes;
      if (input.birthday !== undefined) fieldsToApply.birthday = input.birthday;
      if (input.anniversary !== undefined)
        fieldsToApply.anniversary = input.anniversary;
      if (input.cadenceDays !== undefined)
        fieldsToApply.cadenceDays = input.cadenceDays;
      // 2026-06-06 · contact info updates on a create-on-match (operator EDIT
      // path). source is NOT here · it's set-once on create, never overwritten.
      if (input.phone !== undefined) fieldsToApply.phone = input.phone || null;
      if (input.email !== undefined) fieldsToApply.email = input.email || null;
      if (resolved.matched) {
        // Don't overwrite existing relationship + role · operator-create
        // shouldn't clobber what's already curated.
        if (input.relationship && !fieldsToApply.relationship) {
          // keep the existing relationship · don't overwrite
        }
      } else {
        if (input.role) fieldsToApply.role = input.role;
        if (input.relationship) fieldsToApply.relationship = input.relationship;
      }
      if (Object.keys(fieldsToApply).length > 0) {
        await prisma.personProfile.update({
          where: { id: resolved.person.id },
          data: fieldsToApply,
        });
      }
      return {
        ok: true,
        personId: resolved.person.id,
        matched: resolved.matched,
        matchTier: resolved.matchTier,
      };
    }),

  /**
   * 2026-05-28 · Wave AB.b · operator-grade UPDATE PersonProfile basic
   * fields (NOT dossierMd · that has its own mutation). Lets the
   * operator fix a name typo, change role assignment, set birthday,
   * adjust cadence, etc. without touching the dossier prose.
   */
  updatePerson: operatorProcedure
    .input(
      z.object({
        personId: z.string().min(1).max(64),
        name: z.string().min(2).max(120).optional(),
        role: z.enum(PERSON_ROLES).optional(),
        relationship: z.string().max(2000).optional(),
        leverageNotes: z.string().max(2000).nullable().optional(),
        birthday: z.string().nullable().optional(),
        anniversary: z.string().nullable().optional(),
        cadenceDays: z.number().int().min(1).max(365).nullable().optional(),
        phone: z.string().max(40).nullable().optional(),
        email: z.string().max(200).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.role !== undefined) data.role = input.role;
      if (input.relationship !== undefined) data.relationship = input.relationship;
      if (input.leverageNotes !== undefined) data.leverageNotes = input.leverageNotes;
      if (input.birthday !== undefined) data.birthday = input.birthday;
      if (input.anniversary !== undefined) data.anniversary = input.anniversary;
      if (input.cadenceDays !== undefined) data.cadenceDays = input.cadenceDays;
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.email !== undefined) data.email = input.email;
      if (Object.keys(data).length === 0) return { ok: true, noop: true };
      await prisma.personProfile.update({
        where: { id: input.personId },
        data,
      });
      // Power Atlas 2026-06-02: this path skipped the embed hook, so edits
      // to name/role/relationship/leverageNotes were invisible to chat
      // recall + the /people search bar. Refresh both (mirrors updateDossier).
      const { enqueuePersonEmbed } = await import("@/lib/brain/people-embed-hook");
      void enqueuePersonEmbed(input.personId);
      return { ok: true };
    }),

  /**
   * 2026-05-28 · Wave AB.b · operator-grade SOFT-DELETE PersonProfile.
   * Sets `deletedAt = now()` · the row stays in the DB so cross-refs
   * (ledger entries, alpha moments, retros) don't break, but the
   * people-intelligence + Sam-layer surfaces filter them out via the
   * existing `deletedAt: null` predicate.
   *
   * Operator can revive (just set deletedAt back to null) via the same
   * mutation with revive: true.
   */
  softDeletePerson: operatorProcedure
    .input(
      z.object({
        personId: z.string().min(1).max(64),
        revive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await prisma.personProfile.update({
        where: { id: input.personId },
        data: {
          deletedAt: input.revive ? null : new Date(),
        },
      });
      return { ok: true, revived: input.revive === true };
    }),

  /**
   * 2026-05-28 · Wave AB.b · DELETE a single RelationshipLedger entry.
   * Used when the operator added an entry in error. 2026-09-16 (W6): the
   * delete goes through lib/services/people/delete-ledger-row.ts — the
   * per-person lock, the delete, then BOTH counters recomputed from the
   * remaining contact rows. The old body decremented unconditionally (a
   * deleted synthetic or status-flip row cost a real contact) and never
   * refreshed lastInteraction.
   */
  deleteLedger: operatorProcedure
    .input(
      z.object({
        ledgerId: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const deleted = await deleteLedgerRow(input.ledgerId);
        return {
          ok: true,
          personId: deleted.personId,
          interactionCount: deleted.interactionCount,
          lastInteraction: deleted.lastInteraction,
        };
      } catch (err) {
        if (err instanceof LedgerRowNotFoundError) throw new Error("Ledger entry not found");
        throw err;
      }
    }),

  /**
   * 2026-05-27 · Power Atlas Phase 2 · operator-driven powerBalance edit.
   *
   * The operator drags the slider on PowerBalanceGauge → this mutation
   * writes both `powerBalance` and `powerBalanceManualLock=true`. The
   * Phase 3 power-balance auto-compute engine MUST check the lock and
   * skip any profile where it's true (the operator's value is sticky).
   *
   * Pass `manualLock: false` to clear the lock when re-enabling
   * auto-compute for a profile (rare · use only when wanted).
   */
  updatePowerBalance: operatorProcedure
    .input(
      z.object({
        personId: z.string().min(1).max(64),
        powerBalance: z.number().min(-1).max(1),
        manualLock: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      await prisma.personProfile.update({
        where: { id: input.personId },
        data: {
          powerBalance: input.powerBalance,
          powerBalanceManualLock: input.manualLock,
        },
      });
      return { ok: true };
    }),

  /**
   * 2026-05-27 · Power Atlas Phase 2 · alpha moments archive.
   *
   * Operator pins a peak / shift / insight moment from a ledger entry.
   * Stored in BrainMemory(category="alpha_moment") with key shape
   * `<personId>:<ledgerId>` for natural dedup + per-person filtering.
   */
  markAlphaMoment: operatorProcedure
    .input(
      z.object({
        personId: z.string().min(1).max(64),
        ledgerId: z.string().min(1).max(64),
        moment: z.string().min(1).max(1000),
        kind: z.enum(["peak", "shift", "insight"]).default("peak"),
      }),
    )
    .mutation(async ({ input }) => {
      const payload = JSON.stringify({
        moment: input.moment,
        ledgerId: input.ledgerId,
        pinnedAt: new Date().toISOString(),
        kind: input.kind,
      });
      await prisma.brainMemory.upsert({
        where: {
          category_key: {
            category: "alpha_moment",
            key: `${input.personId}:${input.ledgerId}`,
          },
        },
        create: {
          category: "alpha_moment",
          key: `${input.personId}:${input.ledgerId}`,
          content: payload,
          confidence: 1.0,
          source: "operator-pin",
        },
        update: { content: payload },
      });
      return { ok: true };
    }),

  listAlphaMoments: operatorProcedure
    .input(z.object({ personId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const rows = await prisma.brainMemory.findMany({
        where: {
          category: "alpha_moment",
          key: { startsWith: `${input.personId}:` },
        },
        orderBy: { createdAt: "desc" },
        select: { content: true, createdAt: true },
      });
      return rows
        .map((r) => {
          try {
            const parsed = JSON.parse(r.content) as {
              moment: string;
              ledgerId: string;
              pinnedAt: string;
              kind: "peak" | "shift" | "insight";
            };
            return { ...parsed, createdAt: r.createdAt.toISOString() };
          } catch {
            return null;
          }
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);
    }),

  /**
   * 2026-05-27 · Power Atlas Phase 2 · 5-year arc projection.
   *
   * Calls `projectFiveYearArc` (Sam-flavored strategist · do_nothing /
   * double_effort / blow_up / recommendation). Caches the output on
   * `PersonProfile.lastArcPlan` so the panel can show the last-cached
   * value without re-running the AI every page open.
   */
  projectArc: operatorProcedure
    .input(z.object({ personId: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const { projectFiveYearArc } = await import(
        "@/lib/brain/relationship-arc-projection"
      );
      const projection = await projectFiveYearArc(input.personId);
      if (!projection) return { ok: false, projection: null };
      await prisma.personProfile.update({
        where: { id: input.personId },
        data: { lastArcPlan: projection as never },
      });
      return { ok: true, projection };
    }),

  /**
   * 2026-05-27 · Power Atlas Phase 2 · power plays runner.
   *
   * 4 play kinds: arc_plan · message_draft · scarcity_play ·
   * reciprocity_assess. Each persists a RelationshipPlay row for
   * operator review later. Output is the AI's JSON.
   */
  runPowerPlay: operatorProcedure
    .input(
      z.object({
        personId: z.string().min(1).max(64),
        kind: z.enum([
          "arc_plan",
          "message_draft",
          "scarcity_play",
          "reciprocity_assess",
        ]),
        operatorGoal: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { runPowerPlay } = await import(
        "@/lib/brain/power-plays-runner"
      );
      const output = await runPowerPlay(
        input.personId,
        input.kind,
        input.operatorGoal,
      );
      return { ok: !!output, output };
    }),

  /**
   * 2026-05-27 · Power Atlas Phase 3 polish · mark a play's outcome.
   *
   * Lets the operator close the loop on a RelationshipPlay after the
   * actual interaction has happened · win/partial/loss/not_executed
   * lands on RelationshipPlay.outcome (already in schema) so future
   * pattern analysis can compute play success rates per kind.
   */
  markPlayOutcome: operatorProcedure
    .input(
      z.object({
        playId: z.string().min(1).max(64),
        outcome: z.enum([
          "win",
          "partial",
          "loss",
          "not_executed",
        ]),
        outcomeNote: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await prisma.relationshipPlay.update({
        where: { id: input.playId },
        data: {
          outcome: input.outcome,
          outcomeNote: input.outcomeNote ?? null,
        },
      });
      return { ok: true };
    }),

  /**
   * 2026-05-27 · Power Atlas Phase 3 · social proof aggregator.
   *
   * Returns the operator's "people who appear alongside this person"
   * roster · cross-mentions in shared chat messages. Surfaces in the
   * /relationships detail panel as a Social Proof card. Pure read ·
   * cached implicitly by tRPC client query cache.
   */
  socialProofFor: operatorProcedure
    .input(z.object({ personId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const { aggregateSocialProof } = await import(
        "@/lib/brain/social-proof-aggregator"
      );
      return aggregateSocialProof(input.personId);
    }),
};

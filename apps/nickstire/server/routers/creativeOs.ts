/**
 * Creative OS router — the admin surface for the Wave C intelligence
 * services that have no other home: organic→paid evidence, the content
 * atomizer (thesis → format-native derivatives), the creator pattern miner
 * (public post → Creative DNA primitive in Pattern Lab) and trend intel.
 *
 * Generation only. Nothing here publishes; drafts go through the existing
 * approval doors (reel queue, inventory staging, article drafts).
 */
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { creativeGenomeSchema } from "../../client/src/lib/creativeGenome";
import { buildOrganicEvidence, renderOrganicEvidenceBlock } from "../services/organicEvidence";
import { planAtomization, executeAtomization, type DerivativeFormat } from "../services/contentAtomizer";
import { minePattern } from "../services/creativePatternMiner";
import { gatherTrends } from "../services/trendIntel";

const DERIVATIVE_FORMATS = ["reel_short", "reel_long", "carousel", "static", "story", "fb_status", "fb_album", "article", "faq", "ad"] as const satisfies readonly DerivativeFormat[];

const atomizationContext = z.object({
  realAssetAvailable: z.boolean().optional(),
  commercialIntent: z.boolean().optional(),
  hasArticle: z.boolean().optional(),
  durationLanes: z.array(z.enum(["18-24", "30-40", "45-60"])).optional(),
});

export const creativeOsRouter = router({
  /** What the organic feed already earned, as the ads architect sees it. */
  organicEvidence: adminProcedure
    .input(z.object({ windowDays: z.number().int().min(7).max(365).optional(), limit: z.number().int().min(1).max(25).optional() }).optional())
    .query(async ({ input }) => {
      const evidence = await buildOrganicEvidence(input ?? {});
      return { evidence, block: renderOrganicEvidenceBlock(evidence) };
    }),

  /** Pure plan: which format-native derivatives a thesis should become, and why. */
  atomizePlan: adminProcedure
    .input(z.object({ genome: creativeGenomeSchema, context: atomizationContext.optional() }))
    .query(({ input }) => planAtomization(input.genome, input.context ?? {})),

  /** Generate drafts for the derivatives that have a director today. Never publishes. */
  atomize: adminProcedure
    .input(z.object({ genome: creativeGenomeSchema, context: atomizationContext.optional(), only: z.array(z.enum(DERIVATIVE_FORMATS)).optional() }))
    .mutation(async ({ input }) => {
      const plan = planAtomization(input.genome, input.context ?? {});
      const result = await executeAtomization(input.genome, plan, input.only);
      return { plan, result };
    }),

  /** Abstract a public post into a Creative DNA primitive (stored in Pattern Lab, unmeasured). */
  minePattern: adminProcedure
    .input(z.object({
      creator: z.string().min(1).max(80),
      url: z.string().url(),
      date: z.string().min(4).max(32),
      format: z.enum(["reel", "carousel", "static", "video"]),
      durationSeconds: z.number().positive().max(600).optional(),
      onScreenText: z.string().max(4000).optional(),
      transcript: z.string().max(12000).optional(),
      shotList: z.array(z.string().max(300)).max(40).optional(),
      caption: z.string().max(4000).optional(),
      metrics: z.array(z.object({ name: z.string().max(40), value: z.number(), source: z.string().max(80) })).max(12).optional(),
      commentSample: z.array(z.string().max(300)).max(20).optional(),
    }))
    .mutation(({ input }) => minePattern(input)),

  /** Deterministic trend classification over the sources the repo actually has. */
  trends: adminProcedure
    .input(z.object({ extra: z.array(z.object({
      source: z.enum(["nws", "gsc", "instagram", "facebook", "google_trends", "reddit", "local_news", "nhtsa_recall", "audio", "operator"]),
      text: z.string().min(1).max(300),
      firstSeen: z.string().optional(),
      volume: z.number().optional(),
      licenseNote: z.string().max(300).optional(),
      requiresOthersGraphics: z.boolean().optional(),
    })).max(50).optional() }).optional())
    .query(({ input }) => gatherTrends(input?.extra ?? [])),
});

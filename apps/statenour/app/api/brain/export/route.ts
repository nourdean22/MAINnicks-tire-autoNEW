/**
 * GET /api/brain/export — full self-model dump as JSON.
 *
 * Everything the brain learning stack has stored about Nour, ready
 * to download. Useful for backups, manual audit, or piping into
 * another tool.
 */
import { apiHandler } from "@/lib/utils/http";
import { loadActiveSkills, loadPendingSkills } from "@/lib/brain/skill-extractor";
import { loadIdentitySnapshot, loadIdentityHistory } from "@/lib/brain/identity-snapshot";
import { loadQualitativeIdentity } from "@/lib/brain/qualitative-identity";
import { loadActiveBeliefs, loadBeliefCandidates } from "@/lib/brain/belief-harvester";
import { loadAllContradictions } from "@/lib/brain/contradiction-surfacer";
import { getGhostPredictions, loadGhostAccuracy } from "@/lib/brain/ghost-nick";

export const GET = apiHandler(
  async () => {
    const [
      skillsActive,
      skillsPending,
      identity,
      identityHistory,
      qualitative,
      beliefs,
      beliefCandidates,
      contradictions,
      ghostBundle,
      ghostAccuracy,
    ] = await Promise.all([
      loadActiveSkills().catch(() => []),
      loadPendingSkills().catch(() => []),
      loadIdentitySnapshot().catch(() => null),
      loadIdentityHistory(90).catch(() => []),
      loadQualitativeIdentity().catch(() => null),
      loadActiveBeliefs().catch(() => []),
      loadBeliefCandidates().catch(() => []),
      loadAllContradictions(180).catch(() => []),
      getGhostPredictions().catch(() => null),
      loadGhostAccuracy().catch(() => null),
    ]);

    return {
      exported_at: new Date().toISOString(),
      schema_version: "2026.04.19",
      skills: { active: skillsActive, pending: skillsPending },
      identity,
      identity_history: identityHistory,
      qualitative_identity: qualitative,
      beliefs: { active: beliefs, candidates: beliefCandidates },
      contradictions,
      ghost: { bundle: ghostBundle, accuracy: ghostAccuracy },
    };
  },
  { auth: "owner" },
);

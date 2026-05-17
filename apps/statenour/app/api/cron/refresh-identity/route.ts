/**
 * GET /api/cron/refresh-identity — daily 04:30, rolls Nour's 8-axis
 * self-model forward. Writes history:YYYY-MM-DD row for timeline
 * scrubbing, emits a brain_insight if any axis shifted buckets by
 * ≥15 points vs yesterday (that's the kind of delta worth Nick
 * noticing).
 */
import { cronHandler } from "@/lib/utils/http";
import { computeIdentitySnapshot, axisLabel, type AxisKey } from "@/lib/brain/identity-snapshot";
import { computeQualitativeIdentity } from "@/lib/brain/qualitative-identity";
import { harvestBeliefs } from "@/lib/brain/belief-harvester";
import { runDecay } from "@/lib/brain/decay";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();

  // Pull yesterday's snapshot (if any) for delta comparison
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const prevRow = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: "identity_snapshot", key: `history:${yesterday}` } },
      select: { content: true },
    })
    .catch(() => null);

  const prevValues: Partial<Record<AxisKey, number>> = {};
  if (prevRow) {
    try {
      const parsed = JSON.parse(prevRow.content) as {
        axes: Record<AxisKey, { value: number; manual: number | null }>;
      };
      for (const k of Object.keys(parsed.axes) as AxisKey[]) {
        prevValues[k] = parsed.axes[k].manual ?? parsed.axes[k].value;
      }
    } catch {
      // ignore
    }
  }

  const snapshot = await computeIdentitySnapshot();

  // Qualitative identity + belief harvest + decay run alongside
  const [qualitative, beliefs, decay] = await Promise.all([
    computeQualitativeIdentity().catch((): null => null),
    harvestBeliefs().catch((): null => null),
    runDecay().catch((): null => null),
  ]);

  // Detect notable shifts
  const shifts: Array<{ axis: AxisKey; from: number; to: number; delta: number }> = [];
  for (const k of Object.keys(snapshot.axes) as AxisKey[]) {
    const a = snapshot.axes[k];
    const to = a.manual ?? a.value;
    const from = prevValues[k];
    if (from != null && Math.abs(to - from) >= 15) {
      shifts.push({ axis: k, from, to, delta: to - from });
    }
  }

  if (shifts.length > 0) {
    const top = shifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    const arrow = top.delta > 0 ? "↑" : "↓";
    const label = axisLabel(top.axis);
    await prisma.auditEvent
      .create({
        data: {
          actor: "identity_snapshot",
          eventType: "brain_insight",
          detail: `${label} shifted ${arrow} ${Math.abs(top.delta)} pts (${top.from}→${top.to}) — self-model updated`,
          payload: { shifts, computedAt: snapshot.computed_at },
        },
      })
      .catch(() => {});
  }

  if (beliefs && beliefs.newCandidates > 0) {
    await prisma.auditEvent
      .create({
        data: {
          actor: "belief_harvester",
          eventType: "brain_insight",
          detail: `${beliefs.newCandidates} new belief candidate${beliefs.newCandidates > 1 ? "s" : ""} · review in /brain`,
          payload: beliefs as any,
        },
      })
      .catch(() => {});
  }

  if (decay && (decay.skills_decayed > 0 || decay.beliefs_decayed > 0)) {
    const parts: string[] = [];
    if (decay.skills_decayed > 0) parts.push(`${decay.skills_decayed} skill${decay.skills_decayed > 1 ? "s" : ""}`);
    if (decay.beliefs_decayed > 0) parts.push(`${decay.beliefs_decayed} belief${decay.beliefs_decayed > 1 ? "s" : ""}`);
    if (decay.skills_flagged > 0) parts.push(`${decay.skills_flagged} flagged for review`);
    await prisma.auditEvent
      .create({
        data: {
          actor: "brain_decay",
          eventType: "brain_insight",
          detail: `Decay swept: ${parts.join(" · ")}`,
          payload: decay as any,
        },
      })
      .catch(() => {});
  }

  return {
    computedAt: snapshot.computed_at,
    shifts: shifts.length,
    qualitativeBuckets: qualitative
      ? Object.keys(qualitative).filter((k) => k !== "computed_at").length
      : 0,
    beliefs: beliefs ?? null,
    decay: decay ?? null,
    durationMs: Date.now() - started,
  };
});

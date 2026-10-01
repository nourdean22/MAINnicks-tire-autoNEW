/**
 * Organic evidence for paid creative (Creative Intelligence OS, Wave C §Q).
 *
 * Meta Ads Architect used to plan campaigns blind: no idea which tensions,
 * hooks or topics had already earned sends and saves on the organic feed.
 * This reads what the shop already measured — `social_content_inventory`
 * rows that reached "published" and had their IG metrics copied back by the
 * publisher sync — and compiles the winning theses by shares/reach and
 * saves/reach, grouped by topic + hook category.
 *
 * Honest-state rules (see .claude/skills/empty-vs-error): a DB read that
 * fails is an `error`, rendered as "organic evidence unavailable" in the
 * prompt — never an empty list that reads as "nothing ever worked". Rows
 * without reach are excluded from ratios (a 0/0 is not a 0%). Organic
 * evidence is DISCOVERY evidence; it never stands in for ad-conversion
 * evidence, and the block says so to the model.
 */
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { socialContentInventory } from "../../drizzle/schema";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";

const log = createLogger("organic-evidence");

export interface OrganicThesis {
  inventoryId: number;
  topic: string;
  hookCategory: string;
  hookText: string;
  contentType: string;
  platform: string;
  reach: number;
  shares: number;
  saves: number;
  comments: number;
  sharesPerReach: number;
  savesPerReach: number;
  publishedAt: string | null;
}

export interface OrganicEvidence {
  windowDays: number;
  sampled: number;
  /** Rows with reach > 0 — the only ones a ratio can be computed from. */
  measured: number;
  theses: OrganicThesis[];
  winningHookCategories: Array<{ hookCategory: string; n: number; avgSharesPerReach: number; avgSavesPerReach: number }>;
  topicsByFormat: Array<{ topic: string; bestFormat: string; sharesPerReach: number }>;
  error?: string;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Pure ranking over inventory-shaped rows. Exported for tests. */
export function rankOrganicRows(
  rows: Array<{
    id: number; topic: string; hookCategory: string; hookText: string; contentType: string; platform: string;
    metricsReach: number | null; metricsShares: number | null; metricsSaves: number | null; metricsComments: number | null;
    publishedAt: Date | string | null;
  }>,
  opts: { windowDays: number; limit: number },
): OrganicEvidence {
  const measuredRows = rows.filter((r) => (r.metricsReach ?? 0) > 0);
  const theses: OrganicThesis[] = measuredRows
    .map((r) => {
      const reach = r.metricsReach ?? 0;
      const shares = r.metricsShares ?? 0;
      const saves = r.metricsSaves ?? 0;
      return {
        inventoryId: r.id,
        topic: r.topic,
        hookCategory: r.hookCategory,
        hookText: r.hookText,
        contentType: r.contentType,
        platform: r.platform,
        reach,
        shares,
        saves,
        comments: r.metricsComments ?? 0,
        sharesPerReach: round4(shares / reach),
        savesPerReach: round4(saves / reach),
        publishedAt: r.publishedAt ? new Date(r.publishedAt).toISOString() : null,
      };
    })
    .sort((a, b) => (b.sharesPerReach + b.savesPerReach) - (a.sharesPerReach + a.savesPerReach))
    .slice(0, opts.limit);

  const byHook = new Map<string, { n: number; shares: number; saves: number }>();
  for (const t of measuredRows) {
    const reach = t.metricsReach ?? 0;
    const acc = byHook.get(t.hookCategory) ?? { n: 0, shares: 0, saves: 0 };
    acc.n += 1;
    acc.shares += (t.metricsShares ?? 0) / reach;
    acc.saves += (t.metricsSaves ?? 0) / reach;
    byHook.set(t.hookCategory, acc);
  }
  const winningHookCategories = [...byHook.entries()]
    .map(([hookCategory, a]) => ({ hookCategory, n: a.n, avgSharesPerReach: round4(a.shares / a.n), avgSavesPerReach: round4(a.saves / a.n) }))
    .sort((a, b) => (b.avgSharesPerReach + b.avgSavesPerReach) - (a.avgSharesPerReach + a.avgSavesPerReach))
    .slice(0, 5);

  const byTopic = new Map<string, { bestFormat: string; sharesPerReach: number }>();
  for (const t of theses) {
    const cur = byTopic.get(t.topic);
    if (!cur || t.sharesPerReach > cur.sharesPerReach) byTopic.set(t.topic, { bestFormat: t.contentType, sharesPerReach: t.sharesPerReach });
  }
  const topicsByFormat = [...byTopic.entries()].map(([topic, v]) => ({ topic, ...v }));

  return { windowDays: opts.windowDays, sampled: rows.length, measured: measuredRows.length, theses, winningHookCategories, topicsByFormat };
}

export async function buildOrganicEvidence(opts: { windowDays?: number; limit?: number } = {}): Promise<OrganicEvidence> {
  const windowDays = opts.windowDays ?? 90;
  const limit = opts.limit ?? 8;
  const empty: OrganicEvidence = { windowDays, sampled: 0, measured: 0, theses: [], winningHookCategories: [], topicsByFormat: [] };
  try {
    const database = await db();
    if (!database) return { ...empty, error: "database unavailable" };
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const rows = await database
      .select({
        id: socialContentInventory.id,
        topic: socialContentInventory.topic,
        hookCategory: socialContentInventory.hookCategory,
        hookText: socialContentInventory.hookText,
        contentType: socialContentInventory.contentType,
        platform: socialContentInventory.platform,
        metricsReach: socialContentInventory.metricsReach,
        metricsShares: socialContentInventory.metricsShares,
        metricsSaves: socialContentInventory.metricsSaves,
        metricsComments: socialContentInventory.metricsComments,
        publishedAt: socialContentInventory.publishedAt,
      })
      .from(socialContentInventory)
      .where(and(eq(socialContentInventory.status, "published"), isNotNull(socialContentInventory.publishedAt), gte(socialContentInventory.publishedAt, since)))
      .limit(500);
    return rankOrganicRows(rows, { windowDays, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("organic evidence read failed — reporting unavailable, not empty", { error: message });
    return { ...empty, error: message };
  }
}

/** The prompt block the ads architect embeds. Discovery evidence only; says so. */
export function renderOrganicEvidenceBlock(ev: OrganicEvidence): string {
  if (ev.error) {
    return `ORGANIC EVIDENCE: unavailable (${ev.error}). Do not assume any organic winner; plan direct tests.`;
  }
  if (ev.measured === 0) {
    return `ORGANIC EVIDENCE: no measured organic posts in the last ${ev.windowDays} days (${ev.sampled} published, none with reach yet). Plan direct tests; do not invent a winner.`;
  }
  const lines: string[] = [
    `ORGANIC EVIDENCE (discovery signal from ${ev.measured} measured organic posts in ${ev.windowDays} days — this is reach/sends/saves evidence, NOT ad-conversion evidence; derive a direct-response variant, never copy the organic post):`,
  ];
  for (const t of ev.theses) {
    lines.push(`- [${t.contentType}/${t.platform}] topic "${t.topic}" · hook ${t.hookCategory}: "${t.hookText.slice(0, 120)}" — sends/reach ${(t.sharesPerReach * 100).toFixed(2)}%, saves/reach ${(t.savesPerReach * 100).toFixed(2)}% (reach ${t.reach})`);
  }
  if (ev.winningHookCategories.length) {
    lines.push("Hook categories by organic sends+saves per reach: " + ev.winningHookCategories.map((h) => `${h.hookCategory} (n=${h.n}, ${((h.avgSharesPerReach + h.avgSavesPerReach) * 100).toFixed(2)}%)`).join(" · "));
  }
  return lines.join("\n");
}

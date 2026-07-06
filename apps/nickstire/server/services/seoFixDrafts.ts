/**
 * SEO fix drafts (self-improving loop · phase 4 · GSC Act — "draft + surface").
 *
 * The buried money pages (/brakes, /oil-change, …) are STATIC React pages whose
 * SEO title/meta live in shared/services.ts (a compiled data file), NOT the DB —
 * so there is no runtime write path. Instead of a live write, this drafts an
 * improved title + meta-description for each buried service page and surfaces it
 * for a human (or a code agent) to apply as a shared/services.ts edit. Zero live
 * writes; the "act" is a reviewed code change.
 *
 * Source of the buried pages: findCtrOpportunities (the same GSC signal Phase 3
 * persists). Only pages that map to a shared/services.ts entry are drafted (those
 * a human can actually edit); /services is skipped (it already ranks well).
 */
import { eq } from "drizzle-orm";
import { getServiceBySlug, type ServiceData } from "@shared/services";
import { invokeLLM } from "../_core/llm";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";

const log = createLogger("services:seo-fix-drafts");
const DRAFTS_KEY = "seo_fix_drafts";

export interface SeoFixDraft {
  slug: string;
  page: string;
  impressions: number;
  position: number;
  currentTitle: string;
  currentDescription: string;
  proposedTitle: string;
  proposedDescription: string;
  rationale: string;
}

export interface SeoFixDraftsResult {
  generatedAt: string | null;
  drafts: SeoFixDraft[];
}

/** "https://nickstire.org/oil-change" | "/oil-change/" -> "oil-change" */
function pageToSlug(page: string): string {
  let path = page;
  try {
    if (page.startsWith("http")) path = new URL(page).pathname;
  } catch {
    /* fall through with the raw string */
  }
  return path.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
}

async function draftOne(svc: ServiceData, impressions: number, position: number): Promise<SeoFixDraft | null> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are an SEO copywriter for Nick's Tire & Auto, a family-run tire + auto-repair shop in the Cleveland / Euclid, Ohio area. " +
            "Rewrite a page's SEO title tag and meta description to earn more clicks from Google search. Rules: title <= 60 characters; " +
            "meta description <= 155 characters; include the primary service and a local signal (Cleveland/Euclid) and one concrete, truthful " +
            "hook (a price range, same-day service, or a free written estimate) when it fits. Plain, direct, trustworthy — no hype or filler. Return JSON.",
        },
        {
          role: "user",
          content:
            `Page: /${svc.slug}\nService: ${svc.title}\nPrimary keywords: ${(svc.keywords ?? []).slice(0, 6).join(", ")}\n` +
            `Current title: ${svc.metaTitle}\nCurrent meta description: ${svc.metaDescription}\n` +
            `GSC signal: about ${impressions} impressions but ranks around position ${position} (page 2+), so it earns almost no clicks. ` +
            `Rewrite the title tag and meta description to lift click-through.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "seo_meta_fix",
          strict: true,
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              rationale: { type: "string" },
            },
            required: ["title", "description", "rationale"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return null;
    const parsed = JSON.parse(content) as { title: string; description: string; rationale: string };
    if (!parsed.title || !parsed.description) return null;

    return {
      slug: svc.slug,
      page: `/${svc.slug}`,
      impressions,
      position,
      currentTitle: svc.metaTitle,
      currentDescription: svc.metaDescription,
      proposedTitle: parsed.title.slice(0, 70),
      proposedDescription: parsed.description.slice(0, 165),
      rationale: parsed.rationale,
    };
  } catch (e) {
    log.error(`[seo-fix-drafts] draft failed for /${svc.slug}:`, e);
    return null;
  }
}

/**
 * Draft improved title/meta for the top buried service pages and persist them
 * (structured, in shopSettings KV) for the admin SEO view. Read-only to the live
 * site — nothing is written to any page.
 */
export async function generateSeoFixDrafts(opts?: { limit?: number }): Promise<SeoFixDraftsResult> {
  const limit = opts?.limit ?? 4;

  const { findCtrOpportunities } = await import("../pipelines/gsc-data");
  const opps = await findCtrOpportunities({ minImpressions: 100, limit: 40 });

  // Aggregate query-level opportunities to the buried PAGE (position 2+).
  const byPage = new Map<string, { impressions: number; posSum: number }>();
  for (const o of opps) {
    if (!o.page || o.avgPosition < 15) continue;
    const cur = byPage.get(o.page) ?? { impressions: 0, posSum: 0 };
    cur.impressions += o.impressions;
    cur.posSum += o.avgPosition * o.impressions;
    byPage.set(o.page, cur);
  }
  const buried = [...byPage.entries()]
    .map(([page, v]) => ({ page, impressions: v.impressions, position: Math.round(v.posSum / Math.max(1, v.impressions)) }))
    .sort((a, b) => b.impressions - a.impressions);

  const drafts: SeoFixDraft[] = [];
  for (const b of buried) {
    if (drafts.length >= limit) break;
    const slug = pageToSlug(b.page);
    if (slug === "services") continue; // never touch /services — it already ranks #3
    const svc = getServiceBySlug(slug);
    if (!svc) continue; // only static SERVICE pages a human can edit in shared/services.ts
    const draft = await draftOne(svc, b.impressions, b.position);
    if (draft) drafts.push(draft);
  }

  const result: SeoFixDraftsResult = { generatedAt: new Date().toISOString(), drafts };

  // Persist structured drafts for the admin view (best-effort).
  try {
    const d = await db();
    if (d) {
      const { shopSettings } = await import("../../drizzle/schema");
      const payload = JSON.stringify(result);
      const existing = await d.select().from(shopSettings).where(eq(shopSettings.key, DRAFTS_KEY)).limit(1);
      if (existing.length > 0) {
        await d.update(shopSettings).set({ value: payload }).where(eq(shopSettings.key, DRAFTS_KEY));
      } else {
        await d.insert(shopSettings).values({ key: DRAFTS_KEY, value: payload });
      }
    }
  } catch (e) {
    log.error("[seo-fix-drafts] persist failed:", e);
  }

  return result;
}

/** Read the last-generated SEO fix drafts (for the admin view). */
export async function getSeoFixDrafts(): Promise<SeoFixDraftsResult> {
  const d = await db();
  if (!d) return { generatedAt: null, drafts: [] };
  try {
    const { shopSettings } = await import("../../drizzle/schema");
    const rows = await d.select().from(shopSettings).where(eq(shopSettings.key, DRAFTS_KEY)).limit(1);
    if (rows.length === 0) return { generatedAt: null, drafts: [] };
    const parsed = JSON.parse(rows[0].value) as SeoFixDraftsResult;
    return { generatedAt: parsed.generatedAt ?? null, drafts: parsed.drafts ?? [] };
  } catch (e) {
    log.warn("[seo-fix-drafts] read failed:", e);
    return { generatedAt: null, drafts: [] };
  }
}

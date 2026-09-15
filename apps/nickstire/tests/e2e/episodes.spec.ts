/**
 * Experience Gym runner — replays every tests/episodes/*.json against the
 * target site on its own viewport, within its tap + time budget, and judges
 * the success oracle. A failure writes test-results/episodes/<id>.failure.json
 * (the input to scripts/proof/promote-episode.mjs and to the evidence ledger).
 *
 * Deterministic on purpose: this is the oracle, not the explorer. Agentic
 * browsing (Stagehand, in statenour) is for finding NEW paths; once a path
 * matters it lives here as a fixed episode.
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertEpisode, type EpisodeStep, type ExperienceEpisode } from "../episodes/schema";

// ESM package ("type": "module"): no __dirname.
const DIR = fileURLToPath(new URL("../episodes/", import.meta.url));
const episodes: ExperienceEpisode[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => assertEpisode(JSON.parse(readFileSync(join(DIR, f), "utf8")), f));

function toRegex(v: string | RegExp | undefined): RegExp | undefined {
  if (v === undefined) return undefined;
  if (v instanceof RegExp) return v;
  const m = /^\/(.+)\/([a-z]*)$/.exec(v);
  return m ? new RegExp(m[1], m[2]) : new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

async function runStep(page: Page, s: EpisodeStep): Promise<void> {
  const target = s.selector ? page.locator(s.selector).first() : page.getByRole(s.role as never, { name: toRegex(s.name) }).first();
  switch (s.action) {
    case "click":
      await target.click();
      return;
    case "fill":
      await target.fill(s.value ?? "");
      return;
    case "press":
      await page.keyboard.press(s.value ?? "Enter");
      return;
    case "scroll_to":
      await target.scrollIntoViewIfNeeded();
      return;
  }
}

// Only the project whose viewport matches the episode's runs it; episodes
// name their own device because the failures they encode were device-specific.
for (const ep of episodes) {
  test(`${ep.id} · ${ep.task}`, async ({ page }, info) => {
    const vp = info.project.use.viewport;
    test.skip(!vp || vp.width !== ep.viewport.width, `episode is for ${ep.viewport.width}px, project is ${vp?.width}px`);

    const started = Date.now();
    const failure: Record<string, unknown> = { id: ep.id, version: ep.version, startedAt: new Date(started).toISOString(), baseURL: info.project.use.baseURL };
    try {
      await page.goto(ep.startPath, { waitUntil: "domcontentloaded" });
      let taps = 0;
      for (const s of ep.steps) {
        if (s.action === "click") taps++;
        await runStep(page, s);
      }
      expect(taps, "tap budget").toBeLessThanOrEqual(ep.budget.taps);

      // `.filter({ visible: true })` before `.first()`: a prerendered page can
      // carry the same words in a hidden node ahead of the visible one, and
      // "first match is hidden" must not read as "the customer cannot see it".
      for (const t of ep.success.visibleText ?? []) {
        await expect(page.getByText(toRegex(t)!).filter({ visible: true }).first(), `visible text: ${t}`).toBeVisible({ timeout: 10_000 });
      }
      if (ep.success.urlMatches) await expect(page).toHaveURL(toRegex(ep.success.urlMatches)!);
      for (const r of ep.success.visibleRole ?? []) {
        await expect(page.getByRole(r.role as never, { name: toRegex(r.name) }).filter({ visible: true }).first(), `visible ${r.role} ${r.name ?? ""}`).toBeVisible({ timeout: 10_000 });
      }
      const elapsed = Date.now() - started;
      expect(elapsed, "time budget").toBeLessThanOrEqual(ep.budget.ms);
    } catch (err) {
      failure.error = err instanceof Error ? err.message : String(err);
      failure.elapsedMs = Date.now() - started;
      failure.finalUrl = page.url();
      mkdirSync("test-results/episodes", { recursive: true });
      writeFileSync(`test-results/episodes/${ep.id}.failure.json`, JSON.stringify(failure, null, 2));
      throw err;
    }
  });
}

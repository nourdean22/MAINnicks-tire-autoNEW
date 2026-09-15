#!/usr/bin/env node
/**
 * Unpack the hidden holdout (2026-09-15).
 *
 * HOLDOUT_EPISODES_B64 is a GitHub secret: base64 of a JSON array of
 * ExperienceEpisode objects whose ids are HO-xxx. This writes one
 * <id>.json per episode into HOLDOUT_OUT_DIR (the runner's temp dir — never
 * the checkout, never an artifact) and prints ONLY the count. The runner
 * validates each episode on load (tests/episodes/schema.ts assertEpisode);
 * the one rule enforced here is the id prefix, so a visible EP-xxx file can
 * never masquerade as a holdout and titles never collide.
 *
 * Without the secret: prints "no secret", writes count=0, exits 0 — the
 * evidence poster then records the holdout as UNMEASURED.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOLDOUT_ID = /^HO-\d{3,}$/;

function output(count) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `count=${count}\n`);
}

const b64 = process.env.HOLDOUT_EPISODES_B64?.trim();
const outDir = process.env.HOLDOUT_OUT_DIR;
if (!b64) {
  console.log("holdout: no secret — the holdout is unmeasured this run");
  output(0);
  process.exit(0);
}
if (!outDir) {
  console.log("holdout: HOLDOUT_OUT_DIR not set");
  output(0);
  process.exit(2);
}

let episodes;
try {
  episodes = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
} catch {
  console.log("holdout: secret is not base64 JSON");
  output(0);
  process.exit(2);
}
if (!Array.isArray(episodes) || episodes.length === 0) {
  console.log("holdout: secret holds no episodes");
  output(0);
  process.exit(2);
}
const bad = episodes.filter((e) => !e || !HOLDOUT_ID.test(String(e.id)));
if (bad.length) {
  console.log(`holdout: ${bad.length} episode(s) without an HO-xxx id — refused`);
  output(0);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
for (const ep of episodes) writeFileSync(join(outDir, `${ep.id}.json`), JSON.stringify(ep, null, 2));
console.log(`holdout: ${episodes.length} episode(s) unpacked`);
output(episodes.length);

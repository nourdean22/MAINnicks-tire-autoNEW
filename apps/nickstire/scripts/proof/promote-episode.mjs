#!/usr/bin/env node
/**
 * Failure-to-Test compiler — turn an episode FAILURE (or a described real
 * customer miss) into a new, versioned ExperienceEpisode.
 *
 *   node scripts/proof/promote-episode.mjs --from test-results/episodes/EP-003.failure.json
 *   node scripts/proof/promote-episode.mjs --task "..." --path /tires --width 390 --height 844 \
 *        --origin real_customer --text "installed" --role "heading:/find your tires/i"
 *
 * The output is a JSON file in tests/episodes/ with the next free id. It is a
 * PROPOSAL: the steps are empty and the oracle is whatever was given, so the
 * human refines it before it counts. This script never edits an existing
 * episode — an episode that changed silently is not scar tissue, it is a
 * moved goalpost.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(APP, "tests", "episodes");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
    return acc;
  }, []),
);

function nextId() {
  const ids = readdirSync(DIR)
    .map((f) => /^EP-(\d+)/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number);
  return `EP-${String((ids.length ? Math.max(...ids) : 0) + 1).padStart(3, "0")}`;
}

let episode;
if (args.from) {
  const failure = JSON.parse(readFileSync(args.from, "utf8"));
  const originalFile = readdirSync(DIR).find((f) => f.startsWith(`${failure.id}-`));
  const original = originalFile ? JSON.parse(readFileSync(join(DIR, originalFile), "utf8")) : null;
  episode = {
    id: nextId(),
    version: 1,
    origin: "production_incident",
    triggeringEvents: [`episode ${failure.id} v${failure.version} failed at ${failure.startedAt}: ${failure.error}`],
    task: original ? `${original.task} (regression seen ${failure.startedAt?.slice(0, 10)})` : "Describe the customer's goal here.",
    startPath: original?.startPath ?? new URL(failure.finalUrl ?? "https://nickstire.org/").pathname,
    viewport: original?.viewport ?? { width: 390, height: 844 },
    budget: original?.budget ?? { taps: 0, ms: 15000 },
    steps: original?.steps ?? [],
    success: original?.success ?? { visibleText: [] },
    guardrails: original?.guardrails ?? [],
  };
} else {
  if (!args.task || !args.path) {
    console.error("usage: --from <failure.json> | --task <text> --path </route> [--width 390 --height 844] [--origin real_customer] [--text <regex>]... [--role role:/name/]");
    process.exit(2);
  }
  const texts = [].concat(args.text ?? []).filter((t) => t !== "true");
  const roles = [].concat(args.role ?? []).filter((r) => r !== "true").map((r) => {
    const [role, ...rest] = r.split(":");
    return { role, name: rest.join(":") || undefined };
  });
  episode = {
    id: nextId(),
    version: 1,
    origin: args.origin ?? "real_customer",
    triggeringEvents: [],
    task: args.task,
    startPath: args.path,
    viewport: { width: Number(args.width ?? 390), height: Number(args.height ?? 844) },
    budget: { taps: Number(args.taps ?? 0), ms: Number(args.ms ?? 15000) },
    steps: [],
    success: { ...(texts.length ? { visibleText: texts } : {}), ...(roles.length ? { visibleRole: roles } : {}) },
    guardrails: [],
  };
}

const slug = episode.task.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const file = join(DIR, `${episode.id}-${slug}.json`);
if (existsSync(file)) {
  console.error(`refusing to overwrite ${file}`);
  process.exit(1);
}
writeFileSync(file, `${JSON.stringify(episode, null, 2)}\n`);
console.log(`wrote ${file} — refine the steps + oracle, then it counts.`);

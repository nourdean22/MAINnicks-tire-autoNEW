/**
 * Hourly office digest (contract office-digest v1), served by lot.officeDigest.
 *
 * Built ONLY from each hour's gists and validated fact kind/value pairs, never from transcripts,
 * so it inherits the extractor's coverage and evidence gates (services/conversationFacts.ts).
 * No table, no cron: an in-process memo keeps the 60 s admin poll from re-calling the LLM.
 *
 * Memo rules, per clock hour:
 * - inputs unchanged                      -> reuse (a completed hour is computed once)
 * - inputs changed, completed hour        -> recompute
 * - inputs changed, current hour          -> recompute at most once per 10 minutes
 * - last result FAILED                    -> retry at most once per 5 minutes
 * - a compute already in flight           -> every caller shares that one promise
 * The key hashes the episode ids AND their gist/fact input, so a gist the extractor writes after
 * the episode first appeared still counts as a change.
 *
 * Logs carry counts and statuses only; gist, fact and digest text is customer speech.
 */
import { createHash } from "node:crypto";

import { invokeLLM, type JsonSchema } from "../_core/llm";
import { createLogger } from "../lib/logger";
import { stripFence } from "./conversationFacts";

const log = createLogger("services:officeDigest");

export const CURRENT_HOUR_REFRESH_MS = 10 * 60_000;
export const FAILED_RETRY_MS = 5 * 60_000;
const MEMO_KEEP_MS = 13 * 3_600_000;

export type DigestEpisode = { episodeId: string; gist: string | null; facts: Array<{ kind: string; value: string }> };
export type HourDigest = { status: "DONE" | "FAILED"; digest: string | null; topics: string[]; error: string | null };

type Entry = { key: string; startedAtMs: number; promise: Promise<HourDigest>; result: HourDigest | null };
const memo = new Map<number, Entry>();

export function __resetOfficeDigestMemo(): void {
  memo.clear();
}

const SYSTEM = [
  "You summarise one hour of notes from the front counter of a tire and auto repair shop.",
  "Each note is either a one-line gist of a conversation or an extracted fact (KIND: value).",
  "Use ONLY what the notes say. Do not invent names, prices, times, vehicles, promises or outcomes,",
  "and do not guess at anything the notes do not cover. If the notes are thin, say less.",
  "digest: 2 to 4 plain sentences. topics: at most 5 short tags (1 to 3 words) taken from the notes.",
  'Return JSON only: {"digest": string, "topics": string[]}.',
].join(" ");

const OUTPUT_SCHEMA: JsonSchema = {
  name: "office_hour_digest",
  strict: false,
  schema: {
    type: "object",
    properties: {
      digest: { type: "string" },
      topics: { type: "array", items: { type: "string" } },
    },
    required: ["digest", "topics"],
  },
};

function failed(error: string): HourDigest {
  return { status: "FAILED", digest: null, topics: [], error };
}

async function generate(hourStartMs: number, episodes: DigestEpisode[]): Promise<HourDigest> {
  const lines = episodes.flatMap((e) => [
    ...(e.gist ? [`- gist: ${e.gist.slice(0, 300)}`] : []),
    ...e.facts.map((f) => `- ${f.kind}: ${f.value.slice(0, 200)}`),
  ]);
  const started = Date.now();
  let parsed: { digest?: unknown; topics?: unknown };
  try {
    const res = await invokeLLM({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Notes for this hour:\n${lines.join("\n")}` },
      ],
      outputSchema: OUTPUT_SCHEMA,
      temperature: 0,
      timeoutMs: 45_000,
    });
    const content = res.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    if (!text.trim()) return failed("digest output unusable");
    parsed = (JSON.parse(stripFence(text)) ?? {}) as typeof parsed;
  } catch (err) {
    // Fixed strings only: a provider error can echo the prompt, which is customer speech.
    const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
    const error = /timeout|timed out|abort/i.test(msg) ? "digest timed out"
      : err instanceof SyntaxError ? "digest output unusable"
      : "digest call failed";
    log.info("office hour digest failed", { hourStartMs, error, inputLines: lines.length, latencyMs: Date.now() - started });
    return failed(error);
  }

  const digest = typeof parsed.digest === "string" ? parsed.digest.trim().slice(0, 800) : "";
  if (!digest) {
    log.info("office hour digest failed", { hourStartMs, error: "digest output unusable", inputLines: lines.length });
    return failed("digest output unusable");
  }
  const topics = (Array.isArray(parsed.topics) ? parsed.topics : [])
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().slice(0, 40))
    .slice(0, 5);
  log.info("office hour digest done", { hourStartMs, inputLines: lines.length, topics: topics.length, latencyMs: Date.now() - started });
  return { status: "DONE", digest, topics, error: null };
}

/**
 * The digest for one clock hour that has at least one gist or fact (the caller decides
 * NO_ACTIVITY / THIN without an LLM call). Never rejects.
 */
export function officeHourDigest(hourStartMs: number, isCurrent: boolean, episodes: DigestEpisode[]): Promise<HourDigest> {
  const now = Date.now();
  // Pruned against the hour the database clock produced, not Date.now(): the two clocks differ.
  for (const [h] of memo) if (h < hourStartMs - MEMO_KEEP_MS) memo.delete(h);

  const key = createHash("sha1")
    .update(JSON.stringify([...episodes].sort((a, b) => a.episodeId.localeCompare(b.episodeId))))
    .digest("hex");
  const prev = memo.get(hourStartMs);
  if (prev) {
    if (!prev.result) return prev.promise;
    const age = now - prev.startedAtMs;
    if (prev.result.status === "FAILED" ? age < FAILED_RETRY_MS
      : prev.key === key || (isCurrent && age < CURRENT_HOUR_REFRESH_MS)) return prev.promise;
  }

  const entry = { key, startedAtMs: now, result: null } as Entry;
  entry.promise = generate(hourStartMs, episodes)
    .catch(() => failed("digest call failed"))
    .then((r) => { entry.result = r; return r; });
  memo.set(hourStartMs, entry);
  return entry.promise;
}

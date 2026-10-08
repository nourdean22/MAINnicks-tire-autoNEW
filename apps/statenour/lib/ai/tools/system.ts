/**
 * System tools — files + research + device dispatch.
 *
 * Includes: github* · drive* · arsenal{Research,WebSearch,...} ·
 * searchDocuments · searchWebVerified ·
 * runDeviceCommand.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import {
  getExternalWorkerJob,
  getExternalWorkerLaneSnapshots,
  getExternalWorkerLanes,
  queueExternalWorker,
} from "@/lib/workers/external-worker";
import { EXTERNAL_WORKER_LANE_IDS } from "@/lib/workers/contracts";

// moneyprinter rewrites the shared MoneyPrinterTurbo config.toml before each
// run while a prior 7-minute subprocess may still be reading it — one run at
// a time, or an overlapping write corrupts the in-flight job's credentials.
let moneyprinterInFlight = false;

// Tavily primary cap (2026-09-23). askTavily is guardian-wrapped at 25s x 2
// retries; an interactive chat turn cannot afford that on its FIRST rung, so
// the primary attempt is capped and a miss falls through to the next rung.
// Tavily answers in ~2s when healthy, so 8s (the quorum's per-source budget)
// only ever cuts off a source that is already failing.
const TAVILY_PRIMARY_MS = 8_000;

/**
 * Pull the rendered video paths out of MoneyPrinterTurbo's CLI output.
 *
 * cli.py ends with a single JSON line — `{"task_id": ..., "result": {...}}` —
 * and the render paths live at `result.videos` (app/services/task.py:465).
 * Everything before it is loguru progress noise, so scan from the END for the
 * last parseable JSON object rather than trying to match log lines.
 *
 * Exported for tests: this is a parser over another project's output format,
 * which is exactly the kind of contract that breaks silently on an upgrade.
 */
export function parseMoneyprinterResult(stdout: string): { taskId: string | null; videoPaths: string[] } {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as {
        task_id?: unknown;
        result?: { videos?: unknown } | null;
      };
      const videos = parsed?.result?.videos;
      const paths = Array.isArray(videos)
        ? videos.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];
      const taskId = typeof parsed?.task_id === "string" ? parsed.task_id : null;
      if (taskId || paths.length) return { taskId, videoPaths: paths };
    } catch {
      // Not the result line — keep scanning backwards.
    }
  }
  return { taskId: null, videoPaths: [] };
}

// arsenalNotebookLM is whitelisted for the deep-reasoning engine, whose
// contract is OBSERVE-only. The MCP sidecar may expose mutating tools, so the
// LLM-supplied action must pass this code-level read-only allowlist — the
// tool description alone is not an enforcement mechanism.
const READ_ONLY_NOTEBOOKLM_ACTIONS = new Set(["ask_question", "list_notebooks", "get_health"]);

export const systemTools = {
  getExternalWorkerLanes: tool({
    description:
      "Read the live NOUR external-worker plane: Codex, Claude Code, Antigravity, and the local Qwen gateway. Reports measured runner freshness, auth/health/quota state, and cost class. No worker is executed.",
    inputSchema: z.object({}),
    execute: async () => {
      const [snapshot, lanes] = await Promise.all([
        getExternalWorkerLaneSnapshots(),
        getExternalWorkerLanes(),
      ]);
      return {
        ...snapshot,
        lanes: lanes.map((lane) => ({
          id: lane.id,
          provider: lane.provider,
          model: lane.model ?? null,
          capabilities: lane.capabilities,
          health: lane.health,
          quota: lane.quota,
          authClass: lane.authClass,
          costClass: lane.costClass,
          priority: lane.priority,
        })),
      };
    },
  }),

  queueExternalWorkerJob: tool({
    description:
      "Queue a bounded coding/reasoning job onto NOUR's existing durable local-worker queue. AUTO routes only across subscription-included or local-free lanes and never silently uses metered API billing. Read-only is the default. Workspace writes require an explicit allowWorkspaceWrite=true AND a separate local worker write-policy switch.",
    inputSchema: z.object({
      prompt: z.string().min(5).max(20_000),
      capability: z
        .enum([
          "supervisor",
          "deep_reasoner",
          "coder",
          "large_context",
          "multimodal",
          "cheap_local",
          "embed",
          "rerank",
          "ocr",
          "voice",
        ])
        .default("coder"),
      mode: z.enum(["FREE", "AUTO", "MAX"]).default("AUTO"),
      preferredLane: z.enum(EXTERNAL_WORKER_LANE_IDS).optional(),
      workspaceKey: z
        .string()
        .regex(/^[a-z0-9][a-z0-9_-]*$/)
        .default("repo"),
      allowWorkspaceWrite: z.boolean().default(false),
      idempotencyKey: z.string().min(1).max(160).optional(),
    }),
    execute: async (input) =>
      queueExternalWorker({ ...input, requestedBy: "nick" }),
  }),

  getExternalWorkerJob: tool({
    description:
      "Read one previously queued NOUR external-worker job, including durable queue status, bounded result payload, error state, and Reality Ledger phase receipts.",
    inputSchema: z.object({
      jobId: z.string().min(1).max(100),
    }),
    execute: async ({ jobId }) => {
      const job = await getExternalWorkerJob(jobId);
      return job ?? { error: "external_worker_job_not_found", jobId };
    },
  }),

  runDeviceCommand: tool({
    description:
      "Queue a smart-home command to a physical device (lights, locks, cameras, thermostats). Use when Nour says things like 'lock the front door', 'turn off the shop lights', 'take a snapshot'. Identify the device by name OR location + type — Nick resolves to the closest match.",
    inputSchema: z.object({
      deviceId: z
        .string()
        .optional()
        .describe("Preferred — the SmartDevice.id if Nick already has it."),
      nameQuery: z
        .string()
        .optional()
        .describe(
          "Fuzzy match against SmartDevice.name (case-insensitive). 'front door' → matches 'Front Door Lock'."
        ),
      locationQuery: z
        .string()
        .optional()
        .describe(
          "Fuzzy match against SmartDevice.location. 'shop' → matches 'shop', 'home-shop', etc."
        ),
      deviceType: z
        .string()
        .optional()
        .describe(
          "Narrow by type: LIGHT, LOCK, CAMERA, THERMOSTAT, SPEAKER, HEATER, APPLIANCE. Combines with locationQuery."
        ),
      command: z
        .string()
        .describe(
          "Verb — turn_on | turn_off | toggle | lock | unlock | snapshot | record | arm | disarm | siren_on | siren_off | set_temp | set_brightness | speak."
        ),
      params: z
        .record(z.string(), z.any())
        .optional()
        .describe("Optional. E.g. { brightness: 70 } or { celsius: 22 } or { text: 'you forgot your keys' }."),
    }),
    execute: async ({ deviceId, nameQuery, locationQuery, deviceType, command, params }) => {
      // Resolve the device
      let target: {
        id: string;
        name: string;
        platform: string;
        status: string;
        location: string | null;
        deviceType: string;
      } | null = null;

      if (deviceId) {
        target = await prisma.smartDevice.findUnique({
          where: { id: deviceId },
          select: { id: true, name: true, platform: true, status: true, location: true, deviceType: true },
        });
      }

      if (!target && (nameQuery || locationQuery || deviceType)) {
        const where: Record<string, unknown> = {};
        if (nameQuery) where.name = { contains: nameQuery, mode: "insensitive" };
        if (locationQuery) where.location = { contains: locationQuery, mode: "insensitive" };
        if (deviceType) where.deviceType = deviceType.toUpperCase();

        const candidates = await prisma.smartDevice.findMany({
          where,
          orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
          take: 3,
          select: { id: true, name: true, platform: true, status: true, location: true, deviceType: true },
        });

        if (candidates.length === 0) {
          return {
            success: false,
            reason: "device not found",
            hint: "No device matched that name/location. Ask Nour to clarify or check /devices for exact names.",
          };
        }
        if (candidates.length > 1) {
          return {
            success: false,
            reason: "ambiguous",
            matches: candidates.map((c) => ({
              id: c.id,
              name: c.name,
              location: c.location,
              deviceType: c.deviceType,
              platform: c.platform,
            })),
            hint: "More than one device matched. Ask Nour which one, or re-run with a more specific nameQuery.",
          };
        }
        target = candidates[0];
      }

      if (!target) {
        return {
          success: false,
          reason: "no device specified",
          hint: "Provide deviceId OR nameQuery OR locationQuery+deviceType.",
        };
      }

      if (target.status === "OFFLINE") {
        return {
          success: false,
          reason: "device offline",
          device: { id: target.id, name: target.name, location: target.location },
          hint: "Device shows OFFLINE in the registry. Command NOT enqueued — would pile up in the queue.",
        };
      }

      // Enqueue
      const row = await prisma.deviceCommand.create({
        data: {
          deviceId: target.id,
          command,
          params: params ? (params as any) : undefined,
          status: "pending",
        },
        select: { id: true, status: true, createdAt: true },
      });

      return {
        success: true,
        commandId: row.id,
        command,
        device: {
          id: target.id,
          name: target.name,
          platform: target.platform,
          location: target.location,
          deviceType: target.deviceType,
        },
        note: "Agent polls every 20s. Nick can check status via /api/devices/command/" + row.id + ".",
      };
    },
  }),

  // v10.0.75 · closeLoop + createLoop legacy aliases retired.
  // The Apr 18 OpenLoop→Task rename kept both old (loop) and new (task)
  // tool names exposed. That doubled Nick's tool catalog and confused
  // his selection: he sometimes called createLoop when createTask was
  // canonical, splitting telemetry. Canonical replacements:
  //   closeLoop   → completeTask
  //   createLoop  → createTask

  searchDocuments: tool({
    description:
      "Search across documents the operator has uploaded (PDFs, Word docs, spreadsheets, text files). Returns the top matching chunks with their source filename and a similarity score. Use when the operator references 'that PDF', 'the spreadsheet', or asks a question that likely answers from an uploaded document.",
    inputSchema: z.object({
      query: z
        .string()
        .min(2)
        .max(500)
        .describe("The natural-language question or topic to search for."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("How many top chunks to return. Default 5."),
    }),
    execute: async ({ query, limit }) => {
      const { searchDocuments } = await import("@/lib/services/document-ingest");
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
      const hits = await searchDocuments(query, limit ?? 5);
      return {
        ok: true,
        count: hits.length,
        // v10.0.529.5 E-3 fix · fence document chunks. This is the
        // PRIMARY injection vector — an operator-uploaded PDF
        // containing "ignore prior instructions" attacks would bleed
        // into the next model step without this wrap.
        results: hits.map((h) => ({
          filename: h.filename,
          chunkIndex: h.chunkIndex,
          similarity: Number(h.similarity.toFixed(3)),
          text: fenceContent("searchDocuments", "external_doc", h.text),
        })),
      };
    },
  }),

  // v10.0.515 · #10 Document Q&A · ingest from URL when operator
  // shares a link to a public document. Bypasses the multipart
  // upload endpoint for direct-URL convenience.
  ingestDocumentFromUrl: tool({
    description:
      "Fetch a public document from a URL and ingest it into the operator's document index. Returns the documentId and a chunk count. Use when the operator says 'read this PDF' / 'index this doc' and shares a link. Supports PDF, DOCX, XLSX, TXT, MD. Max 20MB.",
    inputSchema: z.object({
      url: z
        .string()
        .url()
        .describe("Direct download URL for the document."),
      filename: z
        .string()
        .optional()
        .describe("Optional override for the stored filename. Defaults to the URL path."),
    }),
    execute: async ({ url, filename }) => {
      try {
        // v10.0.529.4 D-2 fix · daily quota guard. Each call fetches
        // an arbitrary URL + parses + embeds → real paid cost on
        // both Venice + Neon. Default cap 50/day (operator typically
        // uses 2-5/day · 10x headroom triggers only on prompt-injection
        // abuse).
        const { checkAndIncrementToolQuota } = await import("@/lib/ai/tool-quota");
        const quota = await checkAndIncrementToolQuota("ingestDocumentFromUrl");
        if (!quota.ok) {
          return {
            ok: false,
            code: "quota_exceeded",
            error: `ingestDocumentFromUrl daily quota exhausted (${quota.count}/${quota.cap}). Resets at ${quota.resetAt}.`,
          };
        }

        // v10.0.525 security fix · T-1 SSRF defense (CVSS 8.6).
        // Audit found this tool reachable via prompt-injection in
        // documents Nick reads · pivot into AWS/GCP metadata or
        // internal services on RFC-1918 ranges. Gate via DNS-
        // resolution + private-IP block + manual redirect walk.
        const { assertPublicUrl, isAllowedDocumentContentType, publicOnlyDispatcher, connectBlockedReason } =
          await import("@/lib/utils/url-safety");

        // Walk redirects manually so external→internal redirects
        // can't bypass the gate. Cap chain at 5 hops.
        let currentUrl = url;
        let res: Response | null = null;
        const seen = new Set<string>();
        for (let hop = 0; hop < 5; hop++) {
          const safety = await assertPublicUrl(currentUrl);
          if (!safety.safe) {
            return {
              ok: false,
              code: "url_blocked",
              error: `URL safety check failed: ${safety.reason}`,
              resolvedHost: safety.resolvedHost,
              resolvedIp: safety.resolvedIp,
            };
          }
          if (seen.has(currentUrl)) {
            return { ok: false, code: "redirect_loop", error: "Redirect loop detected" };
          }
          seen.add(currentUrl);

          // Q-14: the pinned dispatcher re-checks the address it dials, so a
          // name that re-resolves private after the check above is refused.
          try {
            res = await fetch(currentUrl, { redirect: "manual", dispatcher: publicOnlyDispatcher() } as RequestInit);
          } catch (err) {
            const blocked = connectBlockedReason(err);
            if (blocked) {
              return { ok: false, code: "url_blocked", error: `URL safety check failed: ${blocked}` };
            }
            throw err;
          }
          if (res.status >= 300 && res.status < 400) {
            const next = res.headers.get("location");
            if (!next) {
              return { ok: false, code: "redirect_no_location", error: "Redirect missing Location header" };
            }
            // Resolve relative URLs against current.
            currentUrl = new URL(next, currentUrl).toString();
            continue;
          }
          break;
        }
        if (!res) {
          return { ok: false, code: "no_response", error: "No response after redirect walk" };
        }
        if (!res.ok) {
          return { ok: false, code: "http_error", error: `HTTP ${res.status} fetching ${currentUrl}` };
        }

        // Content-type allow-list · block HTML/JS/etc.
        const contentTypeHeader = res.headers.get("content-type");
        if (!isAllowedDocumentContentType(contentTypeHeader)) {
          return {
            ok: false,
            code: "content_type_blocked",
            error: `Content-type not allowed: ${contentTypeHeader ?? "(missing)"}`,
          };
        }

        const contentLength = parseInt(res.headers.get("content-length") ?? "0", 10);
        if (Number.isFinite(contentLength) && contentLength > 20 * 1024 * 1024) {
          return { ok: false, code: "too_large", error: "Document larger than 20MB · skip" };
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 20 * 1024 * 1024) {
          return { ok: false, code: "too_large_actual", error: "Document larger than 20MB · skip" };
        }
        const mediaType = contentTypeHeader?.split(";")[0] ?? undefined;
        const derivedName =
          filename ?? new URL(currentUrl).pathname.split("/").pop() ?? `doc-${Date.now()}`;

        const { ingestDocument } = await import("@/lib/services/document-ingest");
        const result = await ingestDocument({
          buffer: buf,
          filename: derivedName,
          mediaType,
        });
        // v10.0.529.5 E-3 note · the text content from this fetch is
        // never inlined here · `ingestDocument` writes chunks to the
        // vector store and surfaces them later via searchDocuments,
        // which IS fenced. No additional fence needed at this layer.
        return { ok: true, ...result };
      } catch (err) {
        const { sanitizeError } = await import("@/lib/utils/sanitize-error");
        return {
          ok: false,
          error: sanitizeError(err),
        };
      }
    },
  }),

  // v10.0.515 · #3 Code sandbox · Python execution via E2B.
  // Operator sets E2B_API_KEY (free 100 runs/day) and Nick can run
  // calculations, plot data, parse text, regress numbers. Replaces
  // "describing" with "doing" for any quantitative question.
  searchWebVerified: tool({
    description:
      "Cross-verified web search across multiple sources (Perplexity + Tavily + Exa + Google Grounding). Returns consensus when sources agree, or flags the disagreement when they diverge. Use for factual claims where being wrong matters: news, statistics, recent events, technical specs. Confidence ≥0.66 means 2+ sources agree. Prefer this over single-source web search when the operator's question is verifiable.",
    inputSchema: z.object({
      query: z
        .string()
        .min(3)
        .max(500)
        .describe("The natural-language question or claim to verify."),
      sources: z
        .array(z.enum(["perplexity", "tavily", "exa", "google"]))
        .optional()
        .describe(
          "Restrict to these sources. Default: all configured sources.",
        ),
      domains: z
        .array(z.string())
        .max(20)
        .optional()
        .describe("Allowed domains for sources that support filtering."),
      recency: z
        .enum(["day", "week", "month", "year", "any"])
        .optional()
        .describe("Time bound for results. Default any."),
    }),
    execute: async ({ query, sources, domains, recency }) => {
      const { multiSourceSearch } = await import("@/lib/ai/multi-search");
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
      const res = await multiSourceSearch(query, {
        sources,
        domains: domains ? { allow: domains } : undefined,
        recency: recency === "any" ? undefined : recency,
      });
      // v10.0.529.5 E-3 fix · fence external-web content. The per-
      // source `content` strings come straight from Perplexity / Tavily
      // / Exa response bodies — prime prompt-injection vectors. The
      // `consensus` is derived from those same bodies and gets fenced
      // too. Citations stay unfenced (they're structured URLs · the
      // model needs them clean to render markdown links).
      return {
        ...res,
        consensus: res.consensus
          ? fenceContent("searchWebVerified", "external_web", res.consensus)
          : null,
        sources: res.sources.map((s) => ({
          ...s,
          content: fenceContent("searchWebVerified", "external_web", s.content),
        })),
      };
    },
  }),

  // v10.0.515 · #10 Document Q&A · search ingested documents by
  // semantic similarity. Operator uploads via /api/ai/chat/documents;
  // Nick retrieves with this tool when a question references a known
  // document or when a doc is freshly uploaded in the same turn.
  searchBuildYourOwnX: tool({
    description:
      "Search the Build Your Own X tutorial catalog (450+ curated step-by-step guides for re-creating canonical technologies from scratch — programming languages, databases, blockchains, web servers, neural networks, etc). Use when Nour asks 'how do I build a X', 'show me tutorials for Y', 'where do I learn Z'. Returns a list of {title, language, url, category}. Browse the full catalog at /learn.",
    inputSchema: z.object({
      topic: z
        .string()
        .min(2)
        .max(80)
        .optional()
        .describe(
          "Topic / category / title keywords. e.g. 'database', 'lisp', 'neural network', 'docker'.",
        ),
      language: z
        .string()
        .min(1)
        .max(20)
        .optional()
        .describe(
          "Filter by programming language (case-insensitive substring). e.g. 'python', 'rust', 'go'.",
        ),
      limit: z.number().min(1).max(20).default(8),
    }),
    execute: async ({ topic, language, limit }) => {
      const { searchTutorials } = await import("@/lib/learn/build-your-own-x");
      const results = searchTutorials({ topic, language, limit });
      return {
        count: results.length,
        results: results.map((t) => ({
          title: t.title,
          language: t.language,
          url: t.url,
          category: t.category,
          videoOnly: t.videoOnly,
        })),
        browseAt: "https://bdnick.info/learn",
      };
    },
  }),

  arsenalResearch: tool({
    description: "Use Grok (xAI) for real-time analysis and research. Powered by the Arsenal integration chain.",
    inputSchema: z.object({
      query: z.string().describe("Research question or topic to analyze"),
    }),
    execute: async ({ query }) => {
      const { analyzeRealTime } = await import("@/lib/integrations/grok");
      const result = await analyzeRealTime(query);
      // forensic-audit MEDIUM · fence external web content (prompt-injection).
      // The arsenal* tools returned raw Grok/Perplexity/Google text unfenced
      // while every sibling web tool fences it, so injected instructions in a
      // page reached the next model step without the <tool_data> guard.
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
      return { content: fenceContent("arsenalResearch", "external_web", result?.content?.slice(0, 2000) ?? ""), model: "grok", source: "arsenal" };
    },
  }),

  arsenalWebSearch: tool({
    description: "Web search with AI summarization. Tries Tavily first; falls back to Perplexity/Google, then to the multi-source quorum if those are unavailable. Powered by the Arsenal integration chain.",
    inputSchema: z.object({
      query: z.string().describe("Web search query"),
    }),
    execute: async ({ query }) => {
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
      const fence = (s: string | undefined) =>
        fenceContent("arsenalWebSearch", "external_web", (s ?? "").slice(0, 2000));

      // Primary · one source at a time: Tavily (fastest healthy source, ~2s)
      // → Perplexity (if keyed) → Google grounding. Wrapped so a single dead
      // source — revoked key, timeout, retired model — degrades to the
      // multi-source quorum instead of throwing (which the model would
      // otherwise surface as a confident failure claim).
      //
      // 2026-09-23 · the two self-hosted search-sidecar rungs that used to sit
      // ahead of Tavily are gone. Neither answered a single search in
      // production (0 healthy responses / 0 completed searches, then a
      // JSON-parse error on every request — docs/CURRENT-TRUTH.md), so every
      // search paid their timeouts before reaching a source that works.
      try {
        if (process.env.TAVILY_API_KEY) {
          const { askTavily } = await import("@/lib/integrations/tavily");
          // `.catch` logs the reason and keeps the losing promise from
          // surfacing as an unhandled rejection after the race resolves.
          const r = await Promise.race([
            askTavily(query).catch(async (err) => {
              const { logger } = await import("@/lib/logger");
              logger
                .withSurface("ai/tools/arsenalWebSearch")
                .warn("tavily_primary_error", {
                  error: String((err as { message?: string })?.message ?? err).slice(0, 240),
                });
              return null;
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), TAVILY_PRIMARY_MS)),
          ]);
          if (r?.content?.trim()) {
            // 2026-07-05 improvement · attribute web claims. Each source returns
            // { url, title? }[]; forward them unfenced (URLs are metadata, not
            // model-followable instructions) so the message can render pills.
            return { content: fence(r.content), citations: r.citations ?? [], model: r.model, source: "arsenal/tavily" };
          }
        }

        if (process.env.PERPLEXITY_API_KEY) {
          const { researchTopic } = await import("@/lib/integrations/perplexity");
          const r = await researchTopic(query);
          if (r?.content?.trim()) {
            return { content: fence(r.content), citations: r.citations ?? [], model: "perplexity", source: "arsenal" };
          }
        } else {
          const { askGoogleSearch } = await import("@/lib/integrations/google-search");
          const r = await askGoogleSearch(query);
          if (r?.content?.trim()) {
            return { content: fence(r.content), citations: r.citations ?? [], model: r.model, source: "google" };
          }
        }
      } catch (err) {
        const { logger } = await import("@/lib/logger");
        logger
          .withSurface("ai/tools/arsenalWebSearch")
          .warn("primary_source_failed_falling_back_to_quorum", {
            error: String((err as { message?: string })?.message ?? err).slice(0, 200),
          });
      }

      // Fallback · multi-source quorum (Promise.allSettled · never throws on
      // partial failure). Keeps "search on X" alive when the primary is down;
      // surfaces an honest all-sources-failed note rather than an empty result.
      // Tavily stays IN the quorum even after a primary miss: it is the one
      // source production reliably has (CURRENT-TRUTH), so the quorum doubles
      // as its retry. Unkeyed sources are skipped internally by hasApiKey.
      const { multiSourceSearch } = await import("@/lib/ai/multi-search");
      const q = await multiSourceSearch(query);
      const body =
        q.consensus?.trim() ||
        q.sources.map((s) => `${s.name}: ${s.content}`).join("\n\n").trim() ||
        q.disagreement ||
        "Web search returned no results from any source.";
      // 2026-07-15 · total-failure observability: a no-content result
      // used to count as tool SUCCESS, hiding backend outages from
      // /system/chat-health while the model told the operator "web
      // search unavailable". Best-effort, never blocks the return.
      if (!q.consensus?.trim() && q.sources.length === 0) {
        void import("@/lib/errors/record-error")
          .then(({ recordError }) =>
            recordError("ai:tool-exec", new Error("arsenalWebSearch: all sources returned nothing"), {
              disagreement: q.disagreement?.slice(0, 200) ?? null,
            }),
          )
          .catch(() => {});
      }
      return { content: fence(body), citations: q.citations ?? [], model: "multi-source", source: "arsenal/fallback" };
    },
  }),

  // v10.0.379 · Gmail inbox triage
  arsenalMultiAgent: tool({
    // v10.0.529.93 · Wave 37 · description trimmed · routing + cost
    // guidance lives in system-prompt.ts RESEARCH TOOL SELECTION block
    // (~lines 722-728) · was duplicated here verbatim every turn.
    description: "Spawn N parallel sub-agents + synthesize. Max 8. Staff sub-agents with persona keys: research-analyst, contrarian-critic, execution-planner, thought-partner, strategist, tactician, business-consultant, ghostwriter.",
    inputSchema: z.object({
      goal: z.string().describe("The overall operator goal · seen by every sub-agent as context"),
      subAgents: z.array(
        z.object({
          name: z.string().describe("Stable name for this sub-agent · e.g. 'pricing_analysis' or 'review_themes'"),
          task: z.string().describe("Specific task for this sub-agent · 1-2 sentences · ≤800 chars"),
          outputHint: z.string().optional().describe("Optional output-shape hint · e.g. 'bulleted list' or 'JSON with {a,b,c}'"),
          // AG-12 · unlocks the typed persona library for model-initiated
          // runs — runMultiAgent already accepted SubAgentTask.persona
          // (unknown keys warn + fall back to the generic prompt), but the
          // schema never exposed it, so 30+ registered personas were
          // unreachable from chat.
          persona: z.string().optional().describe("Optional persona key from the typed library · e.g. 'research-analyst', 'contrarian-critic', 'thought-partner', 'tactician', 'business-consultant', 'ghostwriter'"),
        }),
      ).describe("Array of sub-agent task assignments · max 8"),
    }),
    execute: async ({ goal, subAgents }) => {
      const { runMultiAgent } = await import("@/lib/ai/multi-agent-orchestrator");
      const report = await runMultiAgent({ goal, subAgents });
      return {
        agentCount: report.results.length,
        synthesis: report.synthesis.slice(0, 4000),
        results: report.results.map((r) => ({
          name: r.name,
          output: r.output.slice(0, 800),
          failed: r.failed ?? false,
        })),
        costEstimateUsd: report.costEstimateUsd,
        totalDurationMs: report.totalDurationMs,
        source: "arsenal/multi-agent",
      };
    },
  }),

  // AG-13 · Advisory-board council as a chat tool. The board engine
  // (5 preset multi-lens boards · parallel advisors · divergence-
  // preserving synthesis · persisted consultations) was previously
  // reachable ONLY from the /brain Board tab UI — Nick could never say
  // "let me convene the invest board." Read-only side effects: persists
  // one BrainMemory consultation record.
  arsenalBoardConsult: tool({
    description: "Convene an advisor board (parallel multi-lens council) on a major decision. Boards: strategic, invest, product, operator, full, team (the in-house working team: thought partner, researcher, strategist, tactician, consultant).",
    inputSchema: z.object({
      boardId: z.enum(["strategic", "invest", "product", "operator", "full", "team"]).describe("Which preset board to convene"),
      question: z.string().min(8).describe("The decision or question to put before the board"),
    }),
    execute: async ({ boardId, question }) => {
      const { consultBoardAndPersist } = await import("@/lib/services/board-consult-record");
      const { consultation, recordId } = await consultBoardAndPersist(boardId, question);
      return {
        board: consultation.boardName,
        consensus: consultation.synthesis.consensus,
        tension: consultation.synthesis.tension ?? null,
        recommendation: consultation.synthesis.recommendation,
        confidence: consultation.synthesis.confidence,
        takes: consultation.takes.map((t) => ({
          advisor: t.advisorName,
          take: t.recommendation.slice(0, 300),
          confidence: t.confidence,
        })),
        recordId,
        source: "arsenal/board-consult",
      };
    },
  }),

  // AG-34 · async research: queue and go. The in-session
  // arsenalDeepResearch below holds the stream open for 10-15s+ of
  // searches; this one returns instantly and the cited synthesis
  // arrives as a push (~2 min). Prefer it when the operator doesn't
  // need the answer inside THIS reply.
  queueDeepResearch: tool({
    description:
      "Queue deep research to run in the background — returns immediately; the cited report arrives as a push notification in ~2 minutes. Use when the operator says 'go research X' / 'look into X and get back to me' and doesn't need the answer in this reply.",
    inputSchema: z.object({
      question: z.string().min(8).describe("The research question to investigate"),
    }),
    execute: async ({ question }) => {
      const { getInngest } = await import("@/lib/inngest/client");
      await getInngest().send({
        name: "research/on-demand",
        data: { question, deliverTo: "push" },
      });
      return {
        queued: true,
        note: "Research queued — a push notification with the cited report arrives in ~2 minutes.",
        source: "arsenal/queue-research",
      };
    },
  }),

  // v10.0.373 · multi-round autonomous research with citations
  arsenalDeepResearch: tool({
    // v10.0.529.93 · Wave 37 · description trimmed · see arsenalMultiAgent note.
    description: "Multi-round autonomous research with citations.",
    inputSchema: z.object({
      question: z.string().describe("The research question to investigate"),
    }),
    execute: async ({ question }) => {
      const { runDeepResearch } = await import("@/lib/ai/deep-research");
      const report = await runDeepResearch({ question });
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
      return {
        plan: report.plan,
        roundCount: report.rounds.length,
        // forensic-audit MEDIUM · fence the web-derived synthesis (injection).
        synthesis: fenceContent("arsenalDeepResearch", "external_web", report.synthesis.slice(0, 4000)),
        // "synth_failed" = the searches worked and only the write-up failed:
        // say so instead of reporting "no results".
        synthesisStatus: report.synthesisStatus,
        citations: report.allCitations.slice(0, 20),
        durationMs: report.durationMs,
        source: "arsenal/deep-research",
      };
    },
  }),

  // v10.0.372 · pre-task multi-lens fan-out (research + risk + plan)
  arsenalPreTaskFanout: tool({
    // v10.0.529.93 · Wave 37 · description trimmed · see arsenalMultiAgent note.
    description: "Pre-task 3-lens fan-out (research+risk+plan).",
    inputSchema: z.object({
      question: z.string().describe("The hard question to fan out on"),
      brainContext: z.string().optional().describe("Optional brain context to ground the lenses"),
    }),
    execute: async ({ question, brainContext }) => {
      const { runFanout } = await import("@/lib/ai/pretask-fanout");
      const fanout = await runFanout({ question, brainContext });
      return {
        research: fanout.research.slice(0, 1000),
        risk: fanout.risk.slice(0, 1000),
        plan: fanout.plan.slice(0, 1000),
        composite: fanout.composite.slice(0, 3000),
        durationMs: fanout.durationMs,
        source: "arsenal/pretask-fanout",
      };
    },
  }),

  arsenalFindLeads: tool({
    description: "Use Apollo.io to find fleet/business contacts in Cleveland area. Powered by the Arsenal integration chain.",
    inputSchema: z.object({
      titles: z.array(z.string()).optional().describe("Job titles to search for, e.g. ['Fleet Manager', 'Operations Director']"),
      locations: z.array(z.string()).default(["Cleveland", "Ohio"]),
      industries: z.array(z.string()).optional(),
      limit: z.number().default(10),
    }),
    execute: async ({ titles, locations, industries, limit }) => {
      const { searchFleetContacts } = await import("@/lib/integrations/apollo");
      const result = await searchFleetContacts({ titles, locations, industries, limit });
      return {
        count: result?.contacts?.length ?? 0,
        contacts: result?.contacts?.slice(0, 10).map((c: any) => ({
          name: `${c.firstName} ${c.lastName}`,
          title: c.title,
          company: c.company,
          email: c.email,
          phone: c.phone,
        })),
        source: "arsenal/apollo",
      };
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // NOTEBOOKLM — Google Grounding Engine
  // ═══════════════════════════════════════════════════════════

  arsenalNotebookLM: tool({
    description: "Use Google NotebookLM via the connected MCP server. Allows deep grounding against custom uploaded source documents. Use 'notebookAlias' to route to specialized Memory Vaults.",
    inputSchema: z.object({
      action: z.string().describe("The NotebookLM MCP tool to call (e.g., 'ask_question', 'list_notebooks')"),
      notebookAlias: z.enum(["statenour-intel", "competitor-research", "financial-models"]).optional().describe("Target a specific memory vault. If provided, the system will inject the correct notebook_id."),
      params: z.record(z.string(), z.unknown()).optional().describe("Arguments for the MCP tool"),
    }),
    execute: async ({ action, notebookAlias, params }) => {
      if (!READ_ONLY_NOTEBOOKLM_ACTIONS.has(action)) {
        return {
          action,
          error: `Action "${action}" is not in the read-only allowlist (${[...READ_ONLY_NOTEBOOKLM_ACTIONS].join(", ")}). NotebookLM may only be observed, never mutated, from this tool.`,
        };
      }
      const { notebookLMProvider } = await import("@/lib/intelligence/search/notebooklm-mcp");
      const result = await notebookLMProvider.call(action, params, notebookAlias);
      // 2026-09-10 · FENCE THE MCP RESULT.
      //
      // This returned raw third-party text from an external MCP server
      // while every sibling external tool in this file
      // (searchDocuments, searchWebVerified, arsenalResearch...) fences
      // its output. Two consequences, and the second is the serious one:
      //
      //  1. unfenced external text reached the model context directly;
      //  2. fenceContent is what calls updateTurnContext({
      //     untrustedInput: true }) (tool-result-fencing.ts:91). Without
      //     it the TURN was never marked untrusted -- so the U4 sink
      //     policy (tool-policy.ts:183: external side effect during an
      //     untrusted turn -> require_owner) never engaged for content
      //     from this server. An injected "send this to X" arriving via
      //     NotebookLM would have faced one fewer deterministic gate
      //     than the identical string arriving via web search.
      //
      // Slicing still happens, and BEFORE fencing, so the fence markers
      // can never be truncated away mid-tag.
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
      const sliced =
        typeof result.results === "string" ? result.results.slice(0, 4000) : result.results;
      return {
        action,
        result:
          typeof sliced === "string"
            ? fenceContent("notebookLM", "external_doc", sliced)
            : sliced === undefined || sliced === null
              ? sliced
              // Non-string payloads are serialized so they are fenced
              // too -- an object's string fields are just as capable of
              // carrying an instruction as a bare string.
              : fenceContent("notebookLM", "external_doc", JSON.stringify(sliced).slice(0, 4000)),
        error: result.error,
      };
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // GITHUB — Read/write code, create PRs, manage repos
  // ═══════════════════════════════════════════════════════════

  githubReadFile: tool({
    description: "Read a file from any of Nour's GitHub repos. Use to inspect code, configs, or data files.",
    inputSchema: z.object({
      repo: z.string().describe("Repo name: statenour-os, MAINnicks-tire-autoNEW, easy-nickstire"),
      path: z.string().describe("File path in the repo (e.g., 'lib/ai/tools.ts', 'package.json')"),
      branch: z.string().optional().describe("Branch name (default: main)"),
    }),
    execute: async ({ repo, path, branch }) => {
      const { getFileContent } = await import("@/lib/integrations/github");
      try {
        const { content, sha } = await getFileContent(repo, path, branch);
        // Truncate large files
        return { content: content.length > 8000 ? content.slice(0, 8000) + "\n...[truncated]" : content, sha, path, repo };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  }),

  githubListFiles: tool({
    description: "List files in a directory of a GitHub repo. Use to explore repo structure.",
    inputSchema: z.object({
      repo: z.string().describe("Repo name"),
      path: z.string().optional().describe("Directory path (empty = root)"),
      branch: z.string().optional(),
    }),
    execute: async ({ repo, path, branch }) => {
      const { listFiles } = await import("@/lib/integrations/github");
      try {
        const files = await listFiles(repo, path || "", branch);
        return { files: files.map(f => ({ name: f.name, type: f.type, size: f.size })), count: files.length };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  }),

  githubSearchCode: tool({
    description: "Search for code across a GitHub repo. Use to find functions, variables, patterns.",
    inputSchema: z.object({
      repo: z.string().describe("Repo name"),
      query: z.string().describe("Search query (code, function name, variable, etc.)"),
    }),
    execute: async ({ repo, query }) => {
      const { searchCode } = await import("@/lib/integrations/github");
      try {
        return await searchCode(repo, query);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  }),

  githubRecentCommits: tool({
    description: "Get recent commits from a repo. Use to see what changed recently.",
    inputSchema: z.object({
      repo: z.string().describe("Repo name"),
      branch: z.string().optional(),
      count: z.number().min(1).max(20).optional(),
    }),
    execute: async ({ repo, branch, count }) => {
      const { getRecentCommits } = await import("@/lib/integrations/github");
      try {
        return await getRecentCommits(repo, branch, count || 5);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  }),

  githubCreatePR: tool({
    description: "Create a pull request on a GitHub repo. Use after pushing changes to a branch.",
    inputSchema: z.object({
      repo: z.string().describe("Repo name"),
      title: z.string().describe("PR title"),
      body: z.string().describe("PR description"),
      head: z.string().describe("Source branch with changes"),
      base: z.string().optional().describe("Target branch (default: main)"),
    }),
    execute: async ({ repo, title, body, head, base }) => {
      const { createPullRequest } = await import("@/lib/integrations/github");
      try {
        return await createPullRequest(repo, title, body, head, base);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  }),

  githubCreateIssue: tool({
    description: "Create a GitHub issue for tracking bugs, features, or tasks.",
    inputSchema: z.object({
      repo: z.string().describe("Repo name"),
      title: z.string().describe("Issue title"),
      body: z.string().describe("Issue description"),
      labels: z.array(z.string()).optional(),
    }),
    execute: async ({ repo, title, body, labels }) => {
      const { createIssue } = await import("@/lib/integrations/github");
      try {
        return await createIssue(repo, title, body, labels);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  }),

  githubListRepos: tool({
    description: "List Nour's GitHub repos sorted by most recently updated.",
    inputSchema: z.object({}),
    execute: async () => {
      const { listRepos } = await import("@/lib/integrations/github");
      try {
        return await listRepos();
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  }),

  githubReadMultiple: tool({
    description: "Read multiple files at once from a repo. Use to understand a full feature — read the route, the service, the component, and the types together. Much faster than reading one at a time.",
    inputSchema: z.object({
      repo: z.string().describe("Repo name"),
      paths: z.array(z.string()).describe("Array of file paths to read"),
      branch: z.string().optional(),
    }),
    execute: async ({ repo, paths, branch }) => {
      const { readMultipleFiles } = await import("@/lib/integrations/github");
      try {
        const files = await readMultipleFiles(repo, paths, branch);
        return { files: files.map(f => ({ path: f.path, lines: f.content.split("\n").length, preview: f.content.slice(0, 500), error: f.error })) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  }),

  getRepoMap: tool({
    description: "Get the key file paths and architecture of a repo. Use when you need to understand where things are before making changes. Returns the project structure map.",
    inputSchema: z.object({
      repo: z.enum(["statenour", "nickstire"]).describe("Which repo"),
    }),
    execute: async ({ repo }) => {
      const { REPO_CONFIG } = await import("@/lib/integrations/github");
      const config = repo === "statenour" ? REPO_CONFIG.statenour : REPO_CONFIG.nickstire;
      return {
        name: config.name,
        branch: config.branch,
        stack: config.stack,
        keyPaths: config.keyPaths,
      };
    },
  }),

  searchDriveFiles: tool({
    description: "Search Nour's Google Drive for files by name, content, or type. Use this when Nour says 'find my notes', 'check my drive', 'look up that document', etc.",
    inputSchema: z.object({
      query: z.string().describe("Search query — file name, content keyword, or type"),
    }),
    execute: async ({ query }) => {
      // Use Google Drive API via service account (same as knowledge loader)
      try {
        const { google } = await import("googleapis");
        const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        if (!credentials) return { error: "Google Drive not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY." };

        const auth = new google.auth.GoogleAuth({
          credentials: JSON.parse(credentials),
          scopes: ["https://www.googleapis.com/auth/drive.readonly"],
        });

        const drive = google.drive({ version: "v3", auth });
        const res = await drive.files.list({
          q: `fullText contains '${query.replace(/'/g, "\\'")}'`,
          pageSize: 10,
          fields: "files(id, name, mimeType, modifiedTime, webViewLink, size)",
          orderBy: "modifiedTime desc",
        });

        return {
          files: res.data.files || [],
          count: res.data.files?.length || 0,
          query,
        };
      } catch (err) {
        return { error: `Drive search failed: ${err instanceof Error ? err.message : "unknown"}`, query };
      }
    },
  }),

  readDriveFile: tool({
    description: "Read the content of a Google Drive document by file ID. Use after searchDriveFiles to read a specific file. Works with Google Docs, Sheets, and text files.",
    inputSchema: z.object({
      fileId: z.string().describe("Google Drive file ID"),
      mimeType: z.string().optional().describe("File MIME type (auto-detected if not provided)"),
    }),
    execute: async ({ fileId, mimeType }) => {
      try {
        const { google } = await import("googleapis");
        const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        if (!credentials) return { error: "Google Drive not configured." };

        const auth = new google.auth.GoogleAuth({
          credentials: JSON.parse(credentials),
          scopes: ["https://www.googleapis.com/auth/drive.readonly"],
        });

        const drive = google.drive({ version: "v3", auth });

        // Get file metadata first
        const meta = await drive.files.get({
          fileId,
          fields: "name, mimeType, size",
        });

        const fileMime = mimeType || meta.data.mimeType || "";

        // Google Docs — export as plain text
        if (fileMime.includes("google-apps.document")) {
          const exported = await drive.files.export({
            fileId,
            mimeType: "text/plain",
          });
          return {
            name: meta.data.name,
            content: String(exported.data).slice(0, 10000),
            truncated: String(exported.data).length > 10000,
          };
        }

        // Google Sheets — export as CSV
        if (fileMime.includes("google-apps.spreadsheet")) {
          const exported = await drive.files.export({
            fileId,
            mimeType: "text/csv",
          });
          return {
            name: meta.data.name,
            content: String(exported.data).slice(0, 10000),
            format: "csv",
            truncated: String(exported.data).length > 10000,
          };
        }

        // Plain text / markdown files — download directly
        if (fileMime.includes("text/") || fileMime.includes("json") || fileMime.includes("markdown")) {
          const downloaded = await drive.files.get(
            { fileId, alt: "media" },
            { responseType: "text" }
          );
          return {
            name: meta.data.name,
            content: String(downloaded.data).slice(0, 10000),
            truncated: String(downloaded.data).length > 10000,
          };
        }

        return {
          name: meta.data.name,
          mimeType: fileMime,
          error: `Can't read this file type (${fileMime}). Supported: Google Docs, Sheets, text/markdown files.`,
        };
      } catch (err) {
        return { error: `File read failed: ${err instanceof Error ? err.message : "unknown"}` };
      }
    },
  }),

  listRecentDriveFiles: tool({
    description: "List recently modified files in Nour's Google Drive. Use when he says 'what files have I been working on' or 'show me recent docs'.",
    inputSchema: z.object({
      limit: z.number().min(1).max(20).default(10).describe("How many files to show"),
    }),
    execute: async ({ limit }) => {
      try {
        const { google } = await import("googleapis");
        const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        if (!credentials) return { error: "Google Drive not configured." };

        const auth = new google.auth.GoogleAuth({
          credentials: JSON.parse(credentials),
          scopes: ["https://www.googleapis.com/auth/drive.readonly"],
        });

        const drive = google.drive({ version: "v3", auth });
        const res = await drive.files.list({
          pageSize: limit,
          fields: "files(id, name, mimeType, modifiedTime, webViewLink)",
          orderBy: "modifiedTime desc",
        });

        return {
          files: res.data.files || [],
          count: res.data.files?.length || 0,
        };
      } catch (err) {
        return { error: `Drive list failed: ${err instanceof Error ? err.message : "unknown"}` };
      }
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // BRAIN INTELLIGENCE — Direct access to brain engine outputs
  // ═══════════════════════════════════════════════════════════

  // v10.0.530 · Firecrawl web scraper · converts any URL into
  // clean LLM-ready markdown. Use when operator shares a link
  // and Nick needs to read + understand the page content.
  scrapeWebPage: tool({
    description:
      "Scrape a web page and convert it to clean markdown. Use when the operator shares a URL and says 'read this', 'what does this page say', 'summarize this link', or when Nick needs to understand the content of a specific web page. Returns the page content as markdown with title and description. Requires FIRECRAWL_API_KEY — returns a clear error if not configured.",
    inputSchema: z.object({
      url: z
        .string()
        .url()
        .describe("The URL to scrape and convert to markdown."),
      waitFor: z
        .number()
        .int()
        .min(0)
        .max(15000)
        .optional()
        .describe(
          "Wait time in ms for JS-heavy pages to render. Default 0. Use 3000-5000 for SPAs.",
        ),
      excludeTags: z
        .array(z.string())
        .optional()
        .describe(
          "CSS selectors to exclude from output. e.g. ['nav', 'footer', '.ads'].",
        ),
    }),
    execute: async ({ url, waitFor, excludeTags }) => {
      try {
        const { isFirecrawlConfigured, scrapeUrl } = await import(
          "@/lib/integrations/firecrawl"
        );

        if (!isFirecrawlConfigured()) {
          return {
            ok: false,
            code: "missing_api_key",
            error:
              "FIRECRAWL_API_KEY not set. Get a key at https://firecrawl.dev and add it to .env to enable web scraping.",
          };
        }

        // SSRF defense — block private/internal URLs
        const { assertPublicUrl } = await import("@/lib/utils/url-safety");
        const safety = await assertPublicUrl(url);
        if (!safety.safe) {
          return {
            ok: false,
            code: "url_blocked",
            error: `URL safety check failed: ${safety.reason}`,
          };
        }

        const result = await scrapeUrl(url, {
          waitFor,
          excludeTags,
          maxLength: 8000,
        });

        // Fence the scraped content for prompt-injection safety
        const { fenceContent } = await import("@/lib/ai/tool-result-fencing");

        return {
          ok: true,
          title: result.title,
          description: result.description,
          sourceUrl: result.sourceUrl,
          charCount: result.charCount,
          content: fenceContent(
            "scrapeWebPage",
            "external_web",
            result.markdown,
          ),
        };
      } catch (err) {
        const { sanitizeError } = await import("@/lib/utils/sanitize-error");
        return {
          ok: false,
          error: sanitizeError(err),
        };
      }
    },
  }),

  getTopDecisions: tool({
    description:
      "Read the shop's top revenue decisions from the nickstire opportunity queue — the same due-aware, consent-filtered, SQL-ranked top-5 the admin Decision Inbox shows. READ-ONLY. Use when the operator asks 'what should I decide', 'what's in the inbox', 'top opportunities', or before recommending any revenue action.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const { queryNick } = await import("@/lib/nickstire/query");
        const res = await queryNick<{
          decisions?: Array<Record<string, unknown>>;
          totalLive?: number;
          excludedNoConsent?: number;
          excludedSnoozed?: number;
        }>("top_decisions");
        if ("error" in res) {
          return { ok: false, error: res.error };
        }
        // 2026-10-02 · the `decision_surface` ledger row this used to write
        // (S4 producer #2) is gone by operator decision (outcome-ledger census
        // E6): the decision itself is made in nickstire's Decision Inbox, a
        // different app and database, so the row could never be decided or
        // closed here — one permanently-undecided row per surfacing.
        return { ok: true, ...res.data };
      } catch (err) {
        const { sanitizeError } = await import("@/lib/utils/sanitize-error");
        return { ok: false, error: sanitizeError(err) };
      }
    },
  }),

  getFleetTruth: tool({
    description:
      "Read the cross-app operational fleet truth: statenour capability artifacts (daily brief, outbox drain, Inngest heartbeat — fresh/stale/never_produced/unknown with ages) plus nickstire's live health, database, schema-guard and self-healing verdicts. READ-ONLY. Use when the operator asks 'is everything running', 'system status', 'are the crons alive', or before claiming any scheduled capability works.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const { getFleetTruth } = await import("@/lib/observability/fleet-truth");
        return { ok: true, ...(await getFleetTruth()) };
      } catch (err) {
        const { sanitizeError } = await import("@/lib/utils/sanitize-error");
        return { ok: false, error: sanitizeError(err) };
      }
    },
  }),

  fetchVideoTranscript: tool({
    description:
      "Fetch the English transcript + metadata (title, channel, duration) of a YouTube video via the policy-guarded yt-dlp lane. Use for 'summarize this video', 'what does this video say', competitor/industry video research. Allowlisted hosts only (youtube.com/youtu.be), 60-min cap, never downloads media. The transcript is UNTRUSTED third-party content and is returned fenced.",
    inputSchema: z.object({
      url: z.string().url().describe("The YouTube video URL (youtube.com or youtu.be, https)."),
    }),
    execute: async ({ url }) => {
      try {
        const { fetchVideoTranscript } = await import("@/lib/integrations/ytdlp");
        const result = await fetchVideoTranscript(url);
        if (!result.available) {
          return { ok: false, code: "unavailable", error: result.reason, title: result.title ?? null };
        }
        // Fence — auto-captions of arbitrary videos are a textbook
        // injection channel (same treatment as scraped web pages).
        const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
        return {
          ok: true,
          title: result.title,
          channel: result.channel,
          durationS: result.durationS,
          transcriptSource: result.transcriptSource,
          transcript: fenceContent("fetchVideoTranscript", "external_web", result.transcript ?? ""),
        };
      } catch (err) {
        const { sanitizeError } = await import("@/lib/utils/sanitize-error");
        return { ok: false, error: sanitizeError(err) };
      }
    },
  }),

  last30days: tool({
    description:
      "Search and research a topic across live social platforms (Reddit, Hacker News, Polymarket, GitHub, YouTube) and grounded web results from the last 30 days. Returns a raw data report with community comments and source coverage. Use this for queries about recent trends, public consensus, sentiment, product comparison, or tracking what individuals/companies are doing recently. The tool returns a raw structured report; you MUST synthesize it into a clean, markdown-formatted narrative with blue command-clickable links on first mention per the returned instructions. Do not dump the raw clusters.",
    inputSchema: z.object({
      topic: z
        .string()
        .min(1)
        .max(100)
        .describe("The research topic or search query."),
      quick: z
        .boolean()
        .optional()
        .describe("Lower-latency retrieval profile."),
      deep: z
        .boolean()
        .optional()
        .describe("Higher-recall retrieval profile."),
      xHandle: z
        .string()
        .optional()
        .describe("Optional target X handle for a person/product."),
      githubUser: z
        .string()
        .optional()
        .describe("Optional target GitHub username for person-mode."),
      subreddits: z
        .string()
        .optional()
        .describe("Comma-separated broad/category subreddit names to search."),
      deepResearch: z
        .boolean()
        .optional()
        .describe("Use Perplexity Deep Research (requires API key setup, spendy)."),
    }),
    execute: async ({ topic, quick, deep, xHandle, githubUser, subreddits, deepResearch }) => {
      try {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFilePromise = promisify(execFile);
        const path = await import("path");
        const fs = await import("fs");

        let scriptPath = path.join(process.cwd(), "apps/statenour/lib/ai/last30days/scripts/last30days.py");
        if (!fs.existsSync(scriptPath)) {
          scriptPath = path.join(process.cwd(), "lib/ai/last30days/scripts/last30days.py");
        }

        if (!fs.existsSync(scriptPath)) {
          return {
            ok: false,
            error: "last30days engine script not found on system.",
          };
        }

        const args = [scriptPath, topic, "--emit=compact"];
        if (quick) args.push("--quick");
        if (deep) args.push("--deep");
        if (xHandle) args.push(`--x-handle=${xHandle}`);
        if (githubUser) args.push(`--github-user=${githubUser}`);
        if (subreddits) args.push(`--subreddits=${subreddits}`);
        if (deepResearch) args.push("--deep-research");

        // Forward environment variables needed by the script
        const env = {
          ...process.env,
          // Force no-browser-cookies for safe headless execution in production
          FROM_BROWSER: "off",
        };

        const pythonCmd = process.platform === "win32" ? "python" : "python3";
        // forensic-audit HIGH · last30days fans out across Reddit/HN/GitHub/
        // YouTube/Polymarket with 30s-per-request timeouts; the engine's own
        // SKILL.md documents typical 5-min runs, so 60s SIGTERM'd nearly every
        // real invocation. Match the documented runtime + raise maxBuffer so a
        // large multi-platform digest doesn't overflow the 1MB default.
        // (Called inside the chat SSE stream, which stays open for the run.)
        const { stdout, stderr } = await execFilePromise(pythonCmd, args, { env, timeout: 300000, maxBuffer: 10 * 1024 * 1024 });

        const { fenceContent } = await import("@/lib/ai/tool-result-fencing");

        return {
          ok: true,
          stdout: stdout ? fenceContent("last30days", "external_web", stdout) : stdout,
          stderr: stderr ? fenceContent("last30days", "external_web", stderr) : stderr,
        };
      } catch (err) {
        const { sanitizeError } = await import("@/lib/utils/sanitize-error");
        return {
          ok: false,
          error: sanitizeError(err),
        };
      }
    },
  }),

  moneyprinter: tool({
    description:
      "Generate high-definition short videos automatically from a subject topic or a custom script. Uses MoneyPrinterTurbo to write the video script, select royalty-free B-roll clips, synthesize voice narration (Azure edge_tts), and render subtitle overlays. Returns a success status with the generated video filepath. Use when Nour asks to create a video, generate a TikTok/Reel, write and synthesize B-roll, or output a short video on a topic.",
    inputSchema: z.object({
      subject: z
        .string()
        .min(1)
        .max(100)
        .describe("The main topic/keyword of the video. E.g., 'Why exercise is important'."),
      script: z
        .string()
        .optional()
        .describe("Optional custom video script text. By default, script is auto-generated by AI."),
      aspect: z
        .enum(["9:16", "16:9"])
        .optional()
        .describe("Video aspect ratio: 9:16 (portrait, default) or 16:9 (landscape)."),
      language: z
        .string()
        .optional()
        .describe("Video script/voice language code (e.g. 'en', 'zh'). Defaults to auto-detect."),
      paragraphCount: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Optional paragraph count for script segments. Default: 3."),
    }),
    execute: async ({ subject, script, aspect, language, paragraphCount }) => {
      if (moneyprinterInFlight) {
        return {
          ok: false,
          error:
            "A video generation is already running (renders take up to 7 minutes). Wait for it to finish, then retry.",
        };
      }
      moneyprinterInFlight = true;
      try {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFilePromise = promisify(execFile);
        const path = await import("path");
        const fs = await import("fs");

        let rootDir = path.join(process.cwd(), "apps/statenour/lib/ai/moneyprinter");
        let scriptPath = path.join(rootDir, "cli.py");
        if (!fs.existsSync(scriptPath)) {
          rootDir = path.join(process.cwd(), "lib/ai/moneyprinter");
          scriptPath = path.join(rootDir, "cli.py");
        }

        if (!fs.existsSync(scriptPath)) {
          return {
            ok: false,
            error: "MoneyPrinterTurbo engine script not found on system.",
          };
        }

        // Dynamically inject process.env keys into config.toml
        const configPath = path.join(rootDir, "config.toml");
        const examplePath = path.join(rootDir, "config.example.toml");
        
        let configContent = "";
        if (fs.existsSync(configPath)) {
          configContent = fs.readFileSync(configPath, "utf-8");
        } else if (fs.existsSync(examplePath)) {
          configContent = fs.readFileSync(examplePath, "utf-8");
        }

        if (configContent) {
          let updatedContent = configContent;
          // forensic-audit MEDIUM · match ANY current value, not just the empty
          // string / literal default. The old regexes only replaced
          // `openai_api_key = ""`, so once the first run baked a key into the
          // persisted config.toml a rotated OPENAI_API_KEY never propagated;
          // and the base-URL regex required the literal api.openai.com default,
          // silently discarding OPENAI_BASE_URL on every run.
          if (process.env.OPENAI_API_KEY) {
            updatedContent = updatedContent.replace(/openai_api_key\s*=\s*"[^"]*"/, `openai_api_key = "${process.env.OPENAI_API_KEY}"`);
          }
          if (process.env.OPENAI_BASE_URL) {
            updatedContent = updatedContent.replace(/openai_base_url\s*=\s*"[^"]*"/, `openai_base_url = "${process.env.OPENAI_BASE_URL}"`);
          }
          if (process.env.PEXELS_API_KEY) {
            updatedContent = updatedContent.replace(/pexels_api_keys\s*=\s*\[\]/, `pexels_api_keys = ["${process.env.PEXELS_API_KEY}"]`);
          }
          if (process.env.PIXABAY_API_KEY) {
            updatedContent = updatedContent.replace(/pixabay_api_keys\s*=\s*\[\]/, `pixabay_api_keys = ["${process.env.PIXABAY_API_KEY}"]`);
          }
          // Atomic replace: the python subprocess reads config.toml at startup —
          // a plain writeFileSync can be observed half-written by a reader.
          const tmpConfigPath = `${configPath}.tmp`;
          fs.writeFileSync(tmpConfigPath, updatedContent, "utf-8");
          fs.renameSync(tmpConfigPath, configPath);
        }

        const args = [scriptPath, "--video-subject", subject];
        if (script) {
          args.push("--video-script", script);
        }
        if (aspect) {
          args.push("--video-aspect", aspect);
        }
        if (language) {
          args.push("--video-language", language);
        }
        if (paragraphCount) {
          args.push("--paragraph-number", String(paragraphCount));
        }

        // Forward environment variables
        const env = {
          ...process.env,
        };

        const pythonCmd = process.platform === "win32" ? "python" : "python3";
        // forensic-audit HIGH · the moneyprinter pipeline (LLM script → TTS →
        // multi-MB Pexels B-roll → 1080p ffmpeg render) routinely exceeds 3
        // min on Railway's shared CPU, so 180s SIGTERM'd mid-encode and the
        // default 1MB maxBuffer overflowed on verbose ffmpeg stdio. Raise both.
        // (A background/async job is the ideal long-term shape; this is the
        // surgical fix so the tool stops failing on every attempt.)
        const { stdout, stderr } = await execFilePromise(pythonCmd, args, { env, timeout: 420000, maxBuffer: 10 * 1024 * 1024 });

        // The description has always promised "the generated video filepath"
        // and the tool has never returned one — callers got raw stdout and had
        // to guess. cli.py's LAST line is
        // `{"task_id": "...", "result": {..., "videos": ["<abs>/final-1.mp4"]}}`
        // (moneyprinter cli.py run_cli / app/services/task.py:465), so parse it
        // rather than scraping log text.
        const { taskId, videoPaths } = parseMoneyprinterResult(stdout);
        if (videoPaths.length === 0) {
          // A render that produced no file is a FAILURE, not a success with an
          // empty list — returning ok:true here is what let "video generated"
          // reach Nour with nothing behind it.
          return {
            ok: false,
            error: "MoneyPrinterTurbo finished without emitting a video path — check stderr for the failing stage.",
            taskId,
            stdout: stdout.slice(-2000),
            stderr: stderr.slice(-2000),
          };
        }

        return {
          ok: true,
          taskId,
          /** Absolute path(s) on THIS machine. Ingest into nickstire inventory
           *  with its mp4Ingest service rather than posting from here. */
          videoPaths,
          videoPath: videoPaths[0],
          stderr: stderr.slice(-2000),
        };
      } catch (err) {
        const { sanitizeError } = await import("@/lib/utils/sanitize-error");
        return {
          ok: false,
          error: sanitizeError(err),
        };
      } finally {
        moneyprinterInFlight = false;
      }
    },
  }),

};

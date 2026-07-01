/**
 * System tools — files + research + device dispatch.
 *
 * Includes: github* · drive* · arsenal{Research,WebSearch,...} ·
 * searchDocuments · searchWebVerified · searchSessionRecordings ·
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

export const systemTools = {
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
        const { assertPublicUrl, isAllowedDocumentContentType } =
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

          res = await fetch(currentUrl, { redirect: "manual" });
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

  searchSessionRecordings: tool({
    description:
      "Search across the operator's captured session recordings (their own chat + computer-use sessions). Returns up to 5 hits with sessionId, videoId, timestamp (seconds), snippet, and similarity. Use when the operator says 'what did I see on screen', 'from that recording', 'in that session', 'recall from video', or 'earlier on screen'. If VIDEO_DB_API_KEY is missing, returns code='missing_api_key' · surface that to the operator instead of pretending to search.",
    inputSchema: z.object({
      query: z
        .string()
        .min(2)
        .max(500)
        .describe("Natural-language query · what to find in the recordings."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("How many top hits to return. Default 5."),
    }),
    execute: async ({ query, limit }) => {
      const { prisma } = await import("@/lib/prisma");
      const { searchVideo, isError } = await import(
        "@/lib/integrations/videodb"
      );
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");

      const sessions = await prisma.brainMemory.findMany({
        where: { category: "videodb_session", deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { key: true, metadata: true, createdAt: true, content: true },
      });

      if (sessions.length === 0) {
        return { ok: true, count: 0, hits: [], hint: "no sessions captured yet" };
      }

      type Hit = {
        sessionId: string;
        videoId: string;
        capturedAt: string;
        timestamp: number;
        snippet: string;
        similarity: number;
        title: string;
      };
      const allHits: Hit[] = [];
      let missingKey = false;

      await Promise.all(
        sessions.map(async (s) => {
          const meta = (s.metadata ?? {}) as { videoId?: string };
          if (!meta.videoId) return;
          const res = await searchVideo(meta.videoId, query, {
            indexType: "semantic",
            limit: 3,
          });
          if (isError(res)) {
            if (res.code === "missing_api_key") missingKey = true;
            return;
          }
          for (const h of res.hits) {
            allHits.push({
              sessionId: s.key,
              videoId: meta.videoId,
              capturedAt: s.createdAt.toISOString(),
              timestamp: h.start,
              snippet: fenceContent("searchSessionRecordings", "external_doc", h.snippet.slice(0, 400)),
              similarity: Number(h.similarity.toFixed(3)),
              title: s.content,
            });
          }
        }),
      );

      if (missingKey && allHits.length === 0) {
        return {
          ok: false,
          code: "missing_api_key",
          error:
            "VIDEO_DB_API_KEY not set. Sign up at https://console.videodb.io and add the key to env to enable session-recording search.",
        };
      }

      allHits.sort((a, b) => b.similarity - a.similarity);
      const top = allHits.slice(0, limit ?? 5);
      return { ok: true, count: top.length, hits: top };
    },
  }),

  recallFromSession: tool({
    description:
      "Search the operator's captured session recordings within a date range. Same as searchSessionRecordings but constrained to sessions captured between {sinceDate, untilDate}. Use when the operator says 'in last week's session', 'yesterday on screen', 'show me what I saw on Tuesday', or any recall question with a time window. Dates are ISO YYYY-MM-DD. If VIDEO_DB_API_KEY is missing, returns code='missing_api_key'.",
    inputSchema: z.object({
      query: z.string().min(2).max(500).describe("What to find."),
      sinceDate: z
        .string()
        .describe(
          "Earliest capture date (YYYY-MM-DD). Inclusive. Use today() - 7 if the operator says 'this week'.",
        ),
      untilDate: z
        .string()
        .optional()
        .describe("Latest capture date (YYYY-MM-DD). Inclusive. Defaults to today."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("How many hits. Default 5."),
    }),
    execute: async ({ query, sinceDate, untilDate, limit }) => {
      const { prisma } = await import("@/lib/prisma");
      const { searchVideo, isError } = await import(
        "@/lib/integrations/videodb"
      );
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");

      const since = new Date(`${sinceDate}T00:00:00Z`);
      const until = untilDate
        ? new Date(`${untilDate}T23:59:59Z`)
        : new Date();
      if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
        return {
          ok: false,
          error: "invalid date · use YYYY-MM-DD",
        };
      }

      const sessions = await prisma.brainMemory.findMany({
        where: {
          category: "videodb_session",
          deletedAt: null,
          createdAt: { gte: since, lte: until },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { key: true, metadata: true, createdAt: true, content: true },
      });

      if (sessions.length === 0) {
        return {
          ok: true,
          count: 0,
          hits: [],
          hint: `no sessions captured between ${sinceDate} and ${untilDate ?? "today"}`,
        };
      }

      type Hit = {
        sessionId: string;
        videoId: string;
        capturedAt: string;
        timestamp: number;
        snippet: string;
        similarity: number;
        title: string;
      };
      const allHits: Hit[] = [];
      let missingKey = false;

      await Promise.all(
        sessions.map(async (s) => {
          const meta = (s.metadata ?? {}) as { videoId?: string };
          if (!meta.videoId) return;
          const res = await searchVideo(meta.videoId, query, {
            indexType: "semantic",
            limit: 3,
          });
          if (isError(res)) {
            if (res.code === "missing_api_key") missingKey = true;
            return;
          }
          for (const h of res.hits) {
            allHits.push({
              sessionId: s.key,
              videoId: meta.videoId,
              capturedAt: s.createdAt.toISOString(),
              timestamp: h.start,
              snippet: fenceContent("recallFromSession", "external_doc", h.snippet.slice(0, 400)),
              similarity: Number(h.similarity.toFixed(3)),
              title: s.content,
            });
          }
        }),
      );

      if (missingKey && allHits.length === 0) {
        return {
          ok: false,
          code: "missing_api_key",
          error: "VIDEO_DB_API_KEY not set.",
        };
      }

      allHits.sort((a, b) => b.similarity - a.similarity);
      const top = allHits.slice(0, limit ?? 5);
      return {
        ok: true,
        count: top.length,
        hits: top,
        dateRange: { sinceDate, untilDate: untilDate ?? null },
      };
    },
  }),

  // v10.0.526 · Arc C · Feature 3 · pricing-strategy advisor read.
  // Cheap lookup over BrainMemory(category="pricing_advisory",
  // key="weekly_YYYY-MM-DD"). Operator asks "what's the pricing
  // advisory this week" → returns the latest snapshot with outliers
  // + experiments. Does NOT re-run the analyzer (that's the weekly
  // cron's job). Read-only.
  arsenalResearch: tool({
    description: "Use Grok (xAI) for real-time analysis and research. Powered by the Arsenal integration chain.",
    inputSchema: z.object({
      query: z.string().describe("Research question or topic to analyze"),
    }),
    execute: async ({ query }) => {
      const { analyzeRealTime } = await import("@/lib/integrations/grok");
      const result = await analyzeRealTime(query);
      return { content: result?.content?.slice(0, 2000), model: "grok", source: "arsenal" };
    },
  }),

  arsenalWebSearch: tool({
    description: "Use Perplexity (or Google Search Grounding if Perplexity is unconfigured) for web search with AI-powered summarization. Powered by the Arsenal integration chain.",
    inputSchema: z.object({
      query: z.string().describe("Web search query"),
    }),
    execute: async ({ query }) => {
      if (process.env.PERPLEXITY_API_KEY) {
        const { researchTopic } = await import("@/lib/integrations/perplexity");
        const result = await researchTopic(query);
        return { content: result?.content?.slice(0, 2000), model: "perplexity", source: "arsenal" };
      }
      const { askGoogleSearch } = await import("@/lib/integrations/google-search");
      const result = await askGoogleSearch(query);
      return { content: result?.content?.slice(0, 2000), model: result.model, source: "google" };
    },
  }),

  // v10.0.379 · Gmail inbox triage
  arsenalMultiAgent: tool({
    // v10.0.529.93 · Wave 37 · description trimmed · routing + cost
    // guidance lives in system-prompt.ts RESEARCH TOOL SELECTION block
    // (~lines 722-728) · was duplicated here verbatim every turn.
    description: "Spawn N parallel sub-agents + synthesize. Max 8.",
    inputSchema: z.object({
      goal: z.string().describe("The overall operator goal · seen by every sub-agent as context"),
      subAgents: z.array(
        z.object({
          name: z.string().describe("Stable name for this sub-agent · e.g. 'pricing_analysis' or 'review_themes'"),
          task: z.string().describe("Specific task for this sub-agent · 1-2 sentences · ≤800 chars"),
          outputHint: z.string().optional().describe("Optional output-shape hint · e.g. 'bulleted list' or 'JSON with {a,b,c}'"),
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
      return {
        plan: report.plan,
        roundCount: report.rounds.length,
        synthesis: report.synthesis.slice(0, 4000),
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
  // GITHUB — Read/write code, create PRs, manage repos
  // ═══════════════════════════════════════════════════════════

  githubReadFile: tool({
    description: "Read a file from any of Nour's GitHub repos. Use to inspect code, configs, or data files.",
    inputSchema: z.object({
      repo: z.string().describe("Repo name: statenour-os, MAINnicks-tire-autoNEW, easy-nickstire"),
      path: z.string().describe("File path in the repo (e.g., 'lib/ai/tools.ts', 'package.json')"),
      branch: z.string().optional().describe("Branch name (default: main or codex/ollama-local for statenour)"),
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
        const { stdout, stderr } = await execFilePromise(pythonCmd, args, { env, timeout: 60000 });

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
          if (process.env.OPENAI_API_KEY) {
            updatedContent = updatedContent.replace(/openai_api_key\s*=\s*""/, `openai_api_key = "${process.env.OPENAI_API_KEY}"`);
          }
          if (process.env.OPENAI_BASE_URL) {
            updatedContent = updatedContent.replace(/openai_base_url\s*=\s*"https:\/\/api.openai.com\/v1"/, `openai_base_url = "${process.env.OPENAI_BASE_URL}"`);
          }
          if (process.env.PEXELS_API_KEY) {
            updatedContent = updatedContent.replace(/pexels_api_keys\s*=\s*\[\]/, `pexels_api_keys = ["${process.env.PEXELS_API_KEY}"]`);
          }
          if (process.env.PIXABAY_API_KEY) {
            updatedContent = updatedContent.replace(/pixabay_api_keys\s*=\s*\[\]/, `pixabay_api_keys = ["${process.env.PIXABAY_API_KEY}"]`);
          }
          fs.writeFileSync(configPath, updatedContent, "utf-8");
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
        const { stdout, stderr } = await execFilePromise(pythonCmd, args, { env, timeout: 180000 });

        return {
          ok: true,
          stdout,
          stderr,
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

};

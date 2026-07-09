/**
 * Brain tools — semantic recall, BrainMemory ops, classification.
 *
 * Includes: searchMemories · searchSkills · searchConversations ·
 * searchReflections · pinMemory · classifyThought · checkAntiPattern ·
 * resolveContradiction · runSimulation · syncKnowledge · etc.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import { detectBlindSpots } from "@/lib/brain/blind-spot-detector";
import { classifyThought as classifyThoughtFn } from "@/lib/brain/journal-ingest";
import { runKnowledgeSync } from "@/lib/brain/knowledge-sync";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const brainTools = {
  surfaceAntiPatterns: tool({
    description:
      "Pull the operator's recent anti-patterns (decisions that scored D/F + recurring drift loops + commitments operator has broken). Returns up to 5 with severity + description + when it last fired. Use when Nick suspects the operator is about to repeat a known failure mode, or when the operator asks 'what do I keep getting wrong'.",
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("How many to return. Default 5."),
      topic: z
        .string()
        .optional()
        .describe(
          "Optional topic to filter by · keyword match against description.",
        ),
    }),
    execute: async ({ limit, topic }) => {
      const cap = limit ?? 5;
      const rows = await prisma.brainMemory
        .findMany({
          where: {
            category: BRAIN_CATEGORIES.ANTI_PATTERN,
            deletedAt: null,
          },
          orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
          take: 50,
          select: {
            key: true,
            content: true,
            confidence: true,
            updatedAt: true,
            metadata: true,
          },
        })
        .catch((err): never[] => {
          void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.tools.brain", err, { fn: "surfaceAntiPatterns" }, "error"));
          return [];
        });

      let filtered = rows;
      if (topic) {
        const q = topic.toLowerCase();
        filtered = rows.filter((r) => r.content.toLowerCase().includes(q));
      }

      const top = filtered.slice(0, cap);
      return {
        ok: true,
        count: top.length,
        patterns: top.map((r) => ({
          key: r.key,
          description: r.content,
          confidence: r.confidence,
          lastSeen: r.updatedAt.toISOString().slice(0, 10),
          metadata: r.metadata,
        })),
      };
    },
  }),

  // v10.0.524 · #6 Skill suggestion tool. Pulls the top-K Claude
  // skills semantically similar to a query. Operator can ask
  // "which skill should I apply for X" and Nick surfaces the
  // best-fit specialist lens from the indexed skill registry.
  suggestSkills: tool({
    description:
      "Find the best Claude skills (from the indexed skill registry) for the operator's current task or question. Returns skill name + description + similarity score for top 3 matches. Use when the operator says 'which skill applies here', 'is there a skill for X', or when Nick wants to recommend a specialist lens before answering.",
    inputSchema: z.object({
      query: z
        .string()
        .min(3)
        .max(300)
        .describe("Task or question to find skills for."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("How many to return. Default 3."),
    }),
    execute: async ({ query, limit }) => {
      const { recallSkills } = await import("@/lib/skills/skill-recall");
      const { hasBundledProtocol } = await import(
        "@/lib/ai/skills/bundled-protocols"
      );
      const matches = await recallSkills(query, limit ?? 3);
      return {
        ok: true,
        count: matches.length,
        skills: matches.map((s) => ({
          name: s.name,
          description: s.description,
          category: s.category,
          similarity: Number(s.similarity.toFixed(3)),
          // When true, call getSkillProtocol(name) to load the full
          // instructions before executing the skill.
          hasProtocol: hasBundledProtocol(s.name),
        })),
      };
    },
  }),

  // Loads the full instruction body for a bundled skill. suggestSkills
  // returns description-only; this returns the verbatim protocol (table
  // templates, hard rules) so the model executes with full fidelity.
  getSkillProtocol: tool({
    description:
      "Load the full step-by-step protocol for a bundled skill by exact name (e.g. 'maxforge-alpha'). suggestSkills returns only a short description — when a match has hasProtocol:true, call this to fetch its actual instructions, output templates, and hard rules BEFORE executing the skill. Returns { ok, name, protocol } or { ok:false } when the skill has no bundled protocol.",
    inputSchema: z.object({
      name: z
        .string()
        .min(2)
        .max(100)
        .describe("Exact skill name from suggestSkills, e.g. 'maxforge-alpha'."),
    }),
    execute: async ({ name }) => {
      const { getBundledProtocol } = await import(
        "@/lib/ai/skills/bundled-protocols"
      );
      const protocol = getBundledProtocol(name);
      if (!protocol) {
        return {
          ok: false as const,
          name,
          error:
            "No bundled protocol for this skill. Use suggestSkills for description-level guidance.",
        };
      }
      return { ok: true as const, name, protocol };
    },
  }),

  // v10.0.524 · #1 Cross-conversation context recall. Surfaces past
  // threads on similar topics so Nick can cite continuity ("we
  // discussed X last Tuesday · here's where it left off").
  findRelatedConversations: tool({
    description:
      "Find past chat conversations semantically similar to a topic. Returns conversationId + summary + similarity score + date for up to 5 threads. Use when the operator says 'what did I discuss about X', 'last time we talked about Y', 'pull up the conversation about Z', or to maintain cross-session continuity. Hides the current conversation from results when activeConversationId is provided.",
    inputSchema: z.object({
      query: z
        .string()
        .min(4)
        .max(500)
        .describe("Topic to find prior conversations about."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("How many to return. Default 3."),
      activeConversationId: z
        .string()
        .optional()
        .describe("Current conversation id, to exclude from results."),
    }),
    execute: async ({ query, limit, activeConversationId }) => {
      const { findRelatedConversations } = await import(
        "@/lib/brain/conversation-recall"
      );
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
      const matches = await findRelatedConversations(
        query,
        limit ?? 3,
        activeConversationId,
      );
      return {
        ok: true,
        count: matches.length,
        matches: matches.map((m) => ({
          conversationId: m.conversationId,
          // v10.0.529.5 E-3 fix · fence cross-session content. If a
          // prior session's summary contains injection-laced text
          // (e.g. operator pasted a page from a malicious site), this
          // tells the model not to treat it as a fresh directive.
          summary: fenceContent(
            "findRelatedConversations",
            "cross_session",
            m.summary,
          ),
          topics: m.topics,
          date: m.date,
          similarity: Number(m.similarity.toFixed(3)),
        })),
      };
    },
  }),

  // v10.0.524 · #4 Multi-source verified web search. Fans out
  // across Perplexity + Tavily + Exa in parallel, returns consensus
  // + per-source citations + confidence. Reduces fabrication risk
  // versus single-source by ~70% on factual claims. Falls back
  // gracefully when only one provider has a key configured.
  searchMemories: tool({
    description: "Search Nick's brain memories by keyword, category, or confidence threshold. Use to recall past insights, patterns, and stored knowledge.",
    inputSchema: z.object({
      query: z.string().describe("Keyword to search in memory content and keys"),
      category: z.string().optional().describe("Filter by category: insight, pattern, preference, lesson, fact"),
      minConfidence: z.number().min(0).max(1).default(0.3).describe("Minimum confidence threshold"),
      limit: z.number().min(1).max(50).default(10),
    }),
    execute: async ({ query, category, minConfidence, limit }) => {
      // Lexical pre-match via Postgres FTS (stemmed + multi-word) on content,
      // reusing the brain_memories_content_fts_idx GIN index. The prior matcher
      // was `content ILIKE '%query%'` only -- brittle: it missed plurals and
      // multi-word queries ("tire advice" matched 1 row vs 62 via FTS). FTS hits
      // are UNIONed into the OR below (purely additive: the ILIKE + key matches
      // still apply), degrading to the old behavior when the tsquery is empty/
      // unparseable or the index is absent.
      const _ftsQuery = (query ?? "").trim();
      let ftsIds: string[] = [];
      if (_ftsQuery) {
        try {
          const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id::text AS id FROM brain_memories
             WHERE deleted_at IS NULL AND confidence >= $1
               AND to_tsvector('english', content) @@ websearch_to_tsquery('english', $2)
             ORDER BY ts_rank(to_tsvector('english', content), websearch_to_tsquery('english', $2)) DESC
             LIMIT $3`,
            minConfidence,
            _ftsQuery,
            limit * 2,
          );
          ftsIds = rows.map((r) => r.id);
        } catch (err) {
          // FTS unavailable / empty tsquery -- fall back to the ILIKE match below.
          void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.tools.brain", err, { fn: "searchMemories.ftsQuery" }, "warn"));
        }
      }
      const where: any = {
        // v7.9 — searchMemories never returns soft-deleted rows
        deletedAt: null,
        AND: [
          { confidence: { gte: minConfidence } },
          { OR: [
            ...(ftsIds.length ? [{ id: { in: ftsIds } }] : []),
            { content: { contains: query, mode: "insensitive" } },
            { key: { contains: query, mode: "insensitive" } },
          ]},
        ],
      };
      if (category) where.AND.push({ category });
      const memories = await prisma.brainMemory.findMany({
        where,
        orderBy: { confidence: "desc" },
        take: limit,
        select: { id: true, category: true, key: true, content: true, confidence: true, source: true, updatedAt: true },
      });
      return { count: memories.length, memories };
    },
  }),

  searchSkills: tool({
    description:
      "Semantic search across the indexed Claude skill registry. Returns top-K skills most relevant to a query · use when Nour asks 'what skill helps with X' or 'find me a skill for Y', when you need a specific framework/approach (e.g. 'kaizen', 'database design', 'mobile UX audit'), OR when a workflow could benefit from invoking a known skill protocol. Each match includes name, description, similarity score, category, and tags. Skills are pulled from ~/.claude/skills/ + plugin marketplaces · multi-language coverage (skills authored in Chinese/Portuguese still match English queries via their English summaries).",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Natural language query · what kind of skill/protocol/framework you're looking for"),
      topK: z.number().min(1).max(10).default(5),
    }),
    execute: async ({ query, topK }) => {
      const { recallSkills } = await import("@/lib/skills/skill-recall");
      const matches = await recallSkills(query, topK);
      if (matches.length === 0) {
        return {
          count: 0,
          matches: [],
          hint: "No skills matched · try a broader query, or run `pnpm tsx scripts/embed-skills.ts` if the skill registry feels incomplete.",
        };
      }
      return {
        count: matches.length,
        matches: matches.map((m) => ({
          name: m.name,
          description: m.description.slice(0, 240),
          similarity: m.similarity,
          category: m.category ?? null,
          tags: m.tags ?? [],
          path: m.path ?? null,
        })),
      };
    },
  }),

  searchColdMemory: tool({
    description:
      "Semantic search across Nour's cold memory corpus — archived Google Drive docs, old brain memories, and ingested knowledge. Unlike searchMemories (keyword), this is meaning-based: 'my pipeline is drying up' correctly finds getRevenueAging-style memories without needing the literal word. USE THIS when Nour asks about something you don't see in the hot system prompt, when he references an old document, or when the question requires reaching back into historical knowledge. Returns top matches with similarity scores and Drive view URLs when available.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Natural language query — describe what you're looking for"),
      scope: z
        .enum(["drive", "ingest", "archive", "all"])
        .default("drive")
        .describe(
          "Source bucket to search. 'drive' = Google Drive ingested docs only. 'ingest' = drive + gmail + calendar. 'all' = every brain memory. Default is 'drive' for focused archival lookup."
        ),
      limit: z.number().min(1).max(20).default(5),
      minScore: z
        .number()
        .min(0)
        .max(1)
        .default(0.25)
        .describe("Minimum hybrid score cutoff — below this is noise"),
    }),
    execute: async ({ query, scope, limit, minScore }) => {
      const { searchColdMemory } = await import("@/lib/brain/cold-memory");
      const matches = await searchColdMemory(query, { scope, limit, minScore });
      if (matches.length === 0) {
        return {
          count: 0,
          matches: [],
          hint: "No cold memory matches. Try broadening scope to 'ingest' or 'all', or run a manual Drive sync via /api/drive/sync if the knowledge base feels stale.",
        };
      }
      return {
        count: matches.length,
        matches: matches.map((m) => ({
          category: m.category,
          similarity: Number(m.similarity.toFixed(3)),
          hybridScore: Number(m.hybridScore.toFixed(3)),
          confidence: Number(m.confidence.toFixed(2)),
          source: m.source,
          driveTitle: m.driveTitle,
          driveViewUrl: m.driveViewUrl,
          modifiedTime: m.modifiedTime,
          // Trim long content so the tool result stays compact in the
          // model context — Nick can see enough to decide + cite the URL
          excerpt: m.content.slice(0, 600),
        })),
      };
    },
  }),

  searchConversations: tool({
    description: "Search past chat conversations by keyword. Use to recall what was discussed, decisions made, or advice given.",
    inputSchema: z.object({
      query: z.string().describe("Keyword to search in message content"),
      role: z.enum(["user", "assistant", "any"]).default("any").describe("Filter by message role"),
      limit: z.number().min(1).max(20).default(10),
    }),
    execute: async ({ query, role, limit }) => {
      const where: any = {
        content: { contains: query, mode: "insensitive" },
      };
      if (role !== "any") where.role = role;
      const messages = await prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true, role: true, content: true, createdAt: true, conversationId: true,
          conversation: { select: { title: true } },
        },
      });
      return {
        count: messages.length,
        messages: messages.map(m => ({
          conversationTitle: m.conversation?.title,
          role: m.role,
          snippet: m.content.slice(0, 300),
          date: m.createdAt,
          conversationId: m.conversationId,
        })),
      };
    },
  }),

  // ═══════════════════════════════════════════════════════
  // TIER 2: PROACTIVE PUSH + DECISION REPLAY
  // ═══════════════════════════════════════════════════════

  searchGreeneLaws: tool({
    description: "Search the 189 Greene strategic laws by keyword. Returns matching laws with essence and shop/personal application.",
    inputSchema: z.object({
      query: z.string().describe("Search term — title, concept, or situation"),
      book: z.string().optional().describe("Filter by book: FORTY_EIGHT_LAWS, THIRTY_THREE_STRATEGIES, HUMAN_NATURE, MASTERY, ART_OF_SEDUCTION, FIFTIETH_LAW"),
    }),
    execute: async ({ query, book }) => {
      const where: any = {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { essence: { contains: query, mode: "insensitive" } },
          { shopApplication: { contains: query, mode: "insensitive" } },
          { nourApplication: { contains: query, mode: "insensitive" } },
        ],
      };
      if (book) where.book = book;
      const laws = await prisma.strategicLaw.findMany({ where, take: 5 });
      return laws.map(l => ({
        ref: `${l.book} #${l.number}`,
        title: l.title,
        essence: l.essence?.slice(0, 200),
        shopApplication: l.shopApplication?.slice(0, 200),
        nourApplication: l.nourApplication?.slice(0, 200),
      }));
    },
  }),

  syncDriveMemory: tool({
    description:
      "Manually trigger a Google Drive ingest run — pulls the latest Drive documents, extracts their content, generates embeddings, and stores them as cold memories searchable via searchColdMemory. Use when Nour says 'sync my drive', 'refresh my knowledge base', 'ingest my latest docs', or similar. Returns stats on what was ingested.",
    inputSchema: z.object({
      force: z
        .boolean()
        .default(false)
        .describe(
          "If true, bypass any recency check and re-pull all candidate files. Use sparingly — embeds cost API calls."
        ),
    }),
    execute: async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/drive/sync`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ actor: "nick_tool_call" }),
          }
        );
        if (!res.ok) {
          return {
            ok: false,
            error: `Sync failed with HTTP ${res.status}`,
          };
        }
        const data = await res.json();
        return {
          ok: true,
          stored: data.stored ?? 0,
          skipped: data.skipped ?? 0,
          categories: data.categoryCounts ?? {},
          durationMs: data.durationMs ?? 0,
          hint:
            data.stored > 0
              ? `Ingested ${data.stored} new Drive docs. Run searchColdMemory with your query to reach them.`
              : "No new files needed ingest — cold memory is already up to date.",
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown sync error",
        };
      }
    },
  }),

  // v10.0.74 · searchBrainDumps retired — strict subset of searchReflections,
  // which now searches BOTH Reflection rows AND BrainDump entries (with the
  // same date-range support and the patterns field added). Nick had two
  // search names for the same intent; selection split telemetry. Canonical:
  //   searchBrainDumps  →  searchReflections (covers both sources)

  syncKnowledge: tool({
    description: "Run the knowledge sync pipeline on demand. Three idempotent stages: (1) promote substantial new chat messages to BrainDumps (AI classification of raw BrainDumps is currently disabled — no provider), (2) rebalance priorities on backfill/journal-sourced tasks, (3) index substantial assistant chat messages as nick_advice memories. Use when Nour says 'sync my knowledge', 'process new thoughts', 'ingest recent chats', or 'catch up the brain'.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const result = await runKnowledgeSync();
        return {
          ok: true,
          classified: result.backfill.classified,
          chatPromoted: result.backfill.chatPromoted,
          tasksCreated:
            result.backfill.tasksCreated + result.backfill.chatTasksCreated,
          insightsStored: result.backfill.insightsStored,
          commitmentsFound: result.backfill.commitmentsFound,
          tasksRebalanced: result.rebalance.tasksUpdated,
          priorityDistribution: result.rebalance.after,
          wisdomStored: result.wisdom.memoriesStored,
          durationMs: result.durationMs,
          message: `Synced ${result.backfill.classified} raw + ${result.backfill.chatPromoted} chat → ${result.backfill.tasksCreated + result.backfill.chatTasksCreated} tasks, ${result.rebalance.tasksUpdated} rebalanced, ${result.wisdom.memoriesStored} wisdom memories stored. ${(result.durationMs / 1000).toFixed(1)}s.`,
        };
      } catch (err) {
        return { error: String(err) };
      }
    },
  }),

  /**
   * Get recent reflections from the reflection engine. These are
   * generated by a cron job that scans patterns across BrainMemory,
   * DailyScores, BrainDumps, and Commitments over a 7-day window.
   * Previously write-only — nothing in the app surfaced them.
   */
  pinMemory: tool({
    description:
      "Pin a fact to long-term memory · creates a BrainMemory(category=pinned_user) row · surfaces in the brain's pinned context panel + chat recall. Use when Nour says 'remember this' / 'pin this' / 'this is important'.",
    inputSchema: z.object({
      content: z.string().describe("The fact or note to pin · plain English · 1-2 sentences ideal"),
      key: z
        .string()
        .optional()
        .describe("Optional dedup key · defaults to slug of content first 60 chars"),
      confidence: z.number().min(0).max(1).default(0.95).optional(),
    }),
    execute: async ({ content, key, confidence }) => {
      const slug =
        key ??
        content
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-")
          .slice(0, 60);
      const row = await prisma.brainMemory.upsert({
        where: { category_key: { category: BRAIN_CATEGORIES.PINNED_USER, key: slug } },
        create: {
          category: BRAIN_CATEGORIES.PINNED_USER,
          key: slug,
          content,
          confidence: confidence ?? 0.95,
          source: "nick-tool:pinMemory",
          createdBy: "user:via-nick",
        },
        update: {
          content,
          confidence: confidence ?? 0.95,
          lastSeen: new Date(),
          seenCount: { increment: 1 },
        },
      });
      return { pinned: true, id: row.id, key: slug, content };
    },
  }),

  // Apr 20 · Device RPC via chat. Nour says "lock the front door" or
  // "turn on the shop lights" and Nick resolves the device by
  // fuzzy name/location, enqueues a DeviceCommand row, and the
  // nour-os-unified agent executes it via Ring/Eufy/Tuya/Google
  // bridges. See docs/DEVICE-RPC.md for the contract.
  checkAntiPattern: tool({
    description:
      "Check the anti-pattern library for lessons that match the current intent. Call BEFORE any side-effecting tool (sendSMS, createPaymentLink, triggerFollowUp, createQuote, runDeviceCommand) if Nour's intent rhymes with a past failure. Returns zero-or-more matching lessons with severity and lesson text — surface them to Nour before acting. Zero cost per call (pure DB).",
    inputSchema: z.object({
      intent: z
        .string()
        .min(3)
        .max(500)
        .describe("One-sentence description of the action about to be taken, or the decision context."),
      domain: z
        .enum(["business", "personal", "tech", "health", "relationships", "other"])
        .optional()
        .describe("Restrict to one domain if you know it; omit to search all."),
      tags: z
        .array(z.string().max(40))
        .optional()
        .describe("Optional tag hints for filtering (e.g. ['pricing','quote'])."),
    }),
    execute: async ({ intent, domain, tags }) => {
      try {
        const { tokenize, jaccard } = await import("@/lib/brain/similarity");
        const { readMetadata } = await import("@/lib/brain/memory-metadata-types");
        type AntiMeta = import("@/lib/brain/memory-metadata-types").AntiPatternMeta;
        const queryTokens = tokenize(intent);
        const rows = await prisma.brainMemory.findMany({
          where: { category: BRAIN_CATEGORIES.ANTI_PATTERN, deletedAt: null }, // v7.9
          take: 200,
        });
        const matches = rows
          .map((r) => {
            const meta = readMetadata<Partial<AntiMeta>>(r.metadata);
            if (domain && meta.domain && meta.domain !== domain) return null;
            const blob = `${r.key} ${r.content} ${meta.attempt ?? ""} ${meta.outcome ?? ""} ${(meta.tags ?? []).join(" ")}`;
            const score = jaccard(queryTokens, tokenize(blob));
            let tagBonus = 0;
            if (tags && tags.length > 0 && meta.tags) {
              for (const t of tags) if (meta.tags.includes(t)) tagBonus += 0.1;
            }
            const finalScore = score + tagBonus;
            if (finalScore < 0.08) return null;
            return {
              key: r.key,
              lesson: r.content,
              severity: meta.severity ?? "warn",
              domain: meta.domain ?? "other",
              attempt: meta.attempt ?? "",
              outcome: meta.outcome ?? "",
              tags: meta.tags ?? [],
              revisitCount: meta.revisitCount ?? 0,
              score: Math.round(finalScore * 100) / 100,
            };
          })
          .filter((m): m is NonNullable<typeof m> => m !== null)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);

        return {
          intent,
          matchCount: matches.length,
          matches,
          warning: matches.length > 0
            ? `Found ${matches.length} past failure${matches.length === 1 ? "" : "s"} that rhyme with this. Review before acting.`
            : "No matching anti-patterns — action has no historical failure record.",
        };
      } catch (err) {
        return {
          error: `Couldn't check anti-patterns: ${String(err)}`,
          matches: [],
          matchCount: 0,
        };
      }
    },
  }),

  // v10.0.526 · Arc B Feature 5 · resolveContradiction — when a
  // CONTRADICTION ALERT was injected into the system prompt and Nour
  // answered "which is current?", this tool persists the canonical
  // belief. The underlying handler (a) updates the existing
  // BrainMemory(category="contradiction") row's status + resolved_at
  // (b) deprecates the losing side's BrainMemory by dropping its
  // confidence to 0.1 (c) writes a NEW BrainMemory(category=
  // "resolved_contradiction") capturing the canonical belief in
  // human-readable form.
  // No parallel table; everything lives in BrainMemory.
  classifyThought: tool({
    description: "Classify a thought into one of: raw, thinking, reasoning, insight, decision, reflection, planning, venting. Use when Nour asks 'what am I doing right now' or 'am I overthinking this'. Does NOT store anything — pure classification.",
    inputSchema: z.object({
      text: z.string().min(1).max(2000),
    }),
    execute: async ({ text }) => {
      const type = await classifyThoughtFn(text);
      return { entryType: type };
    },
  }),

  // NOTE: ingestThought tool deleted Apr 15 — brain-dump capture is
  // now handled by the NL interceptor in /api/ai/chat. Prefixes like
  // "remember that X", "note: X", "capture: X", "journal: X" hit
  // ingestJournal() directly before the model gets involved. Faster
  // + model can't forget to call the tool.

  getBrainHealth: tool({
    description: "Get a full brain health report — memory count, learning velocity, prediction accuracy, wisdom promotions, contradiction resolution. Shows how smart the brain is getting.",
    inputSchema: z.object({}),
    execute: async () => {
      const { measureLearningVelocity } = await import("@/lib/brain/learning-velocity");
      const { systemHealthCheck } = await import("@/lib/brain/memory-consolidation");
      const [velocity, health] = await Promise.all([
        measureLearningVelocity(),
        systemHealthCheck(),
      ]);
      return { velocity, health };
    },
  }),

  // 2026-06-02 · ported from the `mental-health-analyzer` skill, GROUNDED in
  // statenour's own logs (no clinical questionnaire assumed, nothing
  // fabricated, gaps reported honestly). Engine: lib/brain/analyzers/
  // mental-health.ts. Explicitly NON-clinical — never diagnoses or predicts
  // self-harm; surfaces crisis resources (988) instead.
  analyzeMentalHealth: tool({
    description:
      "Analyze Nour's mental/emotional wellbeing from his OWN logged data (mood, energy, sleep, stress, workouts, journal patterns) over a window. Returns a grounded mood trend, volatility, sleep/workout correlations, a NON-clinical 'concern level' with factors, and safe guidance. Use when Nour asks how he's doing emotionally, about mood/stress/burnout patterns, or 'am I okay'. NOT a diagnosis — it surfaces crisis resources and never predicts self-harm.",
    inputSchema: z.object({
      days: z
        .number()
        .min(7)
        .max(180)
        .default(30)
        .describe("Lookback window in days"),
    }),
    execute: async ({ days }) => {
      const { analyzeMentalHealth } = await import(
        "@/lib/brain/analyzers/mental-health"
      );
      return analyzeMentalHealth({ days });
    },
  }),

  // 2026-06-02 · goal-analyzer skill ported -> SMART scoring (5 dims ->
  // S/A/B/C grade) grounded in real LifeGoal rows; surfaces unmeasurable
  // (targetValue=0) + not-time-bound goals. Engine: lib/brain/analyzers/goal.ts.
  analyzeGoals: tool({
    description:
      "Analyze Nour's active LifeGoals with the SMART framework (Specific/Measurable/Achievable/Relevant/Time-bound, each 1-5 -> S/A/B/C grade) plus progress and pace. Names each goal's weaknesses (e.g. targetValue=0 -> not measurable; no deadline -> not time-bound) with a concrete fix, and flags weak/unmeasurable goals across the portfolio. Use when Nour asks about his goals, whether they're well-formed/SMART, goal progress or quality, or 'are my goals any good / what's wrong with my goals'.",
    inputSchema: z.object({}),
    execute: async () => {
      const { analyzeGoals } = await import("@/lib/brain/analyzers/goal");
      return analyzeGoals();
    },
  }),

  // 2026-06-02 · generalizes the `health-trend-analyzer` skill (multi-dimension
  // trend + change-point detection + correlation) from health-only to ALL of
  // the operator's tracked daily metrics. Grounded in real logs, honest about
  // gaps, no model call. Engine: lib/brain/analyzers/trends.ts.
  analyzeTrends: tool({
    description:
      "Detect what's changing across ALL of Nour's tracked daily metrics (mood, energy, sleep, dailyScore, deep-work, drift, workouts + body: weight, body-fat, waist, stress) over a window. Returns per-metric direction (rising/flat/falling) + per-30-day change + a recent-vs-prior change-point, the TOP MOVERS (biggest normalized change), and notable pairwise correlations (|r|>=0.5, e.g. sleep<->mood). Honest about thin data (per-metric insufficient flag when <5 points). Use when Nour asks 'what's changing / trending / what's off lately / what moves together' across his metrics. Reports direction without moralizing (e.g. weight is context-dependent).",
    inputSchema: z.object({
      days: z
        .number()
        .min(7)
        .max(180)
        .default(30)
        .describe("Lookback window in days"),
    }),
    execute: async ({ days }) => {
      const { analyzeTrends } = await import("@/lib/brain/analyzers/trends");
      return analyzeTrends({ days });
    },
  }),

  // 2026-06-02 · sleep-analyzer skill ported -> avg + consistency (SD) +
  // short-night load + sleep-debt vs a 7.5h target + trend, grounded in
  // PersonalDailyLog.sleepHours (body sleepHours as fallback). Engine:
  // lib/brain/analyzers/sleep.ts.
  analyzeSleep: tool({
    description:
      "Analyze Nour's sleep from his OWN logged nightly hours (daily check-in, with /body tracking as fallback) over a window. Returns average, consistency (SD), short-night count + %, accumulated sleep-debt vs a 7.5h target, the trend/direction, and best/worst night. Use when Nour asks how his sleep is, whether he's sleep-deprived, about his sleep trend or sleep debt. Honest about thin data (<5 nights).",
    inputSchema: z.object({
      days: z
        .number()
        .min(7)
        .max(180)
        .default(30)
        .describe("Lookback window in days"),
    }),
    execute: async ({ days }) => {
      const { analyzeSleep } = await import("@/lib/brain/analyzers/sleep");
      return analyzeSleep({ days });
    },
  }),

  // 2026-06-02 · weightloss-analyzer skill ported (TREND only) -> weight
  // trend + per-WEEK rate + body-fat + waist + net change + distance to an
  // active weight LifeGoal. DIRECTION-NEUTRAL (never labels good/bad) and NO
  // BMR/TDEE (no height/age -> would be fabricated). Engine:
  // lib/brain/analyzers/weight.ts.
  analyzeWeightTrend: tool({
    description:
      "Analyze Nour's weight + body-composition TREND from his OWN BodyTracking logs over a window. Returns weight trend + per-week rate, body-fat trend, waist trend, net change, and — if he has an active weight LifeGoal — the distance from his latest weight to the target. Reports direction WITHOUT judging it good/bad/healthy (whether up or down is 'progress' depends on his goal, not a moral prior). No BMR/TDEE/calorie math (statenour stores no height/age). Use when Nour asks about his weight, body-composition trend, or whether he's making progress on weight. Honest about thin data.",
    inputSchema: z.object({
      days: z
        .number()
        .min(7)
        .max(180)
        .default(30)
        .describe("Lookback window in days"),
    }),
    execute: async ({ days }) => {
      const { analyzeWeightTrend } = await import("@/lib/brain/analyzers/weight");
      return analyzeWeightTrend({ days });
    },
  }),

  // 2026-06-02 · fitness-analyzer skill ported (CONSISTENCY only) ->
  // active-day count + rate + current/longest streak + avg workouts/week +
  // recent-vs-prior trend, merging PersonalDailyLog.workoutCompleted with
  // BodyTracking.workoutDone (active if either). EXPLICITLY frequency-only
  // (statenour logs a boolean, not type/intensity/duration). Engine:
  // lib/brain/analyzers/fitness.ts.
  analyzeFitness: tool({
    description:
      "Analyze Nour's workout CONSISTENCY from his OWN logged daily workout flags (daily check-in + /body, merged) over a window. Returns active-day count + rate (% of logged days), current streak, longest streak, average workouts/week, and a recent-vs-prior trend. This is workout-FREQUENCY ONLY — statenour logs a daily yes/no, NOT type, intensity, duration, or load — so it reads consistency, not training quality. Use when Nour asks about his workout consistency, whether he's training enough, or his streak. Honest about thin data.",
    inputSchema: z.object({
      days: z
        .number()
        .min(7)
        .max(180)
        .default(30)
        .describe("Lookback window in days"),
    }),
    execute: async ({ days }) => {
      const { analyzeFitness } = await import("@/lib/brain/analyzers/fitness");
      return analyzeFitness({ days });
    },
  }),

  // 2026-06-02 · work-pattern health -> deepWork avg+trend, drift load+trend,
  // stress avg+trend, energy avg+trend + a NON-clinical "strain signal"
  // (low/elevated/high) that rises when high stress + high drift + low energy
  // co-occur. Explicitly a heuristic, NOT a diagnosis (ships a disclaimer).
  // Engine: lib/brain/analyzers/work-health.ts.
  analyzeWorkHealth: tool({
    description:
      "Analyze Nour's work-pattern health from his OWN logs (deep-work blocks + drift incidents from the daily check-in; stress + energy from /body) over a window. Returns each metric's average + trend plus a NON-clinical 'strain signal' (low/elevated/high) that rises when high stress, high drift, and low energy co-occur. The strain signal is an explicit heuristic, NOT a burnout diagnosis or clinical assessment (it ships a disclaimer). Use when Nour asks about his work-pattern health, burnout risk, or whether he's overworking. Honest about thin data.",
    inputSchema: z.object({
      days: z
        .number()
        .min(7)
        .max(180)
        .default(30)
        .describe("Lookback window in days"),
    }),
    execute: async ({ days }) => {
      const { analyzeWorkHealth } = await import(
        "@/lib/brain/analyzers/work-health"
      );
      return analyzeWorkHealth({ days });
    },
  }),

  getEmotionalState: tool({
    description: "Get Nour's current emotional arc — stress trajectory, dominant state, triggers, decision risk. Shows how emotions are affecting performance.",
    inputSchema: z.object({}),
    execute: async () => {
      const { analyzeEmotionalArc } = await import("@/lib/brain/emotional-arc");
      return analyzeEmotionalArc();
    },
  }),

  getHabitRevenueCorrelation: tool({
    description: "Show how personal habits (workouts, discipline, energy) correlate with business outcomes (revenue, conversion, lead response). e.g. 'weeks with 4+ workouts = 23% higher revenue'.",
    inputSchema: z.object({}),
    execute: async () => {
      const correlations = await prisma.brainMemory.findMany({
        where: { category: BRAIN_CATEGORIES.HABIT_REVENUE_CORRELATION, confidence: { gte: 0.3 }, deletedAt: null }, // v7.9
        orderBy: { confidence: "desc" },
        take: 5,
      });
      return { correlations: correlations.map((c) => ({ content: c.content, confidence: c.confidence })) };
    },
  }),

  getRecentReflections: tool({
    description: "Get recent reflections generated by the cron reflection engine. These are meta-cognitive insights (what patterns changed this week, what's drifting, what predictions came true). Use when Nour asks 'what have I been learning' or 'what's my pattern lately'. Returns actionable + unacknowledged first.",
    inputSchema: z.object({
      limit: z.number().min(1).max(20).default(5),
      scope: z.enum(["daily", "weekly", "monthly", "triggered", "all"]).default("all"),
      onlyActionable: z.boolean().default(false),
    }),
    execute: async ({ limit, scope, onlyActionable }) => {
      const where: Record<string, unknown> = { deletedAt: null };
      if (scope !== "all") where.scope = scope;
      if (onlyActionable) {
        where.actionable = true;
        where.acknowledged = false;
      }
      const reflections = await prisma.reflection.findMany({
        where,
        orderBy: [
          { actionable: "desc" },
          { acknowledged: "asc" },
          { createdAt: "desc" },
        ],
        take: limit,
        select: {
          id: true,
          date: true,
          scope: true,
          category: true,
          insight: true,
          evidence: true,
          confidence: true,
          actionable: true,
          acknowledged: true,
        },
      }).catch((): never[] => []);
      return {
        count: reflections.length,
        reflections,
      };
    },
  }),

  /**
   * Semantic search across Reflection + BrainDump summaries. Useful
   * for 'what have I said about X in the past' type questions. Not
   * a vector search — keyword only for now, but still much more
   * targeted than searchMemories which hits BrainMemory.
   */
  // v10.0.74 · searchReflections is the canonical "have I thought about
  // this before / what did I say about X last week" tool. Searches both
  // Reflection insights AND BrainDump entries (summaries, raw thoughts,
  // detected patterns). Optional date range. Replaces searchBrainDumps
  // which was a strict subset (BrainDump only).
  searchReflections: tool({
    description: "Search Nour's reflective writing — Reflection insights AND BrainDump entries (raw thoughts + summaries + detected patterns). Use when Nour asks 'have I thought about this before', 'what did I say about X last week', or wants past brainstorms / vents. Returns matches with source (reflection vs brain_dump) + date. Optional date range narrows the scope.",
    inputSchema: z.object({
      query: z.string().min(1).max(200),
      startDate: z.string().optional().describe("Start date filter (YYYY-MM-DD). Inclusive."),
      endDate: z.string().optional().describe("End date filter (YYYY-MM-DD). Inclusive."),
      limit: z.number().min(1).max(20).default(8),
    }),
    execute: async ({ query, startDate, endDate, limit }) => {
      const q = query.toLowerCase();
      const dateFilter: { gte?: string; lte?: string } = {};
      if (startDate) dateFilter.gte = startDate;
      if (endDate) dateFilter.lte = endDate;
      const hasDateFilter = startDate || endDate;
      const [reflections, dumps] = await Promise.all([
        prisma.reflection.findMany({
          where: {
            OR: [
              { insight: { contains: q, mode: "insensitive" } },
              { evidence: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
            ],
            ...(hasDateFilter ? { date: dateFilter } : {}),
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: { id: true, date: true, category: true, insight: true, evidence: true, actionable: true },
        }).catch((): never[] => []),
        prisma.brainDump.findMany({
          where: {
            OR: [
              { summary: { contains: q, mode: "insensitive" } },
              { rawThoughts: { contains: q, mode: "insensitive" } },
              { patterns: { contains: q, mode: "insensitive" } },
            ],
            ...(hasDateFilter ? { date: dateFilter } : {}),
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: { id: true, date: true, summary: true, rawThoughts: true, patterns: true, moodBefore: true },
        }).catch((): never[] => []),
      ]);
      return {
        query,
        reflectionCount: reflections.length,
        brainDumpCount: dumps.length,
        reflections,
        brainDumps: dumps.map((d) => ({
          id: d.id,
          date: d.date,
          summary: d.summary,
          patterns: d.patterns,
          mood: d.moodBefore,
          preview: d.rawThoughts.slice(0, 200),
        })),
      };
    },
  }),

  getBlindSpots: tool({
    description: "Get severity-ranked blind spots — the things Nour is NOT paying attention to. Returns overdue commitments, stale leads, workout gaps, scoring gaps, neglected people, drift alerts. Use this when Nour asks 'what am I missing' or when you need to proactively surface a gap.",
    inputSchema: z.object({
      limit: z.number().min(1).max(20).default(5).describe("Max blind spots to return"),
      severity: z.enum(["critical", "high", "medium", "low", "all"]).default("all").describe("Filter by severity"),
    }),
    execute: async ({ limit, severity }) => {
      try {
        const all = await detectBlindSpots();
        const filtered = severity === "all" ? all : all.filter((b) => b.severity === severity);
        const top = filtered.slice(0, limit);
        return {
          count: top.length,
          total: all.length,
          stats: {
            critical: all.filter((b) => b.severity === "critical").length,
            high: all.filter((b) => b.severity === "high").length,
            medium: all.filter((b) => b.severity === "medium").length,
            low: all.filter((b) => b.severity === "low").length,
          },
          blindSpots: top.map((b) => ({
            domain: b.domain,
            severity: b.severity,
            description: b.description,
            evidence: b.evidence,
            daysSinceAttention: b.daysSinceAttention,
            suggestedAction: b.suggestedAction,
          })),
        };
      } catch (err) {
        return { error: String(err), blindSpots: [] };
      }
    },
  }),

  /**
   * Rank open tasks by impact × ease / age so the ADHD brain can
   * pick the top N without staring at a wall of 40 items. Score
   * formula:
   *   score = (roiScore * 0.6) + (frictionInverse * 0.3) + (ageBoost * 0.1)
   * Where frictionInverse is 100 - frictionScore, and ageBoost
   * gives a small push to tasks that are 2-7 days old (real, but
   * not yet stale). Tasks marked DOING float to the top because
   * closing a DOING is always the highest-leverage move.
   */
  resolveContradiction: tool({
    description:
      "Persist the operator's chosen side after a CONTRADICTION ALERT. Call this when the operator confirms which belief is current (e.g. 'the new one is right', 'I still believe the old one', 'both are true in different contexts', 'never mind that wasn't really a contradiction'). Required: contradictionKey from the alert block. side='current_wins' (today's statement is canonical), 'old_wins' (prior statement is canonical), 'both_valid' (context-dependent), or 'dismissed' (false positive). Optional currentBelief is a 1-2 sentence summary of the canonical position. Updates the contradiction status, deprecates the losing memory, and writes a resolved_contradiction memory for downstream recall.",
    inputSchema: z.object({
      contradictionKey: z
        .string()
        .min(1)
        .max(64)
        .describe("The key from the CONTRADICTION ALERT block (e.g. 'a1b2c3d4...')."),
      side: z
        .enum(["current_wins", "old_wins", "both_valid", "dismissed"])
        .describe(
          "Which side is canonical. current_wins = today's statement. old_wins = prior statement. both_valid = context-dependent. dismissed = not actually a contradiction.",
        ),
      currentBelief: z
        .string()
        .max(400)
        .optional()
        .describe("Optional 1-2 sentence summary of the canonical belief for future recall."),
      note: z
        .string()
        .max(400)
        .optional()
        .describe("Optional operator note explaining the resolution."),
    }),
    execute: async ({ contradictionKey, side, currentBelief, note }) => {
      try {
        const { resolveContradiction: resolve } = await import(
          "@/lib/brain/contradiction-surfacer"
        );
        const resolved = await resolve(contradictionKey, side, note);
        if (!resolved) {
          return {
            ok: false,
            error: "contradiction_not_found",
            contradictionKey,
          };
        }

        // Write the canonical belief as its own resolved_contradiction
        // BrainMemory so downstream recall (search, hybrid recall,
        // contextual-recall) can cite it the next time the topic
        // comes up. Confidence high — Nour just explicitly resolved.
        if (currentBelief && currentBelief.trim().length > 0) {
          const beliefKey = `belief:${contradictionKey}`;
          await prisma.brainMemory
            .upsert({
              where: {
                category_key: {
                  category: "resolved_contradiction",
                  key: beliefKey,
                },
              },
              create: {
                category: "resolved_contradiction",
                key: beliefKey,
                content: currentBelief.trim(),
                confidence: 0.95,
                source: "resolve_contradiction_tool",
                metadata: {
                  side,
                  contradictionKey,
                  resolvedAt: new Date().toISOString(),
                  note: note ?? null,
                } as unknown as object,
              },
              update: {
                content: currentBelief.trim(),
                confidence: 0.95,
                lastSeen: new Date(),
              },
            })
            .catch(() => {
              // Non-fatal — the resolve already succeeded
            });
        }

        return {
          ok: true,
          contradictionKey,
          side,
          resolvedAt: resolved.resolved_at,
          newExcerpt: resolved.new_excerpt,
          oldExcerpt: resolved.old_excerpt,
          canonical:
            side === "current_wins"
              ? resolved.new_excerpt
              : side === "old_wins"
                ? resolved.old_excerpt
                : null,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  }),

  // v11.1 G1 · browser_do — Nick spins a cloud headless-Chrome
  // session via Browserbase and reports the live-view URL so Nour
  // can watch. Graceful degradation when Browserbase isn't
  // configured (returns a structured "not_configured" payload —
  // the chat route surfaces it as a one-line hint instead of a
  // tool-call error).
  //
  // Next iteration (pending Nour's sign-off on the scaffold):
  //   · Install @browserbasehq/stagehand + playwright-core
  //     (~9MB in the serverless bundle)
  //   · Add browser_navigate({sessionId, url}) tool
  //   · Add browser_act({sessionId, instruction}) tool — runs a
  //     Stagehand page.act() on the open session
  //   · Add browser_extract({sessionId, schema}) tool — runs
  //     page.extract() with a Zod schema for structured return
  // Right now the scaffold is a "supervised handoff" — Nick opens
  // the door, Nour walks through. The driver upgrade makes Nick
  // walk through first, Nour watches.
  runSimulation: tool({
    description: "Run a 'what if' simulation — predict the cascade of consequences for a specific scenario. e.g. 'What if I hire a second tech?' or 'What if I raise prices 10%?'",
    inputSchema: z.object({
      scenario: z.string().describe("The scenario to simulate"),
    }),
    execute: async ({ scenario }) => {
      const { runSimulation: simulate } = await import("@/lib/brain/thinking-engine");
      return simulate(scenario);
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // META — Tools about the tools themselves
  // ═══════════════════════════════════════════════════════════

  buildArchitectureMemory: tool({
    description: "Scan a repo feature and store its architecture in brain memory. Use when learning about a part of the codebase for the first time — stores it so you remember next conversation.",
    inputSchema: z.object({
      repo: z.string(),
      feature: z.string().describe("Feature name (e.g., 'chat system', 'lead pipeline', 'morning autopilot')"),
      filePaths: z.array(z.string()).describe("Key files that make up this feature"),
      summary: z.string().describe("How this feature works in 2-3 sentences"),
    }),
    execute: async ({ repo, feature, filePaths, summary }) => {
      const { brainMemory } = await import("@/lib/brain/memory-manager");
      await brainMemory.remember(
        "architecture",
        `arch_${repo}_${feature.replace(/\s+/g, "_")}`,
        `ARCHITECTURE [${repo}] ${feature}: ${summary}. Key files: ${filePaths.join(", ")}`,
        "nick-builder",
        { repo, feature, filePaths }
      );
      return { stored: true, feature, repo };
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // LIVE NICKSTIRE — Real-time business data from the shop
  // ═══════════════════════════════════════════════════════════

  learnCodingPreference: tool({
    description: "Store a coding preference or pattern that Nour likes. Use when Nour says 'I prefer X' or 'always do Y' or 'never do Z' about code. These preferences guide future code generation.",
    inputSchema: z.object({
      preference: z.string().describe("The coding preference or pattern"),
      context: z.string().describe("When/where this applies"),
    }),
    execute: async ({ preference, context }) => {
      const { brainMemory } = await import("@/lib/brain/memory-manager");
      await brainMemory.remember(
        "coding_preference",
        `pref_${Date.now()}`,
        `CODING PREFERENCE: ${preference}. Context: ${context}`,
        "nick-builder",
        { type: "coding_preference" }
      );
      return { stored: true, preference };
    },
  }),

  // 2026-06-20 · Power-dynamics analyzer · scores the operator's power
  // position across all relationships. Pure core + IO wrapper pattern
  // matching mental-health.ts. Engine: lib/brain/analyzers/power-dynamics.ts.
  analyzePowerDynamics: tool({
    description:
      "Analyze Nour's power position across all relationships. Returns leverage scores (avg power balance, strongest/weakest positions, dependency ratio), influence metrics (plays executed, XP), network health (active/neglected/mentors/rivals), threats (drainers, rivals, unstable alliances), and concrete next moves. Use when Nour asks about power dynamics, leverage, relationship strategy, or 'who has power over me'.",
    inputSchema: z.object({
      days: z
        .number()
        .min(7)
        .max(180)
        .default(30)
        .describe("Lookback window in days"),
    }),
    execute: async ({ days }) => {
      const { analyzePowerDynamics } = await import(
        "@/lib/brain/analyzers/power-dynamics"
      );
      return analyzePowerDynamics({ days });
    },
  }),

  // 2026-06-20 · Dark psychology tactics lookup · queries BrainMemory for
  // relevant tactical patterns (cognitive biases, manipulation, social
  // engineering) matching the operator's current situation.
  getDarkPsychologyTactics: tool({
    description:
      "Look up dark psychology tactics (cognitive biases, manipulation techniques, social engineering patterns) relevant to the operator's current situation. Returns matching entries with triggers, actions, and applicability. Use when Nour asks about persuasion, influence, manipulation, cognitive biases, or tactical social dynamics.",
    inputSchema: z.object({
      query: z
        .string()
        .min(3)
        .max(300)
        .describe("Situation or topic to find matching tactics for"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("How many to return. Default 3."),
    }),
    execute: async ({ query, limit }) => {
      const cap = limit ?? 3;
      const q = query.toLowerCase();
      const rows = await prisma.brainMemory
        .findMany({
          where: {
            category: BRAIN_CATEGORIES.DARK_PSYCHOLOGY,
            deletedAt: null,
          },
          select: { key: true, content: true, metadata: true },
          take: 50,
        })
        .catch((): never[] => []);

      const scored = rows
        .map((r) => {
          const meta = (r.metadata as Record<string, unknown> | null) ?? {};
          const triggers = Array.isArray(meta.triggers)
            ? (meta.triggers as string[])
            : [];
          const hits = triggers.filter((t) => q.includes(t.toLowerCase()));
          return { r, hits: hits.length, title: String(meta.title ?? r.key) };
        })
        .filter((s) => s.hits > 0)
        .sort((a, b) => b.hits - a.hits)
        .slice(0, cap);

      return {
        ok: true,
        count: scored.length,
        tactics: scored.map((s) => {
          const meta = (s.r.metadata as Record<string, unknown> | null) ?? {};
          return {
            key: s.r.key,
            title: s.title,
            summary: String(meta.summary ?? ""),
            actions: Array.isArray(meta.actions) ? (meta.actions as string[]) : [],
            sourceBook: String(meta.sourceBook ?? ""),
          };
        }),
      };
    },
  }),

  // 2026-06-20 · Power-balance summary · lightweight read-only tool for
  // the reasoning engine. Calls computePowerBalance() for the top 5
  // people by interaction count. Returns name + balance + manual-lock.
  getPowerBalanceSummary: tool({
    description:
      "Get power-balance scores for the top 5 people by interaction count. Returns each person's name, power balance (-1 to +1), and whether it's manually locked. Use when reasoning about relationship leverage across the network.",
    inputSchema: z.object({}),
    execute: async () => {
      const { computePowerBalance } = await import(
        "@/lib/brain/power-balance-engine"
      );
      const people = await prisma.personProfile
        .findMany({
          where: { deletedAt: null },
          select: { id: true, name: true, powerBalance: true, interactionCount: true },
          orderBy: { interactionCount: "desc" },
          take: 5,
        })
        .catch((): never[] => []);

      const results = await Promise.all(
        people.map(async (p) => {
          const auto = await computePowerBalance(p.id).catch(() => null);
          return {
            name: p.name,
            currentBalance: p.powerBalance ?? 0,
            autoComputed: auto,
          };
        }),
      );
      return { count: results.length, people: results };
    },
  }),

  // 2026-06-20 · Contextual Greene laws · wraps pickContextualLawsForPerson
  // for the reasoning engine. Returns top 3 Greene laws applicable to a
  // specific person right now, with rationale and concrete actions.
  getContextualGreeneLaws: tool({
    description:
      "Get the top 3 Robert Greene laws applicable to a specific person right now, with rationale and concrete actions. Use when reasoning about relationship strategy for a specific contact.",
    inputSchema: z.object({
      personId: z.string().min(1).describe("PersonProfile ID"),
    }),
    execute: async ({ personId }) => {
      const { pickContextualLawsForPerson } = await import(
        "@/lib/ai/contextual-greene-laws"
      );
      const result = await pickContextualLawsForPerson(personId).catch(() => ({
        laws: [],
        source: "empty" as const,
        generatedAt: new Date().toISOString(),
      }));
      return { count: result.laws.length, laws: result.laws, source: result.source };
    },
  }),

  // ── Composure / control analyzer (Phase 2) ──────────────────────────
  analyzeComposure: tool({
    description:
      "Analyze the operator's emotional regulation and composure. Scores mood stability, drift control, decision quality under stress, recovery speed, and trigger management. Returns a 0-100 composure score with specific guidance.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(90).default(14).describe("Look-back window in days"),
    }),
    execute: async ({ days }) => {
      const { analyzeComposure } = await import(
        "@/lib/brain/analyzers/composure-control"
      );
      return analyzeComposure({ days });
    },
  }),

  // ── Competitive intelligence analyzer (Phase 4) ─────────────────────
  analyzeCompetitiveIntel: tool({
    description:
      "Analyze competitive landscape for Nick's Tire. Identifies competitor vulnerabilities (Chanakya-style), GSC keyword opportunities, and threats. Returns market position, exploit strategies, and guidance.",
    inputSchema: z.object({}),
    execute: async () => {
      const { analyzeCompetitiveIntel } = await import(
        "@/lib/brain/analyzers/competitive-intel"
      );
      return analyzeCompetitiveIntel();
    },
  }),

};


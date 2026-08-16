/**
 * buildContextHints · chat-route extract (2026-05-31)
 *
 * Lifted VERBATIM from app/api/ai/chat/route.ts (the cross-device
 * anchor read/write + live OPERATOR CONTEXT hint assembly, original
 * lines 674-918). Owns:
 *
 *   1. Wave 42 · cross-device anchor READ. When the operator arrives
 *      with NO client-side anchors (desktop→phone switch), read the
 *      single `cross_device_anchors / latest` BrainMemory row (2-hour
 *      freshness cap) and use its stored IDs as the first fallback.
 *   2. Wave 38 · top-priority active task fallback. If cross-device
 *      also produced nothing AND this is the first turn, seed
 *      lastTaskId from the top DOING/READY task.
 *   3. Wave 42 · WRITE current anchors back to the cross-device row
 *      (fire-and-forget upsert) so the next device inherits them.
 *   4. Wave 30/34/36/37 · assemble the `# OPERATOR CONTEXT (live)`
 *      block: current route + surface-aware TOOL_BIAS + the 7 entity
 *      anchor hints (task/goal/journal/decision/pin/reflection/mission)
 *      + the suggestion-tap hint.
 *
 * Returns the ready-to-append block string (empty when no hints fired).
 * Caller does `systemPrompt += block`. The `effective*` anchor values
 * are internal — they're only ever consumed to build the hint strings,
 * so they stay encapsulated here. Best-effort DB I/O only; no stream
 * coupling, no closures over caller state.
 */

import { prisma } from "@/lib/prisma";

/**
 * Surface-aware tool bias — BDN-103 (2026-08-12).
 *
 * When the operator's request is ambiguous between two tool families,
 * prefer the family matching the route they're sitting on. Intentionally
 * small: only cases where two tools could plausibly fire.
 *
 * This map was authored while the `contextRoute` lane was DEAD (no
 * client ever sent the field — Wave 30 → 2026-08-12/#1540), so its
 * coverage was never checked against the real route set. Extended here
 * from `components/layout/nav-items.ts` (the single nav source), and
 * every tool named below is verified present in `lib/ai/tools/catalog.ts`
 * — a bias naming a tool that does not exist is worse than no bias.
 *
 * Module-level + exported so the pin can assert both of those invariants.
 */
export const TOOL_BIAS: Record<string, string> = {
  "/missions": "createTask · completeTask · snoozeTask · setTaskPriority · updateTask",
  "/journal": "logSituation · journalDecision · classifyThought · reviewDecisionReplay",
  "/pins": "pinMemory · searchMemories",
  // /mastery + /plan + /life + /body all consolidated into /stats · merged tool bias.
  "/stats": "updateMasteryScore · setLifeGoal · logGoalProgress · archiveGoal · getCommitments · getBodyData · createMissionPlan · setOKRs · setWeeklyTargets · suggestMIT",
  // 2026-08-16 · syncKnowledge / searchColdMemory / searchSkills folded in
  // from the retired "/knowledge" key so the three tools keep a bias route.
  "/brain": "pinMemory · searchMemories · getBlindSpots · buildArchitectureMemory · syncKnowledge · searchColdMemory · searchSkills",
  "/system": "getCronStatus · toolHealth · getBrainHealth · getFleetTruth",
  "/business": "getFinancialSnapshot · getProjections · compareLiveRevenue",
  "/decisions": "journalDecision · reviewDecisionReplay · getDecisionReplays",
  // ── 2026-08-12 · routes that existed in nav but never had a bias ──
  "/content": "writeCreative · generateImage · getInstagramAutopostStatus · triggerInstagramAutopost · composeEmail",
  "/market": "getGscSummary · getGscTopQueries · analyzeCompetitiveIntel · compareCompetitors · analyzeTrends",
  "/people": "getPowerBalanceSummary · analyzePowerDynamics · getContextualGreeneLaws · scheduleFollowUp",
  "/learn": "searchSkills · getSkillProtocol · suggestSkills · captureSkillFromSource",
  // Home is the decision surface — bias to reading state, never to
  // minting new work. Safe ONLY because resolveToolBiasKey matches the
  // LONGEST prefix; with the old `find(startsWith)` this key would have
  // swallowed every route in the map depending on key order.
  "/": "getAttentionAlerts · getDashboardSummary · rankNextActions · recommendNextMove · getAgendaItems",
};

/**
 * PURE — longest-prefix match, exported for the pin.
 *
 * Replaces `Object.keys(TOOL_BIAS).find((k) => route.startsWith(k))`,
 * which returned the first key in INSERTION order — correct only by
 * accident, and silently breakable by reordering the object or adding a
 * shorter key that prefixes a longer one.
 */
export function resolveToolBiasKey(route: string): string | null {
  let best: string | null = null;
  for (const key of Object.keys(TOOL_BIAS)) {
    const matches = key === "/" ? true : route === key || route.startsWith(`${key}/`) || route.startsWith(key);
    if (!matches) continue;
    if (!best || key.length > best.length) best = key;
  }
  return best;
}

export interface BuildContextHintsInput {
  /** Number of messages in this turn — `=== 1` enables the Wave 38 fallback. */
  messageCount: number;
  /** The route the operator is currently sitting on (e.g. "/tasks"). */
  contextRoute: string | undefined;
  // Client-supplied anchors (from the chat control bar / PageContextBridge).
  lastTaskId: string | undefined;
  lastGoalId: string | undefined;
  lastSuggestionKind: string | undefined;
  lastSuggestionId: string | undefined;
  lastJournalEntryId: string | undefined;
  lastDecisionId: string | undefined;
  lastPinId: string | undefined;
  lastReflectionId: string | undefined;
  lastMissionId: string | undefined;
}

/**
 * @returns the `# OPERATOR CONTEXT (live)` block to append to the system
 * prompt, or an empty string when no hints fired.
 */
export async function buildContextHints(
  input: BuildContextHintsInput,
): Promise<string> {
  const {
    messageCount,
    contextRoute,
    lastTaskId,
    lastGoalId,
    lastSuggestionKind,
    lastSuggestionId,
    lastJournalEntryId,
    lastDecisionId,
    lastPinId,
    lastReflectionId,
    lastMissionId,
  } = input;

  // v10.0.529.94 · Wave 38 · NEW-CONVERSATION FALLBACK ANCHOR.
  // When the operator opens a fresh chat and says "snooze it" / "do it"
  // with no prior anchor wiring (no contextRoute, no suggestion tap,
  // no PageContextBridge state), the system prompt previously had
  // nothing to resolve "it" against and Nick had to fuzzy-match.
  // Pre-seed lastTaskId from the top-priority active task when ALL
  // anchors are missing AND this is the first turn. ~5ms cost · zero
  // impact on later turns (anchors already set).
  let effectiveLastTaskId = lastTaskId;
  let effectiveLastGoalId = lastGoalId;
  let effectiveLastJournalEntryId = lastJournalEntryId;
  let effectiveLastDecisionId = lastDecisionId;
  let effectiveLastPinId = lastPinId;
  let effectiveLastReflectionId = lastReflectionId;
  let effectiveLastMissionId = lastMissionId;
  const noAnchors =
    !lastTaskId &&
    !lastGoalId &&
    !lastJournalEntryId &&
    !lastDecisionId &&
    !lastPinId &&
    !lastReflectionId &&
    !lastMissionId &&
    !lastSuggestionId;
  if (noAnchors) {
    // v10.0.529.98 · Wave 42 · cross-device continuity. Anchors live in
    // client-side React state + localStorage · operator switching from
    // desktop to phone loses them. We persist the LATEST anchors to a
    // single BrainMemory row (cross_device_anchors / latest) on every
    // chat turn (further down in route.ts) · here we READ them as the
    // first fallback when no client-side anchors arrived. 2-hour cap
    // so stale context doesn't bleed into a fresh session next morning.
    try {
      const crossDevice = await prisma.brainMemory
        .findFirst({
          where: {
            category: "cross_device_anchors",
            key: "latest",
            deletedAt: null,
            updatedAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
          },
          select: { content: true },
        })
        .catch(() => null);
      if (crossDevice?.content) {
        try {
          const stored = JSON.parse(crossDevice.content) as {
            lastTaskId?: string;
            lastGoalId?: string;
            lastJournalEntryId?: string;
            lastDecisionId?: string;
            lastPinId?: string;
            lastReflectionId?: string;
            lastMissionId?: string;
          };
          effectiveLastTaskId = effectiveLastTaskId ?? stored.lastTaskId;
          effectiveLastGoalId = effectiveLastGoalId ?? stored.lastGoalId;
          effectiveLastJournalEntryId =
            effectiveLastJournalEntryId ?? stored.lastJournalEntryId;
          effectiveLastDecisionId = effectiveLastDecisionId ?? stored.lastDecisionId;
          effectiveLastPinId = effectiveLastPinId ?? stored.lastPinId;
          effectiveLastReflectionId =
            effectiveLastReflectionId ?? stored.lastReflectionId;
          effectiveLastMissionId = effectiveLastMissionId ?? stored.lastMissionId;
        } catch {
          // ignore malformed JSON
        }
      }
    } catch {
      // silent · cross-device fallback is best-effort
    }

    // Fall back to top-priority active task ONLY if cross-device read
    // also produced nothing AND this is the first turn (Wave 38 logic).
    if (!effectiveLastTaskId && messageCount === 1) {
      try {
        const topTask = await prisma.task
          .findFirst({
            where: { status: { in: ["DOING", "READY"] }, deletedAt: null },
            orderBy: [
              { status: "asc" }, // DOING ranks before READY alphabetically · semantically correct
              { autoPriority: "desc" },
              { lastTouchedAt: "desc" },
            ],
            select: { id: true },
          })
          .catch(() => null);
        if (topTask?.id) {
          effectiveLastTaskId = topTask.id;
        }
      } catch {
        // silent · fallback anchor is best-effort
      }
    }
  }

  // v10.0.529.98 · Wave 42 · WRITE current anchors back to cross-device
  // storage. Fire-and-forget · doesn't block the chat path. Skip when
  // every anchor is empty (don't pollute storage with noise rows).
  // Uses upsert so we keep one canonical "latest" row that gets updated
  // in place · prevents unbounded growth.
  const anyAnchorPresent = !!(
    lastTaskId ||
    lastGoalId ||
    lastJournalEntryId ||
    lastDecisionId ||
    lastPinId ||
    lastReflectionId ||
    lastMissionId
  );
  if (anyAnchorPresent) {
    void prisma.brainMemory
      .upsert({
        where: { id: "cross_device_anchors_latest" },
        create: {
          id: "cross_device_anchors_latest",
          category: "cross_device_anchors",
          key: "latest",
          content: JSON.stringify({
            lastTaskId,
            lastGoalId,
            lastJournalEntryId,
            lastDecisionId,
            lastPinId,
            lastReflectionId,
            lastMissionId,
          }),
          source: "chat-turn",
          confidence: 1.0,
          createdBy: "system",
        },
        update: {
          content: JSON.stringify({
            lastTaskId,
            lastGoalId,
            lastJournalEntryId,
            lastDecisionId,
            lastPinId,
            lastReflectionId,
            lastMissionId,
          }),
          updatedAt: new Date(),
          deletedAt: null, // un-soft-delete if it was cleared
        },
      })
      .catch(() => null);
  }

  // v10.0.529.86 · Wave 30 · live context hints. Tells the model
  // what page the operator is currently on, which task/goal they
  // last touched, and whether they tapped a NickSuggestions chip.
  // Resolves "this task" / "do that" / "yes go ahead" without
  // fuzzy-title gymnastics. Cheap · always ≤ 200 chars. Appended
  // AFTER the cached base prompt so it doesn't poison the cache.
  const contextHints: string[] = [];
  if (contextRoute) {
    contextHints.push(`The operator is currently on \`${contextRoute}\`.`);
    // v10.0.529.92 · Wave 36 · surface-aware tool biasing. When the
    // operator's request is ambiguous between two tool families,
    // prefer the one that matches the route they're sitting on. Cuts
    // hallucinated tool calls (e.g. createTask firing when the operator
    // on /journal really meant journalDecision). Mapping is intentionally
    // small · only the cases where two tools could plausibly fire.
    const biasKey = resolveToolBiasKey(contextRoute);
    if (biasKey) {
      contextHints.push(
        `Surface-aware tool bias · prefer these tools for ambiguous requests on this route: ${TOOL_BIAS[biasKey]}.`,
      );
    } else {
      // v10.0.529.93 · Wave 37 · route-miss fallback. Audit found
      // 5 routes lacked a TOOL_BIAS entry (/photo-improver /social /
      // content /cockpit /knowledge sub-paths). Generic fallback so
      // the model still gets behavioral direction instead of just
      // a route name. Strips leading "/" and uses the first segment.
      const surface = contextRoute.split("/").filter(Boolean)[0] ?? "";
      if (surface) {
        contextHints.push(
          `For ambiguous requests on this route, prefer tools whose names match "${surface}" or are read-oriented over write-oriented.`,
        );
      }
    }
  }
  if (effectiveLastTaskId) {
    // Wave 38 · effectiveLastTaskId falls back to the top active task
    // for new conversations with no anchors · the original lastTaskId
    // wins when set explicitly via PageContextBridge or suggestion tap.
    const anchorSource = lastTaskId
      ? "operator's last touch"
      : "current top-priority active task (auto-seeded · low confidence · confirm before destructive moves)";
    contextHints.push(`Their most-recently-touched taskId is \`${effectiveLastTaskId}\` (${anchorSource}) — use it directly when they say "this task" / "snooze this" / "complete it".`);
  }
  // v10.0.529.98 · Wave 42 · all 7 entity hints now use `effective*`
  // values so cross-device fallback flows through. When the value
  // arrived via fallback (not client-side), annotate the source so
  // Nick treats it as lower-confidence + confirms before destructive
  // actions. Same pattern as Wave 38's task fallback annotation.
  if (effectiveLastGoalId) {
    const src = lastGoalId ? "" : " (cross-device · confirm before destructive moves)";
    contextHints.push(`Their most-recently-touched goalId is \`${effectiveLastGoalId}\`${src} — use it for "this goal" / "log progress on it".`);
  }
  if (lastSuggestionKind && lastSuggestionId) {
    contextHints.push(`They just tapped a Nick proactive suggestion (kind="${lastSuggestionKind}", id="${lastSuggestionId}"). "Yes" / "do that" / "go ahead" means proceed with this suggestion's intent.`);
  }
  // v10.0.529.90 · Wave 34 · expanded entity anchors. The chat client
  // extracts entity IDs from suggestion chip IDs (e.g. broken-promise-
  // <taskId>) AND from /journal#bd-<id> deep-links so Nick can resolve
  // "this reflection" / "grade this decision" / "unpin this" / "act
  // on it" without guessing.
  if (effectiveLastJournalEntryId) {
    const src = lastJournalEntryId ? "" : " (cross-device · confirm)";
    contextHints.push(`Their most-recently-touched journalEntryId is \`${effectiveLastJournalEntryId}\`${src} — use it for "this entry" / "this brain dump".`);
  }
  if (effectiveLastDecisionId) {
    const src = lastDecisionId ? "" : " (cross-device · confirm)";
    contextHints.push(`Their most-recently-touched decisionId is \`${effectiveLastDecisionId}\`${src} — use it for "this decision" / "grade it" / "review that".`);
  }
  if (effectiveLastPinId) {
    const src = lastPinId ? "" : " (cross-device · confirm)";
    contextHints.push(`Their most-recently-touched pinId is \`${effectiveLastPinId}\`${src} — use it for "this pin" / "unpin it" / "refresh that".`);
  }
  if (effectiveLastReflectionId) {
    const src = lastReflectionId ? "" : " (cross-device · confirm)";
    contextHints.push(`Their most-recently-touched reflectionId is \`${effectiveLastReflectionId}\`${src} — use it for "this reflection" / "act on it" / "convert to a task".`);
  }
  if (effectiveLastMissionId) {
    const src = lastMissionId ? "" : " (cross-device · confirm)";
    contextHints.push(`Their most-recently-touched missionId is \`${effectiveLastMissionId}\`${src} — use it for "this mission" / "this project".`);
  }
  if (contextHints.length > 0) {
    return `\n\n# OPERATOR CONTEXT (live)\n${contextHints.join("\n")}`;
  }
  return "";
}

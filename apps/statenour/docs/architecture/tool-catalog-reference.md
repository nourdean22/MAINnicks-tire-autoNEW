# Tool catalog reference · every tool Nick can call

The authoritative tool count lives in `lib/ai/tools/catalog.ts`
(`TOOL_CATALOG.length`). At time of writing: **138 tools** registered
(verified 2026-05-21). A contract test in
`tests/ai/tool-contract.test.ts` asserts 1:1 alignment between
`nourTools` (the function objects in `lib/ai/tools.ts`) and the
catalog metadata (this list).

> Sorted by `ToolCategory` matching `catalog.ts`. Each row shows the
> name, what it does, its inputs, its outputs, cost tier, battle-safe
> flag (read-only + fast = safe in BATTLE mode), what it talks to, and
> when the chat-pipeline pruner surfaces it.

### How the pruner decides

`lib/ai/chat-mode.ts:pruneTools` is the gatekeeper between the
catalog and the model:

- **CORE tools** are always included (10 names: `classifyThought`,
  `searchMemories`, `getRecentReflections`, `searchReflections`,
  `rankNextActions`, `getBlindSpots`, `syncKnowledge`, `dailyPulse`,
  `setTaskPriority`, `runDeviceCommand`)
- **Semantic top-N** when the tool-embedding cache is warm: top-15
  in standard mode, top-40 in deep mode, cosine floor 0.25
- **Keyword regex fallback** when the cache is cold
- **Always-on overrides** from `aiConfig.alwaysOnTools` (Settings)
- **Blocklist** from `aiConfig.disabledTools` (Settings) +
  circuit-breaker via `isToolBlocked(name)` (`lib/ai/tool-telemetry`)

### Cost tier reference

| Tier      | Meaning                                                    |
|-----------|------------------------------------------------------------|
| `free`    | DB read or pure local logic · no external API              |
| `cheap`   | One embedding call OR one bridge call · sub-$0.001         |
| `medium`  | One LLM call · ~$0.01-0.05 per invocation                  |
| `spendy`  | Image generation / multi-agent / external paid API         |

---

## `personal_read` — daily ops · habits · body · finance · schedule (15)

| Tool                       | Description                                                                        | Input                       | Output                                                                      | Cost  | Battle | Talks to                       |
|----------------------------|------------------------------------------------------------------------------------|-----------------------------|----------------------------------------------------------------------------|-------|--------|--------------------------------|
| `getBodyData`              | Recent body tracking entries                                                       | `days: 1-365` (default 30)  | `BodyTracking[]`                                                            | free  | yes    | `BodyTracking` table           |
| `getCameraIntelligence`    | Live camera/traffic data summary                                                   | `{}`                         | summary of `camera_intelligence`                                            | free  | yes    | `lib/brain/camera-intelligence`|
| `getCommitments`           | Active commitments (status in active/in_progress)                                  | `{}`                         | `Commitment[]`                                                              | free  | yes    | `Commitment` table             |
| `getDecisionReplays`       | Decisions due for review                                                           | `{}`                         | `DecisionReplay[]`                                                          | free  | yes    | `DecisionReplay` table         |
| `getDriftAlerts`           | Unresolved drift alerts                                                            | `{}`                         | `DriftAlert[]`                                                              | free  | yes    | `DriftAlert` table             |
| `getFinancialSnapshot`     | Latest financial snapshot                                                          | `{}`                         | `FinancialSnapshot`                                                         | free  | yes    | `FinancialSnapshot` table      |
| `getHabitStreaks`          | Habit completion data — current streaks for DAILY-loop tasks                       | `{}`                         | `{ [taskTitle]: { completed, total } }`                                     | free  | yes    | `Task` (loopKind=DAILY)        |
| `getMasteryScores`         | Current mastery domain scores (last 12)                                            | `{}`                         | `MasteryScore[]`                                                            | free  | yes    | `MasteryScore` table           |
| `getMissions`              | Active missions                                                                    | `{}`                         | `Mission[]`                                                                 | free  | yes    | `Mission` table                |
| `getProjections`           | AI-generated projections                                                           | `{}`                         | projections array                                                           | free  | yes    | `BrainMemory(projection)`      |
| `getTasks`                 | Active tasks with their missions (INBOX/READY/DOING)                               | `{}`                         | `Task[]` with `mission`                                                     | free  | yes    | `Task` + `Mission`             |
| `getTodaySchedule`         | Google Calendar events for today + N days ahead                                    | `daysAhead: 0-14`            | `{ ok, count, events[] }`                                                   | free  | yes    | Google Calendar API            |
| `proposeCalendarEvent`     | Propose new GCal event · returns compose URL (human confirms)                      | `title, startISO, endISO?, location?, description?, attendees?` | `{ composeUrl, summary, start, end }`                                       | free  | yes    | Google Calendar (URL only)     |
| `runPython`                | Execute Python in E2B sandbox · numpy/pandas/matplotlib/scipy/requests             | `code: string`              | `{ stdout, stderr, charts[] }`                                              | cheap | no     | E2B API (`E2B_API_KEY`)        |
| `searchDocuments`          | Semantic search across uploaded documents                                          | `query: string, limit: 1-10`| `{ count, results[] }` with filename, similarity                            | cheap | yes    | `lib/services/document-ingest` |
| `ingestDocumentFromUrl`    | Fetch a public document from URL · ingest to operator index                        | `url, filename?`            | `{ ok, documentId, chunks }`                                                | cheap | no     | document-ingest service        |
| `findRelatedConversations` | Find past chat conversations semantically similar to a topic                       | `query, limit?, activeConversationId?` | `{ count, matches: [{ conversationId, summary, similarity, date }] }`        | cheap | yes    | `lib/brain/conversation-recall`|
| `searchWebVerified`        | Cross-verified web search (Perplexity + Tavily + Exa) · consensus or disagreement  | `query, sources?, domains?, recency?` | consensus + per-source citations + confidence                                | medium| no     | Perplexity/Tavily/Exa APIs     |
| `suggestSkills`            | Top Claude skills (from 1,423 indexed) semantically similar to a query             | `query, limit?`             | `{ count, skills[] }` with similarity                                       | cheap | yes    | `lib/skills/skill-recall`      |
| `surfaceAntiPatterns`      | Recent anti-patterns (D/F decisions + recurring drift loops + broken commitments)  | `limit?, topic?`            | `{ count, patterns[] }` with severity + lastSeen                            | free  | yes    | `BrainMemory(anti_pattern)`    |

---

## `personal_write` — task + commitment + goal mutations (17)

| Tool                       | Description                                                                        | Input                                                  | Output                                | Cost | Side-effect | Talks to                  |
|----------------------------|------------------------------------------------------------------------------------|--------------------------------------------------------|---------------------------------------|------|------|---------------------------|
| `addTasksToProject`        | Create multiple tasks under a mission in bulk                                      | `missionId, tasks[]` with `{ title, nextPhysicalAction, effort, context }` | `{ created, count, tasks[] }`         | free | no   | `Task` table              |
| `completeCommitment`       | Mark a commitment done                                                             | `commitmentId`                                          | `{ completed }`                       | free | no   | `Commitment` table        |
| `completeTask`             | Mark a task as DONE                                                                | `taskId`                                                | `{ completed, taskId }`               | free | no   | `Task` table              |
| `createCommitment`         | Create a new commitment with deadline + toWhom                                     | `description, deadline?, toWhom?, status?`              | `{ created, commitmentId }`           | free | no   | `Commitment` table        |
| `createMissionPlan`        | Create a full mission with tasks                                                   | mission + tasks payload                                 | `{ created, missionId, taskCount }`   | free | no   | `Mission` + `Task`        |
| `createTask`               | Create a single task under a mission                                               | `title, missionId, nextPhysicalAction, effort, context` | `{ created, taskId, title }`          | free | no   | `Task` table              |
| `journalDecision`          | Log a decision from conversation                                                   | `title, options?, chosen?, stakes?`                     | `{ logged, decisionId }`              | free | no   | `MasteryDecision` table   |
| `logSituation`             | Log a strategic situation for Greene-law analysis                                  | `context, situation, emotion?, lawHits?`                | `{ logged, situationLogId }`          | free | no   | `SituationLog` table      |
| `markCommitmentBroken`     | Mark a commitment as broken (operator owns up to the miss)                         | `commitmentId, reason?`                                 | `{ marked }`                          | free | no   | `Commitment` + anti-pattern auto-promote chain |
| `resolveAlert`             | Resolve a drift alert                                                              | `alertId`                                               | `{ resolved }`                        | free | no   | `DriftAlert` table        |
| `reviewDecisionReplay`     | Grade a past decision (assigns A-F + outcome)                                      | `decisionId, grade, actualOutcome`                      | `{ reviewed }`                        | free | no   | `DecisionReplay` + auto-promote to anti_pattern |
| `runDeviceCommand`         | Bridge chat → physical devices ("lock front door" / "turn off shop lights")        | `deviceId, command, params?`                            | `{ enqueued, commandId }`             | free | **yes**| `DeviceCommand` queue   |
| `setLifeGoal`              | Set or update a life goal                                                          | `domain, statement, horizon?`                           | `{ set, lifeGoalId }`                 | free | no   | `LifeGoal` table          |
| `setTaskPriority`          | Override task priority (0-100, higher = more urgent)                               | `taskId? OR titleQuery?, priority, reason?`             | `{ updated, taskId }`                 | free | no   | `Task.manualPriorityOverride` |
| `triageStaleLead`          | Triage a stale lead (route to followup / drop / followup_now)                      | `leadId, decision, reason?`                             | `{ triaged }`                         | free | no   | `Task` + `BrainMemory`    |
| `updateCommitment`         | Update commitment status / deadline / description                                  | `commitmentId, status?, deadline?, description?`        | `{ updated }`                         | free | no   | `Commitment` table        |
| `updateMasteryScore`       | Update a mastery score for a specific domain                                       | `domain, score`                                         | `{ updated }`                         | free | no   | `MasteryScore` table      |

---

## `planning` — weekly targets · OKRs · MIT · follow-ups (10)

| Tool                | Description                                                                              | Input                                                | Output                                | Cost  | Battle | Talks to               |
|---------------------|------------------------------------------------------------------------------------------|------------------------------------------------------|--------------------------------------|-------|--------|------------------------|
| `checkCommitments`  | Check all active commitments · what's on track, what's overdue, what needs follow-up      | `{}`                                                  | `{ total, overdue, dueSoon, openEnded }` | free | yes    | `Commitment` table     |
| `clearMit`          | Clear today's Most Important Task                                                        | `{}`                                                  | `{ cleared }`                         | free  | no     | `BrainMemory(mit)`     |
| `decisionPreFlight` | Pre-flight checklist before high-stakes decision · emotional state + cognitive load      | `decision, stakes, reversible`                        | `{ recommendation, riskScore, risks[] }` | cheap | no     | `BrainMemory` + identity snapshot |
| `getWeeklyTargets`  | Get this week's 3 targets (revenue / personal / health)                                  | `{}`                                                  | `{ hasTargets, weekOf, targets }`     | free  | yes    | `BrainMemory(weekly_target)` |
| `rankNextActions`   | Rank pending tasks by ROI / friction / context fit                                       | `{}`                                                  | ranked task array                     | cheap | no     | `Task` + AI ranker     |
| `scheduleFollowUp`  | Schedule a follow-up reminder for a person / commitment / lead                           | `description, dueAt, channel?`                        | `{ scheduled }`                       | free  | no     | `ScheduledAction` table|
| `setMit`            | Set today's Most Important Task                                                          | `mit`                                                 | `{ set, mit }`                        | free  | no     | `BrainMemory(mit)`     |
| `setOKRs`           | Set quarterly OKRs (objective + 3 key results)                                           | `objective, keyResults[]`                             | `{ set, okrId }`                      | free  | no     | `BrainMemory(strategic_plan)` |
| `setWeeklyTargets`  | Set this week's 3 targets (revenue / personal / health)                                  | `revenue, personal, health`                           | `{ stored, weekOf, targets }`         | free  | no     | `BrainMemory(weekly_target)` |
| `suggestMIT`        | Suggest Most Important Task based on current commitments + drift + revenue gaps          | `{}`                                                  | `{ suggestion, reasoning }`           | cheap | no     | `Task` + AI suggester  |

---

## `business_read` — shop · customer · revenue (6)

| Tool                  | Description                                            | Input          | Output                          | Cost | Battle | Talks to                |
|-----------------------|--------------------------------------------------------|----------------|--------------------------------|------|--------|-------------------------|
| `compareCompetitors`  | Competitor comparison (pricing + services + reviews)   | `{}`            | competitor analysis array       | free | yes    | `BrainMemory(industry)` |
| `getDashboardSummary` | Full dashboard summary (revenue + leads + tasks)       | `{}`            | dashboard payload               | free | yes    | local cached aggregates |
| `getEstimateLeaks`    | Find revenue leaks · unconverted estimates             | `{}`            | leak array · $value declined    | free | yes    | nickstire bridge (estimates) |
| `getReviewStats`      | Review statistics (count + avg + recency)              | `{}`            | review stats payload            | free | yes    | `BrainMemory(review_stats)` |
| `getRevenueStats`     | Revenue statistics (day / week / month)                | `period`        | revenue + comparison            | free | yes    | nickstire bridge (revenue) |

---

## `business_write` — quote · payment · SMS (1)

| Tool               | Description                                                                                 | Input                                                | Output                                  | Cost  | Side-effect | Talks to       |
|--------------------|---------------------------------------------------------------------------------------------|------------------------------------------------------|----------------------------------------|-------|------|----------------|
| `createQuickQuote` | Quote creation REDIRECTS to nickstire admin (no bridge mutation surface). Returns prefill.  | `customerName?, vehicleYear, vehicleMake, vehicleModel, services, tireSize?, tireQty?` | `{ created: false, redirect, message, prefill, adminUrl }` | cheap | **yes**| (redirect only) |

> Note: this tool intentionally returns `created: false` after the
> v10.0.54 cleanup. The bridge mutation surface for quotes doesn't
> exist yet — Nick relays the redirect, operator clicks through to
> nickstire.org/admin/quotes/new.

---

## `live_shop` — nickstire bridge live queries (8 · all need bridge)

| Tool                       | Description                                                                                                  | Input                              | Output                                              | Cost | Battle | Bridge query              |
|----------------------------|--------------------------------------------------------------------------------------------------------------|------------------------------------|----------------------------------------------------|------|--------|---------------------------|
| `compareLiveRevenue`       | Compare revenue across two date ranges                                                                       | `period1From/To, period2From/To`    | `{ period1, period2, note }`                       | free | yes    | `revenue_range` x2        |
| `findCustomer`             | MUST USE before asserting facts about any customer · 360° timeline (shop + brain memories + PersonProfile)   | `nameOrPhone`                       | `{ timeline, customer, shopData, quotesCount, memoriesCount }` | free | yes | `customer_search`         |
| `getAttentionAlerts`       | What needs attention NOW · stale leads + unanswered callbacks + overdue WOs + unpaid invoices                | `{}`                                | alert payload                                       | free | yes    | `attention_needed`        |
| `getShopSnapshot`          | Quick live shop snapshot · revenue today + open WOs + bookings                                               | `{}`                                | snapshot payload                                    | free | yes    | (batch query)             |
| `queryNickstire`           | Generic bridge query · supply query name + filters                                                           | `query, from?, to?, term?`          | bridge response                                     | free | yes    | (any registered query)    |
| `getGscSummary`            | Real GSC totals for nickstire.org over a date range · clicks + impressions + CTR + position                  | `from?, to?` (default 30d)          | `{ totalClicks, totalImpressions, avgCtr, avgPosition, daysCovered }` | free | no | `gsc_summary`             |
| `getGscTopQueries`         | Top search queries driving organic traffic to nickstire.org                                                  | `from?, to?, limit?` (default 10, max 50) | per-query clicks + impressions + CTR + position    | free | no     | `gsc_top_queries`         |
| `getMarketingAttribution`  | Source-by-source attribution · leads → conversions → revenue per channel (popup / chat / booking / sms / …)  | `from?, to?` (default 30d)          | ranked source rows                                  | free | yes    | `marketing_attribution`   |

---

## `content` — image + chart (2)

| Tool                | Description                                                                                                                 | Input                                                            | Output                                          | Cost   | Side-effect | Talks to                 |
|---------------------|-----------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------|------------------------------------------------|--------|------|--------------------------|
| `generateImage`     | Generate AI image via Venice (flux-2-pro by default) · auto-injects Nick's Tire brand when prompt reads as marketing        | `prompt, size: 512x512 \| 1024x1024 \| 1536x1024 \| 1024x1536`     | `{ imageUrl, dataUrl, imageId, model }`         | spendy | **yes**| Venice flux-2-pro API    |
| `renderInlineChart` | Render an inline chart (line / sparkline / bar / pie) · Nick MUST include returned markdown for the React component to render | `type, data[], title?, color?`                                  | `{ markdown, summary }`                         | free   | no     | `nick-message.tsx` <pre> override |

---

## `comms` — SMS + Telegram + Gmail (4)

| Tool                       | Description                                                                                | Input                          | Output                  | Cost  | Side-effect | Talks to             |
|----------------------------|--------------------------------------------------------------------------------------------|--------------------------------|------------------------|-------|------|----------------------|
| `arsenalGmailInbox`        | List recent Gmail inbox messages                                                           | `limit?, unreadOnly?`           | inbox array             | free  | no   | Gmail API            |
| `arsenalGmailReadThread`   | Fetch a full Gmail thread by ID                                                            | `threadId`                      | thread payload          | free  | no   | Gmail API            |
| `composeEmail`             | Render an inline email-composer card · POST to /api/email/send requires auth + user click  | `to, subject, body, cc?, bcc?` | `{ markdown, summary }` | free  | no   | Inline renderer only |
| `sendTelegram`             | Push urgent message to Nour's Telegram                                                     | `message, priority?`            | `{ sent, messageId }`   | free  | **yes**| Telegram Bot API   |

---

## `ai_analysis` — SQL · code · summarize · sentiment · math (9)

| Tool             | Description                                                          | Input                | Output                          | Cost   | Talks to                  |
|------------------|----------------------------------------------------------------------|----------------------|--------------------------------|--------|---------------------------|
| `analyzeImage`   | Analyze an attached image · OCR + object ID + receipt/ad/screenshot parse | `imageContext, extractNumbers?` | `{ instruction, context, guidelines[] }` | spendy | downstream vision LLM call |
| `analyzeSentiment`| Analyze sentiment of provided text                                  | `text`                | sentiment payload               | cheap  | AI provider               |
| `extractData`    | Extract structured data from text (JSON shape)                       | `text, schema`        | extracted JSON                   | cheap  | AI provider               |
| `generateCode`   | Generate code snippet (language + spec)                              | `language, spec`      | code string                      | medium | AI provider (`task=code`) |
| `generateSQL`    | Generate SQL query for a natural-language spec                       | `description`         | SQL string                       | cheap  | AI provider (`task=sql`)  |
| `runCode`        | Execute JavaScript in a VM sandbox · Math/Date/JSON + avg/sum/min/max/pct/delta helpers · 5s timeout | `code, description?`   | `{ success, result, logs?, description }` | free   | Node `vm` module          |
| `solveMath`      | Solve math problem with steps                                        | `problem`             | `{ answer, steps }`              | cheap  | AI provider (`task=math`) |
| `summarize`      | Summarize text                                                       | `text, length?`       | summary string                   | cheap  | AI provider (`task=summary`) |
| `writeCreative`  | Write creative content (caption / post / tagline)                    | `prompt, voice?`      | creative string                  | medium | AI provider (`task=creative`) |

---

## `brain` — brain intelligence + memory ops (18)

| Tool                          | Description                                                                                  | Input               | Output                                        | Cost   | Battle | Talks to                       |
|-------------------------------|----------------------------------------------------------------------------------------------|---------------------|----------------------------------------------|--------|--------|--------------------------------|
| `checkAntiPattern`            | Check if current intent matches a known anti-pattern                                         | `intent`            | `{ match?, severity, lesson }`               | free   | yes    | `BrainMemory(anti_pattern)`    |
| `classifyThought`             | Classify a thought into category + sentiment + actionability                                 | `thought`           | classification payload                        | cheap  | no     | `lib/brain/journal-ingest`     |
| `getBlindSpots`               | Detect blind spots (decisions / commitments / projects that operator is avoiding)            | `{}`                | blind-spot array                              | free   | yes    | `lib/brain/blind-spot-detector`|
| `getBrainHealth`              | Full brain health report · memory count + learning velocity + prediction accuracy            | `{}`                | `{ velocity, health }`                        | free   | yes    | `lib/brain/learning-velocity` + `memory-consolidation` |
| `getEmotionalState`           | Current emotional arc · stress trajectory + dominant state + triggers + decision risk        | `{}`                | emotional arc payload                         | free   | yes    | `lib/brain/emotional-arc`      |
| `getHabitRevenueCorrelation`  | Show how habits correlate with business outcomes                                             | `{}`                | `{ correlations[] }`                          | cheap  | no     | `BrainMemory(habit_revenue_correlation)` |
| `getRecentReflections`        | Recent reflections (daily/weekly/monthly/triggered)                                          | `limit?`            | `Reflection[]`                                | free   | yes    | `Reflection` table             |
| `listTools`                   | List all available tools organized by category                                               | `category?`         | tool catalog                                  | free   | yes    | (catalog itself)               |
| `runSimulation`               | Run a "what if" simulation · predict cascade of consequences                                 | `scenario`          | simulation payload                            | medium | no     | `lib/brain/thinking-engine`    |
| `searchBrainDumps` → **retired** v10.0.74 (use `searchReflections`)                                                              |                     |                                              |        |        |                                |
| `searchColdMemory`            | Search the cold-memory archive (older than active 30d window)                                | `query, limit?`     | cold-memory hits                              | cheap  | no     | `lib/brain/cold-memory`        |
| `searchConversations`         | Search past chat conversations by content                                                    | `query, limit?`     | conv hits                                     | free   | yes    | `ChatMessage` full-text        |
| `searchGreeneLaws`            | Search 189 Greene's Laws + 48 Laws + 33 Strategies + Human Nature + Mastery + 50th Law       | `query, limit?`     | `StrategicLaw[]`                              | free   | yes    | `StrategicLaw` table           |
| `searchMemories`              | Search BrainMemory by content + category                                                     | `query, category?, limit?` | memory hits                              | free   | yes    | `BrainMemory` table            |
| `searchReflections`           | Search Reflection rows + BrainDump entries · date range supported                            | `query, dateFrom?, dateTo?` | `{ reflections, brainDumps }`            | free   | yes    | `Reflection` + `BrainDump`     |
| `searchSkills`                | Top Claude skills (from 1,423 indexed) semantically similar to a query                       | `query, limit?`     | top-K skill hits                              | cheap  | no     | `lib/skills/skill-recall`      |
| `syncDriveMemory`             | Sync Drive document changes into brain memory                                                | `{}`                | `{ synced, count }`                           | spendy | **yes**| Google Drive + `BrainMemory`   |
| `syncKnowledge`               | Run the knowledge-sync pipeline (RSS feeds + curated sources)                                | `{}`                | `{ synced, sources[] }`                       | spendy | **yes**| `lib/brain/knowledge-sync`     |
| `toolHealth`                  | Check tool dependency health · DB latency + env vars + tool count                            | `{}`                | `{ status, database, services, toolCount, recommendation }` | free | yes | env vars + `prisma`            |

---

## `files` — Drive + GitHub (14)

| Tool                       | Description                                                          | Input                                              | Output                                    | Cost | Battle | Side-effect | Talks to                 |
|----------------------------|----------------------------------------------------------------------|----------------------------------------------------|------------------------------------------|------|--------|------|--------------------------|
| `buildArchitectureMemory`  | Scan a repo feature + store its architecture in brain memory         | `repo, feature, filePaths[], summary`              | `{ stored, feature, repo }`              | spendy | no   | no   | `BrainMemory(architecture)` |
| `getRepoMap`               | Return the structured repo metadata (stack + key paths + branch)     | `repo`                                              | `{ name, branch, stack, keyPaths }`      | cheap | no    | no   | `config/repos.ts`        |
| `githubCreateIssue`        | Create a GitHub issue                                                | `repo, title, body, labels?`                        | `{ created, number, url }`                | free | no     | **yes**| GitHub API             |
| `githubCreatePR`           | Create a pull request                                                | `repo, title, body, head, base, draft?`             | `{ created, number, url }`                | free | no     | **yes**| GitHub API             |
| `githubListFiles`          | List files in a repo directory                                       | `repo, path, ref?`                                  | files array                               | free | yes    | no   | GitHub API               |
| `githubListRepos`          | List all configured repos                                            | `{}`                                                 | repo array                                | free | yes    | no   | `config/repos.ts`        |
| `githubReadFile`           | Read a single file from a repo                                       | `repo, path, ref?`                                  | `{ content, sha }`                        | free | yes    | no   | GitHub API               |
| `githubReadMultiple`       | Read multiple files from a repo in one call                          | `repo, paths[], ref?`                               | files array                               | free | no     | no   | GitHub API               |
| `githubRecentCommits`      | Recent commits on a branch                                           | `repo, branch?, limit?`                             | commits array                             | free | yes    | no   | GitHub API               |
| `githubSearchCode`         | Search code across all configured repos                              | `query, repo?, language?`                           | search hits                               | free | no     | no   | GitHub API               |
| `learnCodingPreference`    | Store a coding preference Nour expressed (tab vs space, naming, etc.)| `preference, scope?`                                | `{ stored }`                              | free | no     | no   | `BrainMemory(coding_preference)` |
| `listRecentDriveFiles`     | List recently modified files in Nour's Drive                         | `limit: 1-20` (default 10)                          | `{ files[], count }`                      | free | yes    | no   | Google Drive API         |
| `readDriveFile`            | Read content of a Drive document (Docs / Sheets / text / markdown)   | `fileId, mimeType?`                                 | `{ name, content, truncated }`            | free | no     | no   | Google Drive API         |
| `searchDriveFiles`         | Search Google Drive by full-text query                               | `query`                                              | `{ files[], count, query }`               | free | no     | no   | Google Drive API         |

---

## `routines` — daily / weekly / EOD (4)

| Tool          | Description                                                                                              | Input | Output                          | Cost   | Talks to             |
|---------------|----------------------------------------------------------------------------------------------------------|-------|--------------------------------|--------|----------------------|
| `analyzeWeek` | Deep week analysis · AI synthesis of revenue + scores + tasks + drift                                    | `{}`   | analysis payload                | medium | multi-source aggregator |
| `dailyPulse`  | One-shot daily status · revenue + alerts + leads + callbacks + WOs + bookings + tasks + score + drift     | `{}`   | full pulse payload              | cheap  | nickstire bridge x6 + `identity_snapshot` + `Task` + `DriftAlert` |
| `endOfDay`    | EOD wrap-up · revenue summary + what got done + what's still open + drift check                          | `{}`   | EOD payload                     | cheap  | nickstire bridge x4 + `identity_snapshot` + `Task` + `Commitment` |
| `weeklyReview`| Weekly performance review · 7d revenue trend + task completion rate + habit streaks + drift + wins/misses| `{}`   | review payload                  | medium | nickstire bridge + `identity_snapshot` (7d) + `Task` + `DriftAlert` |

---

## `research` — knowledge · arsenal · web search (9)

| Tool                       | Description                                                                                         | Input                       | Output                          | Cost   | Battle | Talks to                       |
|----------------------------|-----------------------------------------------------------------------------------------------------|-----------------------------|--------------------------------|--------|--------|--------------------------------|
| `arsenalDeepResearch`      | Multi-round autonomous research worker · iterates queries + synthesizes                             | `topic, rounds?`            | research report                 | spendy | no     | `lib/ai/deep-research`         |
| `arsenalFindLeads`         | Find business leads (B2B prospecting) · domain + role filters                                       | `industry, role?, geo?`     | leads array                     | spendy | no     | Apollo + arsenal               |
| `arsenalMultiAgent`        | Parallel sub-agent fan-out · multi-lens analysis                                                    | `prompt, lenses[]`          | per-lens results                | spendy | no     | `lib/ai/multi-agent-orchestrator` |
| `arsenalPreTaskFanout`     | Multi-lens fan-out BEFORE a task starts · gather perspectives                                       | `task, lenses[]`            | per-lens fan-out                | spendy | no     | `lib/ai/pretask-fanout`        |
| `arsenalResearch`          | Research a topic (single-shot)                                                                      | `topic, depth?`             | research summary                | spendy | no     | `lib/ai/deep-research`         |
| `arsenalWebSearch`         | Web search via arsenal (Perplexity / Tavily / Exa)                                                  | `query, recency?`           | search hits                     | spendy | no     | arsenal search providers       |
| `getCronStatus`            | Status of all configured cron jobs                                                                  | `{}`                        | `CronJobLog[]`                  | free   | yes    | `CronJobLog` table             |
| `searchBuildYourOwnX`      | Local search over codecrafters-io/build-your-own-x tutorial catalog                                 | `query, limit?`             | tutorial hits                   | free   | yes    | bundled `data/build-your-own-x.json` |
| `searchWebVerified`        | (also in `personal_read`) Cross-verified web search across multiple sources                         | `query, sources?, recency?` | consensus + per-source citations | medium | no     | Perplexity + Tavily + Exa      |

---

## `browser` — Browserbase / Stagehand headless browser (5)

| Tool               | Description                                                                                                 | Input                          | Output                       | Cost   | Side-effect | Talks to                |
|--------------------|-------------------------------------------------------------------------------------------------------------|--------------------------------|-----------------------------|--------|------|-------------------------|
| `browser_act`      | Stagehand `act()` · LLM-driven action (click / fill / hover) by natural-language description                | `instruction, url?`             | action result                | medium | **yes**| Browserbase + Stagehand|
| `browser_do`       | Stagehand `do()` · multi-step task ("book the 3pm slot")                                                    | `instruction, url?, maxSteps?`  | task result                  | spendy | **yes**| Browserbase + Stagehand|
| `browser_extract`  | Stagehand `extract()` · pull structured data from a page                                                    | `instruction, schema, url?`     | extracted JSON               | medium | **yes**| Browserbase + Stagehand|
| `browser_navigate` | Navigate to a URL                                                                                            | `url`                           | `{ navigated, currentUrl }`  | cheap  | **yes**| Browserbase            |
| `browser_observe`  | Stagehand `observe()` · list possible actions on the page                                                   | `instruction, url?`             | observed actions array       | medium | no   | Browserbase + Stagehand|

---

## Retired tools (kept here for "why isn't this in chat?" lookups)

| Tool                       | Retired         | Reason                                                                          |
|----------------------------|-----------------|----------------------------------------------------------------------------------|
| `getDailyScores`           | Apr 19 (DailyScore model retired) | Brain maturity + identity snapshot history replaces the rollup |
| `logDailyScore`            | Apr 19          | Same — write surface for retired model                                          |
| `logDecision`              | Apr 15          | NL interceptor in `/api/ai/chat` writes to `MasteryDecision` directly           |
| `logDecisionForReplay`     | Apr 15          | Same — NL interceptor + auto-schedules review date based on stakes              |
| `ingestThought`            | Apr 15          | Brain-dump NL interceptor in `/api/ai/chat` writes to `BrainDump` directly      |
| `getOpenLoops`             | Apr 18          | OpenLoop concept retired; use `getTasks` (filters INBOX/READY/DOING + mission)  |
| `searchBrainDumps`         | v10.0.74        | `searchReflections` is canonical superset (Reflection rows + BrainDump + dates) |
| `getLiveRevenue`           | v10.0.79        | Strict subset of `getRevenueStats({period:"day"})`                              |
| `getShopBriefing`          | v10.0.79        | `dailyPulse` covers same 6 queries plus personal layer                          |
| `closeLoop` / `createLoop` | v10.0.75        | Legacy aliases retired · canonical: `completeTask` + `createTask`               |
| `sendToTelegram`           | v10.0.75        | Legacy alias retired · canonical: `sendTelegram`                                |
| `searchBuildYourOwnX`      | (active)        | Local tutorial catalog · pure local search · no network                         |
| `sendSMS` / `sendBulkSMS`  | v7 cleanup Apr 28 | Twilio → customer SMS belongs on nickstire.org/admin                          |
| `createPaymentLink`        | v7 cleanup Apr 28 | Stripe mutating actions belong on nickstire.org/admin                         |
| `triggerFollowUp`          | v7 cleanup Apr 28 | Customer-facing follow-ups belong on nickstire.org/admin                      |
| `generateSocialPost` etc.  | Apr 17          | Post generation moved to nickstire admin · autonicks keeps image generation     |
| `checkDeployStatus`        | 2026-05-21      | Vercel deploy-status probe · statenour deploys on Railway now, not Vercel        |
| `githubWriteFile`          | 2026-05-21      | Agent code-write tool removed · code edits stay manual (Nick has no write access) |
| `githubCommitMultiple`     | 2026-05-21      | Same — multi-file commit tool removed · Nick observes repos, doesn't push        |
| `githubSafeCommit`         | 2026-05-21      | Same — validated-commit tool removed                                             |
| `githubDeploy`             | 2026-05-21      | Deploy-trigger tool removed · deploys are Railway-driven off `main` pushes       |

---

## Catalog meta + telemetry

The catalog exposes four query helpers at `lib/ai/tools/catalog.ts`:

```ts
getToolMeta(name)        → ToolMeta | null    // single tool lookup
toolNamesByCategory(cat) → string[]            // all tools in a category
categoryOf(name)         → ToolCategory | null // reverse lookup
catalogSummary()         → [{ category, count }, …]  // for /system/ai-cost
battleSafeTools()        → string[]            // battle=true subset
sideEffectingTools()     → string[]            // strict-mode approval list
TOOL_COUNT               = TOOL_CATALOG.length // 138
```

Telemetry consumers:

- **`/system/ai-cost`** groups tool cost by category (`catalogSummary`)
- **`/system/tools`** (future) lists every tool with invocation count
  / failure rate / cost
- **`tests/ai/tool-schemas.snapshot.test.ts`** asserts every exported
  tool has a catalog entry (drift detection)
- **`tests/ai/tool-contract.test.ts`** asserts 1:1 alignment between
  `nourTools` keys and `TOOL_CATALOG` names

To add a new tool:

1. Add the tool to `nourTools` in `lib/ai/tools.ts`
2. Add its name + category entry to `TOOL_CATALOG`
3. `pnpm test` — snapshot test fails on unexpected schema change
   until the snapshot is regenerated

To physically split `tools.ts` later (W6 backlog): each category
becomes its own file under `lib/ai/tools/personal.ts`, `business.ts`,
etc. `lib/ai/tools/index.ts` becomes the barrel. The contract test
stays exactly the same.

---

## Common pruning examples

The pruner output for these example user messages, using `mode=standard`:

| User message                                  | Tools kept (approx)                                                                                          |
|-----------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| "hi" (mode: standard)                         | CORE (10) only · semantic cache skipped under 10 chars                                                       |
| "what's my revenue today?"                    | CORE + `getRevenueStats` + `dailyPulse` + `compareLiveRevenue` + `getShopSnapshot` (~15)                     |
| "what did I discuss with Mo last week?"       | CORE + `findRelatedConversations` + `searchConversations` + `findCustomer` (~15)                             |
| "run python to compute LTV"                   | toolChoice forces `runPython` SPECIFICALLY · pruner output ignored                                           |
| "add a task to call back Bob"                 | toolChoice="required" · pruner output still kept · model picks `createTask`                                  |
| "audit the chat route" (mode: deep)           | CORE + top-40 semantic + keyword regex (~50)                                                                 |

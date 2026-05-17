# Silent-failure sweep · v10.0.515 → v10.0.524.6 · 2026-05-12

Range: `0051613..HEAD` (v10.0.523 → v10.0.524.6 · 7 commits · 36 files changed)
Auditor stance: `silent-failure-hunter` + `production-code-audit` + `error-handling-patterns`
Mode: read-only — no files modified.

---

## 1. Methodology

Patterns hunted across the 14 scope files via `Grep` (`catch \{`, `\.catch\(`, `Promise.allSettled`, `void `, `try { ... } catch { ... }`):

- empty-arm catches (`catch { ... }` with no log)
- `.catch(() => null/[]/undefined/0)` fallback chains
- `Promise.allSettled` paths where the `rejected` arm collapses into a return value
- `await ... .catch(() => "")` swallowing inside template literals
- fire-and-forget `void` paths where a downstream failure has no log surface
- timeouts whose timeout-reject path is silently turned into "no result"

Each finding is classified as `silent-swallow` (no log, no operator surface) vs `intentional-fallback` (deliberate degradation with log/return-flag).

Baseline pattern reference: `lib/services/chat/stream-error-handler.ts` — the
v10.0.20 / v10.0.513 implementation that demonstrates the right shape:
`log.warn → markProviderFailed → persist degraded ChatMessage → recordTrace(errorClass) → ErrorLog row`. All findings below are graded against that bar.

Range note: **`app/api/ai/chat/route.ts` was not modified in `0051613..HEAD`** —
the python-execute commits (v520-523) all landed at or before `0051613` (the
base of the diff). It's removed from the audit scope. The other 13 files all
have substantive changes and were read in full.

---

## 2. HIGH severity findings

> Errors that vanish into the void in a way that will produce a head-scratcher
> bug report 4-12 weeks from now.

### H1 · `lib/ai/multi-search.ts` · all-sources-failed disagreement message is *the only* failure surface

**Location:** `lib/ai/multi-search.ts:286-294`

```ts
286:  if (successes.length === 0) {
287:    return {
288:      consensus: null,
289:      sources: [],
290:      disagreement: `All sources failed: ${failures.map((f) => `${f.name}(${f.reason})`).join(" · ")}`,
291:      confidence: 0,
292:      citations,
293:    };
294:  }
```

**Why this is HIGH:** `searchWebVerified` is registered as a chat tool
(`lib/ai/tools.ts:529-563`) that Nick reaches for **factual claims where being
wrong matters** (per its own description). When all three providers fail
(rate-limit storm · all three keys missing · Vercel egress block · Perplexity
+ Tavily + Exa simultaneously degraded — uncorrelated-but-coincident is a
*weekly* event during minor outages), the function returns
`{ consensus: null, sources: [], disagreement: "All sources failed: ...", confidence: 0 }`.

That returned object becomes a tool-call result the chat model then sees. The
model may treat the empty result as "no information available" and fabricate
without surfacing that the *tool itself failed* — which is precisely the
fabrication risk the tool exists to prevent.

**No log fires.** No `ErrorLog`. No `log.warn`. No Sentry breadcrumb.

**Hidden errors that get swallowed:**
- All three API keys missing on prod (silent — caller sees "all failed" only)
- Per-source 25s guardian timeout + 8s outer timeout interacting (timeouts compound; nobody sees this)
- A coding bug in one of the three integrations (e.g. response-shape regression) that throws — same path as a network error
- Quota exhaustion across all three providers in the same minute
- DNS failure / egress block

**Concrete fix (3 lines):**

```ts
import { logger as rootLogger } from "@/lib/logger";
const log = rootLogger.withSurface("ai/multi-search");

if (successes.length === 0) {
  log.error("all_sources_failed", {
    query: query.slice(0, 200),
    failures: failures.map((f) => ({ name: f.name, reason: f.reason.slice(0, 200) })),
  });
  return { /* unchanged return shape */ };
}
```

Optional secondary improvement: also write an `ErrorLog` row with
`source: "multi-search.allFailed"` so the operator dashboard surfaces a count.

---

### H2 · `lib/brain/conversation-recall.ts` · embeddings load failure returns empty array with **zero log surface** at the call site

**Location:** `lib/brain/conversation-recall.ts:111-117`

```ts
111:  const embeddings = await prisma.vectorEmbedding
112:    .findMany({
113:      where: { sourceType: "brain_memory", sourceId: { in: ids } },
114:      select: { sourceId: true, embedding: true },
115:    })
116:    .catch((): never[] => []);
117:
118:  if (embeddings.length === 0) return [];
```

**Why this is HIGH:** Three failure modes collapse to the same return shape
(empty array), and the caller can't distinguish them:

1. Genuine cold-start (no embeddings yet) — correct to return `[]`
2. Neon transient (5xx · pool exhausted) — should be retried, not silently empty
3. `prisma.vectorEmbedding` schema drift / migration not applied — should
   page the operator

The same swallow appears at line 92-105 for the parent `brainMemory.findMany`.
Both `.catch((): never[] => [])` blocks. No `log.warn` fires.

The chat tool `findRelatedConversations` (`lib/ai/tools.ts:486-526`) returns
`{ ok: true, count: 0, matches: [] }` either way — so the model reports "no
prior conversations" to the user, who reasonably concludes the recall is
working but the topic is new. **This is a high-debug-impact failure** because
the operator wires their workflow around "Nick remembers cross-session" and
a silently-degraded recall path is worse than a hard error.

**Hidden errors:**
- Connection pool exhaustion (cron + chat both at peak)
- Prisma client out-of-sync after a schema migration
- `vector_embeddings` table missing on a fresh branch deploy
- `sourceId: { in: ids }` query parameter overflow (Postgres has a 32k array literal cap — at >500 brain rows we're at the edge)

**Concrete fix:**

```ts
const memories = await prisma.brainMemory
  .findMany({ /* unchanged */ })
  .catch((err) => {
    log.warn("brainMemory_findMany_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return [] as never[];
  });
```

Apply the same wrap to the `vectorEmbedding.findMany` call on L111-117.

---

### H3 · `lib/brain/conversation-recall.ts` · JSON.parse failure on stored embedding silently skips that row

**Location:** `lib/brain/conversation-recall.ts:126-133`

```ts
126:  for (const [memId, embeddingJson] of embeddingBySourceId) {
127:    let vec: number[];
128:    try {
129:      vec = JSON.parse(embeddingJson) as number[];
130:    } catch {
131:      continue;
132:    }
133:    if (!Array.isArray(vec) || vec.length !== queryVec.length) continue;
```

**Why this is HIGH:** If embeddings are stored corrupt (column truncation,
encoding drift, a regression that wrote a non-JSON string), each row gets
silently skipped. The function returns 0 matches when it should return
N matches. No log. The operator sees "no related conversations" and assumes
the recall pipeline simply hasn't found anything.

Compounded with H2, this is the second silent failure on the same path.

**Hidden errors:**
- An ingestion regression that wrote `"[1,2,3"` (truncated) instead of `"[1,2,3]"`
- A schema migration that changed embedding column type
- A Prisma TEXT-vs-bytea encoding drift
- A model upgrade where new embeddings have different dimensionality than
  stored ones — caught silently at L133 (`vec.length !== queryVec.length`)
  which is *another* silent skip worth surfacing because it indicates a
  dimensionality migration is needed

**Concrete fix:** count both failure classes, log when non-zero:

```ts
let parseFailures = 0;
let dimensionMismatches = 0;
for (const [memId, embeddingJson] of embeddingBySourceId) {
  let vec: number[];
  try {
    vec = JSON.parse(embeddingJson) as number[];
  } catch {
    parseFailures += 1;
    continue;
  }
  if (!Array.isArray(vec) || vec.length !== queryVec.length) {
    dimensionMismatches += 1;
    continue;
  }
  // ...
}
if (parseFailures > 0 || dimensionMismatches > 0) {
  log.warn("embedding_decode_skips", {
    parseFailures,
    dimensionMismatches,
    queryVecDim: queryVec.length,
    totalRows: embeddingBySourceId.size,
  });
}
```

---

### H4 · `app/api/cron/morning-brief/route.ts` · brain-memory `.findFirst` failure makes idempotency lie

**Location:** `app/api/cron/morning-brief/route.ts:27-41`

```ts
27:  const existing = await prisma.brainMemory
28:    .findFirst({
29:      where: { category: "morning_brief", key: brief.date },
30:      select: { id: true },
31:    })
32:    .catch(() => null);
33:
34:  if (existing) {
35:    return {
36:      ok: true,
37:      skipped: true,
38:      reason: "already_pushed_today",
39:      date: brief.date,
40:    };
41:  }
```

**Why this is HIGH:** The whole point of the idempotency check is to prevent
double-Telegram-push on cron retry. If `findFirst` errors (Neon transient ·
pool exhaustion · query-timeout because mega-morning has a packed fanout),
the catch returns `null`, the route proceeds as if no brief was pushed
today, and the operator gets a **second Telegram brief on the same day** —
exactly what the route was written to prevent.

`mega` cron now fans out morning-brief at ~5am ET and Vercel retries failed
cron invocations once. Combined with H5 (durable write also swallows), this
is the cron-loud-twice scenario.

**Hidden errors:**
- Connection pool exhausted during morning fanout (likely — morning slot
  runs predict + drift + recall-promote + commitments + ...)
- Query timeout (Neon defaults can fire under load)
- `BrainMemory` schema drift after migration

**Concrete fix:** treat `null` ambiguously — log the catch path explicitly
and `return` early, so a retry that hits the same error doesn't push twice.

```ts
let existing: { id: string } | null | "errored" = null;
try {
  existing = await prisma.brainMemory.findFirst({
    where: { category: "morning_brief", key: brief.date },
    select: { id: true },
  });
} catch (err) {
  log.error("idempotency_check_failed", {
    date: brief.date,
    err: err instanceof Error ? err.message.slice(0, 200) : String(err),
  });
  // Fail closed: if we can't prove we haven't pushed today, don't push.
  // Operator gets the daily brief via the dashboard fallback.
  return { ok: false, skipped: true, reason: "idempotency_check_failed" };
}
if (existing) { /* unchanged */ }
```

---

### H5 · `app/api/cron/morning-brief/route.ts` · durable-log write failure means the dashboard fallback that the comment claims doesn't exist

**Location:** `app/api/cron/morning-brief/route.ts:43-67`

```ts
43:  // Try Telegram first. If it fails, still record the brief — the
44:  // payload is durable and the operator can pull it from the
45:  // dashboard later.
46:  let telegramOk = false;
47:  try {
48:    telegramOk = await sendTelegram(brief.text, undefined, "HTML");
49:  } catch {
50:    telegramOk = false;
51:  }
52:
53:  await prisma.brainMemory
54:    .create({
55:      data: {
56:        category: "morning_brief",
57:        key: brief.date,
58:        content: brief.text,
59:        confidence: 0.95,
60:        source: "cron:morning-brief",
61:        metadata: { ...brief.payload, telegramOk } as ...,
62:      },
63:    })
64:    .catch(() => undefined);
```

**Why this is HIGH:** The comment promises **"the payload is durable and the
operator can pull it from the dashboard later"** — but `.catch(() => undefined)`
on line 67 means a write failure leaves NO durable record. The route returns
`{ ok: true, pushed: true|false }` regardless. Operator believes the brief
is logged. It isn't. The "dashboard fallback" doesn't exist.

Additionally, the Telegram `try/catch` on L47-51 is redundant (`sendTelegram`
already returns `false` on failure per `lib/services/telegram.ts:52-55`) but
the catch arm is empty (no log) — if `sendTelegram` is *ever* changed to
throw, the swallow becomes a real silent failure.

**Hidden errors:**
- `prisma.brainMemory.create` failing because of category enum / unique
  constraint / RLS drift
- Neon write-pool starvation
- A schema migration that renamed the column

**Concrete fix:**

```ts
let persistOk = true;
try {
  await prisma.brainMemory.create({ data: { /* ... */ } });
} catch (err) {
  persistOk = false;
  log.error("morning_brief_persist_failed", {
    date: brief.date,
    telegramOk,
    err: err instanceof Error ? err.message.slice(0, 200) : String(err),
  });
}

return { ok: telegramOk || persistOk, pushed: telegramOk, persisted: persistOk, ... };
```

The `ok: telegramOk || persistOk` means cron status reflects reality: if
*neither* channel got the brief out, the cron failed.

---

## 3. MEDIUM severity findings

### M1 · `lib/eval/regression-runner.ts` · UI stream parse failures silently drop turns from the regression report

**Location:** `lib/eval/regression-runner.ts:303-308`

```ts
303:        let evt: { type?: string; delta?: string; text?: string; toolName?: string; toolCallId?: string };
304:        try {
305:          evt = JSON.parse(payload) as typeof evt;
306:        } catch {
307:          continue;
308:        }
```

**Why MEDIUM (not HIGH):** The regression suite is *internal* — only the
operator sees its results, and the score will reflect a bad stream by failing
mustContain / minLength checks anyway. But if the AI SDK changes its stream
framing in a minor bump (this has happened twice already per the comments on
L292), the regression suite goes from "telling us prod is broken" to "telling
us nothing because every payload silently fails to parse". The cron alert
threshold at 80% pass rate is what tells the operator "regression!" — a
framing change drops it to 0% pass, which the operator might read as a real
regression and chase a phantom for an hour.

**Fix:** keep silent-skip but emit a one-line warning if the **ratio** of
unparseable lines exceeds, say, 50% — that flags SDK drift specifically.

```ts
let parseSkips = 0, parseTotal = 0;
// ... inside loop ...
parseTotal += 1;
try { evt = JSON.parse(payload) as typeof evt; } catch { parseSkips += 1; continue; }
// ... after loop ...
if (parseTotal > 10 && parseSkips / parseTotal > 0.5) {
  // logged at the runner-level, not in the inner loop, so we don't spam
  console.warn("[eval] high stream-parse skip ratio", { parseSkips, parseTotal });
}
```

---

### M2 · `app/api/system/vapi-assistant-tune/route.ts` · per-assistant fetch errors collapse the `before` payload

**Location:** `app/api/system/vapi-assistant-tune/route.ts:177-188`

```ts
177:      } catch (err) {
178:        results.push({
179:          id: stub.id,
180:          name: stub.name ?? "(unnamed)",
181:          before: { ttsModel: null, llmModel: null, responseDelay: null },
182:          after: { ttsModel: null, llmModel: null, responseDelay: null },
183:          diff: [],
184:          applied: false,
185:          dryRun,
186:          error: err instanceof Error ? err.message : String(err),
187:        });
188:      }
189:    }
```

**Why MEDIUM:** The `error` field IS surfaced, which is good. But the `before`
state is reset to `null` regardless of where the error fired — meaning if the
GET succeeded and the PATCH failed (the most operationally-interesting case
during a live apply), the operator can't tell from the response what the
assistant's pre-patch state was. They'd have to rerun the audit route to
recover. For a tune-apply route this matters because partial successes are
expected (Vercel rate-limit · VAPI 429 mid-fanout).

**Fix:** capture `before` outside the try-block and reuse it in the catch arm.

```ts
const beforeTts = full.voice?.model ?? null;  // (already computed inside try)
// ...
} catch (err) {
  results.push({
    /* ... */
    before: beforeRecorded ?? { ttsModel: null, llmModel: null, responseDelay: null },
    /* ... */
  });
}
```

Also: PATCH failures should log to `ErrorLog` (an apply-route that mutates
external state is high-debug-impact; we should be able to look up "why didn't
the 4pm tune apply succeed" without combing through Vercel logs).

---

### M3 · `app/api/system/vapi-assistant-tune/route.ts` · body-parse failure silently degrades to "apply to all assistants"

**Location:** `app/api/system/vapi-assistant-tune/route.ts:75-82`

```ts
75:    let body: ApplyBody = {};
76:    try {
77:      body = (await req.json()) as ApplyBody;
78:    } catch {
79:      body = {};
80:    }
81:    const dryRun = body.dryRun !== false; // default TRUE for safety
82:    const filter = body.assistantIds && body.assistantIds.length > 0 ? new Set(body.assistantIds) : null;
```

**Why MEDIUM:** A malformed JSON body silently becomes `{}`. Two consequences:
1. `dryRun` defaults to TRUE — *safe*, good.
2. `filter` becomes `null` — every assistant gets the tune attempt.

If the operator intended to scope to one assistant via `assistantIds` but
sent malformed JSON, **every assistant gets patched** (because dryRun
defaults are safe, but the next call without dryRun=false hits all). This
is unlikely-to-fire-but-high-blast-radius.

**Fix:** return a 400 on parse error rather than silently degrading.

```ts
let body: ApplyBody;
try {
  body = (await req.json()) as ApplyBody;
} catch {
  throw new ServiceError("invalid JSON body", 400);
}
```

---

### M4 · `app/api/system/vapi-assistant-audit/route.ts` · per-assistant fetch failure produces a fabricated audit row that grades F

**Location:** `app/api/system/vapi-assistant-audit/route.ts:202-218`

```ts
202:    for (const stub of list) {
203:      try {
204:        const full = (await vapiGet(`/assistant/${stub.id}`, apiKey)) as VapiAssistant;
205:        results.push(auditOne(full));
206:      } catch (err) {
207:        results.push({
208:          id: stub.id,
209:          name: stub.name ?? "(unnamed)",
210:          stt: { provider: "unknown", ..., note: `fetch failed: ${err instanceof Error ? err.message : String(err)}` },
211:          tts: { provider: "unknown", ..., verdict: "tune", note: "" },
212:          llm: { provider: "unknown", ..., verdict: "tune", note: "" },
213:          timing: { ... },
214:          findings: ["Fetch failed"],
215:          grade: "F",
216:        });
217:      }
218:    }
```

**Why MEDIUM:** Grading a "fetch failed" assistant as `"F"` mixes
*real-tune-needed* with *we-couldn't-check*. The operator looking at the
audit dashboard sees two assistants graded F and doesn't know one is broken
ops vs one is a hot tune target. Mild but adds noise to a clean signal.

Also: the `err` message is interpolated into the user-facing `note` only on
the `stt` block; `tts` + `llm` blocks have empty notes. If the failure is
informative, it's truncated to the STT row only.

**Fix:** use a distinct grade like `"?"` or a `"fetchFailed: true"` flag,
plus stamp `note` across all three rows or hoist `note` to the top-level
finding.

---

### M5 · `lib/ai/multi-search.ts` · 8s per-source timeout has zero observability when it fires

**Location:** `lib/ai/multi-search.ts:86-96`

```ts
86: function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
87:   let timer: ReturnType<typeof setTimeout> | undefined;
88:   const timeout = new Promise<T>((_, reject) => {
89:     timer = setTimeout(() => {
90:       reject(new Error(`${label} timed out after ${ms}ms`));
91:     }, ms);
92:   });
93:   return Promise.race([promise, timeout]).finally(() => {
94:     if (timer) clearTimeout(timer);
95:   });
96: }
```

**Why MEDIUM:** The timeout fires a rejection with a descriptive message, but
the rejection lands in `Promise.allSettled` (L264) and the failure record
goes only into the in-memory `failures` array surfaced via the `disagreement`
field. No log. Operator never sees "tavily timed out 8 times this hour" —
which is exactly the metric you want when tuning whether 8s is the right
budget.

**Fix:** in the `s.status === "rejected"` branch on L275, classify timeout
vs other:

```ts
} else {
  const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
  const isTimeout = reason.includes("timed out after");
  if (isTimeout) {
    log.warn("multi_search_source_timeout", { source: name, ms: timeoutMs });
  } else {
    log.warn("multi_search_source_failed", { source: name, reason: reason.slice(0, 200) });
  }
  failures.push({ name, reason });
}
```

---

### M6 · `lib/services/morning-brief.ts` · five parallel queries each silently degrade with zero log surface

**Location:** `lib/services/morning-brief.ts:47-87`

```ts
55:        .catch((): null => null),
66:        .catch((): never[] => []),
74:        .catch(() => 0),
85:        .catch((): never[] => []),
86:      tryFetchCalendarToday().catch((): never[] => []),
```

**Why MEDIUM:** Each `.catch` is sensible in isolation — the brief should
ship even if one signal is unavailable. But all 5 swallow without logging.
A 7am brief with zero drift / zero tasks / zero conflicts is ambiguous:
either everything is genuinely calm OR every DB query just failed. The
operator can't tell.

**Fix:** log at the call site, return the fallback. Same pattern as H2's fix.

```ts
prisma.driftAlert
  .findFirst({ /* ... */ })
  .catch((err) => { log.warn("driftAlert_lookup_failed", { err: ... }); return null; }),
```

Apply to all 5 query catches.

Also: `tryFetchCalendarToday` on L139-146 has `try { ... } catch { return []; }`
inside it — same pattern, same recommendation, calendar outages are
operator-visible (no schedule line in the brief) and should be logged
explicitly.

---

### M7 · `lib/integrations/tavily.ts` + `lib/integrations/exa.ts` · `await res.text().catch(() => "Unknown error")` swallows network errors during error-body decode

**Location:** `lib/integrations/tavily.ts:109-115` (and identical pattern in `lib/integrations/exa.ts:131-137`)

```ts
109:  if (!res.ok) {
110:    const err = await res.text().catch(() => "Unknown error");
111:    const error: Error & { status?: number } = new Error(
112:      `Tavily API error ${res.status}: ${err.slice(0, 300)}`,
113:    );
114:    error.status = res.status;
115:    throw error;
116:  }
```

**Why MEDIUM:** The pattern itself is correct (we have a status code; the
body might be empty/malformed and we don't want to swallow the *primary*
status error to surface a decode error). But the literal "Unknown error"
hides the difference between "the API responded with an empty body" and "the
body decode hit a transport error mid-stream" — which matters for diagnosing
flakey edge runtime behavior. Pattern is borrowed verbatim from Perplexity
which is fine, but it's the same shape twice more now.

**Fix:** the existing pattern is acceptable. Optionally, distinguish:

```ts
const err = await res.text().catch((e) =>
  e instanceof Error ? `<body decode failed: ${e.message}>` : "<body unreadable>"
);
```

so the truncated message in the thrown error tells the operator whether
they're looking at an upstream issue vs a transport issue.

---

## 4. LOW severity findings (style / future-debugging)

### L1 · `app/api/cron/eval-regression/route.ts` · Telegram alert failure logs but doesn't surface to cron return value

**Location:** `app/api/cron/eval-regression/route.ts:107-108`

```ts
107:    const sent = await sendTelegram(msg, undefined, "HTML");
108:    if (!sent) log.warn("telegram_alert_failed", { passRate: report.passRate });
```

The `log.warn` is correct, but the return object on L111-121 doesn't expose
`alertSent`. The operator looking at the cron run summary sees `alerted: true`
(L120) but can't tell if the Telegram actually delivered. Add `alertSent`
to the returned shape.

### L2 · `lib/brain/conversation-recall.ts` · query-embed failure logs but the call site has no visibility

**Location:** `lib/brain/conversation-recall.ts:62-67`

```ts
62:  } catch (err) {
63:    log.warn("query_embed_failed", { err: ... });
64:    return null;
65:  }
```

Log is there (good). But `findRelatedConversations` returns `[]` on L87
without re-logging. If embedding consistently fails (provider rotation
through dead providers), every recall returns empty silently. Consider a
counter or a one-line warn at the top-level call.

### L3 · `lib/ai/multi-search.ts` · `tokenize` allocates a fresh Set per call inside a hot loop

`jaccardSimilarity` on L131 calls `tokenize` twice per pair, and the pair
loop on L318-328 calls it `O(N²)` times. Not a silent failure — a perf
concern only worth mentioning because if the function is called with very
long content, hot-loop allocation is a debug-impact hazard later. Not in
scope for this audit; flagging for separate work.

### L4 · `app/api/cron/morning-brief/route.ts` · the metadata-as-prisma-type-shape cast is brittle

**Location:** `app/api/cron/morning-brief/route.ts:64`

```ts
64:        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
```

This double-cast hides any future drift in the Prisma type for `metadata`.
If the underlying column type changes, the `as unknown as` will accept
anything. Switch to `as Prisma.JsonObject` or `as Prisma.InputJsonValue`
once available.

### L5 · `app/api/ai/chat/related-conversations/route.ts` · clean, no findings

The route is correctly thin — it delegates to `findRelatedConversations` and
throws `ServiceError` for input validation. All silent-failure concerns
live in the delegate (covered by H2/H3/L2). Route file itself is clean.

---

## 5. CLEAN — files audited with no findings

These files passed the silent-failure sweep with no findings (any catches
present have correct context — log + fallback + return-flag):

- `app/api/cron/mega/route.ts` — 12-line additive change (2 new folded
  cron entries in `CRON_JOBS.morning` and `CRON_JOBS.evening`); no error
  handling touched.
- `lib/ai/tools.ts` — 4 new tool registrations. The `.catch((): never[] => [])`
  on the anti-pattern brain query (L+:39 in the diff) is acceptable
  because the wrapping `execute` returns `{ ok: true, count: 0, patterns: [] }`
  — same-as-empty is the user-visible result on success too; no information
  lost. The other 3 tools delegate to library functions whose failures
  are this audit's HIGH findings (already covered).
- `lib/integrations/exa.ts` — same shape as tavily.ts (M7 covers it).
  Otherwise clean: throws on missing key, throws on non-2xx with full
  message + status code, no swallows.
- `lib/integrations/tavily.ts` — same shape as exa.ts (M7 covers it).
  Same verdict: clean except for the borrowed "Unknown error" pattern.
- `lib/eval/regression-runner.ts` — the per-question try/catch on L356-365
  is correct: errors get stored as `pipelineError` field on the result row,
  surface in the operator dashboard, and the suite keeps running (the
  documented "one fails, others continue" design). The stream-parse skip
  on L306 is M1.
- `app/api/cron/eval-regression/route.ts` — the persist failure on L84-91
  is the right shape (logs `persist_failed` with err message, comment
  explains why it doesn't throw, alert path is separate). Clean.

---

## 6. Top 5 fixes (ranked by `likelihood × debug-impact`)

| # | Finding | Fire freq | Debug impact | Composite | Estimated fix |
|---|---------|-----------|--------------|-----------|---------------|
| 1 | **H1** · multi-search `all sources failed` returns empty silently | weekly during minor outages | HIGH — chat fabricates without surfacing tool failure | **10** | 3 lines (add `log.error`) |
| 2 | **H2** · `vectorEmbedding.findMany` swallow → silent recall degradation | monthly (pool exhaustion) | HIGH — operator's mental model "Nick remembers" fails silently | **8** | 2 catches → log+return |
| 3 | **H4** · morning-brief idempotency `.catch(() => null)` → double Telegram | rare but cron-retry-loud | MEDIUM-HIGH — operator gets double-paged | **6** | 1 try block + fail-closed return |
| 4 | **H5** · morning-brief durable-write swallow → broken dashboard fallback promise | rare but the comment lies | MEDIUM-HIGH — comment explicitly promises durability that doesn't exist | **6** | 1 try block + return-flag |
| 5 | **H3** · embedding JSON-parse silent skip → recall returns 0 instead of N | uncommon (only on data corruption) | HIGH — invisible until the operator notices "Nick never remembers anything anymore" | **5** | 1 counter + 1 log line |

All 5 fixes are <10 lines each. Combined ~30 lines of edits across 3 files.
Pure-additive (only adds `log.warn` / `log.error` calls + restructures one
or two arms of existing try/catches into more-explicit shapes). Zero
behavior change for the success path.

---

## Appendix · diff stats

- 7 commits in range (`bfa863a..0051613`)
- 36 files changed · 8919 insertions / 383 deletions
- 14 files in audit scope · 13 actually modified in range (`app/api/ai/chat/route.ts` unchanged in this range)
- 5 HIGH findings · 7 MEDIUM · 5 LOW · 6 CLEAN
- Total grep patterns hunted: 6
- Total lines read: ~2300 across 13 scope files + 4 reference files

Audit complete. Operator should triage HIGH findings before next deploy;
MEDIUM and LOW can fold into the next housekeeping commit.

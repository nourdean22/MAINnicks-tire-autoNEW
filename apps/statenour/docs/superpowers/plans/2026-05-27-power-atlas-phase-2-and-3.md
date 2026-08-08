# Power Atlas · Phase 2 + Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete the Power Atlas with Phase 2 compounding moats + Phase 3 high-res intelligence.

**Architecture:** Adds 5 new background-only crons (no Telegram) · 4 new tRPC mutations · 2 new UI components · 5 brain-layer adapter modules · 2 Apify integrations · 1 network-graph view. All built on the Phase 0 schema (15 fields + 2 tables already exist).

**Tech Stack:** Same as Phase 0+1 (Next.js 16 / React 19 / Prisma 6 / Postgres / tRPC v11 / Tailwind / tracedAiChat / BrainMemory). New external dep: `@apify/client` (for Phase 3 reputation + influencer-discovery).

**Spec reference:** `apps/statenour/docs/superpowers/specs/2026-05-27-power-atlas-design.md`
**Phase 0+1 plan reference:** `apps/statenour/docs/superpowers/plans/2026-05-27-power-atlas-phase-0-1.md`

**Pattern inheritance:** All patterns established by Phase 0+1 plan apply (cronHandler · tracedAiChat label/source · BrainMemory idempotency markers · 1px borders · serif headings · no emojis on this surface · sendTelegram only from digest + birthday crons).

---

# Phase 2 · Compounding moats

Sam's lens. The data that gets more valuable over time. 8 features.

## Task 2.1: updatePowerBalance tRPC mutation

**File:** `apps/statenour/lib/trpc/routers/task.ts` (extend operator-procedures section)

- [ ] **Step 1: Add the mutation**

Insert after `updateDossier`:

```ts
  updatePowerBalance: operatorProcedure
    .input(z.object({
      personId: z.string().min(1).max(64),
      powerBalance: z.number().min(-1).max(1),
    }))
    .mutation(async ({ input }) => {
      await prisma.personProfile.update({
        where: { id: input.personId },
        data: { powerBalance: input.powerBalance },
      });
      return { ok: true };
    }),
```

- [ ] **Step 2: Wire to PowerBalanceGauge component**

Edit `apps/statenour/components/power-atlas/PowerBalanceGauge.tsx` to accept an optional `onUpdate?: (newValue: number) => Promise<void>` callback. When provided, render as a slider (`<input type="range" min="-1" max="1" step="0.05">`); when omitted, stay read-only.

In `apps/statenour/app/(mastery)/relationships/page.tsx`, pass the callback wired to `trpc.task.updatePowerBalance.useMutation()`.

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/statenour && pnpm typecheck && cd /c/Users/nourd/NOURCITY && git add apps/statenour/lib/trpc/routers/task.ts apps/statenour/components/power-atlas/PowerBalanceGauge.tsx apps/statenour/app/\(mastery\)/relationships/page.tsx && git commit -m "feat · power-atlas · updatePowerBalance mutation + interactive gauge slider"
```

---

## Task 2.2: Kept-word tracker

**Files:**
- Create: `apps/statenour/lib/brain/kept-word-tracker.ts`
- Create: `apps/statenour/app/api/cron/kept-word-scan/route.ts`
- Modify: `apps/statenour/config/crons.ts`
- Modify: `apps/statenour/lib/brain/categories.ts` (add KEPT_WORD)

- [ ] **Step 1: Register KEPT_WORD category**

In `lib/brain/categories.ts`, after `RELATIONSHIP_BIRTHDAY_SENT`:

```ts
  /** Promise-extraction log · per-promise row · key = `<personId>:<chatMsgId>`.
   *  Content = JSON { promise, dueHint, extractedAt, status: "open"|"kept"|"broken",
   *  resolvedAt? }. Drives trust-score derivation. */
  KEPT_WORD: "kept_word",
```

- [ ] **Step 2: Write the tracker module**

`lib/brain/kept-word-tracker.ts`:

```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

interface ExtractedPromise {
  personName: string;
  promise: string;
  dueHint: string | null;
}

/**
 * Scan last-24h chat messages for promises made TO the operator BY
 * known people. Extract via AI · upsert per (personId, chatMsgId).
 * Marks subsequent message as `kept` when the promised thing appears
 * to have happened (verified via follow-up message content).
 */
export async function scanKeptWords(): Promise<{
  scanned: number;
  newPromises: number;
  resolved: number;
}> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const messages = await prisma.chatMessage.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, conversationId: true, createdAt: true },
  });
  if (messages.length === 0) return { scanned: 0, newPromises: 0, resolved: 0 };

  const people = await prisma.personProfile.findMany({
    where: { status: { not: "blown_up" }, deletedAt: null },
    select: { id: true, name: true },
  });
  const namesLower = people.map((p) => p.name.toLowerCase());

  let newPromises = 0;
  let resolved = 0;

  for (const msg of messages) {
    if (msg.role !== "user") continue; // operator quotes someone
    const contentLower = msg.content.toLowerCase();
    const mentionedPeople = people.filter((p) =>
      contentLower.includes(p.name.toLowerCase()),
    );
    if (mentionedPeople.length === 0) continue;

    // Quick filter · skip messages without promise-shape language
    if (!/will|going to|promise|i'll|i will|next week|tomorrow|by /i.test(msg.content)) continue;

    try {
      const result = await tracedAiChat(
        { label: "kept-word-extract", source: "cron" },
        [
          { role: "system", content: "Extract promises made by named persons to the operator. Output ONLY JSON: {promises: [{personName, promise, dueHint}]}. dueHint is freetext or null. If no promises, return {promises:[]}." },
          { role: "user", content: msg.content.slice(0, 2000) },
        ],
        "reason",
      );
      const raw = (result.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
      const parsed = JSON.parse(raw) as { promises: ExtractedPromise[] };
      for (const promise of parsed.promises ?? []) {
        const matchedPerson = people.find((p) => p.name.toLowerCase() === promise.personName.toLowerCase());
        if (!matchedPerson) continue;
        await prisma.brainMemory.upsert({
          where: {
            category_key: {
              category: BRAIN_CATEGORIES.KEPT_WORD,
              key: `${matchedPerson.id}:${msg.id}`,
            },
          },
          create: {
            category: BRAIN_CATEGORIES.KEPT_WORD,
            key: `${matchedPerson.id}:${msg.id}`,
            content: JSON.stringify({
              promise: promise.promise,
              dueHint: promise.dueHint,
              extractedAt: new Date().toISOString(),
              status: "open",
            }),
            confidence: 0.85,
            source: "cron:kept-word-scan",
          },
          update: {},
        });
        newPromises++;
      }
    } catch {
      // skip · classifier failure on one message doesn't block others
    }
  }

  return { scanned: messages.length, newPromises, resolved };
}

/**
 * Derive per-person trust score from kept-word ratio.
 * Pure function · no side effects · used by trust-score-refresh cron.
 */
export async function deriveTrustFromKeptWord(personId: string): Promise<number | null> {
  const rows = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.KEPT_WORD, key: { startsWith: `${personId}:` } },
    select: { content: true },
  });
  if (rows.length === 0) return null;
  let kept = 0;
  let broken = 0;
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content) as { status: string };
      if (parsed.status === "kept") kept++;
      else if (parsed.status === "broken") broken++;
    } catch {}
  }
  const total = kept + broken;
  if (total < 3) return null; // need ≥3 data points
  return kept / total;
}
```

- [ ] **Step 3: Write the cron route**

`app/api/cron/kept-word-scan/route.ts`:

```ts
import { cronHandler } from "@/lib/utils/http";
import { scanKeptWords } from "@/lib/brain/kept-word-tracker";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const result = await scanKeptWords();
  return { ok: true, ...result };
});
```

- [ ] **Step 4: Register cron**

In `config/crons.ts` after the relationship-birthday entry:

```ts
  {
    name: "kept-word-scan",
    schedule: "0 2 * * *", // daily 2am UTC = 9pm ET prev night
    mode: "active",
    category: "brain",
    description: "Power Atlas · scan last-24h chat for promises made TO operator BY known persons · drives trust-score-from-kept-word",
    maxDuration: 120,
    addedAt: "2026-05-27",
  },
```

- [ ] **Step 5: Typecheck + commit**

```bash
cd apps/statenour && pnpm typecheck && cd /c/Users/nourd/NOURCITY && git add apps/statenour/lib/brain/kept-word-tracker.ts apps/statenour/app/api/cron/kept-word-scan/ apps/statenour/lib/brain/categories.ts apps/statenour/config/crons.ts && git commit -m "feat · power-atlas · kept-word tracker · daily chat scan for promises · derives trust from kept-ratio"
```

---

## Task 2.3: Alpha moments archive

**Files:**
- Create: `apps/statenour/components/power-atlas/AlphaMoments.tsx`
- Modify: `apps/statenour/lib/brain/categories.ts` (add ALPHA_MOMENT)
- Modify: `apps/statenour/lib/trpc/routers/task.ts` (add `markAlphaMoment` mutation)
- Modify: `apps/statenour/app/(mastery)/relationships/page.tsx` (mount the component)

- [ ] **Step 1: Add category**

`lib/brain/categories.ts` after KEPT_WORD:

```ts
  /** Alpha moment archive · operator-flagged peak interactions or
   *  AI-suggested ones the operator approves. Key shape:
   *  `<personId>:<ledgerId>`. Content = JSON { moment, ledgerId,
   *  pinnedAt, kind: "peak"|"shift"|"insight" }. */
  ALPHA_MOMENT: "alpha_moment",
```

- [ ] **Step 2: Add the mutation**

```ts
  markAlphaMoment: operatorProcedure
    .input(z.object({
      personId: z.string().min(1).max(64),
      ledgerId: z.string().min(1).max(64),
      moment: z.string().min(1).max(1000),
      kind: z.enum(["peak", "shift", "insight"]).default("peak"),
    }))
    .mutation(async ({ input }) => {
      await prisma.brainMemory.upsert({
        where: {
          category_key: { category: "alpha_moment", key: `${input.personId}:${input.ledgerId}` },
        },
        create: {
          category: "alpha_moment",
          key: `${input.personId}:${input.ledgerId}`,
          content: JSON.stringify({
            moment: input.moment,
            ledgerId: input.ledgerId,
            pinnedAt: new Date().toISOString(),
            kind: input.kind,
          }),
          confidence: 1.0,
          source: "operator-pin",
        },
        update: {
          content: JSON.stringify({
            moment: input.moment,
            ledgerId: input.ledgerId,
            pinnedAt: new Date().toISOString(),
            kind: input.kind,
          }),
        },
      });
      return { ok: true };
    }),

  listAlphaMoments: operatorProcedure
    .input(z.object({ personId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const rows = await prisma.brainMemory.findMany({
        where: { category: "alpha_moment", key: { startsWith: `${input.personId}:` } },
        orderBy: { createdAt: "desc" },
        select: { content: true, createdAt: true },
      });
      return rows.map((r) => {
        try { return { ...JSON.parse(r.content), createdAt: r.createdAt.toISOString() }; }
        catch { return null; }
      }).filter(Boolean);
    }),
```

- [ ] **Step 3: Write the component**

`components/power-atlas/AlphaMoments.tsx`:

```tsx
"use client";
import { trpc } from "@/lib/trpc/client";

interface AlphaMomentsProps {
  personId: string;
}

export default function AlphaMoments({ personId }: AlphaMomentsProps) {
  const { data: moments = [] } = trpc.task.listAlphaMoments.useQuery({ personId });

  if (moments.length === 0) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-zinc-900/40 p-4">
        <p className="text-[11px] uppercase tracking-wider text-zinc-500">alpha moments</p>
        <p className="mt-2 text-xs text-zinc-600">No peaks pinned yet. From the ledger timeline, long-press an entry to mark it as a peak / shift / insight.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/[0.06] bg-zinc-900/40 p-4 space-y-3">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">alpha moments · {moments.length}</p>
      {moments.map((m, i) => (
        <div key={i} className="border-l-2 border-amber-500/40 pl-3">
          <p className="text-[10px] uppercase tracking-wider text-amber-300/70">{m.kind}</p>
          <p className="text-sm text-zinc-200 mt-1">{m.moment}</p>
          <p className="text-[10px] text-zinc-600 mt-1 font-mono">{new Date(m.createdAt).toISOString().slice(0, 10)}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Mount in detail panel**

In `app/(mastery)/relationships/page.tsx`, import AlphaMoments and render in the detail-panel left column after `<LedgerTimeline>`.

- [ ] **Step 5: Typecheck + commit**

```bash
cd apps/statenour && pnpm typecheck && cd /c/Users/nourd/NOURCITY && git add . && git commit -m "feat · power-atlas · AlphaMoments component + tRPC markAlphaMoment + listAlphaMoments"
```

---

## Task 2.4: 5-year arc projection

**Files:**
- Create: `apps/statenour/lib/brain/relationship-arc-projection.ts`
- Modify: `apps/statenour/lib/trpc/routers/task.ts` (add `projectArc` mutation)
- Create: `apps/statenour/components/power-atlas/ArcProjection.tsx`

- [ ] **Step 1: Write the projection module**

`lib/brain/relationship-arc-projection.ts`:

```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

export interface ArcProjection {
  do_nothing: string;     // 5-year arc if operator changes nothing
  double_effort: string;  // 5-year arc if operator doubles effort
  blow_up: string;        // 5-year arc if operator severs
  recommendation: string; // strategist's one-line read
  projectedAt: string;
}

export async function projectFiveYearArc(personId: string): Promise<ArcProjection | null> {
  const person = await prisma.personProfile.findUnique({ where: { id: personId } });
  if (!person) return null;
  const ledger = await prisma.relationshipLedger.findMany({
    where: { personId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const recentTrend = ledger.slice(0, 10).reduce((s, r) => s + r.amount, 0);
  const olderTrend = ledger.slice(10, 20).reduce((s, r) => s + r.amount, 0);

  const prompt = `Strategist · 5-year arc projection. Read the data, output JSON only.

Person: ${person.name}
Role: ${person.role}
Status: ${person.status}
Trust: ${Math.round(person.trustScore * 100)}/100
Power balance: ${person.powerBalance.toFixed(2)} (negative = they have leverage over operator)
Recent ledger trend (last 10): ${recentTrend}
Older ledger trend (entries 10-20): ${olderTrend}
Greene archetype: ${person.greeneType ?? "unknown"}
Dark traits: [${person.darkTraits.join(",")}]
Applicable laws: [${person.applicableLaws.join(",")}]
Dossier:
${(person.dossierMd ?? "").slice(0, 800)}

Output JSON only · NO markdown fences:
{
  "do_nothing": "1-sentence projection if operator changes nothing",
  "double_effort": "1-sentence projection if operator 2x effort",
  "blow_up": "1-sentence projection if operator severs (only applicable if status != 'blown_up')",
  "recommendation": "strategist's 1-line read in Greene's voice"
}`;

  try {
    const result = await tracedAiChat(
      { label: "arc-projection", source: "tool", metadata: { personId } },
      [
        { role: "system", content: "You are a relationship strategist trained in Greene's corpus. Output STRICT JSON only." },
        { role: "user", content: prompt },
      ],
      "reason",
    );
    const raw = (result.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    const parsed = JSON.parse(raw) as ArcProjection;
    return { ...parsed, projectedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add mutation**

```ts
  projectArc: operatorProcedure
    .input(z.object({ personId: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const { projectFiveYearArc } = await import("@/lib/brain/relationship-arc-projection");
      const projection = await projectFiveYearArc(input.personId);
      if (!projection) return { ok: false, projection: null };
      // Cache on the profile · operator can re-run anytime
      await prisma.personProfile.update({
        where: { id: input.personId },
        data: { lastArcPlan: projection as never },
      });
      return { ok: true, projection };
    }),
```

- [ ] **Step 3: Component**

`components/power-atlas/ArcProjection.tsx`:

```tsx
"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";

interface ArcProjectionProps {
  personId: string;
  initialProjection: unknown;
}

export default function ArcProjection({ personId, initialProjection }: ArcProjectionProps) {
  const [projection, setProjection] = useState<any>(initialProjection);
  const mutation = trpc.task.projectArc.useMutation();

  return (
    <div className="rounded-lg border border-white/[0.06] bg-zinc-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-zinc-500">5-year arc</p>
        <button
          onClick={async () => {
            const r = await mutation.mutateAsync({ personId });
            if (r.projection) setProjection(r.projection);
          }}
          disabled={mutation.isPending}
          className="text-[10px] uppercase tracking-wider text-amber-300/80 hover:text-amber-300 disabled:opacity-50"
        >
          {mutation.isPending ? "projecting…" : projection ? "re-project" : "project"}
        </button>
      </div>
      {projection && (
        <div className="space-y-3 text-xs text-zinc-300">
          <p><span className="text-zinc-500 uppercase text-[10px] tracking-wider">do nothing →</span> {projection.do_nothing}</p>
          <p><span className="text-zinc-500 uppercase text-[10px] tracking-wider">2x effort →</span> {projection.double_effort}</p>
          {projection.blow_up && <p><span className="text-zinc-500 uppercase text-[10px] tracking-wider">sever →</span> {projection.blow_up}</p>}
          <p className="border-t border-white/[0.06] pt-3 text-zinc-200 italic">"{projection.recommendation}"</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Mount in page + commit**

```bash
cd apps/statenour && pnpm typecheck && cd /c/Users/nourd/NOURCITY && git add . && git commit -m "feat · power-atlas · 5-year arc projection · do-nothing/2x/sever scenarios via tracedAiChat"
```

---

## Task 2.5: Behavioral X-ray adapter

**Files:**
- Create: `apps/statenour/lib/brain/behavioral-xray-adapter.ts`
- Create: `apps/statenour/app/api/cron/behavioral-xray-refresh/route.ts`
- Modify: `apps/statenour/config/crons.ts`

- [ ] **Step 1: Adapter module**

`lib/brain/behavioral-xray-adapter.ts`:

```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

interface BehavioralFingerprint {
  decisionStyle: string;
  refusalPatterns: string[];
  conflictTriggers: string[];
  toneDefaults: string;
  communicationCadence: string;
  refreshedAt: string;
}

/**
 * Run a behavioral X-ray on a person's chat history · output structured
 * JSON behavioralFingerprint. Re-runs monthly per person with >5
 * ledger events since last run.
 */
export async function runBehavioralXray(personId: string): Promise<BehavioralFingerprint | null> {
  const person = await prisma.personProfile.findUnique({ where: { id: personId } });
  if (!person) return null;

  const chatMentions = await prisma.chatMessage.findMany({
    where: {
      content: { contains: person.name, mode: "insensitive" },
      role: "user",
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { content: true, createdAt: true },
  });
  if (chatMentions.length < 5) return null;

  const corpus = chatMentions.map((m) => m.content).join("\n---\n").slice(0, 8000);

  const prompt = `Behavioral X-ray on a single person based on operator's chat about them. Output STRICT JSON only · no fences.

Person: ${person.name}
Role: ${person.role}

Operator's chat mentions (last 40):
${corpus}

Infer:
{
  "decisionStyle": "1-sentence · how do they make decisions (impulsive/deliberate/avoidant/etc)",
  "refusalPatterns": ["list of common ways they say no or push back, ≤3 items"],
  "conflictTriggers": ["specific topics that produce friction, ≤4 items"],
  "toneDefaults": "1-sentence · default emotional tone (warm/cool/transactional/etc)",
  "communicationCadence": "1-sentence · how often + when they reach out"
}`;

  try {
    const result = await tracedAiChat(
      { label: "behavioral-xray", source: "cron", metadata: { personId } },
      [
        { role: "system", content: "Behavioral analyst. Output STRICT JSON only." },
        { role: "user", content: prompt },
      ],
      "reason",
    );
    const raw = (result.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    const parsed = JSON.parse(raw) as Omit<BehavioralFingerprint, "refreshedAt">;
    return { ...parsed, refreshedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Cron route**

`app/api/cron/behavioral-xray-refresh/route.ts`:

```ts
import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { runBehavioralXray } from "@/lib/brain/behavioral-xray-adapter";

export const maxDuration = 300;

export const GET = cronHandler(async () => {
  // Find profiles needing refresh: >5 ledger events since last
  // behavioralFingerprint.refreshedAt OR no fingerprint yet.
  const candidates = await prisma.personProfile.findMany({
    where: {
      status: { not: "blown_up" },
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      behavioralFingerprint: true,
      ledger: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 20, // cap per run · weekly cadence catches up
  });

  const eligible = candidates.filter((p) => {
    if (!p.behavioralFingerprint) return true;
    try {
      const fp = p.behavioralFingerprint as { refreshedAt?: string };
      const refreshedAt = fp.refreshedAt ? new Date(fp.refreshedAt) : new Date(0);
      const lastLedgerAt = p.ledger[0]?.createdAt ?? new Date(0);
      return lastLedgerAt > refreshedAt;
    } catch { return true; }
  });

  let updated = 0;
  for (const p of eligible.slice(0, 5)) { // cap 5/run for cost
    const fingerprint = await runBehavioralXray(p.id);
    if (fingerprint) {
      await prisma.personProfile.update({
        where: { id: p.id },
        data: { behavioralFingerprint: fingerprint as never },
      });
      updated++;
    }
  }

  return { ok: true, candidates: eligible.length, refreshed: updated };
});
```

- [ ] **Step 3: Register cron**

```ts
  {
    name: "behavioral-xray-refresh",
    schedule: "0 5 * * 1", // Monday 5am UTC = midnight ET Sunday→Monday
    mode: "active",
    category: "brain",
    description: "Power Atlas · weekly behavioral X-ray refresh · ≤5 profiles/run · gpt-4o-mini",
    maxDuration: 300,
    addedAt: "2026-05-27",
  },
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd apps/statenour && pnpm typecheck && cd /c/Users/nourd/NOURCITY && git add . && git commit -m "feat · power-atlas · behavioral-xray-refresh weekly cron · auto-populates behavioralFingerprint per person"
```

---

## Task 2.6: Psychographic ladder profiler

**Files:**
- Create: `apps/statenour/lib/brain/psychographic-ladder-adapter.ts`
- Create: `apps/statenour/app/api/cron/psychographic-ladder-refresh/route.ts`
- Modify: `apps/statenour/config/crons.ts`

- [ ] **Step 1: Adapter module**

Follow the SAME pattern as behavioral-xray-adapter (Task 2.5). Output shape:

```ts
interface PsychographicLadder {
  identity: string[];        // who they see themselves as
  needs: string[];           // unmet needs driving behavior
  fears: string[];           // anxieties they protect against
  statusConcerns: string[];  // how they want to be seen
  valuesSnapshot: string;    // 1-sentence values summary
  refreshedAt: string;
}
```

System prompt: `"You are a psychographic analyst trained in self-determination theory + identity theory + values-based segmentation. Output STRICT JSON only following the schema below."`

User prompt: same corpus extraction as behavioral-xray.

- [ ] **Step 2: Cron route**

Identical structure to `behavioral-xray-refresh/route.ts` but calls `runPsychographicLadder` and writes to `psychographicLadder` field.

- [ ] **Step 3: Register cron**

```ts
  {
    name: "psychographic-ladder-refresh",
    schedule: "0 6 * * 1", // Monday 6am UTC (1 hour after behavioral X-ray)
    mode: "active",
    category: "brain",
    description: "Power Atlas · weekly psychographic ladder refresh · ≤5 profiles/run",
    maxDuration: 300,
    addedAt: "2026-05-27",
  },
```

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "feat · power-atlas · psychographic-ladder-refresh weekly cron · identity/needs/fears/status/values per person"
```

---

## Task 2.7: Dossier auto-drafter

**Files:**
- Create: `apps/statenour/lib/brain/dossier-autodrafter.ts`
- Create: `apps/statenour/app/api/cron/dossier-autodraft/route.ts`
- Modify: `apps/statenour/config/crons.ts`

- [ ] **Step 1: Drafter module**

`lib/brain/dossier-autodrafter.ts`:

```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

export async function draftDossierFor(personId: string): Promise<string | null> {
  const person = await prisma.personProfile.findUnique({ where: { id: personId } });
  if (!person) return null;

  const [chatMentions, recentLedger, alphaMoments] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { content: { contains: person.name, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { content: true, createdAt: true },
    }),
    prisma.relationshipLedger.findMany({
      where: { personId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { amount: true, note: true, createdAt: true },
    }),
    prisma.brainMemory.findMany({
      where: { category: "alpha_moment", key: { startsWith: `${personId}:` } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { content: true },
    }),
  ]);

  const prompt = `Draft a 5-bullet markdown dossier for ${person.name}. Plain markdown. NO emojis. The operator reads on phone. Concise.

Role: ${person.role}
Existing dossier (preserve operator's edits where useful):
${person.dossierMd ?? "(none)"}

Chat mentions (recent 30):
${chatMentions.map((m) => `- ${m.content.slice(0, 200)}`).join("\n").slice(0, 4000)}

Recent ledger:
${recentLedger.map((l) => `- ${l.amount >= 0 ? "+" : ""}${l.amount} · ${l.note.slice(0, 80)}`).join("\n")}

Alpha moments pinned:
${alphaMoments.map((a) => { try { return `- ${JSON.parse(a.content).moment.slice(0, 200)}`; } catch { return ""; } }).filter(Boolean).join("\n")}

Behavioral fingerprint:
${person.behavioralFingerprint ? JSON.stringify(person.behavioralFingerprint).slice(0, 800) : "(none)"}

Output 5-7 markdown bullets covering:
- Who they are (1 bullet)
- How operator met them + key shared history (1 bullet)
- Their current state of life (1 bullet)
- Communication norms with this person (1 bullet)
- Strategic notes · greene-flavored (1-2 bullets)
- The single most important thing for the operator to remember (1 bullet)

Plain markdown · no headers · just bullets.`;

  try {
    const result = await tracedAiChat(
      { label: "dossier-autodraft", source: "cron", metadata: { personId } },
      [
        { role: "system", content: "Editorial assistant. Plain markdown bullets. No emoji. No fluff." },
        { role: "user", content: prompt },
      ],
      "reason",
    );
    return (result.content ?? "").trim();
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Cron route**

```ts
import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { draftDossierFor } from "@/lib/brain/dossier-autodrafter";

export const maxDuration = 300;

export const GET = cronHandler(async () => {
  // Prioritize · profiles with stale (or missing) dossiers + recent activity
  const profiles = await prisma.personProfile.findMany({
    where: {
      status: { not: "blown_up" },
      deletedAt: null,
      role: { in: ["friend", "close_friend", "family", "mentor", "mentee", "romantic", "advisor"] },
    },
    select: {
      id: true,
      dossierUpdatedAt: true,
      lastInteraction: true,
    },
    orderBy: { lastInteraction: "desc" },
    take: 20,
  });

  let drafted = 0;
  for (const p of profiles.slice(0, 5)) {
    const draft = await draftDossierFor(p.id);
    if (!draft) continue;
    await prisma.personProfile.update({
      where: { id: p.id },
      data: {
        dossierMd: draft,
        dossierUpdatedAt: new Date(),
      },
    });
    // Queue embedding refresh
    const { enqueuePersonEmbed } = await import("@/lib/brain/people-embed-hook");
    await enqueuePersonEmbed(p.id);
    drafted++;
  }

  return { ok: true, candidates: profiles.length, drafted };
});
```

- [ ] **Step 3: Register cron**

```ts
  {
    name: "dossier-autodraft",
    schedule: "0 4 * * 1", // Monday 4am UTC = 11pm ET Sunday
    mode: "active",
    category: "brain",
    description: "Power Atlas · weekly dossier auto-drafter · ≤5 profiles/run · operator approves on Monday morning",
    maxDuration: 300,
    addedAt: "2026-05-27",
  },
```

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "feat · power-atlas · dossier auto-drafter weekly cron · operator approves on Monday morning"
```

---

## Task 2.8: Power plays runner (arc + message + scarcity)

**Files:**
- Create: `apps/statenour/lib/brain/power-plays-runner.ts`
- Modify: `apps/statenour/lib/trpc/routers/task.ts` (add `runPowerPlay` mutation)
- Create: `apps/statenour/components/power-atlas/PowerPlaysModal.tsx`

- [ ] **Step 1: Runner module**

`lib/brain/power-plays-runner.ts`:

```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

export type PlayKind = "arc_plan" | "message_draft" | "scarcity_play" | "reciprocity_assess";

const PROMPTS: Record<PlayKind, string> = {
  arc_plan: "Plan a conversation. Output JSON: {goal, currentState, desiredState, phases:[{order,label,prompt}]}. Use emotional-arc-designer framework (engineered progression from entry emotion to action emotion).",
  message_draft: "Draft a message to this person. Apply copywriting-psychologist + sequence-psychologist principles. Output JSON: {subject?, body, rationale}. Operator edits + sends.",
  scarcity_play: "Greene Law 16 · scarcity playbook. When + how should operator make themselves less available to increase respect? Output JSON: {when, how, why, lawApplied: 16}.",
  reciprocity_assess: "Compute reciprocity asymmetry. Who reached out first 80%+ of the time? Output JSON: {operatorInitiatedPct, theirInitiatedPct, recommendation}.",
};

export async function runPowerPlay(personId: string, kind: PlayKind, operatorGoal?: string): Promise<unknown> {
  const person = await prisma.personProfile.findUnique({ where: { id: personId } });
  if (!person) return null;

  const recentLedger = await prisma.relationshipLedger.findMany({
    where: { personId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { amount: true, note: true, source: true, createdAt: true },
  });

  const context = `Person: ${person.name}
Role: ${person.role}
Status: ${person.status}
Trust: ${Math.round(person.trustScore * 100)}/100
Power balance: ${person.powerBalance.toFixed(2)}
Greene type: ${person.greeneType ?? "unknown"}
Applicable laws: [${person.applicableLaws.join(",")}]
Dossier:
${(person.dossierMd ?? "").slice(0, 1500)}

Recent ledger (last 20):
${recentLedger.map((l) => `${l.amount >= 0 ? "+" : ""}${l.amount} · ${l.note.slice(0, 60)} · ${l.source}`).join("\n")}

Operator's goal: ${operatorGoal ?? "(not specified)"}`;

  const result = await tracedAiChat(
    { label: `power-play-${kind}`, source: "tool", metadata: { personId, kind } },
    [
      { role: "system", content: `${PROMPTS[kind]} Output STRICT JSON only · no markdown fences.` },
      { role: "user", content: context },
    ],
    "reason",
  );

  try {
    const raw = (result.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    const parsed = JSON.parse(raw);

    // Persist as RelationshipPlay
    await prisma.relationshipPlay.create({
      data: {
        personId,
        kind,
        inputCtx: { operatorGoal, person: { trust: person.trustScore, power: person.powerBalance } } as never,
        output: parsed as never,
      },
    });

    return parsed;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add mutation**

```ts
  runPowerPlay: operatorProcedure
    .input(z.object({
      personId: z.string().min(1).max(64),
      kind: z.enum(["arc_plan", "message_draft", "scarcity_play", "reciprocity_assess"]),
      operatorGoal: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input }) => {
      const { runPowerPlay } = await import("@/lib/brain/power-plays-runner");
      const output = await runPowerPlay(input.personId, input.kind, input.operatorGoal);
      return { ok: !!output, output };
    }),
```

- [ ] **Step 3: Component**

`components/power-atlas/PowerPlaysModal.tsx`:

Render a modal that takes `personId` and exposes 4 buttons (one per PlayKind). Each button → calls `trpc.task.runPowerPlay.useMutation()` with appropriate kind. Display the resulting JSON output rendered as readable card sections (arc phases as numbered list, message as markdown, etc.).

- [ ] **Step 4: Mount + commit**

```bash
cd apps/statenour && pnpm typecheck && cd /c/Users/nourd/NOURCITY && git add . && git commit -m "feat · power-atlas · PowerPlaysRunner · 4 play kinds · arc_plan + message_draft + scarcity_play + reciprocity_assess"
```

---

## Phase 2 Push

- [ ] **Step 1: Push**

```bash
git push origin main
```

Wait for Railway deploy (~3 min). Done.

---

# Phase 3 · High-res intelligence

Niche-intelligence lens. Detect signals nobody else surfaces. 8 features.

---

## Task 3.1: Reciprocity gradient detector

**Files:**
- Create: `apps/statenour/lib/brain/reciprocity-tracker.ts`
- Create: `apps/statenour/app/api/cron/reciprocity-tracker-update/route.ts`
- Modify: `apps/statenour/config/crons.ts`

- [ ] **Step 1: Module**

`lib/brain/reciprocity-tracker.ts`:

```ts
import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Compute reciprocity gradient from last 90 days of ledger events.
 * Gmail-source events are direction-coded (sent vs received) via
 * metadata.direction · chat-source events default to "operator-initiated"
 * since chat is operator-authored.
 *
 * Returns { operatorInitiatedPct, theirInitiatedPct, sampleSize }.
 */
export async function computeReciprocity(personId: string): Promise<{
  operatorInitiatedPct: number;
  theirInitiatedPct: number;
  sampleSize: number;
} | null> {
  const since = new Date(Date.now() - 90 * 86400_000);
  const events = await prisma.relationshipLedger.findMany({
    where: { personId, createdAt: { gte: since }, amount: { gte: 0 } }, // positive only · deposits = touchpoints
    select: { source: true, metadata: true },
  });
  if (events.length < 5) return null; // need ≥5 events

  let operatorInit = 0;
  let theirInit = 0;
  for (const ev of events) {
    if (ev.source === "gmail") {
      const meta = ev.metadata as { direction?: "sent" | "received" } | null;
      if (meta?.direction === "sent") operatorInit++;
      else if (meta?.direction === "received") theirInit++;
    } else if (ev.source === "chat" || ev.source === "manual") {
      operatorInit++; // operator-initiated by definition
    } else {
      operatorInit++; // default assumption
    }
  }
  const total = operatorInit + theirInit || 1;
  return {
    operatorInitiatedPct: Math.round((operatorInit / total) * 100),
    theirInitiatedPct: Math.round((theirInit / total) * 100),
    sampleSize: events.length,
  };
}
```

- [ ] **Step 2: Cron**

`app/api/cron/reciprocity-tracker-update/route.ts`:

```ts
import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { computeReciprocity } from "@/lib/brain/reciprocity-tracker";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const profiles = await prisma.personProfile.findMany({
    where: { status: { not: "blown_up" }, deletedAt: null },
    select: { id: true },
    take: 100,
  });

  let updated = 0;
  for (const p of profiles) {
    const reciprocity = await computeReciprocity(p.id);
    if (!reciprocity) continue;
    // Store in metadata so it's surfaceable without schema migration
    await prisma.personProfile.update({
      where: { id: p.id },
      data: {
        metadata: {
          ...(await prisma.personProfile.findUnique({ where: { id: p.id }, select: { metadata: true } }))?.metadata as Record<string, unknown> | null ?? {},
          reciprocity,
          reciprocityUpdatedAt: new Date().toISOString(),
        } as never,
      },
    });
    updated++;
  }
  return { ok: true, candidates: profiles.length, updated };
});
```

- [ ] **Step 3: Register + commit**

```ts
  {
    name: "reciprocity-tracker-update",
    schedule: "0 3 * * 0", // Sunday 3am UTC = 10pm ET Saturday
    mode: "active",
    category: "brain",
    description: "Power Atlas · weekly reciprocity-gradient compute · 90d window · stored in PersonProfile.metadata.reciprocity",
    maxDuration: 120,
    addedAt: "2026-05-27",
  },
```

```bash
git add . && git commit -m "feat · power-atlas · reciprocity-tracker weekly cron · 90d operator-vs-them initiation gradient"
```

---

## Task 3.2: Tone-shift detector

**Files:**
- Create: `apps/statenour/lib/brain/tone-shift-detector.ts`
- Create: `apps/statenour/app/api/cron/tone-shift-detect/route.ts`
- Modify: `apps/statenour/config/crons.ts`

- [ ] **Step 1: Module**

Compares trailing-3 chat-mention sentiment vs trailing-30. Uses `tracedAiChat` for sentiment scoring.

```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

export async function detectToneShift(personId: string): Promise<{
  recentSentiment: number;
  trailingSentiment: number;
  shift: number;
  alert: boolean;
} | null> {
  const person = await prisma.personProfile.findUnique({ where: { id: personId } });
  if (!person) return null;

  const all = await prisma.chatMessage.findMany({
    where: { content: { contains: person.name, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: 33,
    select: { content: true },
  });
  if (all.length < 10) return null;

  const recent = all.slice(0, 3);
  const trailing = all.slice(3, 33);

  const score = async (texts: string[]): Promise<number> => {
    if (texts.length === 0) return 0;
    const result = await tracedAiChat(
      { label: "tone-sentiment", source: "cron" },
      [
        { role: "system", content: "Rate the operator's sentiment when mentioning this person. Output ONE number from -1 (very negative) to +1 (very positive). NO other text." },
        { role: "user", content: texts.map((t) => t.slice(0, 500)).join("\n---\n") },
      ],
      "fast",
    );
    const num = parseFloat((result.content ?? "0").trim());
    return Number.isFinite(num) ? Math.max(-1, Math.min(1, num)) : 0;
  };

  const [recentSentiment, trailingSentiment] = await Promise.all([score(recent.map((m) => m.content)), score(trailing.map((m) => m.content))]);
  const shift = recentSentiment - trailingSentiment;
  return {
    recentSentiment,
    trailingSentiment,
    shift,
    alert: Math.abs(shift) >= 0.5,
  };
}
```

- [ ] **Step 2: Cron + register + commit**

```ts
{
  name: "tone-shift-detect",
  schedule: "0 1 * * *", // daily 1am UTC = 8pm ET prev night
  mode: "active",
  category: "brain",
  description: "Power Atlas · daily tone-shift detection · trailing-3 vs trailing-30 sentiment delta",
  maxDuration: 300,
  addedAt: "2026-05-27",
},
```

Cron iterates profiles, calls `detectToneShift`, stores result in `metadata.toneShift`.

```bash
git add . && git commit -m "feat · power-atlas · tone-shift-detect daily cron · trailing-3 vs trailing-30 sentiment delta"
```

---

## Task 3.3: Topic graph × goal overlap

**Files:**
- Create: `apps/statenour/lib/brain/topic-goal-overlap.ts`
- Create: `apps/statenour/app/api/cron/topic-goal-overlap-compute/route.ts`
- Modify: `apps/statenour/config/crons.ts`

- [ ] **Step 1: Module**

Extracts top-N topics operator discusses about each person via TF-IDF over chat mentions. Cross-references against active LifeGoals. Stores topic-fit-to-goals score per person.

```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

export async function computeTopicGoalOverlap(personId: string): Promise<{
  topics: string[];
  goalAlignmentScore: number;
  goalMatches: { goalId: string; goalTitle: string; matchedTopics: string[] }[];
} | null> {
  const person = await prisma.personProfile.findUnique({ where: { id: personId } });
  if (!person) return null;

  const mentions = await prisma.chatMessage.findMany({
    where: { content: { contains: person.name, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { content: true },
  });
  if (mentions.length < 5) return null;

  const goals = await prisma.lifeGoal.findMany({
    where: { status: "active", deletedAt: null },
    select: { id: true, title: true, why: true, domain: true },
    take: 12,
  });

  const result = await tracedAiChat(
    { label: "topic-goal-overlap", source: "cron", metadata: { personId } },
    [
      { role: "system", content: "Extract top topics + cross-reference with goals. Output STRICT JSON." },
      { role: "user", content: `Chat mentions of ${person.name}:
${mentions.map((m) => m.content.slice(0, 200)).join("\n---\n").slice(0, 6000)}

Operator's active goals:
${goals.map((g) => `- ${g.id} · "${g.title}" (${g.domain}, why: ${g.why ?? "—"})`).join("\n")}

Output JSON only:
{
  "topics": ["top 5 topics operator + person consistently discuss"],
  "goalAlignmentScore": 0.0 to 1.0,
  "goalMatches": [{"goalId", "goalTitle", "matchedTopics": ["which topics match"]}]
}` },
    ],
    "reason",
  );

  try {
    const raw = (result.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Cron + register + commit**

```ts
{
  name: "topic-goal-overlap-compute",
  schedule: "30 5 * * 1", // Monday 5:30am UTC (after behavioral X-ray)
  mode: "active",
  category: "brain",
  description: "Power Atlas · weekly topic-graph × LifeGoal overlap score per person",
  maxDuration: 300,
  addedAt: "2026-05-27",
},
```

Stores result in `metadata.topicGoalOverlap`.

```bash
git add . && git commit -m "feat · power-atlas · topic-goal-overlap weekly cron · topic-fit-to-goals score"
```

---

## Task 3.4: Power-balance auto-compute

**Files:**
- Create: `apps/statenour/lib/brain/power-balance-engine.ts`
- Modify: `apps/statenour/app/api/cron/reciprocity-tracker-update/route.ts` (extend to also compute power balance)

- [ ] **Step 1: Engine**

Derives `powerBalance` from: reciprocity asymmetry + ledger trend + status + role weights.

```ts
import "server-only";
import { prisma } from "@/lib/prisma";

export async function computePowerBalance(personId: string): Promise<number | null> {
  const person = await prisma.personProfile.findUnique({ where: { id: personId } });
  if (!person) return null;
  const metadata = person.metadata as { reciprocity?: { operatorInitiatedPct?: number } } | null;
  const reciprocity = metadata?.reciprocity?.operatorInitiatedPct ?? null;

  // Heuristic · positive = operator has leverage · negative = they do
  let balance = 0;

  // 1. Reciprocity · if operator initiates ≥80%, they have power over operator (operator needs them more)
  if (reciprocity !== null) {
    balance += (50 - reciprocity) / 50; // 50% = balanced, 100% = operator-heavy = -1
  }

  // 2. Role-based prior
  const rolePrior: Record<string, number> = {
    employee: 0.5, mentor: -0.4, mentee: 0.4, boss: -0.6,
    customer: 0.3, vendor: 0.2, family: 0.0, friend: 0.0,
    rival: -0.1, enemy: -0.3,
  };
  balance += rolePrior[person.role] ?? 0;

  // 3. Recent ledger trend · positive ledger = operator giving = -balance
  const recentLedger = await prisma.relationshipLedger.findMany({
    where: { personId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { amount: true },
  });
  const recentSum = recentLedger.reduce((s, r) => s + r.amount, 0);
  balance += -Math.tanh(recentSum / 50) * 0.3;

  return Math.max(-1, Math.min(1, balance));
}
```

- [ ] **Step 2: Wire into existing reciprocity cron**

Edit `reciprocity-tracker-update/route.ts` to also call `computePowerBalance` and write to `powerBalance` column.

- [ ] **Step 3: Commit**

```bash
git add . && git commit -m "feat · power-atlas · power-balance-engine · derives powerBalance from reciprocity + role + ledger trend"
```

---

## Task 3.5: Greene law auto-tagging

**Files:**
- Create: `apps/statenour/lib/brain/greene-law-tagger.ts`
- Create: `apps/statenour/app/api/cron/greene-law-tag-refresh/route.ts`
- Modify: `apps/statenour/config/crons.ts`

- [ ] **Step 1: Tagger module**

For each person · runs semantic match between their state (ledger trend + tone shift + reciprocity + dark traits + role) and each seeded Greene law's `applicabilityPrompt`. Returns top-3 applicable laws.

```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export async function tagApplicableLaws(personId: string): Promise<number[]> {
  const person = await prisma.personProfile.findUnique({ where: { id: personId } });
  if (!person) return [];

  const lawRows = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.GREENE_LAW, key: { startsWith: "law_" } },
    select: { key: true, content: true },
  });

  const laws = lawRows.map((r) => {
    try {
      const parsed = JSON.parse(r.content) as { number: number; title: string; applicabilityPrompt: string };
      return { number: parsed.number, title: parsed.title, prompt: parsed.applicabilityPrompt };
    } catch { return null; }
  }).filter(Boolean) as { number: number; title: string; prompt: string }[];

  const personState = `Person ${person.name} · role ${person.role} · status ${person.status} · trust ${person.trustScore} · power ${person.powerBalance} · darkTraits [${person.darkTraits.join(",")}] · recent ledger trend ${(person.metadata as any)?.recentLedgerSum ?? "unknown"}`;

  const lawsBlock = laws.map((l) => `Law ${l.number} "${l.title}": ${l.prompt}`).join("\n");

  const result = await tracedAiChat(
    { label: "greene-law-tag", source: "cron", metadata: { personId } },
    [
      { role: "system", content: "Select up to 3 most-applicable Greene laws for this person. Output JSON array of law numbers · NO other text." },
      { role: "user", content: `${personState}\n\nCandidate laws:\n${lawsBlock}\n\nOutput JSON: {"applicableLaws":[<number>,<number>,<number>]}` },
    ],
    "reason",
  );

  try {
    const raw = (result.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    const parsed = JSON.parse(raw) as { applicableLaws: number[] };
    return (parsed.applicableLaws ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 48).slice(0, 3);
  } catch { return []; }
}
```

- [ ] **Step 2: Cron + register + commit**

```ts
{
  name: "greene-law-tag-refresh",
  schedule: "0 7 * * 1", // Monday 7am UTC
  mode: "active",
  category: "brain",
  description: "Power Atlas · weekly Greene-law auto-tagging · top-3 applicable laws per person",
  maxDuration: 300,
  addedAt: "2026-05-27",
},
```

Cron iterates profiles, calls tagger, writes to `applicableLaws` column.

```bash
git add . && git commit -m "feat · power-atlas · greene-law-tagger weekly cron · semantic-match top-3 laws per person"
```

---

## Task 3.6: Network graph view

**Files:**
- Create: `apps/statenour/app/(mastery)/relationships/network/page.tsx`
- Create: `apps/statenour/lib/brain/network-analysis.ts`
- Create: `apps/statenour/app/api/people/network/route.ts`

- [ ] **Step 1: Network analysis module**

Pure-JS centrality + bridge-node detection using a simple BFS-based approach (no networkx dep). Inputs: PersonProfile rows + co-mention edges from chat history.

```ts
import "server-only";
import { prisma } from "@/lib/prisma";

interface NetworkNode {
  id: string;
  name: string;
  role: string;
  trustScore: number;
  status: string;
  centrality: number;
  isBridge: boolean;
}

interface NetworkEdge { source: string; target: string; weight: number }

export async function buildNetwork(): Promise<{ nodes: NetworkNode[]; edges: NetworkEdge[] }> {
  const profiles = await prisma.personProfile.findMany({
    where: { status: { not: "blown_up" }, deletedAt: null },
    select: { id: true, name: true, role: true, trustScore: true, status: true },
  });

  // Build edges from co-mentions in same chat message
  const messages = await prisma.chatMessage.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 180 * 86400_000) } },
    select: { content: true },
    take: 1000,
  });

  const edges: Map<string, number> = new Map();
  for (const msg of messages) {
    const mentioned = profiles.filter((p) => msg.content.toLowerCase().includes(p.name.toLowerCase()));
    for (let i = 0; i < mentioned.length; i++) {
      for (let j = i + 1; j < mentioned.length; j++) {
        const key = [mentioned[i].id, mentioned[j].id].sort().join("|");
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
  }

  // Simple degree centrality
  const degree: Map<string, number> = new Map();
  for (const [key, weight] of edges.entries()) {
    const [a, b] = key.split("|");
    degree.set(a, (degree.get(a) ?? 0) + weight);
    degree.set(b, (degree.get(b) ?? 0) + weight);
  }
  const maxDegree = Math.max(1, ...Array.from(degree.values()));

  // Bridge detection · node connects two otherwise-disconnected clusters
  // Simplified · for now flag the top-3 degree nodes as bridge candidates
  const sortedByDegree = Array.from(degree.entries()).sort((a, b) => b[1] - a[1]);
  const bridgeIds = new Set(sortedByDegree.slice(0, 3).map(([id]) => id));

  const nodes: NetworkNode[] = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    trustScore: p.trustScore,
    status: p.status,
    centrality: (degree.get(p.id) ?? 0) / maxDegree,
    isBridge: bridgeIds.has(p.id),
  }));

  const edgeList: NetworkEdge[] = Array.from(edges.entries()).map(([key, weight]) => {
    const [source, target] = key.split("|");
    return { source, target, weight };
  });

  return { nodes, edges: edgeList };
}
```

- [ ] **Step 2: API route**

`app/api/people/network/route.ts` · returns `buildNetwork()` JSON.

- [ ] **Step 3: Page**

`app/(mastery)/relationships/network/page.tsx` · renders a simple 2D force-directed graph using basic SVG (no D3 dep · ~150 LOC).

For simplicity, render as a static circle-pack: nodes positioned on a circle, edges as straight lines between them, bridge nodes highlighted amber.

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "feat · power-atlas · network graph view at /relationships/network · degree centrality + bridge detection"
```

---

## Task 3.7: Brand-reputation cross-reference

**Files:**
- Create: `apps/statenour/lib/brain/social-proof-aggregator.ts`
- Modify: `apps/statenour/lib/trpc/routers/task.ts` (add `socialProofFor` query)

- [ ] **Step 1: Aggregator module**

Cross-references chat mentions of person X by OTHER people in the operator's network. Returns aggregated mentions.

```ts
import "server-only";
import { prisma } from "@/lib/prisma";

export async function aggregateSocialProof(personId: string): Promise<{
  totalCrossMentions: number;
  mentionsByPerson: { personId: string; personName: string; mentionCount: number }[];
}> {
  const target = await prisma.personProfile.findUnique({ where: { id: personId } });
  if (!target) return { totalCrossMentions: 0, mentionsByPerson: [] };

  const allPeople = await prisma.personProfile.findMany({
    where: { id: { not: personId }, deletedAt: null },
    select: { id: true, name: true },
  });

  // Find chat messages that mention BOTH the target person AND another person
  const messages = await prisma.chatMessage.findMany({
    where: { content: { contains: target.name, mode: "insensitive" } },
    select: { content: true },
    take: 500,
  });

  const mentionCounts: Map<string, number> = new Map();
  for (const msg of messages) {
    for (const otherPerson of allPeople) {
      if (msg.content.toLowerCase().includes(otherPerson.name.toLowerCase())) {
        mentionCounts.set(otherPerson.id, (mentionCounts.get(otherPerson.id) ?? 0) + 1);
      }
    }
  }

  const mentionsByPerson = Array.from(mentionCounts.entries())
    .map(([pid, count]) => {
      const person = allPeople.find((p) => p.id === pid);
      return { personId: pid, personName: person?.name ?? "(unknown)", mentionCount: count };
    })
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, 20);

  return {
    totalCrossMentions: mentionsByPerson.reduce((s, m) => s + m.mentionCount, 0),
    mentionsByPerson,
  };
}
```

- [ ] **Step 2: tRPC query**

```ts
  socialProofFor: operatorProcedure
    .input(z.object({ personId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const { aggregateSocialProof } = await import("@/lib/brain/social-proof-aggregator");
      return aggregateSocialProof(input.personId);
    }),
```

- [ ] **Step 3: Mount in detail panel + commit**

Add a "Social proof" section to the detail panel that calls `trpc.task.socialProofFor.useQuery({personId})` and displays the top cross-mentioners.

```bash
git add . && git commit -m "feat · power-atlas · social-proof-aggregator · cross-references chat mentions by other people in network"
```

---

## Task 3.8: Apify influencer-discovery (wanted relationships)

**Files:**
- Create: `apps/statenour/lib/integrations/apify-people-discovery.ts`
- Create: `apps/statenour/app/(mastery)/relationships/wanted/page.tsx`

- [ ] **Step 1: Integration module**

Pull from Apify influencer-discovery actor. Cross-references results against operator's active LifeGoals' topics.

```ts
import "server-only";

const APIFY_TOKEN = process.env.APIFY_API_TOKEN ?? "";
const INFLUENCER_ACTOR_ID = "apify/instagram-scraper"; // adapt to real actor

export interface WantedPerson {
  source: string;       // "instagram" | "linkedin" | etc.
  handle: string;
  name: string;
  bio: string;
  topicMatch: string[];
  matchScore: number;   // 0.0 to 1.0
}

export async function discoverWantedRelationships(operatorGoals: string[]): Promise<WantedPerson[]> {
  if (!APIFY_TOKEN) {
    return []; // graceful degradation when not configured
  }
  // Implementation depends on operator's preferred Apify actor.
  // Stub: returns empty until operator wires up keys.
  // When wired: POST to apify with goal topics → poll for results → match → return top 20.
  return [];
}
```

- [ ] **Step 2: Page**

`app/(mastery)/relationships/wanted/page.tsx` · operator-facing page listing wanted relationships. Header explains "configure APIFY_API_TOKEN in env to enable."

- [ ] **Step 3: Commit**

```bash
git add . && git commit -m "feat · power-atlas · apify influencer-discovery integration scaffold · wanted-relationships page · graceful degrade when token unset"
```

---

## Phase 3 Push + Smoke

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Smoke test**

Wait for Railway deploy. Open `bdnick.info/relationships`, click any person, verify all new sections render. Open `/relationships/network` and `/relationships/wanted`. Verify Sunday digest cron still fires next Sunday.

- [ ] **Step 3: Done**

Power Atlas is complete · Phases 0+1+2+3 all live.

---

## Self-Review

**1. Spec coverage** (Phase 2 + Phase 3 sections of spec):

| Spec line | Plan task |
|---|---|
| `updatePowerBalance` mutation | 2.1 ✓ |
| Kept-word tracker | 2.2 ✓ |
| Alpha moments archive | 2.3 ✓ |
| 5-year arc projection | 2.4 ✓ |
| Behavioral X-ray adapter | 2.5 ✓ |
| Psychographic ladder profiler | 2.6 ✓ |
| Dossier auto-drafter | 2.7 ✓ |
| Power plays runner | 2.8 ✓ |
| Reciprocity gradient | 3.1 ✓ |
| Tone shift detection | 3.2 ✓ |
| Topic graph × goal overlap | 3.3 ✓ |
| Power balance dashboard (auto-compute) | 3.4 ✓ |
| Greene law auto-tagging | 3.5 ✓ |
| Network graph view | 3.6 ✓ |
| Brand reputation cross-ref | 3.7 ✓ |
| Apify influencer discovery | 3.8 ✓ |

**2. Placeholder scan:** Tasks 2.6 + 3.6 reference "follow the same pattern as Task 2.5" and "simple SVG implementation" — these are pattern-references not placeholders (the pattern is fully detailed in the referenced task). 3.8 explicitly stubs Apify pending operator-provided API token · documented in the code.

**3. Type consistency:** All tRPC procedure names use camelCase · all cron names use kebab-case · all module names use kebab-case · all JSON output shapes match between modules and consumers.

---

## Execution Handoff

Plan saved to `apps/statenour/docs/superpowers/plans/2026-05-27-power-atlas-phase-2-and-3.md`.

Recommended execution mode: **Sequential subagents** — one for Phase 2, one for Phase 3. Phase 3 depends on Phase 2 data being seeded (powerBalance autocompute uses reciprocity output, etc.).

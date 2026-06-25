# Systemic Execution Engine: Missions Reconstruction

## 1. Context & Core Objective
The `/missions` portal on `bdnick.info` is transitioning from a reactive, manual Kanban board into a **self-driving, closed-loop Systemic Execution Engine**. The ultimate goal is to move from manual narration to passive observation by unifying the personal character sheet (the 6 Core Domains) directly with active shop operations and automated verification gates.

**The 6 Core Life Domains:**
1. `HEALTH`
2. `MIND`
3. `BUSINESS`
4. `SOCIAL`
5. `SPIRITUAL`
6. `PERSONAL`

Checklists without systemic consequences invite strategic drift. This architecture introduces automated context harvesting, real-world execution verification, fractional "Patience XP" for valid bottlenecks, and a brutal Systemic Decay cron for neglected priorities.

---

## 2. Database Schema & Auto-Resolving Architecture

### 2.1 The `ActionReceipt` Auto-Closer (`canClaimDone()`)
To enforce absolute honesty, missions cannot be transitioned to `DONE` without cryptographic or systemic proof of execution.

**Schema Updates (`apps/statenour/prisma/schema.prisma`):**
```prisma
model ActionReceipt {
  id                  String   @id @default(cuid())
  missionId           String
  mission             Mission  @relation(fields: [missionId], references: [id])
  sourceSystem        String   // "vapi", "github", "shopdriver", "stripe", "google_sync"
  verificationPayload Json     // Raw payload proving execution (e.g., commit SHA, Vapi call ID)
  executedAt          DateTime @default(now())

  @@index([missionId])
}

// Added to the Mission model:
// completionCriteria Json? // Defines what sourceSystem is required for canClaimDone()
```

**The `canClaimDone()` Hook Logic:**
When a system mutation occurs (a git push, a Vapi call answered, a Stripe invoice paid), the relevant webhook writes an `ActionReceipt`. The `/missions` page queries this ledger. If `canClaimDone()` resolves to true, the UI automatically triggers the status mutation to `DONE` with zero manual clicks.

### 2.2 Passive Context Harvesting (The Ingestion Seam)
Stop relying on manual inbox entries. 
- **The Action**: A background worker in `apps/worker` parses daily Google Calendar blocks, Google Drive document modifications, and unread Gmail threads.
- **Cognitive Routing**: A lightweight LLM classification pass (or embedding similarity) automatically maps these inbound nodes to one of the 6 Core Domains and drops them into the active mission pipeline.

---

## 3. XP Accumulation, Patience, and Systemic Decay

### 3.1 The `WAITING` Path XP-Accumulation Math (Patience-Multiplier)
Tasks stalled in a `WAITING` state (e.g., waiting for client sign-off) historically yielded zero progress, creating a false sense of unproductivity. We transform necessary downtime into a disciplined metric.

**Math Implementation in `updateTask`:**
```typescript
const BASE_PATIENCE_XP_PER_HOUR = 0.5;
const WAITING_CAP = 24; // Max XP awarded for waiting

// When transitioning OUT of WAITING:
const hoursWaiting = (Date.now() - mission.enteredWaitingAt.getTime()) / 3600000;
const gainedPatienceXP = Math.min(hoursWaiting * BASE_PATIENCE_XP_PER_HOUR, WAITING_CAP);

// Award `gainedPatienceXP` to the `MIND` domain (for disciplined patience).
```

### 3.2 Systemic Decay Cron (Neglect Penalty Scheduler)
If a critical mission is ignored, the system systematically deducts XP from the global character sheet and pushes a direct, unvarnished penalty alert to Telegram.

**Implementation in `config/crons.ts`:**
```typescript
const IDLE_HOURS_THRESHOLD = 48; // Grace period
const DECAY_MULTIPLIER = 1.5;    // Exponential or linear penalty weight

export async function neglectPenaltyCron() {
  const neglectedMissions = await prisma.mission.findMany({
    where: {
      status: { in: ['TODO', 'IN_PROGRESS'] },
      domain: { in: ['BUSINESS', 'SPIRITUAL'] },
      updatedAt: { lt: new Date(Date.now() - IDLE_HOURS_THRESHOLD * 3600000) }
    }
  });

  for (const mission of neglectedMissions) {
    const hoursIdle = (Date.now() - mission.updatedAt.getTime()) / 3600000;
    const penaltyXP = Math.floor((hoursIdle - IDLE_HOURS_THRESHOLD) * DECAY_MULTIPLIER);
    
    await deductDomainXP(mission.domain, penaltyXP);
    await sendTelegramAlert(`🚨 NEGLECT PENALTY: You bled ${penaltyXP} XP in ${mission.domain} due to inaction on "${mission.title}". Execute immediately.`);
  }
}
```

---

## 4. Visual Kinetics PWA UI Tokens

### 4.1 The High-Neglect "Rescue Strip"
- **Trigger**: Tasks with an active Neglect Cost (idle > 48 hours).
- **Aesthetic Token**: A sticky, high-contrast banner locking to the top of the mobile viewport. `bg-yellow-400 text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.6)]`.
- **Behavior**: Highlights the daily XP decay rate live. It cannot be dismissed without either executing the task or formally restructuring the timeline.

### 4.2 The 7-Day Velocity Ribbon
- **Trigger**: Replaces the standard weekday picker.
- **Aesthetic Token**: 6 micro-progress bars (color-coded to the 6 domains) stacked beneath each day label. Premium glassmorphism `bg-zinc-900/40 backdrop-blur-md`.
- **Behavior**: As verified `ActionReceipts` accumulate, the bars fill dynamically. Visually exposes exact domain neglect at a single glance.

### 4.3 Low-Cognitive "Counter Mode"
- **Trigger**: Header toggle for immediate, zero-friction execution.
- **Aesthetic Token**: Strip away all WebGL, heavy canvas assets, and horizontal Kanban dragging. 
- **Behavior**: Collapses the view into a clean, single-column vertical feed of the **Critical Few** (top 3 highest priority/neglect). Features large 44px tap targets for one-handed thumb use on poor mobile networks, reducing the barrier to action to absolute zero.

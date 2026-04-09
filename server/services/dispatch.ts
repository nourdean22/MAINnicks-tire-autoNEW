/**
 * Dispatch Service — Tech recommendation, bay assignment, work flow control.
 *
 * Core functions:
 *   - getAvailableTechs() — clocked-in techs with current load
 *   - getAvailableBays() — free bays
 *   - recommendTech() — skill match + load balance + performance scoring
 *   - assignWorkOrder() — assign tech + bay, advance status
 *   - startWork() — tech starts job, update bay occupancy
 *   - techComplete() — tech finishes, trigger QC
 */
import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { logTransition } from "./workOrderService";
import { createLogger } from "../lib/logger";

const log = createLogger("dispatch");

async function getDbAndSchema() {
  const { getDb } = await import("../db");
  const schema = await import("../../drizzle/schema");
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return { db: d, ...schema };
}

// ─── Available Techs (clocked in, with current load) ────
export async function getAvailableTechs() {
  const { db, technicians, workOrders } = await getDbAndSchema();

  const techs = await db.select().from(technicians)
    .where(and(eq(technicians.isActive, 1), eq(technicians.clockedIn, true)));

  // Count active jobs per tech
  const activeStatuses = ["assigned", "in_progress"];
  const techIds = techs.map((t: any) => t.id);

  let loadMap: Record<number, number> = {};
  if (techIds.length > 0) {
    const loads = await db.select({
      techId: workOrders.assignedTechId,
      count: sql<number>`count(*)`.as("count"),
    }).from(workOrders)
      .where(and(
        inArray(workOrders.assignedTechId, techIds),
        inArray(workOrders.status, activeStatuses),
      ))
      .groupBy(workOrders.assignedTechId);

    for (const l of loads) {
      if (l.techId) loadMap[l.techId] = l.count;
    }
  }

  return techs.map((t: any) => ({
    ...t,
    currentLoad: loadMap[t.id] || 0,
    skills: (t.skills as string[] | null) || [],
  }));
}

// ─── Available Bays ─────────────────────────────────
export async function getAvailableBays() {
  const { db, bays } = await getDbAndSchema();
  return db.select().from(bays).where(eq(bays.active, true));
}

export async function getFreeBays() {
  const { db, bays } = await getDbAndSchema();
  return db.select().from(bays)
    .where(and(eq(bays.active, true), isNull(bays.currentWorkOrderId)));
}

// ─── Tech Recommendation Engine ─────────────────────
export async function recommendTech(workOrderId: string): Promise<Array<{
  techId: number;
  name: string;
  score: number;
  reasons: string[];
}>> {
  const { db, workOrders, workOrderItems } = await getDbAndSchema();

  // Get work order details
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!wo) throw new Error("Work order not found");

  // Get line items to determine service types
  const items = await db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, workOrderId));
  const serviceKeywords = extractServiceKeywords(wo.serviceDescription || "", items);

  // Get available techs
  const techs = await getAvailableTechs();
  if (techs.length === 0) return [];

  return techs.map((tech: any) => {
    let score = 50; // base score
    const reasons: string[] = [];

    // 1. Skill match (0-30 points)
    const techSkills = tech.skills;
    const matched = serviceKeywords.filter(kw => techSkills.includes(kw));
    const skillScore = serviceKeywords.length > 0
      ? (matched.length / serviceKeywords.length) * 30
      : 15; // neutral if no keywords detected
    score += skillScore;
    if (matched.length > 0) reasons.push(`Skills: ${matched.join(", ")}`);

    // 2. Load balance (0-20 points) — less load = higher score
    const loadScore = Math.max(0, 20 - (tech.currentLoad * 10));
    score += loadScore;
    if (tech.currentLoad === 0) reasons.push("Available now");
    else reasons.push(`${tech.currentLoad} active job(s)`);

    // 3. Performance (0-20 points)
    const qcRate = Number(tech.qcPassRate) || 1;
    const comebackRate = Number(tech.comebackRate) || 0;
    const perfScore = (qcRate * 10) + ((1 - comebackRate) * 10);
    score += perfScore;

    // 4. Role bonus
    if (tech.role === "lead" || tech.role === "master") {
      score += 5;
      reasons.push(`${tech.role} tech`);
    }

    return {
      techId: tech.id,
      name: tech.name,
      score: Math.round(score),
      reasons,
    };
  }).sort((a: any, b: any) => b.score - a.score);
}

function extractServiceKeywords(desc: string, items: { description: string; type?: string }[]): string[] {
  const keywords: string[] = [];
  const text = (desc + " " + items.map(i => i.description).join(" ")).toLowerCase();

  const skillMap: Record<string, string[]> = {
    brakes: ["brake", "rotor", "caliper", "pad"],
    tires: ["tire", "mount", "balance", "rotation", "flat"],
    alignment: ["alignment", "align", "toe", "camber"],
    oil_change: ["oil change", "oil filter", "lube"],
    diagnostics: ["diagnostic", "check engine", "scan", "code"],
    engine: ["engine", "head gasket", "timing", "valve"],
    electrical: ["electrical", "battery", "alternator", "starter", "wiring"],
    suspension: ["suspension", "strut", "shock", "control arm", "ball joint"],
    exhaust: ["exhaust", "muffler", "catalytic"],
    transmission: ["transmission", "trans fluid", "clutch"],
    ac: ["a/c", "ac", "air conditioning", "freon", "compressor"],
  };

  for (const [skill, terms] of Object.entries(skillMap)) {
    if (terms.some(t => text.includes(t))) {
      keywords.push(skill);
    }
  }

  return keywords;
}

// ─── Assign Work Order to Tech + Bay ────────────────
export async function assignWorkOrder(params: {
  workOrderId: string;
  techId: number;
  bayId: number;
  changedBy: string;
}): Promise<void> {
  const { db, workOrders, technicians, bays } = await getDbAndSchema();

  // Get tech name
  const [tech] = await db.select().from(technicians).where(eq(technicians.id, params.techId));
  if (!tech) throw new Error("Technician not found");

  // Get bay
  const [bay] = await db.select().from(bays).where(eq(bays.id, params.bayId));
  if (!bay) throw new Error("Bay not found");
  if (bay.currentWorkOrderId) throw new Error(`Bay ${bay.name} is occupied`);

  // Get current status
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, params.workOrderId));
  if (!wo) throw new Error("Work order not found");

  // Update work order
  await db.update(workOrders).set({
    assignedTechId: params.techId,
    assignedTech: tech.name,
    assignedBay: bay.name,
    status: "assigned",
    updatedAt: new Date(),
  }).where(eq(workOrders.id, params.workOrderId));

  // Update bay occupancy
  await db.update(bays).set({
    currentWorkOrderId: params.workOrderId,
    currentTechId: params.techId,
  }).where(eq(bays.id, params.bayId));

  await logTransition(params.workOrderId, wo.status, "assigned", params.changedBy,
    `Assigned to ${tech.name} in Bay ${bay.name}`);

  // NOUR OS event
  try {
    const { onWorkOrderStatusChange } = await import("../nour-os-bridge");
    onWorkOrderStatusChange({
      workOrderId: params.workOrderId,
      orderNumber: wo.orderNumber,
      fromStatus: wo.status,
      toStatus: "assigned",
      service: wo.serviceDescription || undefined,
    });
  } catch (err) {
    console.error("[Dispatch] NOUR OS bridge event failed (assign):", err instanceof Error ? err.message : err);
  }
}

// ─── Start Work (tech begins job) ───────────────────
export async function startWork(params: {
  workOrderId: string;
  changedBy: string;
}): Promise<void> {
  const { db, workOrders } = await getDbAndSchema();

  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, params.workOrderId));
  if (!wo) throw new Error("Work order not found");

  await db.update(workOrders).set({
    status: "in_progress",
    startedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(workOrders.id, params.workOrderId));

  await logTransition(params.workOrderId, wo.status, "in_progress", params.changedBy);

  try {
    const { onWorkOrderStatusChange } = await import("../nour-os-bridge");
    onWorkOrderStatusChange({
      workOrderId: params.workOrderId,
      orderNumber: wo.orderNumber,
      fromStatus: wo.status,
      toStatus: "in_progress",
      service: wo.serviceDescription || undefined,
    });
  } catch (err) {
    console.error("[Dispatch] NOUR OS bridge event failed (start):", err instanceof Error ? err.message : err);
  }
}

// ─── Tech Complete (moves to QC review) ─────────────
export async function techComplete(params: {
  workOrderId: string;
  techNotes?: string;
  changedBy: string;
}): Promise<void> {
  const { db, workOrders, bays } = await getDbAndSchema();

  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, params.workOrderId));
  if (!wo) throw new Error("Work order not found");

  // Release bay
  if (wo.assignedBay) {
    await db.update(bays).set({
      currentWorkOrderId: null,
      currentTechId: null,
    }).where(eq(bays.currentWorkOrderId, params.workOrderId));
  }

  await db.update(workOrders).set({
    status: "qc_review",
    techNotes: params.techNotes || wo.techNotes,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(workOrders.id, params.workOrderId));

  await logTransition(params.workOrderId, wo.status, "qc_review", params.changedBy,
    params.techNotes ? `Tech notes: ${params.techNotes}` : undefined);

  // Auto-create QC checklist
  try {
    const { createQcChecklist } = await import("./qcService");
    await createQcChecklist(params.workOrderId);
  } catch (err) {
    console.error("[Dispatch] Auto QC checklist creation failed:", err instanceof Error ? err.message : err);
  }

  try {
    const { onWorkOrderStatusChange } = await import("../nour-os-bridge");
    onWorkOrderStatusChange({
      workOrderId: params.workOrderId,
      orderNumber: wo.orderNumber,
      fromStatus: wo.status,
      toStatus: "qc_review",
      service: wo.serviceDescription || undefined,
    });
  } catch (err) {
    console.error("[Dispatch] NOUR OS bridge event failed (qc_review):", err instanceof Error ? err.message : err);
  }
}

// ─── Clock In/Out ───────────────────────────────────
export async function clockIn(techId: number): Promise<void> {
  const { db, technicians } = await getDbAndSchema();
  await db.update(technicians).set({
    clockedIn: true,
    clockedInAt: new Date(),
  }).where(eq(technicians.id, techId));
}

export async function clockOut(techId: number): Promise<void> {
  const { db, technicians } = await getDbAndSchema();
  await db.update(technicians).set({
    clockedIn: false,
    clockedInAt: null,
  }).where(eq(technicians.id, techId));
}

// ─── Load per Tech + per Bay ────────────────────────
export async function getDispatchLoad() {
  const { db, technicians, workOrders, bays } = await getDbAndSchema();

  const activeStatuses = ["assigned", "in_progress"];

  // Tech load
  const techs = await db.select().from(technicians).where(eq(technicians.isActive, 1));
  const techLoads = await db.select({
    techId: workOrders.assignedTechId,
    count: sql<number>`count(*)`.as("count"),
  }).from(workOrders)
    .where(inArray(workOrders.status, activeStatuses))
    .groupBy(workOrders.assignedTechId);

  const techLoadMap: Record<number, number> = {};
  for (const l of techLoads) {
    if (l.techId) techLoadMap[l.techId] = l.count;
  }

  // Bay occupancy
  const allBays = await db.select().from(bays).where(eq(bays.active, true));

  return {
    techs: techs.map((t: any) => ({
      id: t.id,
      name: t.name,
      role: t.role,
      clockedIn: t.clockedIn,
      currentLoad: techLoadMap[t.id] || 0,
      skills: (t.skills as string[] | null) || [],
    })),
    bays: allBays.map((b: any) => ({
      id: b.id,
      name: b.name,
      type: b.type,
      occupied: !!b.currentWorkOrderId,
      currentWorkOrderId: b.currentWorkOrderId,
      currentTechId: b.currentTechId,
    })),
  };
}

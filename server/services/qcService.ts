/**
 * QC Service — Quality control checklists, pass/fail gating, comeback detection.
 *
 * QC is mandatory before a vehicle can move to ready_for_pickup.
 * Service-specific templates ensure nothing gets missed.
 */
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { logTransition } from "./workOrderService";

async function getDbAndSchema() {
  const { getDb } = await import("../db");
  const schema = await import("../../drizzle/schema");
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return { db: d, ...schema };
}

// ─── QC Templates per Service Type ──────────────────
export interface QcCheckItem {
  id: string;
  label: string;
  category: string;
  required: boolean;
  passed: boolean | null;
  notes?: string;
}

const COMMON_ITEMS: QcCheckItem[] = [
  { id: "visual_inspect", label: "Visual inspection — no leaks, loose parts, or damage", category: "General", required: true, passed: null },
  { id: "test_drive_safe", label: "Vehicle safe to drive (or noted otherwise)", category: "General", required: true, passed: null },
  { id: "clean_interior", label: "Seat covers / floor mats removed, interior clean", category: "Cleanliness", required: true, passed: null },
  { id: "no_tools_left", label: "No tools or rags left in engine bay or interior", category: "Cleanliness", required: true, passed: null },
  { id: "torque_verified", label: "Lug nuts / bolts torqued to spec", category: "Safety", required: true, passed: null },
];

const SERVICE_TEMPLATES: Record<string, QcCheckItem[]> = {
  brakes: [
    { id: "brake_pedal_feel", label: "Brake pedal firm, no spongy feel", category: "Brakes", required: true, passed: null },
    { id: "brake_no_noise", label: "No grinding or squealing during test stop", category: "Brakes", required: true, passed: null },
    { id: "brake_fluid_level", label: "Brake fluid level correct", category: "Brakes", required: true, passed: null },
    { id: "brake_lines_check", label: "Brake lines — no leaks or damage", category: "Brakes", required: true, passed: null },
    { id: "parking_brake", label: "Parking brake holds on incline", category: "Brakes", required: true, passed: null },
  ],
  tires: [
    { id: "tire_pressure", label: "Tire pressure set to door placard spec", category: "Tires", required: true, passed: null },
    { id: "tire_tread", label: "Tread depth uniform, no bulges or damage", category: "Tires", required: true, passed: null },
    { id: "tire_balance", label: "No vibration at highway speed", category: "Tires", required: false, passed: null },
    { id: "tpms_reset", label: "TPMS light off / sensors calibrated", category: "Tires", required: true, passed: null },
    { id: "spare_check", label: "Spare tire and jack returned to proper location", category: "Tires", required: false, passed: null },
  ],
  oil_change: [
    { id: "oil_level", label: "Oil level correct on dipstick", category: "Oil", required: true, passed: null },
    { id: "drain_plug", label: "Drain plug tight, no drips", category: "Oil", required: true, passed: null },
    { id: "filter_seated", label: "Oil filter properly seated, no leaks", category: "Oil", required: true, passed: null },
    { id: "oil_light_reset", label: "Oil life monitor reset", category: "Oil", required: true, passed: null },
    { id: "oil_sticker", label: "Next service sticker placed on windshield", category: "Oil", required: true, passed: null },
  ],
  diagnostics: [
    { id: "codes_cleared", label: "Diagnostic trouble codes cleared (if applicable)", category: "Diagnostics", required: true, passed: null },
    { id: "mil_off", label: "Check engine / warning lights off", category: "Diagnostics", required: true, passed: null },
    { id: "live_data_normal", label: "Live data within normal parameters", category: "Diagnostics", required: false, passed: null },
    { id: "customer_concern_resolved", label: "Original customer concern resolved", category: "Diagnostics", required: true, passed: null },
  ],
  suspension: [
    { id: "ride_height", label: "Ride height even, no sagging", category: "Suspension", required: true, passed: null },
    { id: "no_clunks", label: "No clunks or rattles over bumps", category: "Suspension", required: true, passed: null },
    { id: "alignment_needed", label: "Alignment performed or verified unnecessary", category: "Suspension", required: true, passed: null },
    { id: "steering_center", label: "Steering wheel centered", category: "Suspension", required: true, passed: null },
  ],
};

// ─── Generate checklist for a work order ────────────
export async function createQcChecklist(workOrderId: string): Promise<number> {
  const { db, workOrders, workOrderItems, qcChecklists } = await getDbAndSchema();

  // Get work order + items to determine services
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!wo) throw new Error("Work order not found");

  const items = await db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, workOrderId));
  const text = (wo.serviceDescription || "") + " " + items.map((i: any) => i.description).join(" ");

  // Build checklist from matching templates
  const checkItems: QcCheckItem[] = [...COMMON_ITEMS];
  const matchedServices: string[] = [];

  const servicePatterns: Record<string, string[]> = {
    brakes: ["brake", "rotor", "caliper", "pad"],
    tires: ["tire", "mount", "balance", "rotation"],
    oil_change: ["oil change", "oil filter", "lube"],
    diagnostics: ["diagnostic", "check engine", "scan"],
    suspension: ["suspension", "strut", "shock", "control arm"],
  };

  const lowerText = text.toLowerCase();
  for (const [service, patterns] of Object.entries(servicePatterns)) {
    if (patterns.some(p => lowerText.includes(p))) {
      matchedServices.push(service);
      checkItems.push(...(SERVICE_TEMPLATES[service] || []));
    }
  }

  // Determine if road test is needed
  const needsRoadTest = matchedServices.some(s => ["brakes", "suspension", "diagnostics"].includes(s));

  const [result] = await db.insert(qcChecklists).values({
    workOrderId,
    status: "pending",
    items: checkItems,
    roadTestRequired: needsRoadTest,
  }).$returningId();

  return result.id;
}

// ─── Get QC checklist for a work order ──────────────
export async function getQcChecklist(workOrderId: string) {
  const { db, qcChecklists } = await getDbAndSchema();
  const [checklist] = await db.select().from(qcChecklists)
    .where(eq(qcChecklists.workOrderId, workOrderId))
    .orderBy(desc(qcChecklists.createdAt))
    .limit(1);
  return checklist || null;
}

// ─── Update QC checklist items ──────────────────────
export async function updateQcChecklist(params: {
  checklistId: number;
  items: QcCheckItem[];
  completedBy: string;
  roadTestCompleted?: boolean;
  roadTestNotes?: string;
  roadTestMileage?: number;
}): Promise<void> {
  const { db, qcChecklists } = await getDbAndSchema();
  await db.update(qcChecklists).set({
    items: params.items,
    completedBy: params.completedBy,
    status: "in_progress",
    startedAt: new Date(),
    roadTestCompleted: params.roadTestCompleted ?? undefined,
    roadTestNotes: params.roadTestNotes ?? undefined,
    roadTestMileage: params.roadTestMileage ?? undefined,
  }).where(eq(qcChecklists.id, params.checklistId));
}

// ─── Pass QC — moves WO to ready_for_pickup ─────────
export async function passQc(params: {
  checklistId: number;
  reviewedBy: string;
}): Promise<void> {
  const { db, qcChecklists, workOrders } = await getDbAndSchema();

  const [cl] = await db.select().from(qcChecklists).where(eq(qcChecklists.id, params.checklistId));
  if (!cl) throw new Error("QC checklist not found");

  // Verify all required items passed
  const items = (cl.items as QcCheckItem[]) || [];
  const failedRequired = items.filter(i => i.required && i.passed !== true);
  if (failedRequired.length > 0) {
    throw new Error(`${failedRequired.length} required item(s) not passed: ${failedRequired.map(i => i.label).join(", ")}`);
  }

  // Verify road test if required
  if (cl.roadTestRequired && !cl.roadTestCompleted) {
    throw new Error("Road test required but not completed");
  }

  // Update checklist
  await db.update(qcChecklists).set({
    status: "passed",
    reviewedBy: params.reviewedBy,
    completedAt: new Date(),
  }).where(eq(qcChecklists.id, params.checklistId));

  // Advance work order
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, cl.workOrderId));
  if (wo) {
    await db.update(workOrders).set({
      status: "ready_for_pickup",
      updatedAt: new Date(),
    }).where(eq(workOrders.id, cl.workOrderId));

    await logTransition(cl.workOrderId, wo.status, "ready_for_pickup", params.reviewedBy, "QC passed");

    try {
      const { onWorkOrderStatusChange } = await import("../nour-os-bridge");
      onWorkOrderStatusChange({
        workOrderId: cl.workOrderId,
        orderNumber: wo.orderNumber,
        fromStatus: wo.status,
        toStatus: "ready_for_pickup",
        service: wo.serviceDescription || undefined,
      });
    } catch (err) {
      console.error("[QC] NOUR OS bridge event failed:", err instanceof Error ? err.message : err);
    }
  }
}

// ─── Fail QC — records failure, stays in qc_review ──
export async function failQc(params: {
  checklistId: number;
  failureReasons: string[];
  correctiveActions: string;
  reviewedBy: string;
}): Promise<void> {
  const { db, qcChecklists, workOrders } = await getDbAndSchema();

  const [cl] = await db.select().from(qcChecklists).where(eq(qcChecklists.id, params.checklistId));
  if (!cl) throw new Error("QC checklist not found");

  await db.update(qcChecklists).set({
    status: "failed",
    failureReasons: params.failureReasons,
    correctiveActions: params.correctiveActions,
    reviewedBy: params.reviewedBy,
    completedAt: new Date(),
  }).where(eq(qcChecklists.id, params.checklistId));

  // Move WO back to in_progress for rework
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, cl.workOrderId));
  if (wo) {
    await db.update(workOrders).set({
      status: "in_progress",
      updatedAt: new Date(),
    }).where(eq(workOrders.id, cl.workOrderId));

    await logTransition(cl.workOrderId, wo.status, "in_progress", params.reviewedBy,
      `QC failed: ${params.failureReasons.join(", ")}`);
  }
}

// ─── Comeback Detection ─────────────────────────────
export async function checkForComeback(params: {
  customerId: string;
  vehicleVin?: string | null;
  serviceDescription?: string;
}): Promise<Array<{
  originalWorkOrderId: string;
  orderNumber: string;
  completedAt: string | null;
  daysSince: number;
  serviceDescription: string | null;
}>> {
  const { db, workOrders } = await getDbAndSchema();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Find recent completed work orders for this customer
  const recent = await db.select().from(workOrders)
    .where(and(
      eq(workOrders.customerId, params.customerId),
      gte(workOrders.completedAt, thirtyDaysAgo),
    ))
    .orderBy(desc(workOrders.completedAt))
    .limit(5);

  return recent.map((wo: any) => ({
    originalWorkOrderId: wo.id,
    orderNumber: wo.orderNumber,
    completedAt: wo.completedAt?.toISOString() || null,
    daysSince: wo.completedAt
      ? Math.floor((Date.now() - wo.completedAt.getTime()) / (1000 * 60 * 60 * 24))
      : 0,
    serviceDescription: wo.serviceDescription,
  }));
}

// ─── Record a Comeback ──────────────────────────────
export async function recordComeback(params: {
  originalWorkOrderId: string;
  comebackWorkOrderId?: string;
  customerId: string;
  serviceType?: string;
  originalTechId?: number;
  daysSinceOriginal: number;
  type: string;
  severity?: string;
  rootCause?: string;
  description?: string;
}): Promise<number> {
  const { db, comebacks } = await getDbAndSchema();

  const [result] = await db.insert(comebacks).values({
    originalWorkOrderId: params.originalWorkOrderId,
    comebackWorkOrderId: params.comebackWorkOrderId || null,
    customerId: params.customerId,
    serviceType: params.serviceType || null,
    originalTechId: params.originalTechId || null,
    daysSinceOriginal: params.daysSinceOriginal,
    type: params.type as any,
    severity: params.severity || null,
    rootCause: params.rootCause || null,
    description: params.description || null,
  }).$returningId();

  return result.id;
}

// ─── QC Stats ───────────────────────────────────────
export async function getQcStats() {
  const { db, qcChecklists, comebacks } = await getDbAndSchema();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [qcCounts] = await db.select({
    total: sql<number>`count(*)`,
    passed: sql<number>`sum(case when status = 'passed' then 1 else 0 end)`,
    failed: sql<number>`sum(case when status = 'failed' then 1 else 0 end)`,
    pending: sql<number>`sum(case when status = 'pending' then 1 else 0 end)`,
  }).from(qcChecklists)
    .where(gte(qcChecklists.createdAt, thirtyDaysAgo));

  const [comebackCounts] = await db.select({
    total: sql<number>`count(*)`,
  }).from(comebacks)
    .where(gte(comebacks.createdAt, thirtyDaysAgo));

  return {
    qcTotal: qcCounts?.total || 0,
    qcPassed: qcCounts?.passed || 0,
    qcFailed: qcCounts?.failed || 0,
    qcPending: qcCounts?.pending || 0,
    passRate: qcCounts?.total ? ((qcCounts.passed || 0) / qcCounts.total * 100).toFixed(1) : "100.0",
    comebacks30d: comebackCounts?.total || 0,
  };
}

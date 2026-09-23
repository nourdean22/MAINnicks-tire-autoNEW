/**
 * Tire registration service (Q-47, 49 CFR 574.8) — capture each tire's TIN per position on a
 * work order, record how the shop met 574.8, and render the paper registration form.
 *
 * NO SIDE EFFECTS OUTSIDE THE DB. Nothing here submits to a manufacturer or messages a
 * customer: the shop hands over the form or registers the tires itself, and this records it.
 *
 * The store is an interface so the flow is testable without a database; `drizzleStore()` is
 * the production implementation.
 */
import { TRPCError } from "@trpc/server";
import {
  checkTin, expectedTireCount, renderRegistrationFormHtml, summarizeRegistration,
  REGISTRATION_METHODS, TIRE_CONDITIONS, TIRE_POSITIONS,
  type RegistrationMethod, type RegistrationSummary, type TireCondition, type TirePosition,
  type WorkOrderLineLike,
} from "@shared/tireTin";
import { BUSINESS } from "@shared/business";

export interface RegistrationRow {
  workOrderId: string;
  position: string;
  tin: string | null;
  tinStatus: string | null;
  tinWeek: number | null;
  tinYear: number | null;
  tireBrand: string | null;
  tireCondition: string;
  registrationMethod: string;
  registeredAt: Date | null;
  registeredBy: string | null;
  capturedBy: string | null;
  updatedAt?: Date | null;
}

export interface WorkOrderForRegistration {
  id: string;
  orderNumber: string;
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  completedAt: Date | null;
  createdAt: Date;
  items: WorkOrderLineLike[];
}

export interface TireRegistrationStore {
  loadWorkOrder(workOrderId: string): Promise<WorkOrderForRegistration | null>;
  listRows(workOrderId: string): Promise<RegistrationRow[]>;
  upsertRow(row: RegistrationRow): Promise<void>;
  deleteRow(workOrderId: string, position: string): Promise<void>;
}

export interface RegistrationView {
  workOrderId: string;
  expected: number;
  rows: RegistrationRow[];
  summary: RegistrationSummary;
}

async function requireOrder(store: TireRegistrationStore, workOrderId: string) {
  const order = await store.loadWorkOrder(workOrderId);
  if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Work order not found." });
  return order;
}

/** Throws on any read failure — the caller renders an error, never "0 tires". */
export async function getRegistration(store: TireRegistrationStore, workOrderId: string): Promise<RegistrationView> {
  const order = await requireOrder(store, workOrderId);
  const rows = await store.listRows(workOrderId);
  const expected = expectedTireCount(order.items);
  return { workOrderId, expected, rows, summary: summarizeRegistration(expected, rows) };
}

export interface CaptureInput {
  workOrderId: string;
  position: TirePosition;
  tin: string;
  brand?: string | null;
  condition: TireCondition;
  by: string;
}

/**
 * Record one position's TIN. An invalid TIN is rejected with the validator's reasons; a
 * pre-2000 (3-digit date code) TIN is stored but flagged, and keeps the order incomplete.
 */
export async function captureTin(store: TireRegistrationStore, input: CaptureInput, now = new Date()): Promise<RegistrationView> {
  if (!TIRE_POSITIONS.includes(input.position)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown tire position: ${input.position}` });
  }
  if (!TIRE_CONDITIONS.includes(input.condition)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown tire condition: ${input.condition}` });
  }
  const check = checkTin(input.tin, now);
  if (check.status === "invalid") {
    throw new TRPCError({ code: "BAD_REQUEST", message: check.issues.join(" ") });
  }
  await requireOrder(store, input.workOrderId);
  const existing = (await store.listRows(input.workOrderId)).find((r) => r.position === input.position);

  // A used tire has no 574.8 duty. A tire switched back to new must be registered again.
  let method: string = existing?.registrationMethod ?? "pending";
  let registeredAt = existing?.registeredAt ?? null;
  let registeredBy = existing?.registeredBy ?? null;
  const tinChanged = existing?.tin != null && existing.tin !== check.normalized;
  if (input.condition === "used") {
    method = "not_required_used"; registeredAt = null; registeredBy = null;
  } else if (method === "not_required_used" || tinChanged) {
    // A different tire (or a new one) invalidates any earlier registration of this position.
    method = "pending"; registeredAt = null; registeredBy = null;
  }

  await store.upsertRow({
    workOrderId: input.workOrderId,
    position: input.position,
    tin: check.normalized,
    tinStatus: check.status,
    tinWeek: check.week,
    tinYear: check.year,
    tireBrand: input.brand?.trim() ? input.brand.trim().slice(0, 100) : null,
    tireCondition: input.condition,
    registrationMethod: method,
    registeredAt,
    registeredBy,
    capturedBy: input.by.slice(0, 100),
  });
  return getRegistration(store, input.workOrderId);
}

export async function removePosition(store: TireRegistrationStore, workOrderId: string, position: string): Promise<RegistrationView> {
  await requireOrder(store, workOrderId);
  await store.deleteRow(workOrderId, position);
  return getRegistration(store, workOrderId);
}

/**
 * Record how 574.8 was met for every NEW tire on the order. Refused while any new tire's TIN is
 * missing or not valid: the form (or the submission) has to carry every TIN on the sale.
 */
export async function recordRegistration(
  store: TireRegistrationStore,
  input: { workOrderId: string; method: RegistrationMethod; by: string },
  now = new Date(),
): Promise<RegistrationView> {
  if (!REGISTRATION_METHODS.includes(input.method) || input.method === "not_required_used") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Not a registration step for a new tire: ${input.method}` });
  }
  const view = await getRegistration(store, input.workOrderId);
  const newRows = view.rows.filter((r) => r.tireCondition !== "used");
  if (newRows.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No new tires captured on this work order." });
  }
  if (input.method !== "pending" && (view.summary.missingTins > 0 || newRows.some((r) => r.tinStatus !== "valid"))) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Capture every tire's DOT code first (${view.summary.missingTins} missing or not valid).`,
    });
  }
  for (const r of newRows) {
    await store.upsertRow({
      ...r,
      registrationMethod: input.method,
      registeredAt: input.method === "pending" ? null : now,
      registeredBy: input.method === "pending" ? null : input.by.slice(0, 100),
    });
  }
  return getRegistration(store, input.workOrderId);
}

const ET_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
});

/** The 574.8(a)(1)(i) paper form. Refused while any tire on the sale lacks a valid TIN. */
export async function registrationFormHtml(store: TireRegistrationStore, workOrderId: string): Promise<string> {
  const order = await requireOrder(store, workOrderId);
  const view = await getRegistration(store, workOrderId);
  if (view.summary.missingTins > 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${view.summary.missingTins} tire(s) still need a valid DOT code before the form can be printed.`,
    });
  }
  const vehicle = [order.vehicleYear, order.vehicleMake, order.vehicleModel].filter(Boolean).join(" ") || null;
  try {
    return renderRegistrationFormHtml({
      dealerName: BUSINESS.name,
      dealerStreet: BUSINESS.address.street,
      dealerCityStateZip: `${BUSINESS.address.city}, ${BUSINESS.address.state} ${BUSINESS.address.zip}`,
      orderNumber: order.orderNumber,
      saleDate: ET_DATE.format(order.completedAt ?? order.createdAt),
      vehicle,
      tires: view.rows
        .filter((r) => r.tin && r.tinStatus === "valid")
        .map((r) => ({ position: r.position, tin: r.tin as string, brand: r.tireBrand, tireCondition: r.tireCondition })),
    });
  } catch (err) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: err instanceof Error ? err.message : String(err) });
  }
}

// ─── Production store ──────────────────────────────────────────────────────

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; errno?: number; cause?: { code?: string; errno?: number } };
  return e?.code === "ER_NO_SUCH_TABLE" || e?.errno === 1146 || e?.cause?.code === "ER_NO_SUCH_TABLE" || e?.cause?.errno === 1146;
}

/** Surfaces the pre-migration window as a named error instead of a generic 500 or a zero. */
async function guardTable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isMissingTable(err)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Tire registration storage is not set up yet (migration 0131_tire_registrations has not been applied).",
      });
    }
    throw err;
  }
}

export function drizzleStore(): TireRegistrationStore {
  const deps = async () => {
    const { getDb } = await import("../db");
    const schema = await import("../../drizzle/schema");
    const orm = await import("drizzle-orm");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable — tire registrations could not be read." });
    return { db, ...schema, ...orm };
  };
  return {
    async loadWorkOrder(id) {
      const { db, workOrders, workOrderItems, eq } = await deps();
      const [o] = await db.select({
        id: workOrders.id, orderNumber: workOrders.orderNumber,
        vehicleYear: workOrders.vehicleYear, vehicleMake: workOrders.vehicleMake, vehicleModel: workOrders.vehicleModel,
        completedAt: workOrders.completedAt, createdAt: workOrders.createdAt,
      }).from(workOrders).where(eq(workOrders.id, id)).limit(1);
      if (!o) return null;
      const items = await db.select({
        type: workOrderItems.type, quantity: workOrderItems.quantity,
        approved: workOrderItems.approved, declined: workOrderItems.declined,
      }).from(workOrderItems).where(eq(workOrderItems.workOrderId, id));
      return { ...o, items };
    },
    async listRows(id) {
      const { db, tireRegistrations, eq, asc } = await deps();
      return guardTable(() => db.select().from(tireRegistrations)
        .where(eq(tireRegistrations.workOrderId, id))
        .orderBy(asc(tireRegistrations.id)));
    },
    async upsertRow(row) {
      const { db, tireRegistrations } = await deps();
      // Explicit column list: a row read back from the DB also carries id/createdAt, which an
      // upsert must never rewrite.
      const mutable = {
        tin: row.tin, tinStatus: row.tinStatus, tinWeek: row.tinWeek, tinYear: row.tinYear,
        tireBrand: row.tireBrand, tireCondition: row.tireCondition,
        registrationMethod: row.registrationMethod, registeredAt: row.registeredAt,
        registeredBy: row.registeredBy, capturedBy: row.capturedBy,
      };
      await guardTable(() => db.insert(tireRegistrations)
        .values({ ...mutable, workOrderId: row.workOrderId, position: row.position })
        .onDuplicateKeyUpdate({ set: mutable }));
    },
    async deleteRow(id, position) {
      const { db, tireRegistrations, and, eq } = await deps();
      await guardTable(() => db.delete(tireRegistrations)
        .where(and(eq(tireRegistrations.workOrderId, id), eq(tireRegistrations.position, position))));
    },
  };
}

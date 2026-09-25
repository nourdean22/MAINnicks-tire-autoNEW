import { describe, expect, it } from "vitest";
import {
  captureTin, getRegistration, recordRegistration, registrationFormHtml, removePosition,
  type RegistrationRow, type TireRegistrationStore, type WorkOrderForRegistration,
} from "./tireRegistration";
import { tirePositionsForCount } from "@shared/tireTin";

const NOW = new Date("2026-09-23T12:00:00Z");

/** In-memory store with the same (workOrderId, position) upsert key as the table's unique index. */
function memoryStore(order: WorkOrderForRegistration | null, opts: { failRead?: boolean } = {}) {
  const rows = new Map<string, RegistrationRow>();
  const key = (w: string, p: string) => `${w}|${p}`;
  const store: TireRegistrationStore = {
    async loadWorkOrder(id) {
      if (opts.failRead) throw new Error("connection reset");
      return order && order.id === id ? order : null;
    },
    async listRows(id) {
      if (opts.failRead) throw new Error("connection reset");
      return [...rows.values()].filter((r) => r.workOrderId === id);
    },
    async upsertRow(r) { rows.set(key(r.workOrderId, r.position), { ...r }); },
    async deleteRow(id, p) { rows.delete(key(id, p)); },
  };
  return { store, rows };
}

const ORDER: WorkOrderForRegistration = {
  id: "wo-1", orderNumber: "WO-2026-0001", vehicleYear: 2015, vehicleMake: "Honda", vehicleModel: "Civic",
  completedAt: null, createdAt: NOW,
  items: [{ type: "tire", quantity: "4.00", approved: true, declined: false }, { type: "labor", quantity: "1" }],
};

const TINS = { LF: "3D1A7B2C42324", RF: "3D1A7B2C42424", LR: "U2LLLMLR5123", RR: "U2LLLMLR0122" } as const;

async function captureAll(store: TireRegistrationStore) {
  for (const [position, tin] of Object.entries(TINS)) {
    await captureTin(store, { workOrderId: "wo-1", position: position as keyof typeof TINS, tin, brand: "Hankook", condition: "new", by: "tech" }, NOW);
  }
}

describe("tire registration — capture flow per position", () => {
  it("starts visibly incomplete: 4 tires sold, 0 captured", async () => {
    const { store } = memoryStore(ORDER);
    const v = await getRegistration(store, "wo-1");
    expect(v.expected).toBe(4);
    expect(v.summary).toMatchObject({ state: "incomplete", captured: 0, missingTins: 4 });
  });

  it("stores one row per position, normalized, and re-capturing a position replaces it", async () => {
    const { store, rows } = memoryStore(ORDER);
    await captureTin(store, { workOrderId: "wo-1", position: "LF", tin: "dot 3d1 a7b2c4 2324", condition: "new", by: "tech" }, NOW);
    await captureTin(store, { workOrderId: "wo-1", position: "LF", tin: "3D1A7B2C42424", condition: "new", by: "tech" }, NOW);
    expect(rows.size).toBe(1);
    expect(rows.get("wo-1|LF")).toMatchObject({ tin: "3D1A7B2C42424", tinStatus: "valid", tinWeek: 24, tinYear: 2024, registrationMethod: "pending" });
  });

  it("rejects an invalid TIN with the validator's reason and writes nothing", async () => {
    const { store, rows } = memoryStore(ORDER);
    await expect(captureTin(store, { workOrderId: "wo-1", position: "LF", tin: "3D1AOB2C42324", condition: "new", by: "tech" }, NOW))
      .rejects.toThrow(/zero/);
    expect(rows.size).toBe(0);
  });

  it("stores a pre-2000 TIN flagged, and the order stays incomplete", async () => {
    const { store } = memoryStore(ORDER);
    const v = await captureTin(store, { workOrderId: "wo-1", position: "LF", tin: "EJ4V1HX239", condition: "new", by: "tech" }, NOW);
    expect(v.rows[0].tinStatus).toBe("legacy_date_code");
    expect(v.summary.invalidPositions).toEqual(["LF"]);
    expect(v.summary.state).toBe("incomplete");
  });

  it("a used tire needs no registration; switching it back to new resets it to pending", async () => {
    const { store, rows } = memoryStore(ORDER);
    await captureTin(store, { workOrderId: "wo-1", position: "SPARE", tin: TINS.LF, condition: "used", by: "tech" }, NOW);
    expect(rows.get("wo-1|SPARE")?.registrationMethod).toBe("not_required_used");
    await captureTin(store, { workOrderId: "wo-1", position: "SPARE", tin: TINS.LF, condition: "new", by: "tech" }, NOW);
    expect(rows.get("wo-1|SPARE")?.registrationMethod).toBe("pending");
  });

  it("supports work orders with more than seven tires without wedging completeness", async () => {
    const order8: WorkOrderForRegistration = {
      ...ORDER,
      id: "wo-8",
      orderNumber: "WO-2026-0008",
      items: [{ type: "tire", quantity: "8", approved: true, declined: false }],
    };
    const { store } = memoryStore(order8);
    const positions = tirePositionsForCount(8);
    expect(positions).toHaveLength(8);
    expect(positions.at(-1)).toBe("EXTRA1");
    for (const position of positions) {
      await captureTin(store, {
        workOrderId: "wo-8",
        position,
        tin: TINS.LF,
        brand: "Hankook",
        condition: "new",
        by: "tech",
      }, NOW);
    }
    const beforeRecord = await getRegistration(store, "wo-8");
    expect(beforeRecord.rows).toHaveLength(8);
    expect(beforeRecord.summary.missingTins).toBe(0);
    const done = await recordRegistration(store, { workOrderId: "wo-8", method: "form_given", by: "desk" }, NOW);
    expect(done.summary.state).toBe("complete");
  });

  it("refuses to record a registration step while any TIN is missing", async () => {
    const { store } = memoryStore(ORDER);
    await captureTin(store, { workOrderId: "wo-1", position: "LF", tin: TINS.LF, condition: "new", by: "tech" }, NOW);
    await expect(recordRegistration(store, { workOrderId: "wo-1", method: "form_given", by: "desk" }, NOW))
      .rejects.toThrow(/3 missing/);
  });

  it("completes once every TIN is captured and the form is recorded as handed over", async () => {
    const { store } = memoryStore(ORDER);
    await captureAll(store);
    const v = await recordRegistration(store, { workOrderId: "wo-1", method: "form_given", by: "desk" }, NOW);
    expect(v.summary.state).toBe("complete");
    expect(v.rows.every((r) => r.registeredAt?.getTime() === NOW.getTime() && r.registeredBy === "desk")).toBe(true);
  });

  it("changing a registered tire's TIN voids that position's registration", async () => {
    const { store, rows } = memoryStore(ORDER);
    await captureAll(store);
    await recordRegistration(store, { workOrderId: "wo-1", method: "dealer_submitted_electronic", by: "desk" }, NOW);
    await captureTin(store, { workOrderId: "wo-1", position: "LF", tin: "3D1A7B2C40126", condition: "new", by: "tech" }, NOW);
    expect(rows.get("wo-1|LF")?.registrationMethod).toBe("pending");
    expect(rows.get("wo-1|RF")?.registrationMethod).toBe("dealer_submitted_electronic");
  });

  it("removes a position captured by mistake", async () => {
    const { store } = memoryStore(ORDER);
    await captureTin(store, { workOrderId: "wo-1", position: "LRI", tin: TINS.LF, condition: "new", by: "tech" }, NOW);
    const v = await removePosition(store, "wo-1", "LRI");
    expect(v.rows).toEqual([]);
  });
});

describe("tire registration — the form and read failures", () => {
  it("the registration form contains every TIN on the order", async () => {
    const { store } = memoryStore(ORDER);
    await captureAll(store);
    const html = await registrationFormHtml(store, "wo-1");
    for (const tin of Object.values(TINS)) expect(html).toContain(tin);
    expect(html).toContain("WO-2026-0001");
    expect(html).toContain("17625 Euclid Ave");
    expect(html).not.toContain("Date of sale");
  });

  it("refuses to print the form while TINs are missing", async () => {
    const { store } = memoryStore(ORDER);
    await captureTin(store, { workOrderId: "wo-1", position: "LF", tin: TINS.LF, condition: "new", by: "tech" }, NOW);
    await expect(registrationFormHtml(store, "wo-1")).rejects.toThrow(/3 tire\(s\) still need/);
  });

  it("a failed read THROWS — it never comes back as an empty, zero-tire order", async () => {
    const { store } = memoryStore(ORDER, { failRead: true });
    await expect(getRegistration(store, "wo-1")).rejects.toThrow(/connection reset/);
  });

  it("an unknown work order is NOT_FOUND, not an empty registration", async () => {
    const { store } = memoryStore(ORDER);
    await expect(getRegistration(store, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

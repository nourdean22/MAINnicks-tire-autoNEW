/**
 * seedFlags keeps a deployed row's DESCRIPTION in step with FLAG_DEFINITIONS (PR 3282, Codex P2).
 *
 * featureFlags.list reads the row, not the definition, so a corrected definition text never reached the admin
 * page on a database seeded before the correction. seedFlags now updates the description when it differs, and
 * touches nothing else: not the value (an operator's toggle), not updatedAt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { key: string; value: boolean; description: string | null };
const state = vi.hoisted(() => ({
  rows: new Map<string, { key: string; value: boolean; description: string | null }>(),
  updates: [] as Array<{ key: string; set: Record<string, unknown> }>,
  inserts: [] as Array<Record<string, unknown>>,
  failUpdates: false,
}));

// eq() normally returns an opaque SQL node; here it returns the compared key so the fake db can see it.
vi.mock("drizzle-orm", async (orig) => ({ ...(await orig<typeof import("drizzle-orm")>()), eq: (_col: unknown, v: unknown) => ({ eqValue: v }) }));
vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: (c: { eqValue: string }) => ({ limit: async () => (state.rows.has(c.eqValue) ? [state.rows.get(c.eqValue)] : []) }),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async (c: { eqValue: string }) => {
          if (state.failUpdates) throw new Error("update rejected");
          state.updates.push({ key: c.eqValue, set });
          const r = state.rows.get(c.eqValue);
          if (r) Object.assign(r, set);
        },
      }),
    }),
    insert: () => ({
      values: async (v: Row) => {
        state.inserts.push(v);
        state.rows.set(v.key, v);
      },
    }),
  }),
}));

const KEY = "sms_review_requests";
const STALE = "Auto-send review request SMS 3 days after service";

async function load() {
  vi.resetModules();
  return import("./services/featureFlags");
}

/** Every definition seeded with its current text, except the overrides. */
function seedAll(defs: ReadonlyArray<{ key: string; description: string }>, overrides: Record<string, Partial<Row>> = {}) {
  state.rows.clear();
  for (const d of defs) state.rows.set(d.key, { key: d.key, value: false, description: d.description, ...overrides[d.key] });
}

describe("seedFlags: a deployed row's description follows the definition", () => {
  beforeEach(() => {
    state.updates.length = 0;
    state.inserts.length = 0;
    state.failUpdates = false;
  });

  it("an existing row with a stale description gets the new text, and its value is untouched", async () => {
    const { seedFlags, FLAG_DEFINITIONS } = await load();
    const def = FLAG_DEFINITIONS.find((f) => f.key === KEY)!;
    expect(def.description, "control: the definition no longer carries the old text").not.toBe(STALE);
    seedAll(FLAG_DEFINITIONS, { [KEY]: { value: true, description: STALE } });

    const r = await seedFlags();

    expect(state.updates).toEqual([{ key: KEY, set: { description: def.description } }]); // the set payload names ONE column
    expect(state.rows.get(KEY)).toMatchObject({ value: true, description: def.description }); // the toggle survived
    expect(state.inserts).toEqual([]);
    expect(r).toMatchObject({ seeded: 0, skipped: FLAG_DEFINITIONS.length, redescribed: 1 });
  });

  it("a second run writes nothing (idempotent)", async () => {
    const { seedFlags, FLAG_DEFINITIONS } = await load();
    seedAll(FLAG_DEFINITIONS, { [KEY]: { description: STALE } });
    await seedFlags();
    state.updates.length = 0;

    const r = await seedFlags();

    expect(state.updates).toEqual([]);
    expect(r.redescribed).toBe(0);
  });

  it("a missing row is still inserted with its definition text", async () => {
    const { seedFlags, FLAG_DEFINITIONS } = await load();
    seedAll(FLAG_DEFINITIONS);
    state.rows.delete(KEY);

    const r = await seedFlags();

    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({ key: KEY, value: false });
    expect(r.seeded).toBe(1);
  });

  it("a rejected description update does not stop the rest of the seed", async () => {
    const { seedFlags, FLAG_DEFINITIONS } = await load();
    seedAll(FLAG_DEFINITIONS, { [KEY]: { description: STALE } });
    const other = FLAG_DEFINITIONS[FLAG_DEFINITIONS.length - 1].key;
    state.rows.delete(other); // a later flag is missing: it must still be seeded
    state.failUpdates = true;

    const r = await seedFlags();

    expect(r.seeded).toBe(1);
    expect(state.inserts[0]).toMatchObject({ key: other });
  });
});

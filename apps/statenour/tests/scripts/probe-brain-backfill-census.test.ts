import { describe, expect, it } from "vitest";
import { READS, guard } from "@/scripts/probe-brain-backfill-census";

describe("probe-brain-backfill-census is read-only", () => {
  it("POSITIVE CONTROL: the guard refuses a write and a stacked statement", () => {
    expect(() => guard("UPDATE brain_memories SET confidence = 1")).toThrow();
    expect(() => guard("SELECT 1; DELETE FROM brain_memories")).toThrow();
  });

  it.each(READS.map(([wave, name, sql]) => [`${wave} ${name}`, sql]))("%s passes the guard and selects no row text", (_n, sql) => {
    expect(() => guard(sql)).not.toThrow();
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i);
    expect(sql).not.toMatch(/SELECT[^(]*\b(content|raw_thoughts|note|dossier_md)\b[^(]*FROM/i);
  });
});

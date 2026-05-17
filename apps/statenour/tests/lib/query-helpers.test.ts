import { parsePagination, parseDateRange } from "@/lib/db/query-helpers";

describe("parsePagination", () => {
  it("parses page and pageSize from URL", () => {
    const req = new Request("http://localhost/api/test?page=2&pageSize=10");
    const result = parsePagination(req);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });

  it("defaults to page 1, pageSize 20", () => {
    const req = new Request("http://localhost/api/test");
    const result = parsePagination(req);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("handles invalid values gracefully", () => {
    const req = new Request("http://localhost/api/test?page=abc&pageSize=xyz");
    const result = parsePagination(req);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });
});

describe("parseDateRange", () => {
  it("parses from and to dates", () => {
    const req = new Request(
      "http://localhost/api/test?from=2026-03-01&to=2026-03-26"
    );
    const result = parseDateRange(req);
    expect(result.from).toBeInstanceOf(Date);
    expect(result.to).toBeInstanceOf(Date);
  });

  it("returns undefined for missing dates", () => {
    const req = new Request("http://localhost/api/test");
    const result = parseDateRange(req);
    expect(result.from).toBeUndefined();
    expect(result.to).toBeUndefined();
  });
});

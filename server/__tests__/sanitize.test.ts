/**
 * Sanitization Unit Tests — security boundary validation.
 * These functions guard every user input before it reaches the database.
 */
import { describe, it, expect } from "vitest";
import { sanitizeText, sanitizePhone, sanitizeEmail, sanitizeName, sanitizeMessage, sanitizeFormData } from "../sanitize";

describe("sanitizeText", () => {
  it("returns empty string for null/undefined", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
    expect(sanitizeText("")).toBe("");
  });

  it("strips HTML tags", () => {
    expect(sanitizeText("<script>alert('xss')</script>")).toBe("alert('xss')");
    expect(sanitizeText("<b>bold</b>")).toBe("bold");
    expect(sanitizeText("<img src=x onerror=alert(1)>")).toBe("");
  });

  it("removes javascript: protocol", () => {
    expect(sanitizeText("javascript:alert(1)")).not.toContain("javascript:");
  });

  it("removes inline event handlers", () => {
    expect(sanitizeText("test onerror=alert(1) end")).not.toContain("onerror=");
    expect(sanitizeText("onload=fetch('evil')")).not.toContain("onload=");
  });

  it("removes data:text/html URIs", () => {
    expect(sanitizeText("data:text/html,<script>alert(1)</script>")).not.toContain("data:text/html");
  });

  it("removes null bytes", () => {
    expect(sanitizeText("hello\0world")).toBe("helloworld");
  });

  it("preserves normal text", () => {
    expect(sanitizeText("My car makes a grinding noise when I brake")).toBe("My car makes a grinding noise when I brake");
  });

  it("trims whitespace", () => {
    expect(sanitizeText("  hello  ")).toBe("hello");
  });
});

describe("sanitizePhone", () => {
  it("returns empty string for null/undefined", () => {
    expect(sanitizePhone(null)).toBe("");
    expect(sanitizePhone(undefined)).toBe("");
  });

  it("allows digits and phone characters", () => {
    expect(sanitizePhone("(216) 862-0005")).toBe("(216) 862-0005");
    expect(sanitizePhone("+1-216-862-0005")).toBe("+1-216-862-0005");
  });

  it("strips non-phone characters", () => {
    expect(sanitizePhone("216<script>862</script>0005")).toBe("2168620005");
    expect(sanitizePhone("abc2168620005xyz")).toBe("2168620005");
  });
});

describe("sanitizeEmail", () => {
  it("returns empty string for null/undefined", () => {
    expect(sanitizeEmail(null)).toBe("");
    expect(sanitizeEmail(undefined)).toBe("");
  });

  it("lowercases email", () => {
    expect(sanitizeEmail("John@Gmail.COM")).toBe("john@gmail.com");
  });

  it("strips angle brackets and quotes", () => {
    expect(sanitizeEmail("<test@evil.com>")).toBe("test@evil.com");
    expect(sanitizeEmail("'test@evil.com'")).toBe("test@evil.com");
  });
});

describe("sanitizeName", () => {
  it("allows letters, spaces, hyphens, apostrophes", () => {
    expect(sanitizeName("O'Brien-Smith")).toBe("O'Brien-Smith");
    expect(sanitizeName("Jean-Luc")).toBe("Jean-Luc");
  });

  it("strips HTML and special characters", () => {
    expect(sanitizeName("<script>alert(1)</script>John")).toBe("alertJohn");
    expect(sanitizeName("John123")).toBe("John");
  });

  it("truncates to 100 characters", () => {
    const longName = "A".repeat(150);
    expect(sanitizeName(longName).length).toBe(100);
  });
});

describe("sanitizeMessage", () => {
  it("applies sanitizeText and caps at 5000 chars", () => {
    const longMsg = "A".repeat(6000);
    expect(sanitizeMessage(longMsg).length).toBe(5000);
  });

  it("strips XSS from messages", () => {
    expect(sanitizeMessage("<script>steal(cookies)</script>Check engine light is on")).not.toContain("<script>");
  });
});

describe("sanitizeFormData", () => {
  it("auto-detects phone fields", () => {
    const result = sanitizeFormData({ phone: "<evil>2168620005" });
    expect(result.phone).toBe("2168620005");
  });

  it("auto-detects email fields", () => {
    const result = sanitizeFormData({ email: "TEST@GMAIL.COM" });
    expect(result.email).toBe("test@gmail.com");
  });

  it("auto-detects name fields", () => {
    const result = sanitizeFormData({ name: "<b>John123</b>" });
    expect(result.name).toBe("John");
  });

  it("sanitizes other string fields as messages", () => {
    const result = sanitizeFormData({ notes: "<script>x</script>Valid note" });
    expect(result.notes).not.toContain("<script>");
    expect(result.notes).toContain("Valid note");
  });

  it("ignores non-string fields", () => {
    const result = sanitizeFormData({ count: 5, active: true, name: "John" });
    expect(result.count).toBe(5);
    expect(result.active).toBe(true);
  });
});

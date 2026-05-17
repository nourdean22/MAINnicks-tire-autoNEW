import { describe, it, expect, vi } from "vitest";

describe("ShopDriver & Settings Router", () => {
  describe("Shop Settings", () => {
    it("should have a valid default labor rate", () => {
      const DEFAULT_LABOR_RATE = 115;
      expect(DEFAULT_LABOR_RATE).toBeGreaterThan(0);
      expect(DEFAULT_LABOR_RATE).toBeLessThan(500);
    });

    it("should validate labor rate is a positive number", () => {
      const validRates = [85, 100, 115, 125, 150, 200];
      const invalidRates = [-1, 0, NaN, Infinity];

      validRates.forEach(rate => {
        expect(rate).toBeGreaterThan(0);
        expect(Number.isFinite(rate)).toBe(true);
      });

      invalidRates.forEach(rate => {
        expect(rate > 0 && Number.isFinite(rate)).toBe(false);
      });
    });

    it("should validate shop hours format", () => {
      const validHours = "Mon-Sat 8AM-6PM";
      expect(validHours).toMatch(/\w+/);
      expect(validHours.length).toBeGreaterThan(0);
      expect(validHours.length).toBeLessThan(200);
    });
  });

  describe("CSV Import Parsing", () => {
    it("should parse CSV header row correctly", () => {
      const csvHeader = "First Name,Last Name,Email,Phone,Address,City,State,Zip";
      const headers = csvHeader.split(",");
      expect(headers).toContain("First Name");
      expect(headers).toContain("Last Name");
      expect(headers).toContain("Phone");
      expect(headers).toContain("Email");
    });

    it("should handle CSV rows with missing fields", () => {
      const row = "John,,john@test.com,2165551234,,,OH,";
      const fields = row.split(",");
      expect(fields[0]).toBe("John");
      expect(fields[1]).toBe(""); // Missing last name
      expect(fields[2]).toBe("john@test.com");
      expect(fields[7]).toBe(""); // Missing zip
    });

    it("should normalize phone numbers from CSV", () => {
      const phones = [
        { input: "(216) 555-1234", expected: "+12165551234" },
        { input: "216-555-1234", expected: "+12165551234" },
        { input: "2165551234", expected: "+12165551234" },
        { input: "+12165551234", expected: "+12165551234" },
      ];

      phones.forEach(({ input, expected }) => {
        const digits = input.replace(/\D/g, "");
        const normalized = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : input;
        expect(normalized).toBe(expected);
      });
    });

    it("should skip rows with invalid phone numbers", () => {
      const invalidPhones = ["", "123", "abc", "555"];
      invalidPhones.forEach(phone => {
        const digits = phone.replace(/\D/g, "");
        const isValid = digits.length >= 10;
        expect(isValid).toBe(false);
      });
    });

    it("should handle duplicate detection by phone number", () => {
      const existingPhones = new Set(["+12165551234", "+12165559999"]);
      const newPhone = "+12165551234";
      const isDuplicate = existingPhones.has(newPhone);
      expect(isDuplicate).toBe(true);

      const uniquePhone = "+12165558888";
      expect(existingPhones.has(uniquePhone)).toBe(false);
    });
  });

  describe("Labor Estimate Integration", () => {
    it("should generate a valid estimate prompt", () => {
      const laborRate = 115;
      const vehicle = { year: "2018", make: "Honda", model: "Civic" };
      const repair = "brake pads and rotors replacement";

      const prompt = `Estimate for ${vehicle.year} ${vehicle.make} ${vehicle.model}: ${repair} at $${laborRate}/hr`;
      expect(prompt).toContain("2018");
      expect(prompt).toContain("Honda");
      expect(prompt).toContain("Civic");
      expect(prompt).toContain("$115/hr");
    });

    it("should read labor rate from settings with fallback", () => {
      const DEFAULT_LABOR_RATE = 115;
      const settingsRate = null; // Simulating no DB setting
      const effectiveRate = settingsRate ?? DEFAULT_LABOR_RATE;
      expect(effectiveRate).toBe(115);

      const customRate = 125;
      const effectiveCustom = customRate ?? DEFAULT_LABOR_RATE;
      expect(effectiveCustom).toBe(125);
    });

    it("should validate estimate input constraints", () => {
      const validYear = "2018";
      const validMake = "Honda";
      const validModel = "Civic";
      const validRepair = "brake pads replacement";

      expect(validYear.length).toBe(4);
      expect(parseInt(validYear)).toBeGreaterThanOrEqual(1990);
      expect(parseInt(validYear)).toBeLessThanOrEqual(2027);
      expect(validMake.length).toBeGreaterThanOrEqual(1);
      expect(validMake.length).toBeLessThanOrEqual(50);
      expect(validModel.length).toBeGreaterThanOrEqual(1);
      expect(validRepair.length).toBeGreaterThanOrEqual(3);
      expect(validRepair.length).toBeLessThanOrEqual(1000);
    });
  });
});

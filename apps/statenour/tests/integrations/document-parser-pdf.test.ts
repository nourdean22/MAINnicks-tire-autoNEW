/**
 * NEW-04-X2-pdfparse: pdf-parse 2.x is a class (`new PDFParse({ data })`),
 * not a function, so every PDF ingest threw "pdfParse is not a function".
 * Runs the REAL installed pdf-parse against a minimal one-page PDF built here
 * (valid xref offsets), so the test fails on the API shape, not on a mock.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "@/lib/integrations/document-parser";

/** A one-page PDF whose only text is `text`, with a correct xref table. */
function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

describe("parseDocument / PDF", () => {
  it("extracts the text of a one-page PDF", async () => {
    const parsed = await parseDocument(minimalPdf("HELLO PDF"), { filename: "hello.pdf" });
    expect(parsed.format).toBe("pdf");
    expect(parsed.text).toContain("HELLO PDF");
    expect(parsed.pages).toBe(1);
    expect(parsed.charCount).toBe(parsed.text.length);
  }, 30_000);

  it("a corrupt PDF rejects instead of returning an empty document", async () => {
    await expect(parseDocument(Buffer.from("%PDF-1.4\nnot a pdf"), { filename: "bad.pdf" })).rejects.toThrow(/Invalid PDF/);
  }, 30_000);
});

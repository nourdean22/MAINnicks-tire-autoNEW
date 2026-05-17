/**
 * Document parser · v10.0.515 · #10 Document Q&A
 *
 * Converts PDF / DOCX / XLSX / plaintext / markdown into a clean
 * text stream the ingestion pipeline can chunk + embed.
 *
 * Library choices (all pure-JS, no native deps so Vercel + Railway
 * deploys stay simple):
 *   · pdf-parse     — PDF → text (uses pdfjs internally)
 *   · mammoth       — DOCX → markdown (preserves headings, lists)
 *   · exceljs       — XLSX/CSV → JSON rows → markdown table
 *
 * Returns a uniform shape so the caller doesn't branch on type.
 */

export interface ParsedDocument {
  /** Plain text or markdown body. */
  text: string;
  /** Approximate page count (PDF only · others = null). */
  pages: number | null;
  /** Total character count after parsing. */
  charCount: number;
  /** Format detected. */
  format: "pdf" | "docx" | "xlsx" | "csv" | "txt" | "md" | "unknown";
  /** Source-format metadata (PDF title, DOCX author, XLSX sheet names). */
  metadata: Record<string, unknown>;
}

const MAX_OUTPUT_CHARS = 1_000_000; // 1MB of text is a sane upper bound

// v10.0.529.5 D-3 note · migrated from xlsx@0.18.5 to exceljs@4.4.0.
// Closes the last 2 high-severity CVEs in the audit:
//   · CVE-2023-30533 / GHSA-4r6h-8v6p-xvw6 (prototype pollution)
//   · GHSA-5pgg-2g8v-p4x9 (ReDoS)
// Both were unfixable on the npm channel — SheetJS moved off npm
// after 0.18.5 and the patches live only on their CDN. exceljs is
// maintained (~6.8M weekly downloads, zero known CVEs as of May 2026),
// has read support for xlsx + csv, and ships its own TS types.
// Defense-in-depth still in place:
//   1. MAX_OUTPUT_CHARS hard cap above · text truncated after parse,
//      so even a pathological workbook can't flood downstream
//      consumers (vector embed, LLM context).
//   2. /api/ai/chat/documents enforces a 20MB upload cap upstream.

/**
 * Parse a document buffer to text. Detection priority: explicit
 * mediaType, then filename extension, then magic-byte sniff.
 */
export async function parseDocument(
  buffer: Buffer,
  options: { mediaType?: string; filename?: string } = {},
): Promise<ParsedDocument> {
  const format = detectFormat(buffer, options);

  switch (format) {
    case "pdf":
      return parsePdf(buffer);
    case "docx":
      return parseDocx(buffer);
    case "xlsx":
    case "csv":
      return parseSpreadsheet(buffer, format);
    case "md":
    case "txt":
      return parsePlaintext(buffer, format);
    default:
      // Fallback: attempt utf-8 decode. Avoids hard-failing on
      // unrecognized formats (the LLM can still extract useful info
      // from binary garbage in rare cases).
      return parsePlaintext(buffer, "txt");
  }
}

function detectFormat(
  buffer: Buffer,
  options: { mediaType?: string; filename?: string },
): ParsedDocument["format"] {
  const mt = (options.mediaType ?? "").toLowerCase();
  if (mt.includes("pdf")) return "pdf";
  if (mt.includes("wordprocessingml") || mt.includes("docx")) return "docx";
  if (mt.includes("spreadsheetml") || mt.includes("xlsx")) return "xlsx";
  if (mt.includes("csv")) return "csv";
  if (mt.includes("markdown") || mt.endsWith("/x-markdown")) return "md";
  if (mt.startsWith("text/")) return "txt";

  const name = (options.filename ?? "").toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "md";
  if (name.endsWith(".txt")) return "txt";

  // Magic-byte sniff. PDF starts with %PDF-. ZIP-based formats (DOCX,
  // XLSX) start with PK\x03\x04 — to distinguish we'd need to unzip
  // and look at [Content_Types].xml. For now: if it's a ZIP, default
  // to docx (most common operator drop) and let the parser fall over
  // gracefully.
  const head = buffer.slice(0, 4).toString("binary");
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("PK\x03\x04")) {
    // Sniff for a few common XLSX markers in the first 4KB
    const probe = buffer.slice(0, 4096).toString("binary");
    if (probe.includes("xl/workbook.xml") || probe.includes("xl/sharedStrings")) {
      return "xlsx";
    }
    return "docx";
  }
  return "unknown";
}

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // pdf-parse's default-import handling differs across versions;
  // dynamic import + interop keeps both CJS and ESM bundles happy.
  const mod = await import("pdf-parse");
  type PdfParseFn = (
    b: Buffer,
  ) => Promise<{ text: string; numpages?: number; info?: Record<string, unknown> }>;
  const pdfParse = ((mod as { default?: PdfParseFn }).default ?? mod) as PdfParseFn;
  const result = await pdfParse(buffer);
  const text = (result.text ?? "").slice(0, MAX_OUTPUT_CHARS);
  return {
    text,
    pages: result.numpages ?? null,
    charCount: text.length,
    format: "pdf",
    metadata: result.info ?? {},
  };
}

async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const mammoth = await import("mammoth");
  // extractRawText returns plain text — sufficient for chunked
  // retrieval. convertToHtml is available if we ever want to
  // preserve structure (headings, bold) but adds 2-3x volume for
  // marginal recall benefit.
  const result = await mammoth.extractRawText({ buffer });
  const text = (result.value ?? "").slice(0, MAX_OUTPUT_CHARS);
  return {
    text,
    pages: null,
    charCount: text.length,
    format: "docx",
    metadata: { messages: result.messages ?? [] },
  };
}

async function parseSpreadsheet(
  buffer: Buffer,
  format: "xlsx" | "csv",
): Promise<ParsedDocument> {
  // dynamic import — exceljs is hefty (~1.2MB · server-only)
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();

  if (format === "csv") {
    // exceljs.csv.read wants a readable stream
    const { Readable } = await import("node:stream");
    await workbook.csv.read(Readable.from(buffer));
  } else {
    // Buffer view → ArrayBuffer (xlsx.load expects ArrayBuffer-like)
    await workbook.xlsx.load(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
    );
  }

  const sheetNames: string[] = [];
  const parts: string[] = [];
  workbook.eachSheet((sheet) => {
    sheetNames.push(sheet.name);
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      // row.values is 1-indexed (slot 0 is undefined). Skip it.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map(cellToText).join(" | "));
    });
    parts.push(`## ${sheet.name}\n\n${rows.join("\n")}`);
  });

  const text = parts.join("\n\n").slice(0, MAX_OUTPUT_CHARS);
  return {
    text,
    pages: null,
    charCount: text.length,
    format,
    metadata: { sheetNames },
  };
}

/**
 * Normalize an exceljs cell value into a plain string. Cell values can
 * be primitives, Date, formula objects ({ formula, result }), rich text
 * ({ richText: [{ text }] }), or hyperlinks ({ text, hyperlink }).
 */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const obj = value as {
      richText?: { text?: string }[];
      result?: unknown;
      text?: string;
      hyperlink?: string;
      formula?: string;
    };
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((r) => r.text ?? "").join("");
    }
    if (obj.result !== undefined) return cellToText(obj.result);
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.hyperlink === "string") return obj.hyperlink;
    if (typeof obj.formula === "string") return obj.formula;
  }
  return String(value);
}

function parsePlaintext(
  buffer: Buffer,
  format: "txt" | "md",
): Promise<ParsedDocument> {
  const text = buffer.toString("utf8").slice(0, MAX_OUTPUT_CHARS);
  return Promise.resolve({
    text,
    pages: null,
    charCount: text.length,
    format,
    metadata: {},
  });
}

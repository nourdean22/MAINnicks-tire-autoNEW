import { listKnowledgeFiles, readKnowledgeFile, searchKnowledge } from "@/lib/mastery/knowledge";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

export const GET = apiHandler(async (req) => {
  const { searchParams } = new URL(req.url);
  const file = searchParams.get("file");
  const q = searchParams.get("q");

  // Search mode
  if (q) {
    const results = searchKnowledge(q);
    return {
      query: q,
      results: results.map((r) => ({
        name: r.file.name,
        category: r.file.category,
        path: r.file.relativePath,
        match_count: r.matches.length,
        matches: r.matches,
      })),
      total: results.length,
    };
  }

  // Read specific file
  if (file) {
    const content = readKnowledgeFile(file);
    if (!content) throw new ServiceError("File not found", 404);
    return { path: file, content };
  }

  // List all files
  const files = listKnowledgeFiles();
  const categories = [...new Set(files.map((f) => f.category))];
  return { files, categories, total: files.length };
// v10.0.121 audit-pattern follow-up · knowledge base contains private
// business strategy + customer intel files. Owner-gated.
}, { auth: "owner" });

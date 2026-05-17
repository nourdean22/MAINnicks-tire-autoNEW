import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * GET /api/chat/export/[conversationId]?format=md|json&include=reasoning|tools|all
 *
 * Exports a past conversation for archive / portability / pasting
 * into another AI tool for a second opinion. No auth beyond the
 * route-level owner check (matches /api/chat/search).
 *
 * Formats:
 *   md   — headed sections per turn, tool calls as blockquotes,
 *          reasoning folded in a ```reasoning``` block if included
 *   json — raw dump suitable for programmatic reuse
 *
 * Include filters:
 *   reasoning — add <think> / reasoning_content if present in tokenUsage
 *   tools     — show which tools fired (tokenUsage.toolCalls)
 *   all       — everything (default ergonomics)
 *
 * Headers:
 *   Content-Disposition: attachment — triggers browser download
 *   with filename `nick-chat-<convid8>-<date>.<ext>`
 */

type IncludeFlag = "reasoning" | "tools" | "all";

function shouldInclude(flag: IncludeFlag, selected: Set<string>): boolean {
  if (selected.has("all")) return true;
  return selected.has(flag);
}

function filenameBase(convId: string): string {
  const shortId = convId.slice(-8);
  const date = new Date().toISOString().slice(0, 10);
  return `nick-chat-${shortId}-${date}`;
}

function escapeMarkdown(s: string): string {
  // Light escape only — we want Nick's markdown to survive round-trip
  return s.replace(/\r\n/g, "\n").trim();
}

function formatMarkdown(
  conv: {
    id: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
    messages: Array<{
      role: string;
      content: string;
      model: string | null;
      tokenUsage: unknown;
      createdAt: Date;
    }>;
  },
  includes: Set<string>
): string {
  const lines: string[] = [];
  lines.push(`# ${conv.title || "Untitled conversation"}`);
  lines.push("");
  lines.push(`- **Conversation ID:** \`${conv.id}\``);
  lines.push(`- **Created:** ${conv.createdAt.toISOString()}`);
  lines.push(`- **Updated:** ${conv.updatedAt.toISOString()}`);
  lines.push(`- **Messages:** ${conv.messages.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of conv.messages) {
    const who = msg.role === "user" ? "Nour" : msg.role === "assistant" ? "Nick" : msg.role;
    const ts = msg.createdAt.toISOString().slice(11, 16);
    lines.push(`## ${who} · ${ts}${msg.model ? ` · ${msg.model}` : ""}`);
    lines.push("");
    lines.push(escapeMarkdown(msg.content));
    lines.push("");

    const tu = msg.tokenUsage as
      | {
          toolCalls?: Array<{ name: string; success?: boolean; durationMs?: number }>;
          reasoning?: string;
        }
      | null;

    if (tu?.toolCalls && tu.toolCalls.length > 0 && shouldInclude("tools", includes)) {
      lines.push("> **Tool calls:**");
      for (const tc of tu.toolCalls) {
        const mark = tc.success === false ? "✗" : "✓";
        const dur = tc.durationMs ? ` (${tc.durationMs}ms)` : "";
        lines.push(`> - ${mark} ${tc.name}${dur}`);
      }
      lines.push("");
    }

    if (tu?.reasoning && shouldInclude("reasoning", includes)) {
      lines.push("```reasoning");
      lines.push(escapeMarkdown(tu.reasoning).slice(0, 4000));
      lines.push("```");
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  lines.push("");
  lines.push(
    `*Exported from Nour's Command Center — autonicks.com · ${new Date().toISOString()}*`
  );
  return lines.join("\n");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  // v10.0.44 — auth gate. Pre-fix anyone with a guessed/leaked
  // conversationId could pull the full conversation as md/json.
  await requireSession(req);
  try {
    const { conversationId } = await params;
    if (!conversationId || conversationId.length < 4) {
      return NextResponse.json(
        { error: "invalid conversationId", code: "INVALID_ID" },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const format = (url.searchParams.get("format") || "md").toLowerCase();
    if (format !== "md" && format !== "json") {
      return NextResponse.json(
        { error: "format must be md or json", code: "BAD_FORMAT" },
        { status: 400 }
      );
    }
    const includeRaw = (url.searchParams.get("include") || "all")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const includes = new Set<string>(includeRaw);

    const conv = await prisma.chatConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            content: true,
            model: true,
            tokenUsage: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conv) {
      return NextResponse.json(
        { error: "conversation not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const base = filenameBase(conv.id);

    if (format === "json") {
      return NextResponse.json(
        {
          id: conv.id,
          title: conv.title,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          messages: conv.messages,
          exported: new Date().toISOString(),
        },
        {
          headers: {
            "Content-Disposition": `attachment; filename="${base}.json"`,
          },
        }
      );
    }

    const md = formatMarkdown(conv, includes);
    return new NextResponse(md, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.md"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "export failed",
        code: "EXPORT_FAILED",
      },
      { status: 500 }
    );
  }
}

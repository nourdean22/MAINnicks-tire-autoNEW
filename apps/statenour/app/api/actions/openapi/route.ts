import { getBridgeSafeTools } from "@/lib/agent-bridge/tool-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const protocol = req.headers.get("x-forwarded-proto") || "https";
  
  const tools = getBridgeSafeTools("actions");
  const paths: any = {};
  
  for (const tool of tools) {
    paths[`/api/actions/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.description?.slice(0, 80) || tool.name,
        description: tool.description || `Execute ${tool.name}`,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: tool.inputSchema
            }
          }
        },
        responses: {
          "200": {
            description: "Successful execution",
            content: {
              "application/json": {
                schema: { type: "object" }
              }
            }
          }
        }
      }
    };
  }

  const openapi = {
    openapi: "3.1.0",
    info: {
      title: "StateNour Actions",
      description: "StateNour remote command interface for Custom GPT.",
      version: "1.0.0"
    },
    servers: [
      { url: `${protocol}://${host}` }
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer"
        }
      }
    },
    security: [{ bearerAuth: [] }]
  };

  return Response.json(openapi);
}

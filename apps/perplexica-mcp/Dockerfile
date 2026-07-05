FROM python:3.12-slim

# Install uv for fast python package management
RUN pip install --no-cache-dir uv

# Create app directory
WORKDIR /app

# Install perplexica-mcp globally using uv
RUN uv pip install --system --no-cache perplexica-mcp

# Start the MCP server using SSE transport on the specified PORT.
# MUST be `sse` (serves /sse), NOT `http` (serves /mcp): statenour's
# client uses SSEClientTransport against PERPLEXICA_MCP_URL=…:3002/sse
# (lib/intelligence/search/perplexica-mcp.ts). The original `http` here
# served /mcp only, so the SSE client 404'd on /sse — the sidecar never
# worked since it shipped in #464. `sse` aligns the server to the client + URL.
# The container relies on the PERPLEXICA_BACKEND_URL environment variable to be set.
CMD ["sh", "-c", "perplexica-mcp sse 0.0.0.0 ${PORT:-3002}"]

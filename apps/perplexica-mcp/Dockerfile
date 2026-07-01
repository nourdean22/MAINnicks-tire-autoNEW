FROM python:3.12-slim

# Install uv for fast python package management
RUN pip install --no-cache-dir uv

# Create app directory
WORKDIR /app

# Install perplexica-mcp globally using uv
RUN uv pip install --system --no-cache perplexica-mcp

# Start the MCP server using SSE transport on the specified PORT
# The container relies on the PERPLEXICA_BACKEND_URL environment variable to be set.
CMD ["sh", "-c", "perplexica-mcp http 0.0.0.0 ${PORT:-3002}"]

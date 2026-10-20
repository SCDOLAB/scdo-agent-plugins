# SCDO Agent Ledger (SCDO x402) MCP server, stdio transport.
# Starts and answers MCP introspection (initialize, tools/list) without any secrets.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN pip install --no-cache-dir "scdo-agent-mcp==0.2.0" \
 && useradd -m -u 10001 agent
USER agent
WORKDIR /home/agent
ENTRYPOINT ["scdo-agent-mcp"]

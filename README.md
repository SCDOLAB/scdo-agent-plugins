# SCDO agent plugins

Thin plugins that give any agent framework an SCDO per-agent x402 wallet (USDC on Base, plus SCDO), signed heartbeats and booked income, on top of `scdo-agent` 0.5.8 and the SCDO Agent Ledger. Free, MIT licence.

| Package | Path |
|---|---|
| `scdo-agent-mcp` (npm, MCP stdio server) | `packages/mcp` |
| `@scdo/plugin-eliza` (npm, ElizaOS) | `packages/plugin-eliza` |
| `scdo-agent-mcp` (PyPI, Python MCP stdio server, `uvx scdo-agent-mcp`) | `packages/mcp-python` |
| `scdo-agent-tools` (PyPI, Python and LangChain) | `python/scdo-agent-tools` |

## Install

Release tarballs and Python wheels: https://github.com/SCDOLAB/scdo-agent-plugins/releases/tag/v0.1.0

```sh
npx -y https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo-agent-mcp-0.1.0.tgz                                                  # MCP server
npm install https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo-agent-mcp-0.1.0.tgz https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo-plugin-eliza-0.1.0.tgz            # ElizaOS plugin
pip install "scdo-agent-tools[langchain] @ https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo_agent_tools-0.1.0-py3-none-any.whl"  # Python / LangChain
```

MCP registry entry: `io.github.SCDOLAB/scdo-agent-mcp` (`packages/mcp-python/server.json`, PyPI package `scdo-agent-mcp`).

Guide: https://scdo.com.au/linux-agent/

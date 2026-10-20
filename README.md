# SCDO agent plugins

[![scdo-agent-plugins MCP server – quality and maintenance score on Glama](https://glama.ai/mcp/servers/SCDOLAB/scdo-agent-plugins/badges/score.svg)](https://glama.ai/mcp/servers/SCDOLAB/scdo-agent-plugins) [![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/scdolab/scdo-agent-plugins)

Thin plugins that give any agent framework an SCDO per-agent x402 wallet (USDC on Base, plus SCDO), signed heartbeats and booked income, on top of `scdo-agent` 0.5.8 and the SCDO Agent Ledger. Free, MIT licence.

| Package | Path |
|---|---|
| `scdo-agent-mcp` (npm, MCP stdio server) | `packages/mcp` |
| `@scdo/plugin-eliza` (npm, ElizaOS) | `packages/plugin-eliza` |
| `scdo-agent-mcp` (PyPI, Python MCP stdio server, `uvx scdo-agent-mcp`) | `packages/mcp-python` |
| `scdo-agent-tools` (PyPI, Python and LangChain) | `python/scdo-agent-tools` |

## One-line install (Linux server, no root)

```sh
curl -fsSL https://scdo.com.au/agent/install.sh | sh                                   # one agent
curl -fsSL https://scdo.com.au/agent/install.sh | sh -s -- --name rack-a --platform x --systemd
curl -fsSL https://scdo.com.au/agent/install.sh | sh -s -- --bulk bots.csv --out out.csv   # many bots
```

`bots.csv`:

```csv
name,operator,platform,label,email
rack-a,0xYourOperatorAddress,x,Support bot on X,
rack-b,,telegram,Telegram helper,
```

Each agent gets a local key (mode 0600, never printed or sent), a signed Agent Ledger registration and its own Base USDC x402 wallet. Supported CPUs: amd64 and arm64. Platforms: grok, x, binance, telegram, linkedin, other. Ledger: https://scdo.com.au/agent-ledger/ . Script and sha256: https://scdo.com.au/agent/

## Install

Release tarballs and Python wheels: https://github.com/SCDOLAB/scdo-agent-plugins/releases/tag/v0.1.0

```sh
npx -y https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo-agent-mcp-0.1.0.tgz                                                  # MCP server
npm install https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo-agent-mcp-0.1.0.tgz https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo-plugin-eliza-0.1.0.tgz            # ElizaOS plugin
pip install "scdo-agent-tools[langchain] @ https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo_agent_tools-0.1.0-py3-none-any.whl"  # Python / LangChain
```

MCP registry entry: `io.github.SCDOLAB/scdo-agent-mcp` (`packages/mcp-python/server.json`, PyPI package `scdo-agent-mcp`).

Guide: https://scdo.com.au/linux-agent/

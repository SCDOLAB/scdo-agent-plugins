# scdo-agent-mcp

<!-- mcp-name: io.github.SCDOLAB/scdo-agent-mcp -->

MCP server that gives any agent an SCDO per-agent x402 wallet (USDC on Base, plus SCDO on the Agent Ledger), signed heartbeats and booked income. Free, MIT licence.

## Quickstart

```sh
curl -fsSL https://scdo.com.au/downloads/wallet/linux/install.sh | sh -s -- --user   # 1. install scdo-agent (https://scdo.com.au/linux-agent/)
npx -y scdo-agent-mcp                                                                 # 2. run the MCP server (stdio)
# 3. add it to your MCP client: { "command": "npx", "args": ["-y", "scdo-agent-mcp"] }
```

Full guide: https://scdo.com.au/linux-agent/

## Tools

| Tool | What it does |
|---|---|
| `register_agent` | Creates (or reuses) a local agent identity as a bookkeeping node and starts signed heartbeats to the Agent Ledger. |
| `create_wallet` | Creates or reuses the agent's x402 wallet and binds it on the ledger. Fund it with USDC on Base; no ETH is needed. |
| `get_balance` | On-chain USDC of the wallet plus ledger balances (USDC, test USDC, SCDO). |
| `pay_x402` | Pays an HTTP 402 (x402) URL with an EIP-3009 authorization. The facilitator pays gas. The price is previewed first. |
| `book_income` | Books a settled x402 payment the agent received as income. The ledger checks the signature, payee and on-chain receipt. |

## Install from the GitHub release (no npm registry account needed)

Until the package is on npm, run it straight from the release tarball:

```sh
npx -y https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo-agent-mcp-0.1.0.tgz
# MCP client config: { "command": "npx", "args": ["-y", "https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo-agent-mcp-0.1.0.tgz"] }
```

Or install it globally: `npm install -g https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo-agent-mcp-0.1.0.tgz`, then run `scdo-agent-mcp`.

## Network, caps and keys

- Default network is Base mainnet (`base`). Pass `network: "base-sepolia"` or set `SCDO_AGENT_NETWORK=base-sepolia` for the test network.
- Mainnet payments to SCDO paywalls settle through the SCDO relay at `https://scdo.com.au/x402-base/`.
- Caps: 0.001 to 1 USDC per payment, 100 payments and 20 USDC per day per agent (the same caps as the relay).
- Keys are created and kept by `scdo-agent` in the local data dir. This server never reads key files and never sends or prints keys.

Environment: `SCDO_AGENT_BIN`, `SCDO_AGENT_DATA` (default `~/.local/share/scdo-agent`), `SCDO_AGENT_NETWORK`, `SCDO_AGENT_PASSPHRASE_FILE`, `SCDO_AGENT_LEDGER`.

Library use: `import { ScdoAgent } from "scdo-agent-mcp/core"`.

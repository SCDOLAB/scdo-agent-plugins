# scdo-agent-mcp (Python)

mcp-name: io.github.SCDOLAB/scdo-agent-mcp

MCP stdio server that gives any agent an SCDO per-agent x402 wallet (USDC on Base, plus SCDO on the Agent Ledger), signed heartbeats and booked income. Same tools as the Node `scdo-agent-mcp`, built on the official MCP Python SDK (FastMCP). Free, MIT licence.

## Quickstart

```sh
curl -fsSL https://scdo.com.au/downloads/wallet/linux/install.sh | sh -s -- --user   # 1. install scdo-agent (https://scdo.com.au/linux-agent/)
uvx scdo-agent-mcp                                                                    # 2. run the MCP server (stdio)
# 3. add it to your MCP client: { "command": "uvx", "args": ["scdo-agent-mcp"] }
```

Or `pip install scdo-agent-mcp` and run `scdo-agent-mcp` (or `python -m scdo_agent_mcp`).

Full guide: https://scdo.com.au/linux-agent/

## Tools

| Tool | What it does |
|---|---|
| `register_agent` | Creates (or reuses) a local agent identity as a bookkeeping node and starts signed heartbeats to the Agent Ledger. |
| `create_wallet` | Creates or reuses the agent's x402 wallet and binds it on the ledger. Fund it with USDC on Base; no ETH is needed. |
| `get_balance` | On-chain USDC of the wallet plus ledger balances (USDC, test USDC, SCDO). |
| `pay_x402` | Pays an HTTP 402 (x402) URL with an EIP-3009 authorization. The facilitator pays gas. The price is previewed first. |
| `book_income` | Books a settled x402 payment the agent received as income. The ledger checks the signature, payee and on-chain receipt. |

## Network, caps and keys

- Default network is Base mainnet (`base`); use `network: "base-sepolia"` or `SCDO_AGENT_NETWORK=base-sepolia` for the test network.
- Caps: 0.001 to 1 USDC per payment, 100 payments and 20 USDC per day per agent. Mainnet payments to SCDO paywalls settle through `https://scdo.com.au/x402-base/`.
- Keys are created and kept by `scdo-agent` in the local data dir. This server never reads key files and never sends or prints keys.

Environment: `SCDO_AGENT_BIN`, `SCDO_AGENT_DATA` (default `~/.local/share/scdo-agent`), `SCDO_AGENT_NETWORK`, `SCDO_AGENT_PASSPHRASE_FILE`, `SCDO_AGENT_LEDGER`.

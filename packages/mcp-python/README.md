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

This package is stdio only. FiatDock paid listings need Streamable HTTP, which is the Node package: `npx scdo-agent-mcp --http`, public URL `https://scdo.com.au/mcp` once the scdo.com.au proxy is in place. See `packages/mcp/README.md`.

Full guide: https://scdo.com.au/linux-agent/

## Tools

| Tool | What it does |
|---|---|
| `register_agent` | Creates (or reuses) a local agent identity as a bookkeeping node and starts signed heartbeats to the Agent Ledger. |
| `create_wallet` | Creates or reuses the agent's x402 wallet and binds it on the ledger. Fund it with USDC on Base; no ETH is needed. |
| `get_balance` | On-chain USDC of the wallet plus ledger balances (USDC, test USDC, SCDO). |
| `pay_x402` | Pays an HTTP 402 (x402) URL with an EIP-3009 authorization. The facilitator pays gas. The price is previewed first. |
| `book_income` | Books a settled x402 payment the agent received as income. The ledger checks the signature, payee and on-chain receipt. |

### Public SCDO tools (0.2.0, no keys needed)

| Tool | What it does | Backed by |
|---|---|---|
| `chain_block_height` | Block height per shard (0 = EVM Shard0, 1-4 = SCDO Classic). | `https://apeccapital.org/rpc/<0-4>` |
| `chain_address_balance` | Native SCDO balance of an address on a shard. | same RPC (`eth_getBalance`, `scdo_getBalance`) |
| `chain_tx_status` | Transaction status by hash (success, failed, pending, not_found). | same RPC (receipts) |
| `chain_address_txs` | Shard0 transaction history of an address. | `https://scdo.com.au/api/address/<0x>/txs` |
| `ledger_stats` | Agent Ledger totals, online count, per platform, health. | `https://scdo.com.au/agent-ledger/api/health`, `/agents` |
| `ledger_list_agents` | List ledger agents, filter by platform or operator. | `/agent-ledger/api/agents` |
| `ledger_get_agent` | One agent's record and its book. | `/agent-ledger/api/agents/<0x>`, `/ledger` |
| `ledger_registration` | ERC-8004 registration documents. | `/agent-ledger/api/erc8004`, `/.well-known/agent-registration.json` |
| `games_catalog` | SCDO Games with play links. | `https://scdo.com.au/games/` |
| `stakewheel_demo_commit` | Provably-fair commit for the free Stake Wheel demo. | `/games/stakewheel/api/demo/commit` |
| `x402_catalog` | x402 pay-to wallets and pay URLs (USDC on Base or native SCDO). | `/x402/wallets`, `/x402/scdo/wallets` |
| `x402_quote` | Price quote of any x402 URL (reads the 402 response, pays nothing). | the URL itself |
| `x402_relay_status` | Health and supported schemes of the Base relay. | `/x402-base/health`, `/x402-base/supported` |
| `wallet_downloads` | Latest SCDO Wallet (Windows, Mac) and Linux scdo-agent builds with SHA-256. | `/downloads/wallet/latest.json`, `mac/`, `linux/` |
| `invite_info` | Invite programme status and an address's invite link. | `/agent-ledger/api/invite/status` |
| `connect_start` | Start an SCDO Wallet Connect flow for a game (allowlisted return URL). | `/play/api/demo/connect/start` |
| `connect_exchange` | Redeem the one-time return code for a session. | `/play/api/demo/connect/exchange` |

Live tests: `python -m pytest tests/test_live_public.py`.

## Network, caps and keys

- Default network is Base mainnet (`base`); use `network: "base-sepolia"` or `SCDO_AGENT_NETWORK=base-sepolia` for the test network.
- Caps: 0.001 to 1 USDC per payment, 100 payments and 20 USDC per day per agent. Mainnet payments to SCDO paywalls settle through `https://scdo.com.au/x402-base/`.
- Keys are created and kept by `scdo-agent` in the local data dir. This server never reads key files and never sends or prints keys.

Environment: `SCDO_AGENT_BIN`, `SCDO_AGENT_DATA` (default `~/.local/share/scdo-agent`), `SCDO_AGENT_NETWORK`, `SCDO_AGENT_PASSPHRASE_FILE`, `SCDO_AGENT_LEDGER`.

# scdo-agent-mcp

<!-- mcp-name: io.github.SCDOLAB/scdo-agent-mcp -->

MCP server for SCDO: public chain, Agent Ledger and x402 tools, plus a local per-agent x402 wallet (USDC on Base). Two transports:

- **stdio** (default) for `npx -y scdo-agent-mcp`. This is the FiatDock free-list package name.
- **Streamable HTTP** for a public URL. FiatDock paid listings need this. They do not accept a PyPI package or a bare HTTP 402 URL.

Free, MIT licence. Version 0.2.0.

The npm name `scdo-agent-mcp` is not on the registry until the publish workflow below runs. `@scdolab/scdo-agent-mcp` is not the package. FiatDock already tried `scdo-agent-mcp` and got `npm_package_not_found`.

## Quickstart (stdio)

```sh
curl -fsSL https://scdo.com.au/downloads/wallet/linux/install.sh | sh -s -- --user   # 1. install scdo-agent (https://scdo.com.au/linux-agent/)
npx -y scdo-agent-mcp                                                                 # 2. stdio MCP
# 3. client config: { "command": "npx", "args": ["-y", "scdo-agent-mcp"] }
```

Full wallet guide: https://scdo.com.au/linux-agent/

## Streamable HTTP

```sh
npx -y scdo-agent-mcp --http --host 127.0.0.1 --port 8787
# listening on http://127.0.0.1:8787/mcp
# health: http://127.0.0.1:8787/health and http://127.0.0.1:8787/mcp/health
```

The process is stateless. Each POST is a fresh server, responses are `application/json`, and there is no session cookie to stick. Bind stays on loopback. Put nginx on `scdo.com.au` in front of it.

Wallet tools (`register_agent`, `create_wallet`, `get_balance`, `pay_x402`, `book_income`) are **off** in HTTP mode. They create local keys. Turn them on only for a private operator process: `--enable-wallet` or `SCDO_MCP_ENABLE_WALLET=1`.

Handshake check (local):

```sh
curl -sS http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Health check:

```sh
curl -fsS http://127.0.0.1:8787/mcp/health
```

A healthy body has `"ok": true`, `"transport": "streamable-http"` and `"mcp": "/mcp"`.

### Deploy on scdo.com.au (no new apex domain)

Preferred public URL, a path on the existing site:

- MCP: `https://scdo.com.au/mcp`
- Health: `https://scdo.com.au/mcp/health`

`https://mcp.scdo.com.au/mcp` is only a fallback if the apex vhost cannot proxy this process. It is a subdomain of `scdo.com.au`, not a new apex. Both hostnames are in the default `Host` allowlist.

On the host that already serves scdo.com.au:

```sh
npm install -g scdo-agent-mcp@0.2.0
# or, from a checkout of this repo: node packages/mcp/bin/scdo-agent-mcp.js --http --host 127.0.0.1 --port 8787
```

systemd unit, loopback only:

```ini
[Service]
ExecStart=/usr/bin/scdo-agent-mcp --http --host 127.0.0.1 --port 8787
Restart=on-failure
NoNewPrivileges=true
```

nginx on the existing `scdo.com.au` server. `location /mcp` is more specific than the site's `location /`, so the rest of the site stays as it is. Do not attach this process to a new domain.

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 120s;
    client_max_body_size 1m;
}
```

After reload:

```sh
curl -fsS https://scdo.com.au/mcp/health
```

`GET /mcp` returns 405. Streamable HTTP clients POST. A browser `Origin` that is not `scdo.com.au`, `www.scdo.com.au`, `mcp.scdo.com.au` or localhost is 403. Missing `Origin` (the usual MCP client) is allowed.

This URL does not answer until that proxy is in place. This repo cannot deploy it.

### How FiatDock should list it

From [fiatdock/fiatdock#14](https://github.com/fiatdock/fiatdock/issues/14). Not a partnership. FiatDock's publish check is the constraint.

| Listing | What to enter | What not to enter |
|---|---|---|
| Free (stdio) | npm `packageName`: `scdo-agent-mcp` | PyPI `scdo-agent-mcp`. FiatDock looks up npm and returned `npm_package_not_found`. |
| Paid (per call) | `mcpEndpoint`: `https://scdo.com.au/mcp` once health returns ok. Tool name: `ledger_stats` | `https://scdo.com.au/api/x402/ledger-stats`. That URL is a live HTTP 402 GET. FiatDock reported it `endpoint_unreachable` because it is not a Streamable HTTP MCP handshake. |

`ledger_stats` reads the public Agent Ledger and returns totals, so the gateway gets an answer and can settle. `x402_ledger_stats` is a different tool: it calls the live 402 rail and, with no `paymentSignature`, returns the challenge instead of the stats. The FiatDock gateway does not pass that argument. Use `ledger_stats` as the listing's tool name.

Publish npm before the free listing will pass. From this repo, Actions workflow `publish` (`workflow_dispatch`, target `npm`) runs `npm publish --workspace packages/mcp --access public`. It needs the `NPM_TOKEN` secret. This change does not publish the package.

## Tools

### Local wallet (stdio, or HTTP with `--enable-wallet`)

| Tool | What it does |
|---|---|
| `register_agent` | Creates (or reuses) a local agent identity as a bookkeeping node and starts signed heartbeats to the Agent Ledger. |
| `create_wallet` | Creates or reuses the agent's x402 wallet and binds it on the ledger. Fund it with USDC on Base; no ETH is needed. |
| `get_balance` | On-chain USDC of the wallet plus ledger balances (USDC, test USDC, SCDO). |
| `pay_x402` | Pays an HTTP 402 (x402) URL with an EIP-3009 authorization. The facilitator pays gas. The price is previewed first. |
| `book_income` | Books a settled x402 payment the agent received as income. The ledger checks the signature, payee and on-chain receipt. |

### Public tools (no key)

Same reads as the Python package, plus `x402_ledger_stats`. Outbound HTTP is limited to `scdo.com.au` and `apeccapital.org` (port 443, no redirects) so the public process is not an open proxy.

| Tool | What it does |
|---|---|
| `chain_block_height` | Block height per shard (0 = EVM Shard0, 1-4 = SCDO Classic). |
| `chain_address_balance` | Native SCDO balance of an address on a shard. |
| `chain_tx_status` | Transaction status by hash. |
| `chain_address_txs` | Shard0 transaction history of an address. |
| `ledger_stats` | Agent Ledger totals from the public ledger API. This is the tool to name on a FiatDock paid listing. |
| `ledger_list_agents` | List ledger agents, filter by platform or operator. |
| `ledger_get_agent` | One agent's record and its book. |
| `ledger_registration` | ERC-8004 registration documents. |
| `games_catalog` | SCDO Games with play links. |
| `stakewheel_demo_commit` | Provably-fair commit for the free Stake Wheel demo. |
| `x402_catalog` | x402 pay-to wallets and pay URLs (USDC on Base, or native SCDO). |
| `x402_quote` | Price quote of an allowlisted https URL. Reads a 402 response and pays nothing. |
| `x402_ledger_stats` | Calls the live rail `GET https://scdo.com.au/api/x402/ledger-stats`. No argument: returns the upstream 402 (about 0.01 USDC on Base, `payTo` `0x105c14379874E0Ff5287a2f5214146ed1b9FC866`). `paymentSignature`: forwarded as `PAYMENT-SIGNATURE` and `X-PAYMENT`. The server never signs. |
| `x402_relay_status` | Health and supported schemes of `https://scdo.com.au/x402-base/`. |
| `wallet_downloads` | Latest wallet and Linux scdo-agent builds with SHA-256. |
| `invite_info` | Invite programme status and an address's invite link. |
| `connect_start` | Start an SCDO Wallet Connect flow for a game (allowlisted return URL). |
| `connect_exchange` | Redeem the one-time return code. |

## Network, caps and keys

- Default network is Base mainnet (`base`). Pass `network: "base-sepolia"` or set `SCDO_AGENT_NETWORK=base-sepolia` for the test network.
- Mainnet payments to SCDO paywalls settle through the SCDO relay at `https://scdo.com.au/x402-base/`.
- Caps: 0.001 to 1 USDC per payment, 100 payments and 20 USDC per day per agent (the same caps as the relay).
- Keys are created and kept by `scdo-agent` in the local data dir. This server never reads key files and never sends or prints keys.

Environment: `SCDO_AGENT_BIN`, `SCDO_AGENT_DATA` (default `~/.local/share/scdo-agent`), `SCDO_AGENT_NETWORK`, `SCDO_AGENT_PASSPHRASE_FILE`, `SCDO_AGENT_LEDGER`, `SCDO_MCP_HTTP`, `SCDO_MCP_HOST`, `SCDO_MCP_PORT`, `SCDO_MCP_ENABLE_WALLET`, `SCDO_MCP_ALLOWED_HOSTS`.

Library use: `import { ScdoAgent } from "scdo-agent-mcp/core"`.

## Coinbase Bazaar (`extensions.bazaar`)

Checked 2026-10-23 against the live rail, not against this MCP process.

`GET https://scdo.com.au/api/x402/ledger-stats` already returns HTTP 402 with `extensions.bazaar` (`input.type` `http`, `input.method` `GET`, an output example, and a draft 2020-12 schema). `POST https://api.cdp.coinbase.com/platform/v2/x402/validate` with `{"resource":"https://scdo.com.au/api/x402/ledger-stats","method":"GET"}` returned `valid: true`, every required preflight check passed (including `has_bazaar_extension`), and `index.active: true` (`lastCrawledAt` `2026-10-23T10:05:16.201Z`).

Nothing else is required for that validator. Optional fields the 402 body does not set, which facilitators may show in search: `resource.serviceName` (printable ASCII, 32 characters or fewer), `resource.tags` (at most 5, each 32 characters or fewer) and `resource.iconUrl`. `input.discoverable` is not in the canonical bazaar GET field list. CDP accepted it because the response's own schema allows it. A facilitator that validates against the canonical schema with `additionalProperties: false` would reject that field; deleting `discoverable` is the fix.

Indexing still happens on a successful CDP settle whose `paymentPayload` includes `resource`. Verify alone does not index. The settle response header `EXTENSION-RESPONSES` is where a `bazaar` value of `rejected` would show up.

Do not put HTTP 402 on `https://scdo.com.au/mcp`. FiatDock's probe has to finish the MCP handshake. If a later paywall is the MCP URL itself, that 402's `extensions.bazaar.info.input` has to be `type: "mcp"` with `toolName`, `inputSchema` and `transport: "streamable-http"`. The ledger-stats resource stays `type: "http"`, method `GET`.

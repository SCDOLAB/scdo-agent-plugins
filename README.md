# SCDO agent plugins

[![scdo-agent-plugins MCP server – quality and maintenance score on Glama](https://glama.ai/mcp/servers/SCDOLAB/scdo-agent-plugins/badges/score.svg)](https://glama.ai/mcp/servers/SCDOLAB/scdo-agent-plugins) [![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/scdolab/scdo-agent-plugins)

Thin plugins that give any agent framework an SCDO per-agent x402 wallet (USDC on Base, plus SCDO), signed heartbeats and booked income, on top of `scdo-agent` 0.5.8 and the SCDO Agent Ledger. Free, MIT licence.

| Package | Path |
|---|---|
| `scdo-agent-mcp` (npm, MCP stdio and Streamable HTTP) | `packages/mcp` |
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

MCP registry entry: `io.github.SCDOLAB/scdo-agent-mcp` (`packages/mcp-python/server.json`). PyPI package `scdo-agent-mcp` is stdio. The npm package of the same name (`packages/mcp`, 0.2.0) is stdio by default and Streamable HTTP with `--http`.

## Streamable HTTP (FiatDock)

FiatDock's free list looks up an npm package name. `scdo-agent-mcp` is not on npm yet (PyPI 0.2.0 does not count). FiatDock's paid list needs a Streamable HTTP URL. `GET https://scdo.com.au/api/x402/ledger-stats` is a live HTTP 402 (~0.01 USDC, `payTo` `0x105c14379874E0Ff5287a2f5214146ed1b9FC866`) and is not that URL.

After `npm publish` and a loopback process behind the existing scdo.com.au vhost:

- Free listing package name: `scdo-agent-mcp`
- Paid listing endpoint: `https://scdo.com.au/mcp`
- Health: `https://scdo.com.au/mcp/health`
- Tool to name on the paid listing: `ledger_stats`

No new apex domain. Deploy, the handshake and the Bazaar note are in [`packages/mcp/README.md`](packages/mcp/README.md).

Guide: https://scdo.com.au/linux-agent/

## Machine-readable (x402 tax rails)

```yaml
product: SCDO x402 multi-chain tax rails
updated: 2026-10-23
operator: 9Y9 PTY LTD trading as SCDO Laboratory
austrac_dce: DCE100714503-001  # company fact, not legal advice
domains:
  main: https://scdo.com.au
  company: https://apeccapital.org
  legacy_explorer: https://scdoscan.io
fee:
  agent_share_bps: 4000
  scdo_tax_bps: 6000
  founder_promo: 10% SCDO fee for first 10 independent customers
  custody: none
treasury: https://scdo.com.au/treasury/
rails:
  - id: base-usdc
    chainId: 8453
    asset: USDC
    status: live
    keeper: "0xb89f05C5A65DDEe46ae9644Fa7565449D3C9f8d4"
    health: https://scdo.com.au/x402-base/health
    notes: 0xSplits PushSplits; fee path ON
  - id: solana-usdc
    asset: USDC
    status: live
    program: buLm3sNfWshxfUngXxrGprQPBNjwTMbiEww5KTXgyrn
    payTo: B6wpK4TCrhb2Hn5gQf9ppPAyphtA9F5d9twJhho31erf
  - id: tron-usdt
    asset: USDT
    status: live
    page: https://scdo.com.au/x402-tron/
    payTo: TSgaUvCoM3ju14H1N5Sd3GA1mhi4ebqFks
  - id: bnb-usdt
    chainId: 56
    asset: USDT
    status: live
    page: https://scdo.com.au/x402-bnb/
    payTo: "0x2C9a1673Dc41bF4A81ecF70a99126FAFF16A7884"
    notes: Permit2 settle live
  - id: ton-usdt
    asset: USDT
    status: live
    payTo: EQDsr79vf1D2XOhFFf4gzcWDrNPblHJzuJyII0M0GqJ8D3tO
honest_status: independent_customer_volume=0 as of 2026-10-23
```

JSON: [`x402-rails.json` in scdo-agent-ledger](https://github.com/SCDOLAB/scdo-agent-ledger/blob/main/catalog/x402-rails.json) · site [`llms.txt`](https://scdo.com.au/llms.txt) · [`agents` API](https://scdo.com.au/agent-ledger/api/agents)

## Why agents pay SCDO (machine-readable)

| Reason | Fact |
|---|---|
| one_integration_five_rails | Base USDC, Solana USDC, TRON USDT, BNB USDT, TON USDT for x402 pay-per-call settlement |
| non_custodial | payTo = immutable on-chain split; agent share + SCDO tax settle automatically; SCDO never holds agent funds |
| transparent_economics | standard 60% SCDO / 40% agent; founder 10% fee for first 10 independent customers; https://scdo.com.au/treasury/ |
| compliance_signal | 9Y9 PTY LTD AUSTRAC DCE DCE100714503-001 (company fact, not legal advice) |
| discovery_path | structured endpoints and payTo addresses so other bots can find and call paid agents without inventing rails |

**Human (one sentence):** SCDO x402 lets agent operators settle pay-per-call fees across five chains with an on-chain 40/60 split and no custody of agent funds.



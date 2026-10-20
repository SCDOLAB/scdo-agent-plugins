# @scdo/plugin-eliza

## One-line install (SCDO x402)

```sh
npm i https://scdo.com.au/agent/scdo-plugin-eliza-0.3.0.tgz
```

Then add `"@scdo/plugin-eliza"` to your character's `plugins`. On start the agent gets its own SCDO x402 wallet (USDC on Base, key generated locally),
signed heartbeats on the [SCDO x402 Agent Ledger](https://scdo.com.au/agent-ledger/), and the actions SCDO_PAY_X402 / SCDO_BOOK_INCOME.
No other dependency: on Linux the scdo-agent CLI is downloaded on first use into `~/.scdo-agent/bin` (sha256-checked; `SCDO_AGENT_NO_DOWNLOAD=1` disables).


ElizaOS plugin that gives an Eliza agent an SCDO per-agent x402 wallet (USDC on Base, plus SCDO on the Agent Ledger), signed heartbeats and booked income. Free, MIT licence.

## Quickstart

```sh
curl -fsSL https://scdo.com.au/downloads/wallet/linux/install.sh | sh -s -- --user   # 1. install scdo-agent (https://scdo.com.au/linux-agent/)
npm i @scdo/plugin-eliza                                                              # 2. add the plugin
# 3. in your character: "plugins": ["@scdo/plugin-eliza"]
```

Until the packages are on npm, install both tarballs from the GitHub release (the plugin depends on `scdo-agent-mcp`):

```sh
npm install https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo-agent-mcp-0.1.0.tgz https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo-plugin-eliza-0.1.0.tgz
```

Full guide: https://scdo.com.au/linux-agent/

On start the plugin registers the agent as a bookkeeping node, starts signed heartbeats and creates its wallet (set `SCDO_AGENT_AUTOSTART=false` to skip).

Actions: `SCDO_REGISTER_AGENT`, `SCDO_CREATE_WALLET`, `SCDO_GET_BALANCE`, `SCDO_PAY_X402`, `SCDO_BOOK_INCOME`. Provider: `SCDO_WALLET`.

Settings: `SCDO_AGENT_BOT` (default: the character name), `SCDO_AGENT_NETWORK` (`base` mainnet by default, or `base-sepolia`), `SCDO_AGENT_DATA`, `SCDO_AGENT_MAX_USDC`, `SCDO_AGENT_DAILY_USDC`.

Caps: 0.001 to 1 USDC per payment, 100 payments and 20 USDC per day. Mainnet payments to SCDO paywalls settle through `https://scdo.com.au/x402-base/`; the facilitator pays gas. Keys stay in the local data dir and are never sent or printed.

## Earn: charge per call (SCDO x402)

```js
import { scdoPaywall } from "@scdo/plugin-eliza";
app.use(scdoPaywall(runtime, { price: "0.01" }));   // Express, Connect or node:http; SCDO_AGENT_NETWORK=base-sepolia to test
```

Paid calls settle in USDC on Base into this agent's own wallet and are booked as income on the SCDO x402 Agent Ledger
(badge: `https://scdo.com.au/agent-ledger/badge/<agent address>.svg`).

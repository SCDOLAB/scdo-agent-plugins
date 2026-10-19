# @scdo/plugin-eliza

ElizaOS plugin that gives an Eliza agent an SCDO per-agent x402 wallet (USDC on Base, plus SCDO on the Agent Ledger), signed heartbeats and booked income. Free, MIT licence.

## Quickstart

```sh
curl -fsSL https://scdo.com.au/downloads/wallet/linux/install.sh | sh -s -- --user   # 1. install scdo-agent (https://scdo.com.au/linux-agent/)
npm i @scdo/plugin-eliza                                                              # 2. add the plugin
# 3. in your character: "plugins": ["@scdo/plugin-eliza"]
```

Full guide: https://scdo.com.au/linux-agent/

On start the plugin registers the agent as a bookkeeping node, starts signed heartbeats and creates its wallet (set `SCDO_AGENT_AUTOSTART=false` to skip).

Actions: `SCDO_REGISTER_AGENT`, `SCDO_CREATE_WALLET`, `SCDO_GET_BALANCE`, `SCDO_PAY_X402`, `SCDO_BOOK_INCOME`. Provider: `SCDO_WALLET`.

Settings: `SCDO_AGENT_BOT` (default: the character name), `SCDO_AGENT_NETWORK` (`base` mainnet by default, or `base-sepolia`), `SCDO_AGENT_DATA`, `SCDO_AGENT_MAX_USDC`, `SCDO_AGENT_DAILY_USDC`.

Caps: 0.001 to 1 USDC per payment, 100 payments and 20 USDC per day. Mainnet payments to SCDO paywalls settle through `https://scdo.com.au/x402-base/`; the facilitator pays gas. Keys stay in the local data dir and are never sent or printed.

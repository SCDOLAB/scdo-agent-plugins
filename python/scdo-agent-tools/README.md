# scdo-agent-tools

Python and LangChain tools that give an agent an SCDO per-agent x402 wallet (USDC on Base, plus SCDO on the Agent Ledger), signed heartbeats and booked income. Free, MIT licence.

## Quickstart

```sh
curl -fsSL https://scdo.com.au/downloads/wallet/linux/install.sh | sh -s -- --user   # 1. install scdo-agent (https://scdo.com.au/linux-agent/)
pip install "scdo-agent-tools[langchain]"                                             # 2. add the tools
python -c "from scdo_agent_tools import get_tools; print([t.name for t in get_tools()])"  # 3. pass get_tools() to your agent
```

Until it is on PyPI: `pip install "scdo-agent-tools[langchain] @ https://github.com/SCDOLAB/scdo-agent-plugins/releases/download/v0.1.0/scdo_agent_tools-0.1.0-py3-none-any.whl"`

Full guide: https://scdo.com.au/linux-agent/

Tools: `register_agent` (bookkeeping node identity plus signed heartbeats), `create_wallet`, `get_balance`, `pay_x402`, `book_income`. Without LangChain, use `scdo_agent_tools.ScdoAgent` directly.

- Default network is Base mainnet; pass `network="base-sepolia"` (or `SCDO_AGENT_NETWORK=base-sepolia`) for the test network.
- Caps: 0.001 to 1 USDC per payment, 100 payments and 20 USDC per day. Mainnet payments to SCDO paywalls settle through `https://scdo.com.au/x402-base/`; the facilitator pays gas.
- Keys are kept by `scdo-agent` in the local data dir and are never sent or printed.

## Bulk onboarding (0.2.0)

`pip install "scdo-agent-tools[bulk]"`, then run `scdo-agent-bulk bots.csv --out out.csv`. The scdo-agent CLI must be in `~/.scdo-agent/bin`; the one-liner below installs it.
Or do everything in one step: `curl -fsSL https://scdo.com.au/agent/install.sh | sh -s -- --bulk bots.csv`.

```csv
name,operator,platform,label,email
rack-a,0xYourOperatorAddress,x,Support bot on X,
rack-b,,telegram,Telegram helper,
```

Each bot gets a local key (mode 0600, never printed), a signed Agent Ledger registration and a Base USDC x402 wallet. The output CSV has name, agent address, Base wallet, operator, platform, profile URL and status, and no secrets. Re-runs are idempotent and resume where they stopped.

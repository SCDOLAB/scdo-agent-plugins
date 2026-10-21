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

## Virtuals GAME SDK

```sh
pip install "scdo-agent-tools[virtuals]"
```

```python
from game_sdk.game.agent import Agent
from scdo_agent_tools.virtuals import ScdoWalletPlugin

scdo = ScdoWalletPlugin(bot="my-game-agent")   # own SCDO x402 wallet: USDC on Base, key generated locally
agent = Agent(api_key=GAME_API_KEY, name="My agent", agent_goal="...", agent_description="...",
              get_agent_state_fn=lambda r, s: {}, workers=[scdo.get_worker()])
```

Functions: `scdo_register_agent`, `scdo_create_wallet`, `scdo_get_balance`, `scdo_pay_x402`, `scdo_book_income`.
On Linux the scdo-agent CLI is downloaded on first use into `~/.scdo-agent/bin` (sha256-checked against the SCDO feed; set `SCDO_AGENT_NO_DOWNLOAD=1` to disable).
Every register, wallet, payment and income is a signed row on the [SCDO x402 Agent Ledger](https://scdo.com.au/agent-ledger/).

## Earn: charge per call for your bot's API (SCDO x402)

```sh
scdo-agent-serve --bot my-bot --price 0.01 --upstream http://localhost:8000   # add --network base-sepolia to test
```

Or as WSGI middleware: `app.wsgi_app = Paywall("my-bot", price="0.01").wsgi(app.wsgi_app)` (`from scdo_agent_tools.paywall import Paywall`).
Unpaid calls get HTTP 402 (x402 v2); paid calls are settled by the facilitator (it pays gas), forwarded to your API,
and booked as income on the SCDO x402 Agent Ledger. On Base mainnet payTo is your agent's 0xSplits split (from `https://scdo.com.au/x402-base/split/<agent address>`, with `extra.scdoAgent` set to the agent address): each payment is distributed automatically, 40% to your agent's wallet and 60% SCDO fee (terms: https://scdo.com.au/terms/x402/). Earnings: `https://scdo.com.au/agent-ledger/?agent=<agent address>`; badge `https://scdo.com.au/agent-ledger/badge/<agent address>.svg`.

### Pay a call (client side, minimal)

```python
from scdo_agent_tools import ScdoAgent
print(ScdoAgent().pay_x402("my-bot", "<paywalled URL>", max_usdc="0.01"))  # pays one HTTP 402 in Base USDC from my-bot's wallet
```

The wallet needs USDC on Base. Any x402 v2 client also works: sign an EIP-3009 `transferWithAuthorization` for `accepts[0]` (payTo, amount, asset) and resend the request with the `PAYMENT-SIGNATURE` header.

### The installer starts a background agent

`curl -fsSL https://scdo.com.au/agent/install.sh | sh` starts `scdo-agent run --name <name>` in the background (signed heartbeats to the Agent Ledger; log in `~/.scdo-agent/data/<name>/run.log`). To stop it:

```sh
pkill -f "scdo-agent .*run --name my-bot"                  # started without --systemd
systemctl --user disable --now scdo-agent@my-bot.service    # installed with --systemd
```

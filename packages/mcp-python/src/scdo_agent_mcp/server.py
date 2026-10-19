"""MCP stdio server exposing the same tools as the Node scdo-agent-mcp."""
from __future__ import annotations

from typing import Any, Literal, Optional, Union

from mcp.server.fastmcp import FastMCP

from . import __version__
from .core import CAPS_TEXT, DOCS_URL, ScdoAgent, ScdoError

Network = Optional[Literal["base", "base-sepolia"]]

mcp = FastMCP(
    "scdo-agent-mcp",
    instructions=(
        "SCDO per-agent x402 wallet (Base USDC and SCDO) with signed heartbeats and booked income. "
        f"Keys stay in the local data dir. Caps: {CAPS_TEXT}. Docs: {DOCS_URL}"
    ),
)

_agent: Optional[ScdoAgent] = None


def _get_agent() -> ScdoAgent:
    global _agent
    if _agent is None:
        _agent = ScdoAgent()
    return _agent


def _call(fn, **kw) -> dict:
    try:
        return fn(**{k: v for k, v in kw.items() if v is not None})
    except ScdoError as e:
        raise ValueError(str(e)) from None


@mcp.tool(title="Register agent")
def register_agent(name: str, payout: Optional[str] = None, label: Optional[str] = None, heartbeats: bool = True) -> dict:
    """Create (or reuse) a local SCDO agent identity as a bookkeeping node and start signed heartbeats to the Agent Ledger. The key is created and kept in the local data dir."""
    return _call(_get_agent().register_agent, name=name, payout=payout, label=label, heartbeats=heartbeats)


@mcp.tool(title="Create x402 wallet")
def create_wallet(bot: str, network: Network = None, maxUsdc: Optional[str] = None, dailyUsdc: Optional[str] = None) -> dict:
    """Create or reuse the agent's x402 wallet and bind it on the Agent Ledger. Fund it with USDC on Base; no ETH is needed. maxUsdc: per-payment limit 0.001 to 1 (default 0.10). dailyUsdc: up to 20 (default 1.00)."""
    return _call(_get_agent().create_wallet, bot=bot, network=network, max_usdc=maxUsdc, daily_usdc=dailyUsdc)


@mcp.tool(title="Get balance")
def get_balance(bot: str, network: Network = None) -> dict:
    """On-chain USDC balance of the agent wallet plus the Agent Ledger balances (USDC, test USDC, SCDO)."""
    return _call(_get_agent().get_balance, bot=bot, network=network)


@mcp.tool(title="Pay x402 resource")
def pay_x402(bot: str, url: str, maxUsdc: Optional[str] = None, network: Network = None) -> dict:
    """Pay an HTTP 402 (x402) resource from the agent wallet with an EIP-3009 authorization. The facilitator pays gas. The price is previewed first and must be within maxUsdc and the caps."""
    return _call(_get_agent().pay_x402, bot=bot, url=url, max_usdc=maxUsdc, network=network)


@mcp.tool(title="Book income")
def book_income(
    paymentPayload: Union[str, dict[str, Any]],
    settlement: Union[str, dict[str, Any]],
    bot: Optional[str] = None,
    agent: Optional[str] = None,
    paymentRequirements: Optional[dict[str, Any]] = None,
) -> dict:
    """Book a settled x402 payment the agent received as income on the Agent Ledger. The ledger checks the signature, the payee wallet and the on-chain receipt. Booking twice is safe (duplicate). agent: 0x agent address if not a local bot."""
    return _call(_get_agent().book_income, payment_payload=paymentPayload, settlement=settlement, agent=agent, bot=bot,
                 payment_requirements=paymentRequirements)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()

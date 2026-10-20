"""MCP stdio server exposing the same tools as the Node scdo-agent-mcp."""
from __future__ import annotations

from typing import Any, Literal, Optional, Union

from mcp.server.fastmcp import FastMCP

from . import __version__
from . import public as P
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


def _pub(fn, *a, **kw) -> dict:
    try:
        return fn(*a, **kw)
    except P.PublicError as e:
        raise ValueError(str(e)) from None


RO = {"readOnlyHint": True, "openWorldHint": True}


@mcp.tool(title="Chain block height", annotations=RO)
def chain_block_height(shard: Optional[int] = None) -> dict:
    """Current block height of the SCDO chain per shard (0 = EVM Shard0, chainId 5680; 1-4 = SCDO Classic). Omit shard for all five."""
    return _pub(P.block_height, shard)


@mcp.tool(title="Address balance", annotations=RO)
def chain_address_balance(address: str, shard: int = 0) -> dict:
    """Native SCDO balance of an address on one shard. Shard0 takes 0x addresses; shards 1-4 take 1S.. classic addresses."""
    return _pub(P.address_balance, address, shard)


@mcp.tool(title="Transaction status", annotations=RO)
def chain_tx_status(tx_hash: str, shard: int = 0) -> dict:
    """Look up a transaction by hash: success, failed, pending or not_found, with block and amounts when known."""
    return _pub(P.tx_status, tx_hash, shard)


@mcp.tool(title="Shard0 address history", annotations=RO)
def chain_address_txs(address: str, page: int = 1) -> dict:
    """Shard0 transaction history of a 0x address from the scdo.com.au explorer API (25 per page)."""
    return _pub(P.address_txs, address, page)


@mcp.tool(title="Agent Ledger stats", annotations=RO)
def ledger_stats() -> dict:
    """Agent Ledger totals: registered agents, online now, count per platform, and service health."""
    return _pub(P.ledger_stats)


@mcp.tool(title="List ledger agents", annotations=RO)
def ledger_list_agents(platform: Optional[str] = None, operator: Optional[str] = None, onlineOnly: bool = False, limit: int = 50) -> dict:
    """List agents on the SCDO Agent Ledger (address, online, platform, version, status code). Filter by platform or operator address."""
    return _pub(P.ledger_agents, platform, operator, onlineOnly, limit)


@mcp.tool(title="Look up ledger agent", annotations=RO)
def ledger_get_agent(address: str, includeBook: bool = True) -> dict:
    """One agent's Agent Ledger record (status, problems, wallets) and, optionally, its book (WSCDO, USDC, test USDC balances and entries)."""
    return _pub(P.ledger_agent, address, includeBook)


@mcp.tool(title="Ledger ERC-8004 registration", annotations=RO)
def ledger_registration() -> dict:
    """ERC-8004 registration documents of the Agent Ledger and of the main SCDO agent (services, endpoints)."""
    return _pub(P.ledger_registration)


@mcp.tool(title="Games catalog", annotations=RO)
def games_catalog() -> dict:
    """SCDO Games list with play links on scdo.com.au (free demo and SCDO points bookkeeping games)."""
    return P.games_catalog()


@mcp.tool(title="Stake Wheel demo commit", annotations=RO)
def stakewheel_demo_commit() -> dict:
    """Get a fresh provably-fair commit (commit_id and server seed hash) for the free Stake Wheel demo."""
    return _pub(P.stakewheel_demo_commit)


@mcp.tool(title="x402 service catalog", annotations=RO)
def x402_catalog(network: Literal["base", "scdo"] = "base") -> dict:
    """Catalog of SCDO x402 pay-to wallets and their pay URLs: base = USDC on Base, scdo = native SCDO on Shard0."""
    return _pub(P.x402_catalog, network)


@mcp.tool(title="x402 price quote", annotations=RO)
def x402_quote(url: str) -> dict:
    """Fetch the HTTP 402 payment requirements of an x402 URL (price, asset, network, payTo) without paying."""
    return _pub(P.x402_quote, url)


@mcp.tool(title="x402 relay status", annotations=RO)
def x402_relay_status() -> dict:
    """Health and supported schemes of the SCDO x402 Base settlement relay (scdo.com.au/x402-base/)."""
    return _pub(P.x402_relay_status)


@mcp.tool(title="Wallet downloads", annotations=RO)
def wallet_downloads() -> dict:
    """Latest SCDO Wallet downloads (Windows, Mac) and the Linux scdo-agent, with version, URL and SHA-256."""
    return _pub(P.wallet_downloads)


@mcp.tool(title="Invite info", annotations=RO)
def invite_info(address: Optional[str] = None) -> dict:
    """Invite programme status (contract, limits, live) and, given a Shard0 address, that address's invite link."""
    return _pub(P.invite_info, address)


@mcp.tool(title="Connect: start", annotations={"readOnlyHint": False, "openWorldHint": True})
def connect_start(game: str, returnUrl: str, src: str = "mcp") -> dict:
    """Start an SCDO Wallet Connect flow for a game: returns a token, nonce and the connect URL to open with SCDO Wallet. returnUrl must be an scdo.com.au /games/ or /play/ URL. No keys are involved."""
    return _pub(P.connect_start, game, returnUrl, src)


@mcp.tool(title="Connect: exchange code", annotations={"readOnlyHint": False, "openWorldHint": True})
def connect_exchange(code: str) -> dict:
    """Redeem the one-time return code from SCDO Wallet (valid 300 s, single use) for a browser session and the wallet address."""
    return _pub(P.connect_exchange, code)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()

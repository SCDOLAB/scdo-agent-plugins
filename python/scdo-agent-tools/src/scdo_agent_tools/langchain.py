"""LangChain tools for SCDO per-agent x402 wallets. Install with: pip install "scdo-agent-tools[langchain]"."""
from __future__ import annotations

import json
from typing import Any, Optional

from pydantic import BaseModel, Field

from .core import ScdoAgent, ScdoError

try:
    from langchain_core.tools import BaseToolkit, StructuredTool
except ImportError as e:  # pragma: no cover
    raise ImportError('LangChain is not installed. Run: pip install "scdo-agent-tools[langchain]"') from e

_NET = 'Optional. "base" = Base mainnet (default), "base-sepolia" = test network.'


class RegisterArgs(BaseModel):
    name: str = Field(description="Local agent name, e.g. a1")
    payout: Optional[str] = Field(default=None, description="Optional payout 0x address")
    label: Optional[str] = None
    heartbeats: bool = True


class WalletArgs(BaseModel):
    bot: str = Field(description="Local agent name")
    network: Optional[str] = Field(default=None, description=_NET)
    max_usdc: str = Field(default="0.10", description="Per-payment limit, 0.001 to 1")
    daily_usdc: str = Field(default="1.00", description="Daily limit, up to 20")


class BalanceArgs(BaseModel):
    bot: str
    network: Optional[str] = Field(default=None, description=_NET)


class PayArgs(BaseModel):
    bot: str
    url: str = Field(description="x402 (HTTP 402) URL to pay")
    max_usdc: str = Field(default="0.10", description="Most you will pay, 0.001 to 1")
    network: Optional[str] = Field(default=None, description=_NET)


class IncomeArgs(BaseModel):
    payment_payload: Any = Field(description="x402 PaymentPayload (object, JSON or base64 header)")
    settlement: Any = Field(description="Settlement response or transaction hash")
    bot: Optional[str] = None
    agent: Optional[str] = None
    payment_requirements: Optional[dict] = None


def _wrap(fn):
    def call(**kw):
        try:
            return json.dumps(fn(**kw))
        except ScdoError as e:
            return json.dumps({"ok": False, "error": str(e)})
    return call


def get_tools(agent: Optional[ScdoAgent] = None) -> list:
    a = agent or ScdoAgent()
    return [
        StructuredTool.from_function(_wrap(a.register_agent), name="register_agent", args_schema=RegisterArgs,
            description="Create or reuse a local SCDO agent identity as a bookkeeping node and start signed heartbeats to the Agent Ledger."),
        StructuredTool.from_function(_wrap(a.create_wallet), name="create_wallet", args_schema=WalletArgs,
            description="Create or reuse the agent's x402 wallet (USDC on Base) and bind it on the Agent Ledger."),
        StructuredTool.from_function(_wrap(a.get_balance), name="get_balance", args_schema=BalanceArgs,
            description="On-chain USDC of the agent wallet plus Agent Ledger balances (USDC, test USDC, SCDO)."),
        StructuredTool.from_function(_wrap(a.pay_x402), name="pay_x402", args_schema=PayArgs,
            description="Pay an x402 URL from the agent wallet. Caps: 0.001 to 1 USDC per payment, 100 payments and 20 USDC per day."),
        StructuredTool.from_function(_wrap(a.book_income), name="book_income", args_schema=IncomeArgs,
            description="Book a settled x402 payment the agent received as income on the Agent Ledger."),
    ]


class ScdoAgentToolkit(BaseToolkit):
    """LangChain toolkit exposing the five SCDO wallet tools."""
    agent: Any = None
    model_config = {"arbitrary_types_allowed": True}

    def get_tools(self) -> list:
        return get_tools(self.agent)

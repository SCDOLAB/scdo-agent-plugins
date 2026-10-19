"""SCDO per-agent x402 wallet tools. Docs: https://scdo.com.au/linux-agent/"""
from .core import (CAPS_TEXT, DOCS_URL, LEDGER_URL, NETWORKS, ScdoAgent, ScdoError, atomic_to_usdc, check_amount,
                   parse_network, usdc_to_atomic)

__version__ = "0.1.0"
__all__ = ["ScdoAgent", "ScdoError", "NETWORKS", "DOCS_URL", "LEDGER_URL", "CAPS_TEXT", "usdc_to_atomic", "atomic_to_usdc",
           "check_amount", "parse_network", "get_tools"]


def get_tools(agent=None):
    """LangChain tools (needs the [langchain] extra)."""
    from .langchain import get_tools as _g
    return _g(agent)

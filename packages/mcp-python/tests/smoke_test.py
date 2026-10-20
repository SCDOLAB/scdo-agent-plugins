"""Smoke test: start the server over stdio, list tools and make one read call (get_balance).

Usage: SCDO_AGENT_DATA=<dir with a test agent meta.json> python tests/smoke_test.py <bot>
"""
import asyncio, json, os, sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main(bot: str) -> None:
    params = StdioServerParameters(command=sys.executable, args=["-m", "scdo_agent_mcp"], env=dict(os.environ))
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            tools = sorted(t.name for t in (await s.list_tools()).tools)
            print("tools:", tools)
            assert {"book_income", "create_wallet", "get_balance", "pay_x402", "register_agent"} <= set(tools), tools
            res = await s.call_tool("get_balance", {"bot": bot})
            print("get_balance isError:", res.isError)
            print(res.content[0].text)


asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "smoke"))

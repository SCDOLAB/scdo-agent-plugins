"""Live tests against public SCDO endpoints (network required). Run: python -m pytest tests/test_live_public.py"""
import asyncio, json, sys

from scdo_agent_mcp import public as P

ADDR = "0x3692b92c129f666aa64c9fbda9a9d12f7c378a9d"  # public fiscal-service pay-to wallet
TX = "0x0b99c458af1f8e4ed31f0abdbe6b7da266b330eff3416ede7e3fb400e2314605"


def test_heights():
    h = P.block_height()["shards"]
    assert all(isinstance(h[str(s)].get("height"), int) and h[str(s)]["height"] > 0 for s in range(5)), h

def test_balance_and_tx():
    assert int(P.address_balance(ADDR, 0)["atomic"]) >= 0
    assert P.address_balance("1S01e99d4039ddd3c388afd251e1ec0a2404010651", 1)["decimals"] == 8
    assert P.tx_status(TX, 0)["status"] == "success"
    assert P.tx_status("0x" + "0" * 64, 0)["status"] == "not_found"
    assert P.address_txs(ADDR)["txs"]

def test_ledger():
    s = P.ledger_stats(); assert s["agents"] > 0
    a = P.ledger_agents(limit=3); assert len(a["agents"]) <= 3
    one = P.ledger_agent(a["agents"][0]["agent"]); assert one["found"] and "book" in one
    assert P.ledger_registration()["ledger"]["type"].endswith("registration-v1")

def test_games_x402_downloads_invite():
    assert len(P.games_catalog()["games"]) > 10
    assert P.stakewheel_demo_commit()["server_seed_hash"]
    assert P.x402_catalog("base")["wallets"] and P.x402_catalog("scdo")["wallets"]
    q = P.x402_quote("https://scdo.com.au/x402/pay/agent-wheel?amount=1"); assert q["paymentRequired"] and q["accepts"][0]["amountUsdc"] == "1.000000"
    assert P.x402_relay_status()["health"]["ok"]
    d = P.wallet_downloads(); assert d["windows"]["version"] and d["linuxAgent"]["url"]
    assert P.invite_info(ADDR)["inviteLink"].endswith(ADDR)

def test_connect():
    c = P.connect_start("stakewheel", "https://scdo.com.au/games/stakewheel/")
    assert c["token"] and c["connectUrl"].startswith("https://scdo.com.au/connect?")
    assert P.connect_exchange("invalidcode")["ok"] is False
    for bad in ("https://evil.example/games/", "https://scdo.com.au/admin/"):
        try: P.connect_start("x", bad); assert False
        except P.PublicError: pass

def test_mcp_lists_tools():
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    async def go():
        async with stdio_client(StdioServerParameters(command=sys.executable, args=["-m", "scdo_agent_mcp"])) as (r, w):
            async with ClientSession(r, w) as s:
                await s.initialize()
                names = {t.name for t in (await s.list_tools()).tools}
                assert len(names) == 22, names
                res = await s.call_tool("chain_block_height", {"shard": 0})
                assert not res.isError and json.loads(res.content[0].text)["shards"]["0"]["height"] > 0
    asyncio.run(go())

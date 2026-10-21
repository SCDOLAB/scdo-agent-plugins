import base64, json, os, sys
from pathlib import Path
import pytest
from scdo_agent_tools import ScdoAgent, ScdoError, usdc_to_atomic, atomic_to_usdc, check_amount, parse_network

FAKE = str(Path(__file__).with_name("fake_scdo_agent.py"))


def http(url, body=None, timeout=45):
    http.calls.append((url, body))
    if "base.org" in url:
        return 200, {"result": hex(150000)}
    if url.endswith("/ledger/income"):
        return 200, {"ok": True, "duplicate": True, "entry": {"id": "e1", "kind": "usdc_income", "amount": "1000", "asset": "USDC", "tx": body["settlement"]["transaction"], "confirmed": True}}
    return 200, {"ok": True, "summary": {"balances": {"USDC": {"display": "0.100000"}, "WSCDO": {"display": "0.0"}}, "usdcWallet": "0x9030", "heartbeats": 3}}
http.calls = []


def mk(tmp_path, **env):
    return ScdoAgent(bin=FAKE, data_dir=str(tmp_path), http=http, env={"PATH": os.environ["PATH"], **env})


def test_helpers():
    assert usdc_to_atomic("0.1") == 100000
    assert atomic_to_usdc(1000) == "0.001000"
    with pytest.raises(ScdoError):
        check_amount(999)
    with pytest.raises(ScdoError):
        check_amount(1_000_001)
    assert parse_network(None) == "base" and parse_network("testnet") == "base-sepolia"
    assert ScdoAgent(env={}).network == "base"


def test_flow(tmp_path):
    a = mk(tmp_path)
    r = a.register_agent("a1", heartbeats=False)
    assert r["created"] and r["role"] == "bookkeeping node"
    w = a.create_wallet("a1")
    assert w["network"] == "eip155:8453" and w["wallet"].startswith("0x9030")
    b = a.get_balance("a1")
    assert b["onchainUsdc"]["usdc"] == "0.150000" and b["ledger"]["usdc"] == "0.100000"
    p = a.pay_x402("a1", "http://127.0.0.1:8418/answer", max_usdc="0.15")
    assert p["tx"] == "0x" + "ab" * 32 and p["amountUsdc"] == "0.100000" and p["capsToday"]["payments"] == 1
    calls = [json.loads(l) for l in (tmp_path / "calls.log").read_text().splitlines()]
    assert all(c[:4] == ["--lang", "en", "--data-dir", str(tmp_path)] for c in calls)
    assert calls[-1][calls[-1].index("--max") + 1] == "0.100000"


def test_caps(tmp_path):
    a = mk(tmp_path, FAKE_PRICE="2000000")
    a.register_agent("a1", heartbeats=False)
    with pytest.raises(ScdoError, match="cap"):
        a.pay_x402("a1", "http://x/a", max_usdc="1")
    a2 = mk(tmp_path / "b", FAKE_PRICE="1000000") if (tmp_path / "b").mkdir() is None else None
    a2.register_agent("a1", heartbeats=False)
    c = a2.read_caps("a1"); c["atomic"] = 19_500_000; a2.write_caps("a1", c)
    with pytest.raises(ScdoError, match="20 USDC"):
        a2.pay_x402("a1", "http://x/a", max_usdc="1")
    c["count"] = 100; c["atomic"] = 0; a2.write_caps("a1", c)
    with pytest.raises(ScdoError, match="100 payments"):
        a2.pay_x402("a1", "http://x/a", max_usdc="1")


def test_testnet(tmp_path):
    a = mk(tmp_path)
    a.register_agent("t1", heartbeats=False)
    assert a.create_wallet("t1", network="base-sepolia")["network"] == "eip155:84532"


def test_book_income(tmp_path):
    a = mk(tmp_path)
    payload = {"x402Version": 2, "accepted": {"network": "eip155:8453", "amount": "1000"}, "payload": {"authorization": {"from": "0x90306eF0Ab173FbfEf96E6CdE6fB591E0C8b1f8c", "value": "1000"}}}
    tx = "0x" + "cd" * 32
    r = a.book_income(base64.b64encode(json.dumps(payload).encode()).decode(), tx, agent="0x6eFB9BaA9224b6BeE41fE7f8Fbf5C6f6b9BA563A")
    assert r["ok"] and r["entry"]["tx"] == tx
    assert http.calls[-1][1]["settlement"]["payer"].startswith("0x9030")
    payload["accepted"]["amount"] = "5000000"
    with pytest.raises(ScdoError, match="cap"):
        a.book_income(payload, tx, agent="0x6eFB9BaA9224b6BeE41fE7f8Fbf5C6f6b9BA563A")


def test_missing_cli(tmp_path):
    with pytest.raises(ScdoError, match="https://scdo.com.au/linux-agent/"):
        ScdoAgent(bin="/nonexistent", data_dir=str(tmp_path), env={"SCDO_AGENT_NO_DOWNLOAD": "1"}).register_agent("x1")


def test_heartbeats(tmp_path):
    assert mk(tmp_path).register_agent("h1")["heartbeats"] == "started"


def test_langchain_tools(tmp_path):
    pytest.importorskip("langchain_core")
    from scdo_agent_tools.langchain import get_tools, ScdoAgentToolkit
    a = mk(tmp_path)
    tools = {t.name: t for t in ScdoAgentToolkit(agent=a).get_tools()}
    assert sorted(tools) == ["book_income", "create_wallet", "get_balance", "pay_x402", "register_agent"]
    out = json.loads(tools["register_agent"].invoke({"name": "l1", "heartbeats": False}))
    assert out["agent"].startswith("0x1252")
    bad = json.loads(tools["pay_x402"].invoke({"bot": "l1", "url": "http://x/a", "max_usdc": "5"}))
    assert bad["ok"] is False


def test_compare_versions():
    from scdo_agent_tools.core import compare_versions
    assert compare_versions("0.5.10", "0.5.9") == 1
    assert compare_versions("0.5.9", "0.5.10") == -1
    assert compare_versions("0.5.10", "0.5.10") == 0
    assert compare_versions("0.5.10", "") == 1


def test_cli_upgrade_only_own_copy(tmp_path):
    home = tmp_path / "home"; d = home / ".scdo-agent" / "bin"; d.mkdir(parents=True)
    own = d / "scdo-agent"; own.write_text("#!/bin/sh\necho 'scdo-agent 0.5.10'\n"); own.chmod(0o755)
    feeds = []
    def feed(self):
        feeds.append(1); return {"version": "0.5.10"}
    orig = ScdoAgent._feed; ScdoAgent._feed = feed
    try:
        a = ScdoAgent(bin=str(own), data_dir=str(tmp_path), env={"HOME": str(home), "PATH": os.environ["PATH"]})
        assert a._require_bin() == str(own); a._require_bin()
        assert len(feeds) == 1
        ScdoAgent(bin=FAKE, data_dir=str(tmp_path), env={"HOME": str(home), "PATH": os.environ["PATH"]})._require_bin()
        assert len(feeds) == 1
        ScdoAgent(bin=str(own), data_dir=str(tmp_path), env={"HOME": str(home), "SCDO_AGENT_NO_UPDATE": "1"})._require_bin()
        assert len(feeds) == 1
    finally:
        ScdoAgent._feed = orig

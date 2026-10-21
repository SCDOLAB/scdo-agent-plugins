import base64, json
from test_core import mk
from scdo_agent_tools.paywall import Paywall


def test_paywall(tmp_path):
    a = mk(tmp_path); a.register_agent("pw"); a.create_wallet("pw", network="base-sepolia")
    calls = []
    def post(url, body):
        calls.append(url)
        return (200, {"isValid": True}) if url.endswith("/verify") else (200, {"success": True, "transaction": "0x" + "ab" * 32, "network": "eip155:84532"})
    pw = Paywall("pw", "0.01", "base-sepolia", agent=a, post=post, book=False, log=lambda m: None)
    code, h, _ = pw.challenge("http://x/y")
    req = json.loads(base64.b64decode(h["PAYMENT-REQUIRED"]))
    assert code == 402 and req["accepts"][0]["amount"] == "10000" and req["accepts"][0]["payTo"] == pw.pay_to
    bad = base64.b64encode(json.dumps({"accepted": {**req["accepts"][0], "amount": "1"}}).encode()).decode()
    assert pw.settle(bad)[0] is None and calls == []
    ok = base64.b64encode(json.dumps({"x402Version": 2, "accepted": req["accepts"][0], "payload": {}}).encode()).decode()
    s, err = pw.settle(ok)
    assert err is None and s["success"] and pw.earned == 10000 and len(calls) == 2


def test_paywall_mainnet_pays_split(tmp_path, monkeypatch):
    import scdo_agent_tools.paywall as P
    a = mk(tmp_path); a.register_agent("pm"); a.create_wallet("pm", network="base")
    agent = a.meta("pm")["address"]; seen = []
    def fake_split(fac, addr):
        seen.append((fac, addr))
        return {"agent": addr, "payTo": "0x" + "5" * 40, "split": {"allocations": [4000, 6000], "totalAllocation": 10000}}
    monkeypatch.setattr(P, "fetch_split", fake_split)
    pw = Paywall("pm", "0.01", "base", agent=a, book=False, log=lambda m: None)
    r = pw.requirements()
    assert seen == [("https://scdo.com.au/x402-base", agent)]
    assert r["payTo"] == "0x" + "5" * 40 and r["payTo"] != pw.wallet
    assert r["extra"]["scdoAgent"] == agent and r["extra"]["name"] == "USD Coin"
    assert P.split_terms(pw.split) == "40% agent, 60% SCDO fee"

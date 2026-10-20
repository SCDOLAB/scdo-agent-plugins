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

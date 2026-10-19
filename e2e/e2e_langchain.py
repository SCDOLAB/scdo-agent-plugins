"""E2E: LangChain tools from scdo-agent-tools against the live ledger and Base mainnet."""
import base64, json, sys, time
from scdo_agent_tools import get_tools
url, capture = sys.argv[1], sys.argv[2]
tools = {t.name: t for t in get_tools()}
print("tools:", ",".join(sorted(tools)))
rc = 0
def call(name, args):
    global rc
    out = json.loads(tools[name].invoke(args)); print("==", name, json.dumps(out))
    if out.get("ok") is False: rc = 1
    return out
call("register_agent", {"name": "dfa"})
call("create_wallet", {"bot": "dfa", "max_usdc": "0.20", "daily_usdc": "0.50"})
call("get_balance", {"bot": "dfa"})
p = call("pay_x402", {"bot": "dfa", "url": url, "max_usdc": "0.001"})
time.sleep(8)
cap = json.loads(open(capture).read().strip().splitlines()[-1])
settlement = json.loads(base64.b64decode(cap["response"]))
print("captured settlement tx", settlement["transaction"], "matches pay tx:", settlement["transaction"] == p.get("tx"))
call("book_income", {"bot": "dfb", "payment_payload": cap["payment"], "settlement": settlement})
call("get_balance", {"bot": "dfb"})
sys.exit(rc)

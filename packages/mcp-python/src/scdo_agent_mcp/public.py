"""Read-only (and key-free) helpers for public SCDO endpoints. No keys are read, sent or printed here."""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

SITE = "https://scdo.com.au"
LEDGER = f"{SITE}/agent-ledger/api"
RPC = "https://apeccapital.org/rpc/{shard}"
RELAY = f"{SITE}/x402-base"
UA = "scdo-agent-mcp/0.2.0"
ADDR0 = re.compile(r"^0x[0-9a-fA-F]{40}$")
ADDR_CLASSIC = re.compile(r"^(?:[1-4]S[0-9a-fA-F]{40}|0x[0-9a-fA-F]{40})$")
TXHASH = re.compile(r"^0x[0-9a-fA-F]{64}$")
KEYISH = re.compile(r"(priv|secret|seed|mnemonic|passphrase|keystore)", re.I)

GAMES = [
    ("stakewheel", "Stake Wheel", "/games/stakewheel/"),
    ("rocket", "Rocket", "/games/rocket/"),
    ("shard-keeper", "Shard Keeper", "/games/shard-keeper/"),
    ("shard-keeper-real", "Shard Keeper (SCDO points)", "/games/shard-keeper-real/"),
    ("kitten-boarding-party", "Kitten Boarding Party", "/games/kitten-boarding-party/"),
    ("kitten-circle", "Kitten Circle", "/games/kitten-circle/"),
    ("kitten-devil", "Kitten Devil", "/games/kitten-devil/"),
    ("kitten-drive", "Kitten Drive", "/games/kitten-drive/"),
    ("kitten-ferry", "Kitten Ferry", "/games/kitten-ferry/"),
    ("kitten-merge", "Kitten Merge", "/games/kitten-merge/"),
    ("kitten-stack", "Kitten Stack", "/games/kitten-stack/"),
    ("kitten-unbox", "Kitten Unbox", "/games/kitten-unbox/"),
    ("mast-drop", "Mast Drop", "/games/mast-drop/"),
    ("paw-crate-clear", "Paw Crate Clear", "/games/paw-crate-clear/"),
    ("rum-bottle-sort", "Rum Bottle Sort", "/games/rum-bottle-sort/"),
    ("treasure-trio", "Treasure Trio", "/games/treasure-trio/"),
    ("demo-wheel", "Captain Whiskers' Free Demo Wheel", "/play/"),
]


class PublicError(Exception):
    pass


def http(url: str, body: Optional[dict] = None, timeout: float = 20, allow: tuple = ()) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json",
                                                          **({"Content-Type": "application/json"} if data else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            st, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        st, raw = e.code, e.read()
    except Exception as e:  # network
        raise PublicError(f"request failed: {type(e).__name__}: {e}") from None
    try:
        j = json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        j = {"raw": raw[:500].decode("utf-8", "replace")}
    if st >= 400 and st not in allow:
        raise PublicError(f"HTTP {st} from {url}: {json.dumps(j)[:300]}")
    return st, j


def _shard(s: Any) -> int:
    try:
        s = int(s)
    except (TypeError, ValueError):
        raise PublicError("shard must be 0..4") from None
    if s not in range(5):
        raise PublicError("shard must be 0..4")
    return s


def rpc(shard: int, method: str, params: list) -> Any:
    _, j = http(RPC.format(shard=shard), {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if isinstance(j, dict) and j.get("error"):
        raise PublicError(f"shard {shard} {method}: {j['error'].get('message')}")
    return j.get("result")


def fmt(atomic: int, dec: int) -> str:
    s = f"{abs(atomic):0{dec + 1}d}"
    return ("-" if atomic < 0 else "") + s[:-dec] + "." + s[-dec:]


# ---- chain ----
def block_height(shard: Optional[int] = None) -> dict:
    shards = [_shard(shard)] if shard is not None else list(range(5))
    out = {}
    for s in shards:
        try:
            if s == 0:
                out[str(s)] = {"height": int(rpc(0, "eth_blockNumber", []), 16), "type": "EVM (chainId 5680)"}
            else:
                info = rpc(s, "scdo_getInfo", [])
                out[str(s)] = {"height": info.get("CurrentBlockHeight"), "blockAgeSec": info.get("BlockAge"),
                               "peers": info.get("PeerCnt"), "type": "SCDO Classic"}
        except PublicError as e:
            out[str(s)] = {"error": str(e)}
    return {"shards": out, "rpc": RPC.format(shard="<n>")}


def address_balance(address: str, shard: int = 0) -> dict:
    s = _shard(shard)
    if s == 0:
        if not ADDR0.match(address or ""):
            raise PublicError("shard 0 address must be 0x + 40 hex")
        a = int(rpc(0, "eth_getBalance", [address, "latest"]), 16)
        return {"shard": 0, "address": address, "atomic": str(a), "decimals": 18, "SCDO": fmt(a, 18)}
    if not ADDR_CLASSIC.match(address or ""):
        raise PublicError("classic address must look like 1S<40 hex> (shard prefix) or 0x<40 hex>")
    r = rpc(s, "scdo_getBalance", [address, "", -1])
    a = int(r.get("Balance", 0))
    return {"shard": s, "address": r.get("Account", address), "atomic": str(a), "decimals": 8, "SCDO": fmt(a, 8)}


def tx_status(tx_hash: str, shard: int = 0) -> dict:
    s = _shard(shard)
    if not TXHASH.match(tx_hash or ""):
        raise PublicError("tx_hash must be 0x + 64 hex")
    if s == 0:
        rc = rpc(0, "eth_getTransactionReceipt", [tx_hash])
        tx = rpc(0, "eth_getTransactionByHash", [tx_hash])
        if rc is None and tx is None:
            return {"shard": 0, "hash": tx_hash, "status": "not_found"}
        if rc is None:
            return {"shard": 0, "hash": tx_hash, "status": "pending", "tx": tx}
        return {"shard": 0, "hash": tx_hash, "status": "success" if rc.get("status") == "0x1" else "failed",
                "blockNumber": int(rc["blockNumber"], 16), "from": rc.get("from"), "to": rc.get("to"),
                "valueSCDO": fmt(int(tx["value"], 16), 18) if tx else None, "gasUsed": int(rc.get("gasUsed", "0x0"), 16)}
    try:
        rc = rpc(s, "scdo_getReceiptByTxHash", [tx_hash, ""])
    except PublicError as e:
        if "not found" in str(e):
            return {"shard": s, "hash": tx_hash, "status": "not_found"}
        raise
    return {"shard": s, "hash": tx_hash, "status": "failed" if rc.get("failed") else "success", "receipt": rc}


def address_txs(address: str, page: int = 1) -> dict:
    if not ADDR0.match(address or ""):
        raise PublicError("address must be 0x + 40 hex (Shard0)")
    _, j = http(f"{SITE}/api/address/{address}/txs?page={max(1, int(page))}")
    return j


# ---- agent ledger ----
def ledger_stats() -> dict:
    _, h = http(f"{LEDGER}/health")
    _, a = http(f"{LEDGER}/agents")
    plat: dict = {}
    for x in a.get("agents", []):
        plat[x.get("platform") or "unknown"] = plat.get(x.get("platform") or "unknown", 0) + 1
    return {"agents": a.get("total"), "online": a.get("online"), "byPlatform": plat, "health": h, "ledger": LEDGER}


def ledger_agents(platform: Optional[str] = None, operator: Optional[str] = None, online_only: bool = False, limit: int = 50) -> dict:
    q = {k: v for k, v in {"platform": platform, "operator": operator}.items() if v}
    _, a = http(f"{LEDGER}/agents" + ("?" + urllib.parse.urlencode(q) if q else ""))
    rows = [x for x in a.get("agents", []) if x.get("online") or not online_only]
    keep = ("agent", "online", "platform", "version", "code", "problems", "lastSeen", "label")
    return {"total": a.get("total"), "online": a.get("online"), "returned": min(len(rows), limit),
            "agents": [{k: x.get(k) for k in keep if k in x} for x in rows[: max(1, min(int(limit), 500))]]}


def ledger_agent(address: str, include_book: bool = True) -> dict:
    if not ADDR0.match(address or ""):
        raise PublicError("address must be 0x + 40 hex")
    st, j = http(f"{LEDGER}/agents/{address}", allow=(404,))
    if st == 404:
        return {"found": False, "address": address}
    out = {"found": True, **j}
    if include_book:
        _, b = http(f"{LEDGER}/agents/{address}/ledger")
        out["book"] = b
    return out


def ledger_registration() -> dict:
    _, j = http(f"{LEDGER}/erc8004")
    _, k = http(f"{SITE}/.well-known/agent-registration.json")
    return {"ledger": j, "mainAgent": k}


# ---- games ----
def games_catalog() -> dict:
    return {"games": [{"id": i, "name": n, "url": SITE + p} for i, n, p in GAMES], "lobby": f"{SITE}/games/",
            "note": "SCDO Games are free demo and SCDO points bookkeeping games. SCDO points have no fiat value."}


def stakewheel_demo_commit() -> dict:
    _, j = http(f"{SITE}/games/stakewheel/api/demo/commit")
    return {**j, "note": "Provably-fair commit: the server seed hash is published before the spin."}


# ---- x402 ----
def x402_catalog(network: str = "base") -> dict:
    url = f"{SITE}/x402/wallets" if network == "base" else f"{SITE}/x402/scdo/wallets"
    _, j = http(url)
    return {"source": url, **j}


def x402_quote(url: str) -> dict:
    if not re.match(r"^https://", url or "") or KEYISH.search(url):
        raise PublicError("url must be https and must not carry key material")
    st, j = http(url, allow=(402,))
    if st != 402:
        return {"url": url, "status": st, "paymentRequired": False, "body": j}
    accepts = []
    for a in j.get("accepts", []):
        q = dict(a)
        if str(a.get("amount", "")).isdigit() and a.get("asset", "").lower() == "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913":
            q["amountUsdc"] = fmt(int(a["amount"]), 6)
        accepts.append(q)
    return {"url": url, "status": 402, "paymentRequired": True, "x402Version": j.get("x402Version"),
            "resource": j.get("resource"), "accepts": accepts, "note": "Quote only. Nothing was paid; use pay_x402 to pay."}


def x402_relay_status() -> dict:
    _, h = http(f"{RELAY}/health")
    _, s = http(f"{RELAY}/supported")
    return {"relay": RELAY + "/", "health": h, "supported": s}


# ---- downloads / invite / connect ----
def wallet_downloads() -> dict:
    out = {"page": f"{SITE}/downloads/wallet/"}
    for k, p in {"windows": "latest.json", "mac": "mac/latest.json", "linuxAgent": "linux/latest.json"}.items():
        try:
            _, j = http(f"{SITE}/downloads/wallet/{p}")
            out[k] = {x: j.get(x) for x in ("version", "url", "sha256", "size", "arch") if j.get(x) is not None}
        except PublicError as e:
            out[k] = {"error": str(e)}
    out["linuxInstall"] = f"curl -fsSL {SITE}/downloads/wallet/linux/install.sh | sh -s -- --user"
    return out


def invite_info(address: Optional[str] = None) -> dict:
    q = ""
    if address:
        if not ADDR0.match(address):
            raise PublicError("address must be a Shard0 0x + 40 hex address")
        q = "?address=" + address
    _, j = http(f"{LEDGER}/invite/status{q}")
    out = {"status": j, "invitePage": f"{SITE}/invite/"}
    if address:
        out["inviteLink"] = f"{SITE}/?ref={address}"
    return out


CONNECT_HOSTS = ("https://scdo.com.au/", "https://www.scdo.com.au/", "https://wheel.apeccapital.org/")


def connect_start(game: str, return_url: str, src: str = "mcp") -> dict:
    if not return_url.startswith(CONNECT_HOSTS) or not re.search(r"\.(au|org)/(games|play)/", return_url):
        raise PublicError("return_url must be https://scdo.com.au/games/... or /play/... (allowlist)")
    if KEYISH.search(return_url + game + src):
        raise PublicError("never send key material")
    _, j = http(f"{SITE}/play/api/demo/connect/start", {"game": game, "src": src, "return_url": return_url, "cb": return_url})
    nonce = j.get("nonce")
    j["connectUrl"] = (f"{SITE}/connect?" + urllib.parse.urlencode(
        {"game": game, "nonce": nonce, "cb": return_url, "src": src, "return": return_url})) if nonce else None
    j["next"] = "Open connectUrl on the phone with SCDO Wallet; the wallet returns a one-time code to return_url. Redeem it with connect_exchange within 300 s."
    return j


def connect_exchange(code: str) -> dict:
    if not re.match(r"^[A-Za-z0-9_-]{6,128}$", code or ""):
        raise PublicError("code must be the one-time return code")
    st, j = http(f"{SITE}/play/api/demo/connect/exchange", {"code": code}, allow=(400, 404, 410))
    return {"ok": st == 200, "status": st, **j}

"""SCDO x402 paywall: charge per call for any HTTP endpoint. USDC (or, optionally, AUDM) on Base, paid to the agent's SCDO 0xSplits split
(40% to the agent's wallet, 60% SCDO fee; the split is distributed automatically after each settle).

    scdo-agent-serve --bot my-bot --price 0.01 --upstream http://localhost:8000          # Base mainnet
    scdo-agent-serve --bot my-bot --price 0.01 --upstream http://localhost:8000 --network base-sepolia
    scdo-agent-serve --bot my-bot --price 0.10 --asset AUDM --upstream http://localhost:8000      # AUD stablecoin, Base mainnet

AUDM (Macropod, 18 decimals) has no EIP-3009, so it is offered with the x402 exact scheme's Permit2 path
(extra.assetTransferMethod "permit2" + the eip2612GasSponsoring extension): the payer signs, needs no ETH, and the
SCDO relay forwards to the facilitator, which settles through x402ExactPermit2Proxy to the same split.

Unpaid requests get HTTP 402 with x402 v2 requirements (PAYMENT-REQUIRED header). A paid request (PAYMENT-SIGNATURE
or X-PAYMENT header) is verified and settled by the facilitator (it pays the gas), forwarded to the upstream, and the
income is booked as a row on the SCDO x402 Agent Ledger (checked there against the Base receipt). Earnings show on
https://scdo.com.au/agent-ledger/?agent=<agent address>. Also usable as WSGI middleware: Paywall(...).wsgi(app).
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

from .core import (AUDM, NETWORKS, ScdoAgent, ScdoError, atomic_to_aud, atomic_to_usdc, aud_to_atomic, check_amount,
                   check_audm_amount, parse_network, usdc_to_atomic)

ASSETS = ("USDC", "AUDM")

FACILITATORS = {"base": "https://scdo.com.au/x402-base", "base-sepolia": "https://x402.org/facilitator"}
HOP = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-connection", "host", "content-length"}


def b64(o: Any) -> str:
    return base64.b64encode(json.dumps(o, separators=(",", ":")).encode()).decode()


def _post(url: str, body: dict, timeout: float = 60) -> tuple[int, dict]:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", "user-agent": "scdo-agent-serve"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def fetch_split(facilitator: str, agent_address: str, timeout: float = 30) -> dict:
    """GET <relay>/split/<agent>: the agent's 0xSplits split, the only payTo the SCDO relay settles to."""
    url = f"{facilitator.rstrip('/')}/split/{agent_address}"
    req = urllib.request.Request(url, headers={"user-agent": "scdo-agent-serve", "accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read() or b"{}")
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise ScdoError("split", f"could not get the agent's split from {url}: {e}") from None
    if not str(d.get("payTo", "")).startswith("0x"):
        raise ScdoError("split", f"no split payTo for {agent_address} at {url}: {d.get('error') or d.get('status') or d}")
    return d


def split_terms(split: dict) -> str:
    try:
        al = split["split"]["allocations"]; tot = split["split"].get("totalAllocation") or sum(al)
        return f"{al[0] * 100 // tot}% agent, {al[1] * 100 // tot}% SCDO fee"
    except Exception:  # noqa: BLE001
        return "40% agent, 60% SCDO fee"


class Paywall:
    def __init__(self, bot: str, price: str = "0.01", network: Optional[str] = None, agent: Optional[ScdoAgent] = None,
                 pay_to: Optional[str] = None, facilitator: Optional[str] = None, description: str = "SCDO x402 paid API call",
                 book: bool = True, post=_post, log=lambda m: print(m, file=sys.stderr, flush=True), asset: str = "USDC"):
        if agent is None:
            import os
            agent = ScdoAgent(network=network)
            alt = os.path.expanduser("~/.scdo-agent/data")  # where the Linux one-liner keeps agents
            if not pay_to and not agent.wallet_doc(bot) and os.path.isdir(alt):
                agent = ScdoAgent(data_dir=alt, network=network)
        self.agent = agent
        self.bot, self.network = bot, parse_network(network or self.agent.network)
        self.asset = str(asset or "USDC").upper()
        if self.asset not in ASSETS:
            raise ScdoError("asset", f'asset must be "USDC" or "AUDM", got {asset}')
        if self.asset == "AUDM" and self.network not in AUDM:
            raise ScdoError("asset", "AUDM is only offered on Base mainnet (--network base)")
        self.atomic = check_audm_amount(aud_to_atomic(price)) if self.asset == "AUDM" else check_amount(usdc_to_atomic(price))
        self.facilitator = (facilitator or FACILITATORS[self.network]).rstrip("/")
        meta = self.agent.meta(bot) or {}
        self.agent_address = meta.get("address")
        doc = self.agent.wallet_doc(bot) if not pay_to else None
        self.wallet = (doc or {}).get("address")
        self.split = None
        if not pay_to and self.network == "base":
            # The SCDO relay only settles to the agent's 0xSplits split (40% agent wallet / 60% SCDO fee).
            if not self.agent_address:
                raise ScdoError("agent", f"no SCDO agent address for {bot}; run the one-liner or register_agent first")
            self.split = fetch_split(self.facilitator, self.agent_address)
            pay_to = self.split["payTo"]
        self.pay_to = pay_to or self.wallet
        if not self.pay_to:
            raise ScdoError("wallet", f"no SCDO x402 wallet for {bot}; run the one-liner or create_wallet first")
        self.description, self.book, self.post, self.log = description, book, post, log
        self.earned, self.calls, self._lock = 0, 0, threading.Lock()

    def fmt(self, atomic: int) -> str:
        return f"{atomic_to_aud(atomic)} AUDM" if self.asset == "AUDM" else f"{atomic_to_usdc(atomic)} USDC"

    def requirements(self) -> dict:
        n = NETWORKS[self.network]
        if self.asset == "AUDM":
            return {"scheme": "exact", "network": n["id"], "asset": AUDM[self.network], "amount": str(self.atomic), "payTo": self.pay_to,
                    "maxTimeoutSeconds": 300, "extra": self._extra()}
        return {"scheme": "exact", "network": n["id"], "asset": n["usdc"], "amount": str(self.atomic), "payTo": self.pay_to,
                "maxTimeoutSeconds": 120, "extra": self._extra()}

    def _extra(self) -> dict:
        if self.asset == "AUDM":   # EIP-712 domain of AUDM on Base: name "Macropod", version "1"
            e = {"name": "Macropod", "version": "1", "assetTransferMethod": "permit2"}
        else:
            e = {"name": "USDC" if self.network == "base-sepolia" else "USD Coin", "version": "2"}
        if self.agent_address:
            e["scdoAgent"] = self.agent_address
        return e

    def challenge(self, url: str, error: str = "Payment required") -> tuple[int, dict, bytes]:
        body = {"x402Version": 2, "error": error, "resource": {"url": url, "description": self.description, "mimeType": "application/json"}, "accepts": [self.requirements()]}
        if self.asset == "AUDM":   # gasless Permit2 approval: the payer signs an EIP-2612 permit, the facilitator submits it
            body["extensions"] = {"eip2612GasSponsoring": {"info": {"description": "Sign an EIP-2612 permit to Permit2; the facilitator submits it, no ETH needed", "version": "1"}}}
        return 402, {"PAYMENT-REQUIRED": b64(body), "content-type": "application/json", "cache-control": "no-store"}, json.dumps(body).encode()

    def settle(self, header: str) -> tuple[Optional[dict], Optional[str]]:
        """Verify + settle a payment header. Returns (settlement, None) or (None, error)."""
        try:
            payload = json.loads(base64.b64decode(header))
        except Exception:  # noqa: BLE001
            return None, "bad payment header"
        reqs = self.requirements()
        acc = payload.get("accepted") or {}
        if acc and (str(acc.get("payTo", "")).lower() != self.pay_to.lower() or str(acc.get("amount")) != reqs["amount"] or acc.get("network") != reqs["network"]
                    or (acc.get("asset") and str(acc.get("asset")).lower() != reqs["asset"].lower())):
            return None, "payment does not match the requirements"
        body = {"x402Version": 2, "paymentPayload": payload, "paymentRequirements": reqs}
        st, v = self.post(self.facilitator + "/verify", body)
        if st != 200 or not v.get("isValid"):
            return None, f"verify failed: {v.get('invalidReason') or v.get('error') or st}"
        st, s = self.post(self.facilitator + "/settle", body)
        if st != 200 or not s.get("success"):
            return None, f"settle failed: {s.get('errorReason') or s.get('error') or st}"
        with self._lock:
            self.earned += self.atomic; self.calls += 1
        self.log(f"paid {self.fmt(self.atomic)} tx {s.get('transaction')} (total {self.fmt(self.earned)}, {self.calls} calls)")
        if self.book:
            threading.Thread(target=self._book, args=(payload, s, reqs), daemon=True).start()
        return s, None

    def _book(self, payload, s, reqs):
        try:
            r = self.agent.book_income(payload, s, bot=self.bot, payment_requirements=reqs)
            self.log(f"ledger income entry {r['entry'].get('id')}{' (already booked)' if r.get('duplicate') else ''}")
        except Exception as e:  # noqa: BLE001
            self.log(f"ledger booking failed: {e}")

    def wsgi(self, app):
        """WSGI middleware (Flask, Django, ...): every request behind it costs `price`."""
        def mw(environ, start_response):
            hdr = environ.get("HTTP_PAYMENT_SIGNATURE") or environ.get("HTTP_X_PAYMENT")
            url = f"{environ.get('wsgi.url_scheme', 'http')}://{environ.get('HTTP_HOST', '')}{environ.get('PATH_INFO', '')}"
            s, err = self.settle(hdr) if hdr else (None, None)
            if not s:
                code, h, b = self.challenge(url, err or "Payment required")
                start_response("402 Payment Required", list(h.items())); return [b]
            def sr(status, headers, exc=None):
                return start_response(status, list(headers) + [("PAYMENT-RESPONSE", b64(s))], exc)
            return app(environ, sr)
        return mw


def serve(pw: Paywall, upstream: str, host: str = "0.0.0.0", port: int = 8402, free: tuple = ("/health",)) -> ThreadingHTTPServer:
    up = upstream.rstrip("/")

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        def log_message(self, *a): pass
        def _send(self, code, headers, body):
            self.send_response(code)
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)
        def _go(self):
            n = int(self.headers.get("content-length") or 0); data = self.rfile.read(n) if n else None
            s = None
            if self.path.split("?")[0] not in free:
                hdr = self.headers.get("PAYMENT-SIGNATURE") or self.headers.get("X-PAYMENT")
                s, err = pw.settle(hdr) if hdr else (None, None)
                if not s:
                    return self._send(*pw.challenge(f"http://{self.headers.get('host', '')}{self.path}", err or "Payment required"))
            req = urllib.request.Request(up + self.path, data=data, method=self.command,
                                         headers={k: v for k, v in self.headers.items() if k.lower() not in HOP | {"payment-signature", "x-payment"}})
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    code, hs, body = r.status, dict(r.headers.items()), r.read()
            except urllib.error.HTTPError as e:
                code, hs, body = e.code, dict(e.headers.items()), e.read()
            except OSError as e:
                code, hs, body = 502, {"content-type": "application/json"}, json.dumps({"error": f"upstream: {e}"}).encode()
            hs = {k: v for k, v in hs.items() if k.lower() not in HOP}
            if s:
                hs["PAYMENT-RESPONSE"] = b64(s)
            self._send(code, hs, body)
        do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = _go

    return ThreadingHTTPServer((host, port), H)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="scdo-agent-serve", description="Charge per call for any HTTP endpoint with SCDO x402 (USDC or AUDM on Base, paid to your agent's split: 40% agent, 60% SCDO fee).")
    ap.add_argument("--bot", required=True, help="local SCDO agent name (on Base mainnet payTo is its 0xSplits split: 40%% agent, 60%% SCDO fee)")
    ap.add_argument("--price", default="0.01", help="price per call in --asset: USDC 0.001 to 1, AUDM 0.001 to 1.5 (default 0.01)")
    ap.add_argument("--asset", default="USDC", choices=["USDC", "AUDM", "usdc", "audm"], help="USDC (default) or AUDM (AUD stablecoin by Macropod, Base mainnet only)")
    ap.add_argument("--upstream", required=True, help="your API, e.g. http://localhost:8000")
    ap.add_argument("--network", default=None, help="base (default) or base-sepolia")
    ap.add_argument("--port", type=int, default=8402); ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--data-dir", default=None); ap.add_argument("--no-book", action="store_true", help="do not book income on the ledger")
    a = ap.parse_args(argv)
    pw = Paywall(a.bot, a.price, a.network, agent=ScdoAgent(data_dir=a.data_dir, network=a.network) if a.data_dir else None, book=not a.no_book, asset=a.asset)
    ag = pw.agent
    meta = ag.meta(a.bot) or {}
    srv = serve(pw, a.upstream, a.host, a.port)
    print(f"SCDO x402 paywall on :{a.port} -> {a.upstream}\n  price {pw.fmt(pw.atomic)} per call on {NETWORKS[pw.network]['label']}, paid to {pw.pay_to}"
          + (f"\n  = your agent's split: {split_terms(pw.split)} (agent wallet {pw.wallet})" if pw.split else "") + "\n"
          f"  earnings: https://scdo.com.au/agent-ledger/?agent={meta.get('address', '')}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

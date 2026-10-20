#!/usr/bin/env python3
"""SCDO bulk per-bot x402 wallet onboarding. Keys stay local (0600); nothing secret is printed or written to the output.
Input CSV/JSON rows: name, operator (0x, optional), platform (optional), email (optional).
Usage: bulk.py FILE [--out out.csv] [--delay 2] [--start]"""
import argparse, csv, fcntl, json, os, re, secrets, subprocess, sys, time, urllib.request, urllib.error
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak

R = os.path.expanduser(os.environ.get("SCDO_AGENT_HOME", "~/.scdo-agent"))
BIN, DATA = f"{R}/bin/scdo-agent", f"{R}/data"
API = "https://scdo.com.au/agent-ledger/api"
PREFIX = "SCDO Agent Ledger v1\n"
NAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$"); ADDR = re.compile(r"^0x[0-9a-fA-F]{40}$")

def cj(v): return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def http(path, body=None, tries=5):
    for i in range(tries):
        req = urllib.request.Request(API + path, data=None if body is None else cj(body).encode(), headers={"content-type": "application/json", "user-agent": "scdo-agent-bulk/1"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r: return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503) and i < tries - 1: time.sleep(2 ** i * 2); continue
            try: return e.code, json.load(e)
            except Exception: return e.code, {}
        except OSError:
            if i == tries - 1: raise
            time.sleep(2 ** i)

def cli(*a):
    p = subprocess.run([BIN, "--lang", "en", "--data-dir", DATA, *a], capture_output=True, text=True, env={**os.environ, "SCDO_AGENT_MODE": "user"}, timeout=180)
    if p.returncode: raise RuntimeError(f"{a[0]} failed: {(p.stderr or p.stdout).strip()[-300:]}")

def jload(p, d=None):
    try: return json.load(open(p))
    except FileNotFoundError: return d

def key(d, purpose):
    k = jload(f"{d}/keys/{purpose}.key")
    if not k or k.get("kdf") != "none": raise RuntimeError(f"{purpose}.key missing or passphrase-encrypted (unsupported in bulk)")
    return Account.from_key(k["key"])

def sign(acct, payload):
    h = acct.sign_message(encode_defunct(text=PREFIX + cj(payload))).signature.hex()
    return h if h.startswith("0x") else "0x" + h

def summary(addr):
    st, j = http(f"/agents/{addr}")
    return j.get("summary") if st == 200 and j.get("ok") else None

def locked(d):
    try:
        f = open(f"{d}/run.lock", "a"); fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB); return f
    except BlockingIOError: return None

def rebind(d, name, addr, operator, platform, s):
    """Agent-signed /bind that keeps the existing wallets and adds operator/platform. Wallet proofs signed by wallet.key."""
    ag, wk = key(d, "ledger"), key(d, "wallet")
    if ag.address.lower() != addr.lower(): raise RuntimeError("ledger.key does not match meta.json")
    wallets = {n: a for n, a in (s.get("wallets") or {}).items() if a}
    proofs = {}
    for n, a in wallets.items():
        if a.lower() == addr.lower(): continue
        if a.lower() != wk.address.lower(): raise RuntimeError(f"wallet {n} is not this agent's wallet.key")
        nonce = secrets.token_hex(16)
        proofs[n] = {"nonce": nonce, "sig": sign(wk, {"type": "wallet-proof", "agent": addr, "botId": name, "network": n, "nonce": nonce})}
    w = jload(f"{d}/wallet.json", {})
    email_commit = None
    if os.path.exists(f"{d}/email.salt") and os.path.exists(f"{d}/email.txt"):
        email_commit = "0x" + keccak(b"scdo-bot-email-v1" + open(f"{d}/email.salt", "rb").read()[:32] + open(f"{d}/email.txt").read().strip().lower().encode()).hex()
    stf = f"{d}/state.json"; state = jload(stf, {"v": 1, "seq": 0}); seq = int(state.get("seq", 0)) + 1
    body = {"botId": name, "platform": "grok" if platform == "grok" else "other", "wallets": wallets, "walletProofs": proofs, "custody": "self",
            "operator": operator or None, "emailCommit": email_commit, "limitsCommit": w.get("limitsCommit")}
    payload = {"v": 1, "chainId": 5680, "type": "bind", "agent": addr, "seq": seq, "ts": int(time.time() * 1000), "body": body}
    state["seq"] = seq; tmp = stf + ".tmp"; json.dump(state, open(tmp, "w")); os.chmod(tmp, 0o600); os.replace(tmp, stf)
    st, j = http("/bind", {"payload": payload, "sig": sign(ag, payload)}, tries=1)
    if st != 200 or not j.get("ok"): raise RuntimeError(f"bind {st}: {cj(j)[:200]}")

def onboard(row, start):
    name = (row.get("name") or "").strip(); op = (row.get("operator") or "").strip(); plat = (row.get("platform") or "").strip().lower(); email = (row.get("email") or "").strip()
    if not NAME.match(name): raise RuntimeError("bad name")
    if op and not ADDR.match(op): raise RuntimeError("bad operator")
    d = f"{DATA}/{name}"
    if not os.path.exists(f"{d}/meta.json"): cli("init", "--name", name, "--label", f"{plat or 'linux'}"[:40])
    addr = jload(f"{d}/meta.json")["address"]; s = summary(addr)
    if not s:  # signed register via one short run
        lk = locked(d)
        if lk:
            lk.close()
            p = subprocess.Popen([BIN, "--lang", "en", "--data-dir", DATA, "run", "--name", name], stdout=open(f"{d}/run.log", "a"), stderr=subprocess.STDOUT, env={**os.environ, "SCDO_AGENT_MODE": "user"})
            for _ in range(30):
                time.sleep(2); s = summary(addr)
                if s: break
            p.terminate(); p.wait(10)
        if not s: raise RuntimeError("register not confirmed")
    if not os.path.exists(f"{d}/wallet.json"):
        cli("wallet", "create", "--bot", name, "--network", "base", *(["--email", email] if email else [])); s = summary(addr)
    if (op and (s.get("operator") or "").lower() != op.lower()) or (plat == "grok" and s.get("platform") != "grok"):
        lk = locked(d)
        if not lk: raise RuntimeError("agent is running; stop it to set operator/platform")
        try: rebind(d, name, addr, op, plat, s)
        finally: lk.close()
        s = summary(addr)
    if start and (lk := locked(d)):
        lk.close(); subprocess.Popen([BIN, "--lang", "en", "--data-dir", DATA, "run", "--name", name], stdout=open(f"{d}/run.log", "a"), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True, env={**os.environ, "SCDO_AGENT_MODE": "user"})
    return {"name": name, "agent_address": addr, "base_wallet": s.get("wallets", {}).get("eip155:8453") or "", "operator": s.get("operator") or "",
            "platform": plat, "profile_url": f"https://scdo.com.au/agent-ledger/?agent={addr}", "status": "ok"}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("file"); ap.add_argument("--out", default="scdo-bulk-out.csv"); ap.add_argument("--delay", type=float, default=2.0); ap.add_argument("--start", action="store_true")
    a = ap.parse_args(); os.umask(0o077)
    rows = json.load(open(a.file)) if a.file.endswith(".json") else list(csv.DictReader(open(a.file)))
    cols = ["name", "agent_address", "base_wallet", "operator", "platform", "profile_url", "status"]
    done = {r["name"]: r for r in csv.DictReader(open(a.out))} if os.path.exists(a.out) else {}
    fails = 0
    for i, row in enumerate(rows):
        n = (row.get("name") or "").strip()
        try: done[n] = onboard(row, a.start)
        except Exception as e: done[n] = {"name": n, "status": f"error: {str(e)[:160]}"}; fails += 1
        print(f"[{i+1}/{len(rows)}] {n}: {done[n]['status']} {done[n].get('agent_address','')}", flush=True)
        tmp = a.out + ".tmp"
        with open(tmp, "w", newline="") as f:
            w = csv.DictWriter(f, cols, extrasaction="ignore"); w.writeheader(); w.writerows(done.values())
        os.replace(tmp, a.out)
        if i < len(rows) - 1: time.sleep(a.delay)
    print(f"output: {a.out}"); sys.exit(1 if fails else 0)

if __name__ == "__main__": main()

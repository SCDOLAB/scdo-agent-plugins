#!/bin/sh
# SCDO headless agent installer (no root). Usage:
#   curl -fsSL https://scdo.com.au/agent/install.sh | sh -s -- [--name N] [--operator 0xADDR] [--platform P] [--x-handle H] [--systemd] [--no-start]
#   Bulk: ... | sh -s -- --bulk bots.csv [--out out.csv] [--start]   (CSV/JSON: name,operator,platform,label,email,x_handle)
# Installs into ~/.scdo-agent. The agent key is created locally (mode 0600), never printed, never sent.
set -eu
BSTART=""
NAME="scdo-$(hostname 2>/dev/null | cut -d. -f1 | tr -cd 'a-zA-Z0-9-' | cut -c1-24)"; OPERATOR=""; PLATFORM="linux"; SYSTEMD=0; START=1; BULK=""; XH=""; OUT="scdo-bulk-out.csv"
FEED="${SCDO_FEED:-https://scdo.com.au/downloads/wallet/linux/latest.json}"
while [ $# -gt 0 ]; do case "$1" in
  --name) NAME="$2"; shift 2;; --operator) OPERATOR="$2"; shift 2;; --platform) PLATFORM="$2"; shift 2;; --x-handle) XH="$2"; shift 2;;
  --systemd) SYSTEMD=1; shift;; --bulk) BULK="$2"; shift 2;; --out) OUT="$2"; shift 2;; --start) BSTART=--start; shift;; --no-start) START=0; shift;; -y|--yes|--non-interactive) shift;;
  -h|--help) sed -n 2,4p "$0" 2>/dev/null || true; exit 0;; *) echo "unknown flag: $1" >&2; exit 2;; esac; done
echo "$NAME" | grep -Eq '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$' || { echo "bad --name" >&2; exit 2; }
[ -z "$OPERATOR" ] || echo "$OPERATOR" | grep -Eq '^0x[0-9a-fA-F]{40}$' || { echo "--operator must be a 0x address" >&2; exit 2; }
[ "$(uname -s)" = Linux ] || { echo "Linux only" >&2; exit 1; }
case "$(uname -m)" in x86_64|amd64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;; *) echo "unsupported CPU: $(uname -m) (amd64, arm64)" >&2; exit 1;; esac
for c in curl python3 tar sha256sum; do command -v $c >/dev/null || { echo "missing: $c" >&2; exit 1; }; done
R="$HOME/.scdo-agent"; B="$R/bin/scdo-agent"; D="$R/data"; umask 077; mkdir -p "$R/bin" "$D"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
curl -fsSL "$FEED" -o "$T/f.json"
set -- $(python3 -c 'import json,sys;j=json.load(open(sys.argv[1]));f=j.get("files",{}).get(sys.argv[2]) or (j if sys.argv[2]=="amd64" else sys.exit("no build for "+sys.argv[2]));print(j["version"],f["url"],f["sha256"])' "$T/f.json" "$ARCH")
VER=$1
if [ ! -x "$B" ] || ! "$B" version 2>/dev/null | grep -q "$VER"; then
  echo "Installing scdo-agent $VER"; curl -fsSL "$2" -o "$T/a.tgz"
  echo "$3  $T/a.tgz" | sha256sum -c --quiet - || { echo "sha256 mismatch" >&2; exit 1; }
  tar xzf "$T/a.tgz" -C "$T"; install -m 755 "$T/scdo-agent" "$B"; "$B" version >/dev/null
fi
if [ ! -x "$R/venv/bin/scdo-agent-mcp" ]; then
  echo "Installing scdo-agent-tools and scdo-agent-mcp (PyPI)"
  rm -rf "$R/venv"
  if ! python3 -m venv "$R/venv" >/dev/null 2>&1; then  # Debian/Ubuntu without python3-venv: no ensurepip
    rm -rf "$R/venv"; python3 -m venv --without-pip "$R/venv" && curl -fsSL https://bootstrap.pypa.io/get-pip.py -o "$T/get-pip.py" \
      && "$R/venv/bin/python" "$T/get-pip.py" -q --disable-pip-version-check >/dev/null || { echo "python3 venv unavailable (apt install python3-venv)" >&2; exit 1; }
  fi
  "$R/venv/bin/pip" install -q --disable-pip-version-check scdo-agent-tools scdo-agent-mcp
fi
if [ -z "$BULK" ] && { [ -n "$XH" ] || [ -n "$OPERATOR" ]; }; then  # agent-signed bind of operator/x handle via bulk.py
  printf "name,operator,platform,x_handle\n%s,%s,%s,%s\n" "$NAME" "$OPERATOR" "$PLATFORM" "$XH" > "$R/$NAME.csv"; ONE="$R/$NAME.csv"
fi
if [ -n "$BULK" ] || [ -n "${ONE:-}" ]; then
  [ -n "$BULK" ] || BULK="$ONE"
  BULK=$(cd "$(dirname "$BULK")" && pwd)/$(basename "$BULK"); [ -f "$BULK" ] || { echo "no such file: $BULK" >&2; exit 1; }
  "$R/venv/bin/python" -c 'import eth_account' 2>/dev/null || "$R/venv/bin/pip" install -q --disable-pip-version-check eth-account
  curl -fsSL https://scdo.com.au/agent/bulk.py -o "$T/bulk.py"
  echo "a836c8c58830d59669ac0670c65a8f1db6f01aed1c4dd87a173ee9579e2ad412  $T/bulk.py" | sha256sum -c --quiet - || { echo "bulk.py sha256 mismatch" >&2; exit 1; }
  install -m 600 "$T/bulk.py" "$R/bulk.py"
  [ -z "${ONE:-}" ] && exec "$R/venv/bin/python" "$R/bulk.py" "$BULK" --out "$OUT" ${BSTART:-}
  "$R/venv/bin/python" "$R/bulk.py" "$BULK" --out "$R/$NAME.out.csv" --delay 0 >/dev/null || { echo "bind failed, see $R/$NAME.out.csv" >&2; exit 1; }
fi
A() { SCDO_AGENT_MODE=user "$B" --lang en --data-dir "$D" "$@"; }
J() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2]) or "")' "$@" 2>/dev/null || true; }
if [ ! -f "$D/$NAME/meta.json" ]; then
  L="platform=$PLATFORM"; [ -z "$OPERATOR" ] || L="$L operator=$OPERATOR"
  A init --name "$NAME" --label "$L" >/dev/null
fi
chmod 700 "$D/$NAME/keys" 2>/dev/null || true; find "$D/$NAME" -type f -path "*key*" -exec chmod 600 {} +
printf 'NAME=%s\nOPERATOR=%s\nPLATFORM=%s\n' "$NAME" "$OPERATOR" "$PLATFORM" > "$R/$NAME.conf"
ADDR=$(J "$D/$NAME/meta.json" address)
if [ "$SYSTEMD" = 1 ] && systemctl --user show-environment >/dev/null 2>&1; then
  U="$HOME/.config/systemd/user"; mkdir -p "$U"
  printf '[Unit]\nDescription=SCDO bookkeeping agent (%%i)\nAfter=network-online.target\n[Service]\nEnvironment=SCDO_AGENT_MODE=user\nExecStart=%s --lang en --data-dir %s run --name %%i\nRestart=on-failure\nRestartSec=10\nNoNewPrivileges=true\n[Install]\nWantedBy=default.target\n' "$B" "$D" > "$U/scdo-agent@.service"
  systemctl --user daemon-reload; systemctl --user enable --now "scdo-agent@$NAME.service" >/dev/null 2>&1
  echo "systemd --user: scdo-agent@$NAME (run 'loginctl enable-linger $USER' to survive logout)"
elif [ "$START" = 1 ]; then
  SCDO_AGENT_MODE=user nohup "$B" --lang en --data-dir "$D" run --name "$NAME" >>"$D/$NAME/run.log" 2>&1 </dev/null &
fi
API=https://scdo.com.au/agent-ledger/api; OK=0
if [ "$START" = 1 ] || [ "$SYSTEMD" = 1 ]; then i=0; while [ $i -lt 30 ]; do
  curl -fs "$API/agents/$ADDR" | grep -q '"ok":true' && { OK=1; break; }; i=$((i+1)); sleep 2; done; fi
if [ "$OK" = 1 ] && [ ! -f "$D/$NAME/wallet.json" ]; then A wallet create --bot "$NAME" --network base >/dev/null; fi
W=$(J "$D/$NAME/wallet.json" address)
echo "SCDO agent:      $NAME"
echo "Agent address:   $ADDR"
echo "x402 USDC (Base mainnet, chain 8453): ${W:-not created yet (agent not registered; re-run when online)}"
echo "Ledger profile:  https://scdo.com.au/agent-ledger/?agent=$ADDR"
echo "Registered:      $([ $OK = 1 ] && echo yes || echo pending)"
echo "MCP server:      $R/venv/bin/scdo-agent-mcp   CLI: $B --data-dir $D"

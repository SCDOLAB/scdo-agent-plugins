#!/bin/bash
# Runs on LAN .90 as scdo, inside ~/dogfood-20261019 only. Tiny amounts (0.001 USDC each), dogfood agents A=dfa and B=dfb.
set -u
D=$HOME/dogfood-20261019; E=$D/plugins-e2e; cd $E; cp e2e_mcp.mjs e2e_eliza.mjs npm/
export SCDO_AGENT_BIN=$D/.local/bin/scdo-agent SCDO_AGENT_DATA=$D/.local/share/scdo-agent SCDO_AGENT_NETWORK=base
export PATH=$E/node/bin:$PATH
PORT=8418; PROXY=8419
for p in $PORT $PROXY; do ss -ltn | grep -q ":$p " && { echo "port $p busy"; exit 1; }; done
echo "== B serve-paywall 0.001 USDC (Base mainnet)"
timeout 1500 $SCDO_AGENT_BIN --data-dir $SCDO_AGENT_DATA serve-paywall --bot dfb --price 0.001 --network base --port $PORT > $E/paywall.log 2>&1 &
BP=$!
python3 $E/capture_proxy.py http://127.0.0.1:$PORT $PROXY $E/capture.jsonl & PP=$!
sleep 6; head -5 $E/paywall.log
URL=http://127.0.0.1:$PROXY/answer
echo; echo "######## 1. scdo-agent-mcp"; (cd $E/npm && node e2e_mcp.mjs $E/npm/node_modules/scdo-agent-mcp/bin/scdo-agent-mcp.js $URL $E/capture.jsonl); R1=$?
echo; echo "######## 2. @scdo/plugin-eliza"; (cd $E/npm && node e2e_eliza.mjs $URL $E/capture.jsonl); R2=$?
echo; echo "######## 3. scdo-agent-tools (LangChain)"; $E/venv/bin/python e2e_langchain.py $URL $E/capture.jsonl; R3=$?
sleep 10
kill $PP $BP 2>/dev/null; wait 2>/dev/null
echo; echo "== paywall log"; cat $E/paywall.log
echo "RESULT mcp=$R1 eliza=$R2 langchain=$R3"

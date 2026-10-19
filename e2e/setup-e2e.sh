#!/bin/bash
# Installs the built packages into ~/dogfood-20261019/plugins-e2e only (no system changes).
set -eu
E=$HOME/dogfood-20261019/plugins-e2e; cd $E
[ -d node ] || { tar xJf node-v22.20.0-linux-x64.tar.xz && mv node-v22.20.0-linux-x64 node; }
export PATH=$E/node/bin:$PATH
mkdir -p npm && cd npm && [ -f package.json ] || npm init -y >/dev/null
npm i --no-audit --no-fund ../scdo-agent-mcp-0.1.0.tgz ../scdo-plugin-eliza-0.1.0.tgz 2>&1 | tail -2
cd $E; [ -x uvbin/uv ] || { mkdir -p uvbin && tar xzf uv.tgz -C uvbin --strip-components=1; }
[ -d venv ] || uvbin/uv venv -q --seed -p python3 venv
uvbin/uv pip install -q -p venv/bin/python "$E/scdo_agent_tools-0.1.0-py3-none-any.whl[langchain]" 2>&1 | tail -2
node -v; venv/bin/python -c "import scdo_agent_tools, langchain_core; print('py ok', scdo_agent_tools.__version__, langchain_core.__version__)"

import { test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startStreamableHttp } from "../src/http.js";
import { PUBLIC_TOOL_NAMES, WALLET_TOOL_NAMES } from "../src/server.js";
import { LEDGER_STATS_X402_URL } from "../src/public.js";

const PAYTO = "0x105c14379874E0Ff5287a2f5214146ed1b9FC866";

function fetchImpl() {
  return async (url, init = {}) => {
    if (url === LEDGER_STATS_X402_URL && !init.headers?.["PAYMENT-SIGNATURE"]) {
      return new Response(JSON.stringify({
        x402Version: 2,
        accepts: [{ scheme: "exact", network: "eip155:8453", amount: "10000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: PAYTO }],
        extensions: { bazaar: { info: { input: { type: "http", method: "GET" } } } },
      }), { status: 402 });
    }
    if (url === "https://scdo.com.au/agent-ledger/api/health") return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (url === "https://scdo.com.au/agent-ledger/api/agents") {
      return new Response(JSON.stringify({ total: 2, online: 1, agents: [{ platform: "mcp" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ unexpected: url }), { status: 500 });
  };
}

async function listen() {
  return startStreamableHttp({ host: "127.0.0.1", port: 0, fetchImpl: fetchImpl() });
}

test("health, origin rejection, and a Streamable HTTP tools/list + paid rail call", async () => {
  const server = await listen();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/mcp/health`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.ok, true);
    assert.equal(body.transport, "streamable-http");
    assert.equal(body.mcp, "/mcp");
    assert.equal(body.walletTools, false);
    assert.equal(body.x402LedgerStats, LEDGER_STATS_X402_URL);

    const localHealth = await fetch(`${base}/health`);
    assert.equal(localHealth.status, 200);

    const forbidden = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    assert.equal(forbidden.status, 403);

    const getMcp = await fetch(`${base}/mcp`);
    assert.equal(getMcp.status, 405);

    const badHost = await new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: "127.0.0.1", port, path: "/mcp", method: "POST",
        headers: { Host: "evil.example", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", reject);
      req.end("{}");
    });
    assert.equal(badHost, 403);

    const client = new Client({ name: "t", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...PUBLIC_TOOL_NAMES].sort());
    for (const wallet of WALLET_TOOL_NAMES) assert.equal(names.includes(wallet), false);

    const quoted = await client.callTool({ name: "x402_ledger_stats", arguments: {} });
    assert.equal(quoted.isError, undefined);
    assert.equal(quoted.structuredContent.status, 402);
    assert.equal(quoted.structuredContent.payTo, PAYTO);
    assert.equal(quoted.structuredContent.amountAtomic, "10000");
    assert.equal(quoted.structuredContent.bazaar, true);

    const stats = await client.callTool({ name: "ledger_stats", arguments: {} });
    assert.equal(stats.structuredContent.agents, 2);
    assert.equal(stats.structuredContent.byPlatform.mcp, 1);

    const games = await client.callTool({ name: "games_catalog", arguments: {} });
    assert.ok(games.structuredContent.games.some((g) => g.id === "stakewheel"));

    const bad = await client.callTool({ name: "x402_quote", arguments: { url: "https://example.com/x" } });
    assert.equal(bad.isError, true);

    await client.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

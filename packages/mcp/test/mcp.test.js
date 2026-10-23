import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PUBLIC_TOOL_NAMES, WALLET_TOOL_NAMES } from "../src/server.js";

const here = dirname(fileURLToPath(import.meta.url));
test("stdio server lists wallet and public tools and runs register_agent", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "scdo-mcp-"));
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(here, "..", "bin", "scdo-agent-mcp.js")], env: { PATH: process.env.PATH, SCDO_AGENT_BIN: join(here, "fake-scdo-agent.mjs"), SCDO_AGENT_DATA: dataDir } });
  const client = new Client({ name: "t", version: "0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...PUBLIC_TOOL_NAMES, ...WALLET_TOOL_NAMES].sort());
  const r = await client.callTool({ name: "register_agent", arguments: { name: "m1", heartbeats: false } });
  assert.ok(!r.isError, JSON.stringify(r));
  assert.equal(r.structuredContent.agent, "0x12522c713D49453f0FfD98A3D16Fca7aD4671960");
  const bad = await client.callTool({ name: "pay_x402", arguments: { bot: "m1", url: "http://x/a", maxUsdc: "5" } });
  assert.ok(bad.isError);
  await client.close();
});

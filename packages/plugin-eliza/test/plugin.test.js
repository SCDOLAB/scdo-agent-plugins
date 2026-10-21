import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import plugin, { botName, payX402Action } from "../src/index.js";

const require = createRequire(import.meta.url);
const FAKE = join(dirname(require.resolve("scdo-agent-mcp/package.json")), "test", "fake-scdo-agent.mjs");

function runtime(extra = {}) {
  const data = mkdtempSync(join(tmpdir(), "eliza-"));
  const settings = { SCDO_AGENT_BIN: FAKE, SCDO_AGENT_DATA: data, ...extra };
  return { data, rt: { character: { name: "Eliza Bot" }, getSetting: (k) => settings[k], logger: { warn: (m) => { throw new Error(m); } } } };
}

test("plugin shape", () => {
  assert.equal(plugin.name, "scdo");
  assert.deepEqual(plugin.actions.map((a) => a.name), ["SCDO_REGISTER_AGENT", "SCDO_CREATE_WALLET", "SCDO_GET_BALANCE", "SCDO_PAY_X402", "SCDO_BOOK_INCOME"]);
  assert.equal(botName({ character: { name: "Eliza Bot" } }), "eliza-bot");
});

test("init registers, starts heartbeats and creates a mainnet wallet", async () => {
  const { rt, data } = runtime();
  await plugin.init({ SCDO_AGENT_AUTOSTART: "true" }, rt);
  const calls = readFileSync(join(data, "calls.log"), "utf8");
  assert.match(calls, /"init","--name","eliza-bot"/);
  assert.match(calls, /"run","--name","eliza-bot"/);
  assert.match(calls, /"wallet","create","--bot","eliza-bot","--network","base"/);
  const p = await plugin.providers[0].get(rt, {}, {});
  assert.match(p.text, /0x90306eF0Ab173FbfEf96E6CdE6fB591E0C8b1f8c/);
});

test("pay action extracts url and amount from the message", async () => {
  const { rt } = runtime();
  await plugin.init({ SCDO_AGENT_AUTOSTART: "true" }, rt);
  const said = [];
  const r = await payX402Action.handler(rt, { content: { text: "pay http://127.0.0.1:8418/answer up to 0.15 USDC" } }, {}, {}, async (c) => { said.push(c.text); return []; });
  assert.equal(r.success, true, r.error);
  assert.equal(r.data.amountUsdc, "0.100000");
  assert.match(said[0], /Transaction 0x/);
  const over = await payX402Action.handler(rt, { content: { text: "pay http://x/a up to 3 USDC" } }, {}, {});
  assert.equal(over.success, false);
});

test("vendored core matches scdo-agent-mcp core", () => {
  const a = readFileSync(new URL("../src/scdo-core.js", import.meta.url), "utf8");
  const b = readFileSync(join(dirname(require.resolve("scdo-agent-mcp/package.json")), "src", "core.js"), "utf8");
  assert.equal(a, b);
});

test("Eliza core defaultDataDir finds one-liner agents in ~/.scdo-agent/data", async () => {
  const { defaultDataDir } = await import("../src/scdo-core.js");
  const { mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const home = mkdtempSync(join(tmpdir(), "scdo-home-"));
  mkdirSync(join(home, ".scdo-agent", "data"), { recursive: true });
  assert.equal(defaultDataDir({ HOME: home }), join(home, ".scdo-agent", "data"));
});

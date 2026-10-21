import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ScdoAgent, defaultDataDir, usdcToAtomic, atomicToUsdc, checkAmount, parseNetwork, decodePayment, CAPS } from "../src/core.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fake-scdo-agent.mjs");
function mk(extra = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "scdo-"));
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes("mainnet.base.org") || url.includes("sepolia.base.org")) return new Response(JSON.stringify({ result: "0x" + (150000).toString(16).padStart(64, "0") }));
    if (url.endsWith("/ledger/income")) return new Response(JSON.stringify({ ok: true, duplicate: true, entry: { id: "e1", kind: "usdc_income", amount: "1000", asset: "USDC", tx: JSON.parse(init.body).settlement.transaction, confirmed: true } }));
    return new Response(JSON.stringify({ ok: true, summary: { balances: { USDC: { display: "0.100000" }, tUSDC: { display: "0.000000" }, WSCDO: { display: "0.0" } }, usdcWallet: "0x90306eF0Ab173FbfEf96E6CdE6fB591E0C8b1f8c", online: true, heartbeats: 3 } }));
  };
  return { dataDir, calls, agent: new ScdoAgent({ bin: FAKE, dataDir, fetch, env: { PATH: process.env.PATH, ...extra } }) };
}

test("amount helpers and caps", () => {
  assert.equal(usdcToAtomic("0.1"), 100000n);
  assert.equal(atomicToUsdc(1000n), "0.001000");
  assert.throws(() => checkAmount(999n), /cap/);
  assert.throws(() => checkAmount(1000001n), /cap/);
  assert.equal(checkAmount(CAPS.maxAtomic), 1000000n);
  assert.throws(() => usdcToAtomic("1e3"));
});

test("network defaults to mainnet, testnet optional", () => {
  assert.equal(parseNetwork(undefined), "base");
  assert.equal(parseNetwork("testnet"), "base-sepolia");
  assert.throws(() => parseNetwork("ethereum"));
  assert.equal(new ScdoAgent({ env: {} }).network, "base");
});

test("register, wallet, balance, pay flow through the CLI with --lang en and --data-dir", async () => {
  const { agent, dataDir } = mk();
  const r = await agent.registerAgent({ name: "a1", heartbeats: false });
  assert.equal(r.created, true);
  assert.equal(r.agent, "0x12522c713D49453f0FfD98A3D16Fca7aD4671960");
  assert.equal(r.role, "bookkeeping node");
  const w = await agent.createWallet({ bot: "a1" });
  assert.equal(w.network, "eip155:8453");
  assert.equal(w.wallet, "0x90306eF0Ab173FbfEf96E6CdE6fB591E0C8b1f8c");
  const b = await agent.getBalance({ bot: "a1" });
  assert.equal(b.onchainUsdc.usdc, "0.150000");
  assert.equal(b.ledger.usdc, "0.100000");
  const p = await agent.payX402({ bot: "a1", url: "http://127.0.0.1:8418/answer", maxUsdc: "0.15" });
  assert.equal(p.amountUsdc, "0.100000");
  assert.equal(p.tx, "0x" + "ab".repeat(32));
  assert.match(p.explorer, /^https:\/\/basescan\.org\/tx\//);
  assert.equal(p.capsToday.payments, 1);
  const log = readFileSync(join(dataDir, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const c of log) { assert.deepEqual(c.slice(0, 4), ["--lang", "en", "--data-dir", dataDir]); }
  const create = log.find((c) => c[4] === "wallet");
  assert.ok(create.includes("--network") && create[create.indexOf("--network") + 1] === "base");
  const real = log.filter((c) => c[4] === "pay").pop();
  assert.equal(real[real.indexOf("--max") + 1], "0.100000");
});

test("pay refuses prices outside the caps or above maxUsdc", async () => {
  const { agent } = mk({ FAKE_PRICE: "2000000" });
  await agent.registerAgent({ name: "a1", heartbeats: false });
  await assert.rejects(agent.payX402({ bot: "a1", url: "http://x/answer", maxUsdc: "1" }), /cap/);
  await assert.rejects(agent.payX402({ bot: "a1", url: "http://x/answer", maxUsdc: "2" }), /cap/);
  const { agent: a2 } = mk({ FAKE_PRICE: "200000" });
  await a2.registerAgent({ name: "a1", heartbeats: false });
  await assert.rejects(a2.payX402({ bot: "a1", url: "http://x/answer", maxUsdc: "0.10" }), /above maxUsdc/);
});

test("daily caps: 100 payments and 20 USDC", async () => {
  const { agent } = mk({ FAKE_PRICE: "1000000" });
  await agent.registerAgent({ name: "a1", heartbeats: false });
  agent.writeCaps("a1", { day: new Date().toISOString().slice(0, 10), count: 5, atomic: 19500000n });
  await assert.rejects(agent.payX402({ bot: "a1", url: "http://x/a", maxUsdc: "1" }), /20 USDC/);
  agent.writeCaps("a1", { day: new Date().toISOString().slice(0, 10), count: 100, atomic: 0n });
  await assert.rejects(agent.payX402({ bot: "a1", url: "http://x/a", maxUsdc: "1" }), /100 payments/);
});

test("testnet option passes base-sepolia to the CLI", async () => {
  const { agent, dataDir } = mk();
  await agent.registerAgent({ name: "t1", heartbeats: false });
  const w = await agent.createWallet({ bot: "t1", network: "base-sepolia" });
  assert.equal(w.network, "eip155:84532");
  assert.match(readFileSync(join(dataDir, "calls.log"), "utf8"), /"base-sepolia"/);
});

test("book_income posts payload and settlement to the ledger and enforces caps", async () => {
  const { agent, calls } = mk();
  const payload = { x402Version: 2, accepted: { scheme: "exact", network: "eip155:8453", amount: "1000", payTo: "0x7f2F5DAB6B07b32b65286252bEd2d3c6C8081599" }, payload: { authorization: { from: "0x90306eF0Ab173FbfEf96E6CdE6fB591E0C8b1f8c", value: "1000" } } };
  const tx = "0x" + "cd".repeat(32);
  const header = Buffer.from(JSON.stringify(payload)).toString("base64");
  const r = await agent.bookIncome({ agent: "0x6eFB9BaA9224b6BeE41fE7f8Fbf5C6f6b9BA563A", paymentPayload: header, settlement: tx });
  assert.equal(r.ok, true); assert.equal(r.entry.tx, tx);
  const sent = JSON.parse(calls.at(-1).init.body);
  assert.equal(sent.settlement.network, "eip155:8453");
  assert.equal(sent.settlement.payer, "0x90306eF0Ab173FbfEf96E6CdE6fB591E0C8b1f8c");
  const big = structuredClone(payload); big.accepted.amount = "5000000";
  await assert.rejects(agent.bookIncome({ agent: "0x6eFB9BaA9224b6BeE41fE7f8Fbf5C6f6b9BA563A", paymentPayload: big, settlement: tx }), /cap/);
  assert.deepEqual(decodePayment(header), payload);
});

test("missing CLI points to the docs", async () => {
  const a = new ScdoAgent({ bin: "/nonexistent/scdo-agent", dataDir: tmpdir(), env: { SCDO_AGENT_NO_DOWNLOAD: "1" } });
  await assert.rejects(a.registerAgent({ name: "x1" }), /https:\/\/scdo\.com\.au\/linux-agent\//);
});

test("heartbeats start detached", async () => {
  const { agent, dataDir } = mk();
  const r = await agent.registerAgent({ name: "h1" });
  assert.equal(r.heartbeats, "started");
  assert.ok(existsSync(join(dataDir, "h1", "plugin-run.log")));
});

test("compareVersions is numeric", async () => {
  const { compareVersions } = await import("../src/core.js");
  assert.equal(compareVersions("0.5.10", "0.5.9"), 1);
  assert.equal(compareVersions("0.5.9", "0.5.10"), -1);
  assert.equal(compareVersions("0.5.10", "0.5.10"), 0);
  assert.equal(compareVersions("0.5.10", ""), 1);
});

test("CLI upgrade check: only the self-installed copy, only when the feed is newer", async () => {
  const { writeFileSync, mkdirSync, chmodSync } = await import("node:fs");
  const home = mkdtempSync(join(tmpdir(), "scdo-home-"));
  const dir = join(home, ".scdo-agent", "bin"); mkdirSync(dir, { recursive: true });
  const own = join(dir, "scdo-agent");
  writeFileSync(own, "#!/bin/sh\necho 'scdo-agent 0.5.10'\n"); chmodSync(own, 0o755);
  const feeds = [];
  const fetch = async (url) => { feeds.push(url); return new Response(JSON.stringify({ version: "0.5.10" })); };
  const same = new ScdoAgent({ bin: own, dataDir: tmpdir(), fetch, env: { HOME: home, PATH: process.env.PATH } });
  assert.equal(await same.ensureBin(), own);
  await same.ensureBin();
  assert.equal(feeds.length, 1); // checked once per process, no download when current
  const other = new ScdoAgent({ bin: FAKE, dataDir: tmpdir(), fetch, env: { HOME: home, PATH: process.env.PATH } });
  await other.ensureBin();
  assert.equal(feeds.length, 1); // a CLI from PATH / SCDO_AGENT_BIN is never touched
  const off = new ScdoAgent({ bin: own, dataDir: tmpdir(), fetch, env: { HOME: home, SCDO_AGENT_NO_UPDATE: "1" } });
  await off.ensureBin();
  assert.equal(feeds.length, 1);
});

test("paywall on Base mainnet pays the agent's split with extra.scdoAgent", async () => {
  const { createPaywall } = await import("../src/core.js");
  const dataDir = mkdtempSync(join(tmpdir(), "scdo-"));
  const SPLIT = "0x" + "5".repeat(40); const seen = [];
  const fetch = async (url) => { seen.push(url); if (url.includes("/split/")) return new Response(JSON.stringify({ payTo: SPLIT, split: { allocations: [4000, 6000] } })); return new Response("{}"); };
  const agent = new ScdoAgent({ bin: FAKE, dataDir, fetch, env: { PATH: process.env.PATH } });
  await agent.registerAgent({ name: "pm", heartbeats: false }); await agent.createWallet({ bot: "pm", network: "base" });
  const pw = createPaywall({ bot: "pm", agent, network: "base", book: false, log: () => {} });
  const r = await pw.requirements();
  assert.equal(r.payTo, SPLIT); assert.notEqual(r.payTo, pw.wallet);
  assert.equal(r.extra.scdoAgent, agent.meta("pm").address);
  assert.equal(seen.filter((u) => u === `https://scdo.com.au/x402-base/split/${agent.meta("pm").address}`).length, 1);
});

test("defaultDataDir finds one-liner agents in ~/.scdo-agent/data", async () => {
  const { mkdirSync } = await import("node:fs");
  const home = mkdtempSync(join(tmpdir(), "scdo-home-"));
  mkdirSync(join(home, ".scdo-agent", "data"), { recursive: true });
  assert.equal(defaultDataDir({ HOME: home }), join(home, ".scdo-agent", "data"));
  mkdirSync(join(home, ".local", "share", "scdo-agent"), { recursive: true });
  assert.equal(defaultDataDir({ HOME: home }), join(home, ".local", "share", "scdo-agent"));
});

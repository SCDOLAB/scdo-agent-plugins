import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicApi, LEDGER_STATS_X402_URL, paymentHeader } from "../src/public.js";

const PAYTO = "0x105c14379874E0Ff5287a2f5214146ed1b9FC866";
const CHALLENGE = {
  x402Version: 2,
  error: "payment required",
  accepts: [{
    scheme: "exact", network: "eip155:8453", amount: "10000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: PAYTO,
  }],
  extensions: { bazaar: { info: { input: { type: "http", method: "GET" } } } },
};

function mockFetch(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch, calls };
}

test("x402_ledger_stats returns the live 402 challenge and does not send a payment", async () => {
  const { fetch, calls } = mockFetch(async (url) => {
    assert.equal(url, LEDGER_STATS_X402_URL);
    return new Response(JSON.stringify(CHALLENGE), { status: 402, headers: { "Content-Type": "application/json" } });
  });
  const api = createPublicApi({ fetch });
  const got = await api.x402LedgerStats();
  assert.equal(got.status, 402);
  assert.equal(got.paymentRequired, true);
  assert.equal(got.paid, false);
  assert.equal(got.payTo, PAYTO);
  assert.equal(got.amountAtomic, "10000");
  assert.equal(got.amountUsdc, "0.010000");
  assert.equal(got.bazaar, true);
  assert.equal(calls[0].init.headers["PAYMENT-SIGNATURE"], undefined);
});

test("x402_ledger_stats forwards a payment header and returns the paid body", async () => {
  const { fetch, calls } = mockFetch(async (url, init) => {
    assert.equal(init.headers["PAYMENT-SIGNATURE"], "sig.v2");
    assert.equal(init.headers["X-PAYMENT"], "sig.v2");
    return new Response(JSON.stringify({ ok: true, agents: { total: 3 } }), {
      status: 200,
      headers: { "PAYMENT-RESPONSE": "receipt" },
    });
  });
  const got = await createPublicApi({ fetch }).x402LedgerStats("sig.v2");
  assert.equal(got.paid, true);
  assert.equal(got.body.agents.total, 3);
  assert.equal(got.paymentResponse, "receipt");
  assert.equal(calls.length, 1);
});

test("payment header and quote URL are rejected when they are unsafe", async () => {
  assert.throws(() => paymentHeader("a\nb"), /single-line/);
  const api = createPublicApi({ fetch: async () => { throw new Error("should not fetch"); } });
  await assert.rejects(() => api.x402Quote("http://scdo.com.au/api/x402/ledger-stats"), /https/);
  await assert.rejects(() => api.x402Quote("https://example.com/pay"), /allowlist/);
  await assert.rejects(() => api.x402Quote("https://user:pw@scdo.com.au/x"), /credentials/);
  await assert.rejects(() => api.x402LedgerStats("bad\r\ninject"), /single-line/);
});

test("ledger_stats reads the public ledger, not the paid rail", async () => {
  const seen = [];
  const api = createPublicApi({
    fetch: async (url) => {
      seen.push(url);
      if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify({ total: 4, online: 1, agents: [{ platform: "x" }, { platform: "x" }] }), { status: 200 });
    },
  });
  const got = await api.ledgerStats();
  assert.equal(got.agents, 4);
  assert.deepEqual(got.byPlatform, { x: 2 });
  assert.ok(seen.every((u) => !u.includes("/api/x402/")));
});

test("live ledger-stats rail returns HTTP 402", { skip: process.env.SCDO_LIVE !== "1" }, async () => {
  const got = await createPublicApi().x402LedgerStats();
  assert.equal(got.status, 402);
  assert.equal(String(got.payTo).toLowerCase(), "0x105c14379874e0ff5287a2f5214146ed1b9fc866");
  assert.equal(got.amountAtomic, "10000");
  assert.equal(got.bazaar, true);
});

test("redirects and non-allowlisted RPC hosts are refused", async () => {
  const api = createPublicApi({
    fetch: async () => new Response("", { status: 302, headers: { Location: "http://169.254.169.254/" } }),
  });
  await assert.rejects(() => api.x402Quote(LEDGER_STATS_X402_URL), /redirect refused/);
});

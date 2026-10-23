// Key-free SCDO reads. This module never reads, sends or prints a private key.
// Outbound HTTP is limited to SCDO hosts so a public Streamable HTTP process is not an open proxy.
import { ScdoError, atomicToUsdc } from "./core.js";
import { VERSION } from "./version.js";

export const SITE = "https://scdo.com.au";
export const LEDGER = `${SITE}/agent-ledger/api`;
export const RPC = "https://apeccapital.org/rpc/{shard}";
export const RELAY = `${SITE}/x402-base`;
export const LEDGER_STATS_X402_URL = `${SITE}/api/x402/ledger-stats`;
export const UA = `scdo-agent-mcp/${VERSION}`;

const ADDR0 = /^0x[0-9a-fA-F]{40}$/;
const ADDR_CLASSIC = /^(?:[1-4]S[0-9a-fA-F]{40}|0x[0-9a-fA-F]{40})$/;
const TXHASH = /^0x[0-9a-fA-F]{64}$/;
const KEYISH = /(priv|secret|seed|mnemonic|passphrase|keystore)/i;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export const OUTBOUND_HOSTS = new Set([
  "scdo.com.au",
  "www.scdo.com.au",
  "mcp.scdo.com.au",
  "apeccapital.org",
  "www.apeccapital.org",
  "wheel.apeccapital.org",
]);

const GAMES = [
  ["stakewheel", "Stake Wheel", "/games/stakewheel/"],
  ["rocket", "Rocket", "/games/rocket/"],
  ["shard-keeper", "Shard Keeper", "/games/shard-keeper/"],
  ["shard-keeper-real", "Shard Keeper (SCDO points)", "/games/shard-keeper-real/"],
  ["kitten-boarding-party", "Kitten Boarding Party", "/games/kitten-boarding-party/"],
  ["kitten-circle", "Kitten Circle", "/games/kitten-circle/"],
  ["kitten-devil", "Kitten Devil", "/games/kitten-devil/"],
  ["kitten-drive", "Kitten Drive", "/games/kitten-drive/"],
  ["kitten-ferry", "Kitten Ferry", "/games/kitten-ferry/"],
  ["kitten-merge", "Kitten Merge", "/games/kitten-merge/"],
  ["kitten-stack", "Kitten Stack", "/games/kitten-stack/"],
  ["kitten-unbox", "Kitten Unbox", "/games/kitten-unbox/"],
  ["mast-drop", "Mast Drop", "/games/mast-drop/"],
  ["paw-crate-clear", "Paw Crate Clear", "/games/paw-crate-clear/"],
  ["rum-bottle-sort", "Rum Bottle Sort", "/games/rum-bottle-sort/"],
  ["treasure-trio", "Treasure Trio", "/games/treasure-trio/"],
  ["demo-wheel", "Captain Whiskers' Free Demo Wheel", "/play/"],
];

const CONNECT_PREFIXES = ["https://scdo.com.au/", "https://www.scdo.com.au/", "https://wheel.apeccapital.org/"];

function fail(message) {
  throw new ScdoError("public", message);
}

export function assertOutbound(url) {
  let u;
  try { u = new URL(url); } catch { fail("url is not absolute"); }
  if (u.protocol !== "https:") fail("url must be https");
  if (u.username || u.password) fail("url must not contain credentials");
  if (u.port && u.port !== "443") fail("url must use port 443");
  if (!OUTBOUND_HOSTS.has(u.hostname)) fail(`host is not on the SCDO allowlist: ${u.hostname}`);
  if (KEYISH.test(u.href)) fail("url must not carry key material");
  return u;
}

function shardOf(value) {
  const s = Number(value);
  if (!Number.isInteger(s) || s < 0 || s > 4) fail("shard must be 0..4");
  return s;
}

function headerMap(init) {
  const out = {};
  const h = init?.headers;
  if (!h) return out;
  if (typeof h.forEach === "function" && typeof h.get === "function") {
    h.forEach((v, k) => { out[String(k).toLowerCase()] = v; });
    return out;
  }
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

export function paymentHeader(value) {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 16384 || /[\r\n\0]/.test(value)) {
    fail("paymentSignature must be a single-line header value");
  }
  return value;
}

export function createPublicApi({ fetch: fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  async function request(url, { method = "GET", body, allow = [], headers = {} } = {}) {
    assertOutbound(url);
    const init = {
      method,
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers["Content-Type"] = "application/json";
    }
    let res;
    try {
      res = await fetchImpl(url, init);
    } catch (e) {
      fail(`request failed: ${e?.name || "Error"}: ${e?.message || e}`);
    }
    if (res.status >= 300 && res.status < 400) fail(`redirect refused from ${url}`);
    const raw = await res.text();
    let json;
    try { json = raw ? JSON.parse(raw) : {}; }
    catch { json = { raw: raw.slice(0, 500) }; }
    if (res.status >= 400 && !allow.includes(res.status)) {
      fail(`HTTP ${res.status} from ${url}: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return { status: res.status, json, headers: headerMap(res) };
  }

  async function rpc(shard, method, params) {
    const { json } = await request(RPC.replace("{shard}", String(shard)), {
      method: "POST",
      body: { jsonrpc: "2.0", id: 1, method, params },
    });
    if (json && json.error) fail(`shard ${shard} ${method}: ${json.error.message || JSON.stringify(json.error)}`);
    return json?.result;
  }

  function decorateAccept(a) {
    const q = { ...a };
    if (/^\d+$/.test(String(a?.amount ?? "")) && String(a?.asset || "").toLowerCase() === USDC) {
      q.amountUsdc = atomicToUsdc(BigInt(a.amount));
    }
    return q;
  }

  return {
    async blockHeight(shard) {
      const shards = shard == null ? [0, 1, 2, 3, 4] : [shardOf(shard)];
      const out = {};
      await Promise.all(shards.map(async (s) => {
        try {
          if (s === 0) {
            out["0"] = { height: Number.parseInt(await rpc(0, "eth_blockNumber", []), 16), type: "EVM (chainId 5680)" };
          } else {
            const info = await rpc(s, "scdo_getInfo", []) || {};
            out[String(s)] = {
              height: info.CurrentBlockHeight, blockAgeSec: info.BlockAge, peers: info.PeerCnt, type: "SCDO Classic",
            };
          }
        } catch (e) {
          out[String(s)] = { error: e.message };
        }
      }));
      return { shards: out, rpc: RPC };
    },

    async addressBalance(address, shard = 0) {
      const s = shardOf(shard);
      if (s === 0) {
        if (!ADDR0.test(address || "")) fail("shard 0 address must be 0x + 40 hex");
        const atomic = BigInt(await rpc(0, "eth_getBalance", [address, "latest"]));
        return { shard: 0, address, atomic: atomic.toString(), decimals: 18, SCDO: formatAtomic(atomic, 18) };
      }
      if (!ADDR_CLASSIC.test(address || "")) fail("classic address must look like 1S<40 hex> or 0x<40 hex>");
      const r = await rpc(s, "scdo_getBalance", [address, "", -1]);
      const atomic = BigInt(r?.Balance || 0);
      return { shard: s, address: r?.Account || address, atomic: atomic.toString(), decimals: 8, SCDO: formatAtomic(atomic, 8) };
    },

    async txStatus(txHash, shard = 0) {
      const s = shardOf(shard);
      if (!TXHASH.test(txHash || "")) fail("tx_hash must be 0x + 64 hex");
      if (s === 0) {
        const rc = await rpc(0, "eth_getTransactionReceipt", [txHash]);
        const tx = await rpc(0, "eth_getTransactionByHash", [txHash]);
        if (rc == null && tx == null) return { shard: 0, hash: txHash, status: "not_found" };
        if (rc == null) return { shard: 0, hash: txHash, status: "pending", tx };
        return {
          shard: 0, hash: txHash, status: rc.status === "0x1" ? "success" : "failed",
          blockNumber: Number.parseInt(rc.blockNumber, 16), from: rc.from, to: rc.to,
          valueSCDO: tx ? formatAtomic(BigInt(tx.value), 18) : null,
          gasUsed: Number.parseInt(rc.gasUsed || "0x0", 16),
        };
      }
      try {
        const rc = await rpc(s, "scdo_getReceiptByTxHash", [txHash, ""]);
        return { shard: s, hash: txHash, status: rc?.failed ? "failed" : "success", receipt: rc };
      } catch (e) {
        if (String(e.message).includes("not found")) return { shard: s, hash: txHash, status: "not_found" };
        throw e;
      }
    },

    async addressTxs(address, page = 1) {
      if (!ADDR0.test(address || "")) fail("address must be 0x + 40 hex (Shard0)");
      const p = Math.max(1, Number(page) || 1);
      const { json } = await request(`${SITE}/api/address/${address}/txs?page=${p}`);
      return json;
    },

    async ledgerStats() {
      const { json: health } = await request(`${LEDGER}/health`);
      const { json: agents } = await request(`${LEDGER}/agents`);
      const byPlatform = {};
      for (const row of agents.agents || []) {
        const key = row.platform || "unknown";
        byPlatform[key] = (byPlatform[key] || 0) + 1;
      }
      return { agents: agents.total, online: agents.online, byPlatform, health, ledger: LEDGER };
    },

    async ledgerAgents({ platform, operator, onlineOnly = false, limit = 50 } = {}) {
      const q = new URLSearchParams();
      if (platform) q.set("platform", String(platform).slice(0, 80));
      if (operator) q.set("operator", String(operator).slice(0, 80));
      const qs = q.toString();
      const { json } = await request(`${LEDGER}/agents${qs ? `?${qs}` : ""}`);
      const rows = (json.agents || []).filter((row) => row.online || !onlineOnly);
      const keep = ["agent", "online", "platform", "version", "code", "problems", "lastSeen", "label"];
      const n = Math.max(1, Math.min(Number(limit) || 50, 500));
      return {
        total: json.total, online: json.online, returned: Math.min(rows.length, n),
        agents: rows.slice(0, n).map((row) => Object.fromEntries(keep.filter((k) => k in row).map((k) => [k, row[k]]))),
      };
    },

    async ledgerAgent(address, includeBook = true) {
      if (!ADDR0.test(address || "")) fail("address must be 0x + 40 hex");
      const { status, json } = await request(`${LEDGER}/agents/${address}`, { allow: [404] });
      if (status === 404) return { found: false, address };
      const out = { found: true, ...json };
      if (includeBook) {
        const book = await request(`${LEDGER}/agents/${address}/ledger`);
        out.book = book.json;
      }
      return out;
    },

    async ledgerRegistration() {
      const { json: ledger } = await request(`${LEDGER}/erc8004`);
      const { json: mainAgent } = await request(`${SITE}/.well-known/agent-registration.json`);
      return { ledger, mainAgent };
    },

    gamesCatalog() {
      return {
        games: GAMES.map(([id, name, path]) => ({ id, name, url: SITE + path })),
        lobby: `${SITE}/games/`,
        note: "SCDO Games are free demo and SCDO points bookkeeping games. SCDO points have no fiat value.",
      };
    },

    async stakewheelDemoCommit() {
      const { json } = await request(`${SITE}/games/stakewheel/api/demo/commit`);
      return { ...json, note: "Provably-fair commit: the server seed hash is published before the spin." };
    },

    async x402Catalog(network = "base") {
      const url = network === "scdo" ? `${SITE}/x402/scdo/wallets` : `${SITE}/x402/wallets`;
      const { json } = await request(url);
      return { source: url, ...json };
    },

    async x402Quote(url) {
      assertOutbound(url);
      const { status, json } = await request(url, { allow: [402] });
      if (status !== 402) return { url, status, paymentRequired: false, body: json };
      return {
        url, status: 402, paymentRequired: true, x402Version: json.x402Version,
        resource: json.resource, accepts: (json.accepts || []).map(decorateAccept), bazaar: Boolean(json.extensions?.bazaar),
        note: "Quote only. Nothing was paid. x402_ledger_stats can forward a payment header to the live ledger-stats rail.",
      };
    },

    async x402LedgerStats(paymentSignature) {
      const sig = paymentHeader(paymentSignature);
      const headers = {};
      if (sig) {
        headers["PAYMENT-SIGNATURE"] = sig;
        headers["X-PAYMENT"] = sig;
      }
      const { status, json, headers: responseHeaders } = await request(LEDGER_STATS_X402_URL, { allow: [402], headers });
      const accepts = (json.accepts || []).map(decorateAccept);
      const out = {
        url: LEDGER_STATS_X402_URL,
        status,
        paymentRequired: status === 402,
        paid: status >= 200 && status < 300,
        x402Version: json.x402Version,
        body: json,
        note: sig
          ? "Forwarded PAYMENT-SIGNATURE and X-PAYMENT to the live SCDO rail. This server did not sign anything."
          : "Live SCDO x402 rail. Nothing was paid. Pass paymentSignature (the PAYMENT-SIGNATURE header value) to retry the same URL.",
      };
      if (status === 402) {
        out.accepts = accepts;
        out.payTo = accepts[0]?.payTo;
        out.amountAtomic = accepts[0]?.amount;
        out.amountUsdc = accepts[0]?.amountUsdc;
        out.network = accepts[0]?.network;
        out.bazaar = Boolean(json.extensions?.bazaar);
      }
      const receipt = responseHeaders["payment-response"];
      if (receipt) out.paymentResponse = receipt;
      return out;
    },

    async x402RelayStatus() {
      const { json: health } = await request(`${RELAY}/health`);
      const { json: supported } = await request(`${RELAY}/supported`);
      return { relay: `${RELAY}/`, health, supported };
    },

    async walletDownloads() {
      const out = { page: `${SITE}/downloads/wallet/` };
      for (const [key, path] of Object.entries({ windows: "latest.json", mac: "mac/latest.json", linuxAgent: "linux/latest.json" })) {
        try {
          const { json } = await request(`${SITE}/downloads/wallet/${path}`);
          out[key] = Object.fromEntries(["version", "url", "sha256", "size", "arch"].filter((k) => json[k] != null).map((k) => [k, json[k]]));
        } catch (e) {
          out[key] = { error: e.message };
        }
      }
      out.linuxInstall = `curl -fsSL ${SITE}/downloads/wallet/linux/install.sh | sh -s -- --user`;
      return out;
    },

    async inviteInfo(address) {
      let q = "";
      if (address) {
        if (!ADDR0.test(address)) fail("address must be a Shard0 0x + 40 hex address");
        q = `?address=${address}`;
      }
      const { json } = await request(`${LEDGER}/invite/status${q}`);
      const out = { status: json, invitePage: `${SITE}/invite/` };
      if (address) out.inviteLink = `${SITE}/?ref=${address}`;
      return out;
    },

    async connectStart(game, returnUrl, src = "mcp") {
      if (!CONNECT_PREFIXES.some((p) => String(returnUrl || "").startsWith(p)) || !/\.(au|org)\/(games|play)\//.test(returnUrl || "")) {
        fail("returnUrl must be an https://scdo.com.au/games/ or /play/ URL (allowlist)");
      }
      if (KEYISH.test(`${returnUrl}${game}${src}`)) fail("never send key material");
      assertOutbound(returnUrl);
      const { json } = await request(`${SITE}/play/api/demo/connect/start`, {
        method: "POST",
        body: { game, src, return_url: returnUrl, cb: returnUrl },
      });
      const nonce = json.nonce;
      json.connectUrl = nonce
        ? `${SITE}/connect?${new URLSearchParams({ game, nonce, cb: returnUrl, src, return: returnUrl })}`
        : null;
      json.next = "Open connectUrl on the phone with SCDO Wallet; the wallet returns a one-time code to returnUrl. Redeem it with connect_exchange within 300 s.";
      return json;
    },

    async connectExchange(code) {
      if (!/^[A-Za-z0-9_-]{6,128}$/.test(code || "")) fail("code must be the one-time return code");
      const { status, json } = await request(`${SITE}/play/api/demo/connect/exchange`, {
        method: "POST", body: { code }, allow: [400, 404, 410],
      });
      return { ok: status === 200, status, ...json };
    },
  };
}

function formatAtomic(atomic, dec) {
  const neg = atomic < 0n;
  const s = (neg ? -atomic : atomic).toString().padStart(dec + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, -dec)}.${s.slice(-dec)}`;
}

export const RO = { readOnlyHint: true, openWorldHint: true, destructiveHint: false };
export const OPEN = { readOnlyHint: false, openWorldHint: true, destructiveHint: false };

const addr = { description: "0x + 40 hex address" };
const shardArg = { description: "Shard 0 (EVM) through 4 (SCDO Classic). Default 0." };

/** Tool catalog shared by stdio and Streamable HTTP. `run` receives the public API and the parsed args. */
export const PUBLIC_TOOLS = [
  { name: "chain_block_height", title: "Chain block height", description: "Current block height of the SCDO chain per shard (0 = EVM Shard0, chainId 5680; 1-4 = SCDO Classic). Omit shard for all five.", annotations: RO, input: { shard: { optional: true, kind: "shard" } }, run: (api, a) => api.blockHeight(a.shard) },
  { name: "chain_address_balance", title: "Address balance", description: "Native SCDO balance of an address on one shard. Shard0 takes 0x addresses; shards 1-4 take 1S.. classic addresses.", annotations: RO, input: { address: addr, shard: { optional: true, kind: "shard" } }, run: (api, a) => api.addressBalance(a.address, a.shard) },
  { name: "chain_tx_status", title: "Transaction status", description: "Look up a transaction by hash: success, failed, pending or not_found, with block and amounts when known.", annotations: RO, input: { tx_hash: { description: "0x + 64 hex" }, shard: { optional: true, kind: "shard" } }, run: (api, a) => api.txStatus(a.tx_hash, a.shard) },
  { name: "chain_address_txs", title: "Shard0 address history", description: "Shard0 transaction history of a 0x address from the scdo.com.au explorer API (paged).", annotations: RO, input: { address: addr, page: { optional: true, kind: "page" } }, run: (api, a) => api.addressTxs(a.address, a.page) },
  { name: "ledger_stats", title: "Agent Ledger stats", description: "Agent Ledger totals from the public ledger API: registered agents, online now, count per platform, and service health. This call is not the paid x402 rail; use x402_ledger_stats for GET https://scdo.com.au/api/x402/ledger-stats.", annotations: RO, run: (api) => api.ledgerStats() },
  { name: "ledger_list_agents", title: "List ledger agents", description: "List agents on the SCDO Agent Ledger. Filter by platform or operator address.", annotations: RO, input: { platform: { optional: true }, operator: { optional: true, description: "Operator 0x address" }, onlineOnly: { optional: true, kind: "bool" }, limit: { optional: true, kind: "limit" } }, run: (api, a) => api.ledgerAgents(a) },
  { name: "ledger_get_agent", title: "Look up ledger agent", description: "One agent's Agent Ledger record and, optionally, its book (WSCDO, USDC, test USDC).", annotations: RO, input: { address: addr, includeBook: { optional: true, kind: "bool" } }, run: (api, a) => api.ledgerAgent(a.address, a.includeBook !== false) },
  { name: "ledger_registration", title: "Ledger ERC-8004 registration", description: "ERC-8004 registration documents of the Agent Ledger and of the main SCDO agent.", annotations: RO, run: (api) => api.ledgerRegistration() },
  { name: "games_catalog", title: "Games catalog", description: "SCDO Games list with play links on scdo.com.au (free demo and SCDO points bookkeeping games).", annotations: RO, run: (api) => api.gamesCatalog() },
  { name: "stakewheel_demo_commit", title: "Stake Wheel demo commit", description: "Fresh provably-fair commit (commit_id and server seed hash) for the free Stake Wheel demo.", annotations: RO, run: (api) => api.stakewheelDemoCommit() },
  { name: "x402_catalog", title: "x402 service catalog", description: "Catalog of SCDO x402 pay-to wallets and their pay URLs. network base = USDC on Base; scdo = native SCDO on Shard0.", annotations: RO, input: { network: { optional: true, kind: "catalogNet" } }, run: (api, a) => api.x402Catalog(a.network || "base") },
  { name: "x402_quote", title: "x402 price quote", description: "Read the HTTP 402 payment requirements of an allowlisted https URL (price, asset, network, payTo) without paying. Allowed hosts: scdo.com.au and apeccapital.org.", annotations: RO, input: { url: { description: "https URL on scdo.com.au or apeccapital.org" } }, run: (api, a) => api.x402Quote(a.url) },
  { name: "x402_ledger_stats", title: "Paid ledger stats rail", description: `Call the live SCDO x402 rail GET ${LEDGER_STATS_X402_URL} (Base USDC, about 0.01, payTo 0x105c14379874E0Ff5287a2f5214146ed1b9FC866). With no paymentSignature the tool returns the upstream 402 challenge and pays nothing. Pass paymentSignature to forward it as PAYMENT-SIGNATURE and X-PAYMENT. This server never holds a key and never signs.`, annotations: OPEN, input: { paymentSignature: { optional: true, max: 16384, description: "Optional PAYMENT-SIGNATURE / X-PAYMENT header value to forward. Omit to read the 402 challenge." } }, run: (api, a) => api.x402LedgerStats(a.paymentSignature) },
  { name: "x402_relay_status", title: "x402 relay status", description: "Health and supported schemes of the SCDO x402 Base settlement relay (scdo.com.au/x402-base/).", annotations: RO, run: (api) => api.x402RelayStatus() },
  { name: "wallet_downloads", title: "Wallet downloads", description: "Latest SCDO Wallet downloads (Windows, Mac) and the Linux scdo-agent, with version, URL and SHA-256.", annotations: RO, run: (api) => api.walletDownloads() },
  { name: "invite_info", title: "Invite info", description: "Invite programme status and, given a Shard0 address, that address's invite link.", annotations: RO, input: { address: { optional: true, ...addr } }, run: (api, a) => api.inviteInfo(a.address) },
  { name: "connect_start", title: "Connect: start", description: "Start an SCDO Wallet Connect flow for a game. returnUrl must be an scdo.com.au /games/ or /play/ URL. No keys are involved.", annotations: OPEN, input: { game: {}, returnUrl: { description: "https://scdo.com.au/games/... or /play/..." }, src: { optional: true } }, run: (api, a) => api.connectStart(a.game, a.returnUrl, a.src || "mcp") },
  { name: "connect_exchange", title: "Connect: exchange code", description: "Redeem the one-time return code from SCDO Wallet (valid 300 s, single use).", annotations: OPEN, input: { code: { description: "One-time return code" } }, run: (api, a) => api.connectExchange(a.code) },
];

export const PUBLIC_TOOL_NAMES = PUBLIC_TOOLS.map((t) => t.name);

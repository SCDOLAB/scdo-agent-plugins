// SCDO agent core: a thin wrapper around the scdo-agent CLI and the public Agent Ledger API.
// Keys never leave the agent's data dir. This module never reads key files and never prints secrets.
import { spawn, execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";

export const DOCS_URL = "https://scdo.com.au/linux-agent/";
export const LEDGER_URL = "https://scdo.com.au/agent-ledger/api";
export const RELAY_URL = "https://scdo.com.au/x402-base/";

export const NETWORKS = {
  base: { id: "eip155:8453", label: "Base mainnet", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", rpc: "https://mainnet.base.org" },
  "base-sepolia": { id: "eip155:84532", label: "Base Sepolia (test network)", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", rpc: "https://sepolia.base.org" },
};

// Same caps as the SCDO x402 relay: 0.001 to 1 USDC per settlement, 100 settlements and 20 USDC per day.
export const CAPS = Object.freeze({ minAtomic: 1000n, maxAtomic: 1000000n, dailyCount: 100, dailyAtomic: 20000000n });

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const TX = /0x[0-9a-fA-F]{64}/;

export class ScdoError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function parseNetwork(value) {
  const v = String(value ?? "base").trim().toLowerCase();
  if (v === "" || v === "base" || v === "mainnet" || v === "eip155:8453") return "base";
  if (v === "base-sepolia" || v === "testnet" || v === "sepolia" || v === "eip155:84532") return "base-sepolia";
  throw new ScdoError("network", `network must be "base" (mainnet) or "base-sepolia" (testnet), got ${value}`);
}

/** Decimal USDC string -> atomic bigint (6 decimals). */
export function usdcToAtomic(value) {
  const s = String(value).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new ScdoError("amount", `not a USDC amount: ${value}`);
  const [w, f = ""] = s.split(".");
  return BigInt(w) * 1000000n + BigInt((f + "000000").slice(0, 6));
}

export function atomicToUsdc(atomic) {
  const a = BigInt(atomic);
  const f = (a % 1000000n).toString().padStart(6, "0");
  return `${a / 1000000n}.${f}`;
}

export function checkAmount(atomic) {
  const a = BigInt(atomic);
  if (a < CAPS.minAtomic || a > CAPS.maxAtomic) {
    throw new ScdoError("cap", `amount ${atomicToUsdc(a)} USDC is outside the 0.001 to 1 USDC per-settlement cap`);
  }
  return a;
}

function checkName(name, field = "bot") {
  if (typeof name !== "string" || !NAME.test(name)) throw new ScdoError("name", `${field} must match ${NAME}`);
  return name;
}

function today() { return new Date().toISOString().slice(0, 10); }

export function defaultDataDir(env = process.env) {
  if (env.SCDO_AGENT_DATA && env.SCDO_AGENT_DATA.trim()) return env.SCDO_AGENT_DATA.trim();
  const user = join(env.HOME || homedir(), ".local", "share", "scdo-agent");
  if (existsSync(user) || !existsSync("/var/lib/scdo-agent")) return user;
  return "/var/lib/scdo-agent";
}

export function findBin(env = process.env) {
  if (env.SCDO_AGENT_BIN && env.SCDO_AGENT_BIN.trim()) return env.SCDO_AGENT_BIN.trim();
  const dirs = [...(env.PATH || "").split(delimiter), join(env.HOME || homedir(), ".local", "bin"), "/usr/local/bin", "/usr/bin"];
  for (const d of dirs) {
    if (d && existsSync(join(d, "scdo-agent"))) return join(d, "scdo-agent");
  }
  return null;
}

// Redact anything that looks like a private key or a long secret before it leaves this module.
export function scrub(text) {
  // The CLI never prints keys; this is a second line of defence for labelled secrets.
  return String(text ?? "")
    .replace(/(private[_ ]?key|mnemonic|seed|passphrase)\s*[:=]\s*\S+/gi, "$1: [redacted]");
}

export class ScdoAgent {
  /**
   * @param {object} [opts]
   * @param {string} [opts.bin] path to scdo-agent (default SCDO_AGENT_BIN or PATH)
   * @param {string} [opts.dataDir] agent data dir (default SCDO_AGENT_DATA or ~/.local/share/scdo-agent)
   * @param {string} [opts.network] "base" (default, mainnet) or "base-sepolia" (testnet)
   * @param {string} [opts.ledgerUrl] Agent Ledger API base
   * @param {string} [opts.passphraseFile] key passphrase file, if keys are encrypted
   * @param {Function} [opts.fetch]
   */
  constructor(opts = {}) {
    const env = opts.env || process.env;
    this.env = env;
    this.bin = opts.bin || findBin(env);
    this.dataDir = opts.dataDir || defaultDataDir(env);
    this.network = parseNetwork(opts.network || env.SCDO_AGENT_NETWORK || "base");
    this.ledgerUrl = (opts.ledgerUrl || env.SCDO_AGENT_LEDGER || LEDGER_URL).replace(/\/+$/, "");
    this.passphraseFile = opts.passphraseFile || env.SCDO_AGENT_PASSPHRASE_FILE || "";
    this.fetch = opts.fetch || globalThis.fetch;
    this.rpc = { ...Object.fromEntries(Object.entries(NETWORKS).map(([k, v]) => [k, v.rpc])), ...(opts.rpc || {}) };
    this.timeoutMs = opts.timeoutMs ?? 180000;
  }

  requireBin() {
    if (!this.bin || !existsSync(this.bin)) {
      throw new ScdoError("no_cli", `scdo-agent is not installed. Install it first: ${DOCS_URL}`);
    }
    return this.bin;
  }

  /** Run the CLI with English output and an explicit data dir. Returns {code, stdout, stderr}. */
  run(args, { timeoutMs } = {}) {
    const bin = this.requireBin();
    const full = ["--lang", "en", "--data-dir", this.dataDir, ...args];
    const env = { ...this.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
    if (this.passphraseFile) env.SCDO_AGENT_PASSPHRASE_FILE = this.passphraseFile;
    return new Promise((resolve) => {
      execFile(bin, full, { env, timeout: timeoutMs ?? this.timeoutMs, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
        const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        resolve({ code, stdout: scrub(stdout), stderr: scrub(stderr) });
      });
    });
  }

  agentDir(name) { return join(this.dataDir, checkName(name)); }

  readJSON(name, file) {
    const p = join(this.agentDir(name), file);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  }

  /** Public agent metadata (address, payout, role). Never the key. */
  meta(name) {
    const m = this.readJSON(name, "meta.json");
    if (!m) return null;
    return { name, address: m.address, payout: m.payout || null, role: m.role || null, label: m.label || null };
  }

  /** Public wallet doc fields. */
  walletDoc(name) {
    const w = this.readJSON(name, "wallet.json");
    if (!w) return null;
    return { bot: w.botId || name, address: w.address, network: w.network, maxAtomic: w.maxAtomic, dailyAtomic: w.dailyAtomic, killed: !!w.killed };
  }

  async ledgerGet(path) {
    const res = await this.fetch(this.ledgerUrl + path, { headers: { accept: "application/json", "user-agent": "scdo-agent-plugins" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ScdoError("ledger", `ledger ${res.status}: ${body.error || "error"}`);
    return body;
  }

  // ---- tools ----

  /** Create (or reuse) the agent identity and start signed heartbeats. */
  async registerAgent({ name, payout, label, heartbeats = true } = {}) {
    checkName(name, "name");
    if (payout !== undefined && payout !== null && payout !== "" && !ADDR.test(payout)) throw new ScdoError("payout", "payout must be a 0x address");
    let created = false;
    if (!this.meta(name)) {
      const args = ["init", "--name", name];
      if (payout) args.push("--payout", payout);
      if (label) args.push("--label", String(label).slice(0, 80));
      const r = await this.run(args);
      if (r.code !== 0) throw new ScdoError("init", (r.stderr || r.stdout).trim());
      created = true;
    }
    const meta = this.meta(name);
    let heartbeat = "off";
    if (heartbeats) heartbeat = await this.startHeartbeats(name);
    return { name, agent: meta.address, payout: meta.payout, role: "bookkeeping node", dataDir: this.dataDir, created, heartbeats: heartbeat, ledger: `${this.ledgerUrl}/agents/${meta.address}` };
  }

  /** Start `scdo-agent run` detached. It registers with the ledger and sends signed heartbeats. */
  async startHeartbeats(name) {
    const bin = this.requireBin();
    const dir = this.agentDir(name);
    mkdirSync(dir, { recursive: true });
    const log = openSync(join(dir, "plugin-run.log"), "a");
    const env = { ...this.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
    if (this.passphraseFile) env.SCDO_AGENT_PASSPHRASE_FILE = this.passphraseFile;
    const child = spawn(bin, ["--lang", "en", "--data-dir", this.dataDir, "run", "--name", name], { env, detached: true, stdio: ["ignore", log, log] });
    const exit = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 3000);
      child.once("exit", (code) => { clearTimeout(t); resolve(code); });
    });
    if (exit === null) { child.unref(); return "started"; }
    const tail = readFileSync(join(dir, "plugin-run.log"), "utf8").split("\n").slice(-5).join("\n");
    if (/already running/i.test(tail)) return "running";
    throw new ScdoError("heartbeat", scrub(tail.trim()) || `scdo-agent run exited ${exit}`);
  }

  /** Create or reuse the per-agent x402 wallet and bind it on the ledger. */
  async createWallet({ bot, network, maxUsdc = "0.10", dailyUsdc = "1.00" } = {}) {
    checkName(bot);
    const net = parseNetwork(network || this.network);
    const max = checkAmount(usdcToAtomic(maxUsdc));
    const daily = usdcToAtomic(dailyUsdc);
    if (daily < max || daily > CAPS.dailyAtomic) throw new ScdoError("cap", "dailyUsdc must be at least maxUsdc and at most 20 USDC");
    if (!this.meta(bot)) throw new ScdoError("not_registered", `agent ${bot} does not exist yet; call register_agent first`);
    const r = await this.run(["wallet", "create", "--bot", bot, "--network", net, "--asset", "usdc", "--max", atomicToUsdc(max), "--daily", atomicToUsdc(daily)]);
    if (r.code !== 0) throw new ScdoError("wallet", (r.stderr || r.stdout).trim());
    const doc = this.walletDoc(bot);
    const meta = this.meta(bot);
    return {
      bot, agent: meta.address, wallet: doc?.address, network: NETWORKS[net].id, networkLabel: NETWORKS[net].label,
      maxUsdc: atomicToUsdc(max), dailyUsdc: atomicToUsdc(daily),
      fundWith: `Send USDC on ${NETWORKS[net].label} to ${doc?.address}. No ETH is needed; the facilitator pays gas.`,
    };
  }

  /** On-chain USDC balance of the wallet plus the ledger balances (USDC, test USDC, SCDO). */
  async getBalance({ bot, network } = {}) {
    checkName(bot);
    const net = parseNetwork(network || this.network);
    const meta = this.meta(bot);
    if (!meta) throw new ScdoError("not_registered", `agent ${bot} not found in ${this.dataDir}`);
    const doc = this.walletDoc(bot);
    let onchain = null;
    if (doc?.address) {
      const data = "0x70a08231" + doc.address.slice(2).toLowerCase().padStart(64, "0");
      const res = await this.fetch(this.rpc[net], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: NETWORKS[net].usdc, data }, "latest"] }) });
      const j = await res.json();
      if (j.result) { const a = BigInt(j.result); onchain = { atomic: a.toString(), usdc: atomicToUsdc(a) }; }
    }
    let ledger = null;
    try {
      const s = await this.ledgerGet(`/agents/${meta.address}`);
      const b = s.summary?.balances || {};
      ledger = {
        usdc: b.USDC?.display ?? null, testUsdc: b.tUSDC?.display ?? null, scdo: b.WSCDO?.display ?? null,
        usdcWallet: s.summary?.usdcWallet ?? null, online: s.summary?.online ?? null, heartbeats: s.summary?.heartbeats ?? null,
      };
    } catch (e) { ledger = { error: e.message }; }
    return { bot, agent: meta.address, wallet: doc?.address ?? null, network: NETWORKS[net].id, onchainUsdc: onchain, ledger };
  }

  capsFile(bot) { return join(this.agentDir(bot), "plugin-caps.json"); }

  readCaps(bot) {
    try {
      const c = JSON.parse(readFileSync(this.capsFile(bot), "utf8"));
      if (c.day === today()) return { day: c.day, count: c.count | 0, atomic: BigInt(c.atomic || "0") };
    } catch { /* fresh */ }
    return { day: today(), count: 0, atomic: 0n };
  }

  writeCaps(bot, c) {
    const p = this.capsFile(bot);
    writeFileSync(p + ".tmp", JSON.stringify({ day: c.day, count: c.count, atomic: c.atomic.toString() }));
    renameSync(p + ".tmp", p);
  }

  /** Pay an x402 resource from the agent wallet, inside the relay caps. */
  async payX402({ bot, url, maxUsdc = "0.10", network } = {}) {
    checkName(bot);
    let u;
    try { u = new URL(url); } catch { throw new ScdoError("url", "url must be an http(s) URL"); }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new ScdoError("url", "url must be an http(s) URL");
    const net = parseNetwork(network || this.network);
    const max = checkAmount(usdcToAtomic(maxUsdc));
    const caps = this.readCaps(bot);
    if (caps.count >= CAPS.dailyCount) throw new ScdoError("cap", "daily cap reached: 100 payments today");
    // Preview: learn the price and payee without signing a payment.
    const dry = await this.run(["pay", url, "--bot", bot, "--network", net, "--max", atomicToUsdc(max), "--dry-run"]);
    const m = /Would pay (\d+) atomic units to (0x[0-9a-fA-F]{40})/.exec(dry.stdout);
    if (dry.code !== 0 || !m) throw new ScdoError("preview", (dry.stderr || dry.stdout).trim() || "price preview failed");
    const amount = checkAmount(BigInt(m[1]));
    if (amount > max) throw new ScdoError("cap", `price ${atomicToUsdc(amount)} USDC is above maxUsdc ${atomicToUsdc(max)}`);
    if (caps.atomic + amount > CAPS.dailyAtomic) throw new ScdoError("cap", "daily cap reached: 20 USDC today");
    const r = await this.run(["pay", url, "--bot", bot, "--network", net, "--max", atomicToUsdc(amount)]);
    const txLine = /Transaction: (\S+)/.exec(r.stdout);
    const tx = txLine ? (TX.exec(txLine[1]) || [null])[0] : null;
    if (tx) { caps.count += 1; caps.atomic += amount; this.writeCaps(bot, caps); }
    if (r.code !== 0 && !tx) throw new ScdoError(r.code === 3 ? "limit" : "pay", (r.stderr || r.stdout).trim());
    const ledger = (/Ledger: (.+)/.exec(r.stdout) || [])[1] || null;
    return {
      bot, url, network: NETWORKS[net].id, amountUsdc: atomicToUsdc(amount), payTo: m[2], tx,
      explorer: tx ? (net === "base" ? `https://basescan.org/tx/${tx}` : `https://sepolia.basescan.org/tx/${tx}`) : null,
      ledger, ok: r.code === 0, warning: r.code === 0 ? undefined : (r.stderr || "").trim(),
      capsToday: { payments: caps.count, usdc: atomicToUsdc(caps.atomic) },
    };
  }

  /**
   * Book a settled x402 payment as income on the Agent Ledger.
   * Needs the x402 PaymentPayload the payer sent and the settlement (tx hash).
   * The ledger checks the signature, the payee (the agent's bound wallet) and the on-chain receipt.
   */
  async bookIncome({ agent, bot, paymentPayload, paymentRequirements, settlement } = {}) {
    let addr = agent;
    if (!addr && bot) addr = this.meta(checkName(bot))?.address;
    if (!addr || !ADDR.test(addr)) throw new ScdoError("agent", "agent (0x address) or a local bot name is required");
    if (typeof paymentPayload === "string") paymentPayload = decodePayment(paymentPayload);
    if (!paymentPayload || typeof paymentPayload !== "object") throw new ScdoError("payload", "paymentPayload is required");
    const reqs = paymentRequirements || paymentPayload.accepted;
    if (!reqs) throw new ScdoError("payload", "paymentRequirements is required");
    const amount = reqs.amount ?? reqs.maxAmountRequired ?? paymentPayload.payload?.authorization?.value;
    if (amount !== undefined) checkAmount(BigInt(amount));
    const tx = typeof settlement === "string" ? settlement : settlement?.transaction;
    if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx)) throw new ScdoError("settlement", "settlement transaction hash is required");
    const network = (typeof settlement === "object" && settlement.network) || reqs.network;
    const body = {
      agent: addr, x402Version: paymentPayload.x402Version || 2, paymentPayload, paymentRequirements: reqs,
      settlement: { success: true, transaction: tx, network, payer: (typeof settlement === "object" && settlement.payer) || paymentPayload.payload?.authorization?.from },
    };
    let last;
    for (let i = 0; i < 6; i++) {
      const res = await this.fetch(this.ledgerUrl + "/ledger/income", { method: "POST", headers: { "content-type": "application/json", "user-agent": "scdo-agent-plugins" }, body: JSON.stringify(body) });
      last = { status: res.status, body: await res.json().catch(() => ({})) };
      if (res.ok && last.body.ok) {
        const e = last.body.entry || {};
        return { ok: true, agent: addr, duplicate: !!last.body.duplicate, entry: { id: e.id, kind: e.kind, amount: e.amount, asset: e.asset, tx: e.tx, confirmed: e.confirmed } };
      }
      if (!(last.body.error === "settlementPending" || [0, 502, 503, 504].includes(res.status))) break;
      await new Promise((r) => setTimeout(r, (i + 1) * 2000));
    }
    throw new ScdoError("ledger", `ledger ${last.status}: ${last.body.error || "error"}`);
  }
}

/** Decode an X-PAYMENT / PAYMENT-SIGNATURE header (base64 JSON) or a JSON string. */
export function decodePayment(s) {
  const t = String(s).trim();
  if (t.startsWith("{")) return JSON.parse(t);
  return JSON.parse(Buffer.from(t, "base64").toString("utf8"));
}

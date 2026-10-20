// @scdo/plugin-eliza: SCDO per-agent x402 wallet for ElizaOS agents.
// Keys stay in the local scdo-agent data dir. Docs: https://scdo.com.au/linux-agent/
import { ScdoAgent, ScdoError, CAPS, atomicToUsdc } from "./scdo-core.js";

const URL_RE = /https?:\/\/[^\s<>"')]+/i;
const USDC_RE = /(\d+(?:\.\d{1,6})?)\s*(?:usdc|\$)/i;

function setting(runtime, key, fallback) {
  const v = runtime?.getSetting?.(key) ?? process.env[key];
  return v === undefined || v === null || v === "" ? fallback : String(v);
}

export function botName(runtime) {
  const explicit = setting(runtime, "SCDO_AGENT_BOT");
  if (explicit) return explicit;
  const n = String(runtime?.character?.name || "eliza").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 64);
  return n || "eliza";
}

const cache = new WeakMap();
export function agentFor(runtime) {
  if (runtime && cache.has(runtime)) return cache.get(runtime);
  const a = new ScdoAgent({
    bin: setting(runtime, "SCDO_AGENT_BIN"),
    dataDir: setting(runtime, "SCDO_AGENT_DATA"),
    network: setting(runtime, "SCDO_AGENT_NETWORK", "base"),
    passphraseFile: setting(runtime, "SCDO_AGENT_PASSPHRASE_FILE"),
  });
  if (runtime) cache.set(runtime, a);
  return a;
}

function params(options) {
  return { ...(options || {}), ...((options && options.parameters) || {}) };
}

function action({ name, similes, description, run, text, examples = [] }) {
  return {
    name, similes, description, examples,
    validate: async () => true,
    handler: async (runtime, message, state, options, callback) => {
      try {
        const data = await run(runtime, message, params(options));
        const out = { text: text(data), data, values: data, success: true };
        if (callback) await callback({ text: out.text, actions: [name] });
        return out;
      } catch (e) {
        const msg = e instanceof ScdoError ? `${e.code}: ${e.message}` : String(e?.message || e);
        if (callback) await callback({ text: `SCDO wallet: ${msg}`, actions: [name] });
        return { success: false, error: msg, text: msg };
      }
    },
  };
}

export const registerAgentAction = action({
  name: "SCDO_REGISTER_AGENT",
  similes: ["REGISTER_SCDO_AGENT", "START_HEARTBEATS"],
  description: "Create or reuse this agent's SCDO identity as a bookkeeping node and start signed heartbeats to the Agent Ledger.",
  run: (rt, _m, p) => agentFor(rt).registerAgent({ name: p.name || botName(rt), payout: p.payout, label: p.label, heartbeats: p.heartbeats !== false }),
  text: (d) => `SCDO agent ${d.name} is registered (${d.agent}); heartbeats: ${d.heartbeats}.`,
});

export const createWalletAction = action({
  name: "SCDO_CREATE_WALLET",
  similes: ["CREATE_X402_WALLET", "SCDO_WALLET"],
  description: "Create or reuse this agent's x402 wallet (USDC on Base) and bind it on the Agent Ledger.",
  run: (rt, _m, p) => agentFor(rt).createWallet({ bot: p.bot || botName(rt), network: p.network, maxUsdc: p.maxUsdc || setting(rt, "SCDO_AGENT_MAX_USDC", "0.10"), dailyUsdc: p.dailyUsdc || setting(rt, "SCDO_AGENT_DAILY_USDC", "1.00") }),
  text: (d) => `x402 wallet ${d.wallet} on ${d.networkLabel}. ${d.fundWith}`,
});

export const getBalanceAction = action({
  name: "SCDO_GET_BALANCE",
  similes: ["SCDO_BALANCE", "WALLET_BALANCE"],
  description: "Show the agent wallet's on-chain USDC and its Agent Ledger balances (USDC, SCDO).",
  run: (rt, _m, p) => agentFor(rt).getBalance({ bot: p.bot || botName(rt), network: p.network }),
  text: (d) => `Wallet ${d.wallet}: ${d.onchainUsdc?.usdc ?? "?"} USDC on chain; ledger USDC ${d.ledger?.usdc ?? "?"}, SCDO ${d.ledger?.scdo ?? "?"}.`,
});

export const payX402Action = action({
  name: "SCDO_PAY_X402",
  similes: ["PAY_X402", "PAY_FOR_RESOURCE", "X402_PAY"],
  description: "Pay an x402 (HTTP 402) URL from the agent wallet. Caps: 0.001 to 1 USDC per payment, 100 payments and 20 USDC per day.",
  run: (rt, m, p) => {
    const t = String(m?.content?.text || "");
    const url = p.url || (URL_RE.exec(t) || [])[0];
    if (!url) throw new ScdoError("url", "no URL to pay");
    const maxUsdc = p.maxUsdc || (USDC_RE.exec(t) || [])[1] || setting(rt, "SCDO_AGENT_MAX_USDC", "0.10");
    return agentFor(rt).payX402({ bot: p.bot || botName(rt), url, maxUsdc, network: p.network });
  },
  text: (d) => `Paid ${d.amountUsdc} USDC to ${d.payTo}. Transaction ${d.tx}.`,
  examples: [[{ name: "{{user}}", content: { text: "Buy the answer at https://example.scdo.com.au/answer for up to 0.05 USDC" } }, { name: "{{agent}}", content: { text: "Paying it from my SCDO wallet.", actions: ["SCDO_PAY_X402"] } }]],
});

export const bookIncomeAction = action({
  name: "SCDO_BOOK_INCOME",
  similes: ["BOOK_X402_INCOME", "RECORD_INCOME"],
  description: "Book a settled x402 payment this agent received as income on the Agent Ledger (paymentPayload and settlement required).",
  run: (rt, _m, p) => agentFor(rt).bookIncome({ bot: p.agent ? undefined : (p.bot || botName(rt)), agent: p.agent, paymentPayload: p.paymentPayload, paymentRequirements: p.paymentRequirements, settlement: p.settlement }),
  text: (d) => `Income booked: ${d.entry.amount} atomic ${d.entry.asset} (entry ${d.entry.id}${d.duplicate ? ", already booked" : ""}).`,
});

export const walletProvider = {
  name: "SCDO_WALLET",
  description: "This agent's SCDO x402 wallet address, network and caps.",
  dynamic: true,
  get: async (runtime) => {
    const a = agentFor(runtime);
    const bot = botName(runtime);
    let doc = null;
    try { doc = a.walletDoc(bot); } catch { doc = null; }
    if (!doc) return { text: "No SCDO wallet yet. Use SCDO_REGISTER_AGENT then SCDO_CREATE_WALLET.", values: {} };
    const text = `SCDO x402 wallet ${doc.address} (${doc.network}). Caps: ${atomicToUsdc(CAPS.minAtomic)} to ${atomicToUsdc(CAPS.maxAtomic)} USDC per payment, 100 payments and 20 USDC per day.`;
    return { text, values: { scdoWallet: doc.address, scdoNetwork: doc.network }, data: doc };
  },
};

export const scdoPlugin = {
  name: "scdo",
  description: "SCDO per-agent x402 wallet: Base USDC payments, signed heartbeats and booked income on the SCDO Agent Ledger.",
  config: {
    SCDO_AGENT_BOT: process.env.SCDO_AGENT_BOT ?? null,
    SCDO_AGENT_NETWORK: process.env.SCDO_AGENT_NETWORK ?? "base",
    SCDO_AGENT_DATA: process.env.SCDO_AGENT_DATA ?? null,
    SCDO_AGENT_AUTOSTART: process.env.SCDO_AGENT_AUTOSTART ?? "true",
  },
  init: async (config, runtime) => {
    const auto = String(config?.SCDO_AGENT_AUTOSTART ?? setting(runtime, "SCDO_AGENT_AUTOSTART", "true")).toLowerCase();
    if (auto === "false" || auto === "0") return;
    const a = agentFor(runtime);
    const bot = botName(runtime);
    try {
      await a.registerAgent({ name: bot });
      if (!a.walletDoc(bot)) await a.createWallet({ bot });
    } catch (e) {
      runtime?.logger?.warn?.(`SCDO wallet not started: ${e?.message || e}`);
    }
  },
  actions: [registerAgentAction, createWalletAction, getBalanceAction, payX402Action, bookIncomeAction],
  providers: [walletProvider],
};

export default scdoPlugin;

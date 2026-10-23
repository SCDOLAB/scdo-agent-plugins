import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ScdoAgent, ScdoError, DOCS_URL } from "./core.js";
import { VERSION } from "./version.js";
import { PUBLIC_TOOLS, PUBLIC_TOOL_NAMES, createPublicApi } from "./public.js";

export { PUBLIC_TOOL_NAMES };
export const WALLET_TOOL_NAMES = ["register_agent", "create_wallet", "get_balance", "pay_x402", "book_income"];

const network = z.enum(["base", "base-sepolia"]).optional().describe('"base" = Base mainnet (default), "base-sepolia" = test network');
const bot = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/).describe("Local agent name, e.g. a1");
const usdc = z.string().regex(/^\d+(\.\d{1,6})?$/);

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}
function fail(e) {
  const msg = e instanceof ScdoError ? `${e.code}: ${e.message}` : String(e?.message || e);
  return { isError: true, content: [{ type: "text", text: msg }] };
}
const wrap = (fn) => async (args) => { try { return ok(await fn(args || {})); } catch (e) { return fail(e); } };

function zodField(spec) {
  let field;
  switch (spec.kind) {
    case "shard": field = z.number().int().min(0).max(4); break;
    case "page": field = z.number().int().min(1).max(10000); break;
    case "limit": field = z.number().int().min(1).max(500); break;
    case "bool": field = z.boolean(); break;
    case "catalogNet": field = z.enum(["base", "scdo"]); break;
    default: field = z.string().min(1).max(spec.max || 2048); break;
  }
  if (spec.description) field = field.describe(spec.description);
  return spec.optional ? field.optional() : field;
}

function registerPublic(server, fetchImpl) {
  const api = createPublicApi(fetchImpl ? { fetch: fetchImpl } : {});
  for (const tool of PUBLIC_TOOLS) {
    const config = { title: tool.title, description: tool.description, annotations: tool.annotations };
    if (tool.input) config.inputSchema = Object.fromEntries(Object.entries(tool.input).map(([k, spec]) => [k, zodField(spec)]));
    server.registerTool(tool.name, config, wrap((args) => tool.run(api, args)));
  }
}

export function createServer(agent, options = {}) {
  const includeWallet = options.includeWallet !== false;
  const resolved = agent ?? new ScdoAgent(options.fetchImpl ? { fetch: options.fetchImpl } : {});
  const server = new McpServer({ name: "scdo-agent-mcp", version: VERSION }, {
    instructions: `SCDO public chain, Agent Ledger and x402 tools, plus an optional local per-agent x402 wallet. Public tools need no key. x402_ledger_stats calls the live rail at https://scdo.com.au/api/x402/ledger-stats and never signs a payment. Wallet tools keep keys in the local data dir. Caps: 0.001 to 1 USDC per payment, 100 payments and 20 USDC per day. Docs: ${DOCS_URL}`,
  });
  registerPublic(server, options.fetchImpl);
  if (!includeWallet) return server;

  server.registerTool("register_agent", {
    title: "Register agent",
    description: "Create (or reuse) a local SCDO agent identity as a bookkeeping node and start signed heartbeats to the Agent Ledger. The key is created and kept in the local data dir.",
    inputSchema: { name: bot, payout: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe("Optional payout address"), label: z.string().max(80).optional(), heartbeats: z.boolean().optional().describe("Start heartbeats now (default true)") },
  }, wrap((a) => resolved.registerAgent(a)));

  server.registerTool("create_wallet", {
    title: "Create x402 wallet",
    description: "Create or reuse the agent's x402 wallet and bind it on the Agent Ledger. Fund it with USDC on Base; no ETH is needed.",
    inputSchema: { bot, network, maxUsdc: usdc.optional().describe("Per-payment limit, 0.001 to 1 (default 0.10)"), dailyUsdc: usdc.optional().describe("Daily limit, up to 20 (default 1.00)") },
  }, wrap((a) => resolved.createWallet(a)));

  server.registerTool("get_balance", {
    title: "Get balance",
    description: "On-chain USDC balance of the agent wallet plus the Agent Ledger balances (USDC, test USDC, SCDO).",
    inputSchema: { bot, network },
  }, wrap((a) => resolved.getBalance(a)));

  server.registerTool("pay_x402", {
    title: "Pay x402 resource",
    description: "Pay an HTTP 402 (x402) resource from the agent wallet with an EIP-3009 authorization. The facilitator pays gas. The price is previewed first and must be within maxUsdc and the caps.",
    inputSchema: { bot, url: z.string().url(), maxUsdc: usdc.optional().describe("Most you will pay, 0.001 to 1 (default 0.10)"), network },
  }, wrap((a) => resolved.payX402(a)));

  server.registerTool("book_income", {
    title: "Book income",
    description: "Book a settled x402 payment the agent received as income on the Agent Ledger. The ledger checks the signature, the payee wallet and the on-chain receipt. Booking twice is safe (duplicate).",
    inputSchema: {
      bot: bot.optional(), agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe("Agent address, if not a local bot"),
      paymentPayload: z.union([z.string(), z.record(z.string(), z.any())]).describe("x402 PaymentPayload (object, JSON, or the base64 payment header)"),
      paymentRequirements: z.record(z.string(), z.any()).optional(),
      settlement: z.union([z.string(), z.record(z.string(), z.any())]).describe("Settlement response or the transaction hash"),
    },
  }, wrap((a) => resolved.bookIncome(a)));

  return server;
}

export async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

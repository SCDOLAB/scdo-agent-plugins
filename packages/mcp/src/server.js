import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ScdoAgent, ScdoError, DOCS_URL } from "./core.js";
import { VERSION } from "./version.js";

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
const wrap = (fn) => async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };

export function createServer(agent = new ScdoAgent()) {
  const server = new McpServer({ name: "scdo-agent-mcp", version: VERSION }, {
    instructions: `SCDO per-agent x402 wallet (Base USDC and SCDO) with signed heartbeats and booked income. Keys stay in the local data dir. Caps: 0.001 to 1 USDC per payment, 100 payments and 20 USDC per day. Docs: ${DOCS_URL}`,
  });

  server.registerTool("register_agent", {
    title: "Register agent",
    description: "Create (or reuse) a local SCDO agent identity as a bookkeeping node and start signed heartbeats to the Agent Ledger. The key is created and kept in the local data dir.",
    inputSchema: { name: bot, payout: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe("Optional payout address"), label: z.string().max(80).optional(), heartbeats: z.boolean().optional().describe("Start heartbeats now (default true)") },
  }, wrap((a) => agent.registerAgent(a)));

  server.registerTool("create_wallet", {
    title: "Create x402 wallet",
    description: "Create or reuse the agent's x402 wallet and bind it on the Agent Ledger. Fund it with USDC on Base; no ETH is needed.",
    inputSchema: { bot, network, maxUsdc: usdc.optional().describe("Per-payment limit, 0.001 to 1 (default 0.10)"), dailyUsdc: usdc.optional().describe("Daily limit, up to 20 (default 1.00)") },
  }, wrap((a) => agent.createWallet(a)));

  server.registerTool("get_balance", {
    title: "Get balance",
    description: "On-chain USDC balance of the agent wallet plus the Agent Ledger balances (USDC, test USDC, SCDO).",
    inputSchema: { bot, network },
  }, wrap((a) => agent.getBalance(a)));

  server.registerTool("pay_x402", {
    title: "Pay x402 resource",
    description: "Pay an HTTP 402 (x402) resource from the agent wallet with an EIP-3009 authorization. The facilitator pays gas. The price is previewed first and must be within maxUsdc and the caps.",
    inputSchema: { bot, url: z.string().url(), maxUsdc: usdc.optional().describe("Most you will pay, 0.001 to 1 (default 0.10)"), network },
  }, wrap((a) => agent.payX402(a)));

  server.registerTool("book_income", {
    title: "Book income",
    description: "Book a settled x402 payment the agent received as income on the Agent Ledger. The ledger checks the signature, the payee wallet and the on-chain receipt. Booking twice is safe (duplicate).",
    inputSchema: {
      bot: bot.optional(), agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe("Agent address, if not a local bot"),
      paymentPayload: z.union([z.string(), z.record(z.string(), z.any())]).describe("x402 PaymentPayload (object, JSON, or the base64 payment header)"),
      paymentRequirements: z.record(z.string(), z.any()).optional(),
      settlement: z.union([z.string(), z.record(z.string(), z.any())]).describe("Settlement response or the transaction hash"),
    },
  }, wrap((a) => agent.bookIncome(a)));

  return server;
}

export async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

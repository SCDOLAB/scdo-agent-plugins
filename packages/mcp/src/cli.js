import { main as stdioMain } from "./server.js";
import { startStreamableHttp, DEFAULT_ALLOWED_HOSTS } from "./http.js";

export const HELP = `scdo-agent-mcp

  scdo-agent-mcp
      stdio MCP (local wallet tools + public SCDO tools)

  scdo-agent-mcp --http [--host 127.0.0.1] [--port 8787]
      Streamable HTTP MCP. Default bind is loopback.
      Public URL to proxy: https://scdo.com.au/mcp
      Health: http://127.0.0.1:8787/health and /mcp/health
      Wallet tools are off. Set --enable-wallet or SCDO_MCP_ENABLE_WALLET=1
      only on a private operator process (it can create local keys).

Environment: SCDO_MCP_HTTP=1, SCDO_MCP_HOST, SCDO_MCP_PORT or PORT,
SCDO_MCP_ENABLE_WALLET, SCDO_MCP_ALLOWED_HOSTS (comma-separated Host names).
`;

export function parseArgs(argv, env = process.env) {
  const out = {
    http: env.SCDO_MCP_HTTP === "1",
    host: env.SCDO_MCP_HOST || "127.0.0.1",
    port: Number(env.SCDO_MCP_PORT || env.PORT || 8787),
    includeWallet: env.SCDO_MCP_ENABLE_WALLET === "1",
    help: false,
    allowedHosts: env.SCDO_MCP_ALLOWED_HOSTS
      ? env.SCDO_MCP_ALLOWED_HOSTS.split(",").map((s) => s.trim()).filter(Boolean)
      : [...DEFAULT_ALLOWED_HOSTS],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--http") out.http = true;
    else if (a === "--stdio") out.http = false;
    else if (a === "--enable-wallet") out.includeWallet = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--host") out.host = argv[++i];
    else if (a === "--port") out.port = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.host) throw new Error("host is required");
  if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) throw new Error("port must be an integer 0..65535");
  return out;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv, env);
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!opts.http) {
    await stdioMain();
    return;
  }
  const server = await startStreamableHttp(opts);
  const addr = server.address();
  process.stderr.write(`scdo-agent-mcp ${opts.includeWallet ? "with wallet tools " : ""}listening on http://${opts.host}:${addr.port}/mcp (health /mcp/health)\n`);
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

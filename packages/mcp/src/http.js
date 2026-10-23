// Public Streamable HTTP MCP. Stateless JSON responses: one fresh server per POST,
// no session stickiness, so it can sit behind the scdo.com.au nginx proxy.
// Wallet tools stay off unless includeWallet is set. Keys are never created on the public path.
import { createServer as createHttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";
import { LEDGER_STATS_X402_URL } from "./public.js";

export const MCP_PATH = "/mcp";
export const DEFAULT_ALLOWED_HOSTS = Object.freeze([
  "127.0.0.1", "localhost", "::1", "scdo.com.au", "www.scdo.com.au", "mcp.scdo.com.au",
]);

export function headerHostname(hostHeader) {
  const raw = String(hostHeader || "").trim();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return (end === -1 ? raw : raw.slice(1, end)).toLowerCase();
  }
  return raw.replace(/:\d+$/, "").toLowerCase();
}

export function originAllowed(origin, allowedHosts = DEFAULT_ALLOWED_HOSTS) {
  if (origin == null || origin === "") return true;
  let url;
  try { url = new URL(origin); } catch { return false; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return allowedHosts.map((h) => h.toLowerCase()).includes(url.hostname.toLowerCase());
}

function sendJson(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
    "Cache-Control": "no-store",
  });
  res.end(raw);
}

function healthBody() {
  return {
    ok: true,
    name: "scdo-agent-mcp",
    version: VERSION,
    transport: "streamable-http",
    mcp: MCP_PATH,
    health: "/mcp/health",
    walletTools: false,
    x402LedgerStats: LEDGER_STATS_X402_URL,
  };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error("invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

export async function startStreamableHttp({
  host = "127.0.0.1",
  port = 8787,
  includeWallet = false,
  fetchImpl,
  agent,
  allowedHosts = DEFAULT_ALLOWED_HOSTS,
  bodyLimit = 1_000_000,
} = {}) {
  const allowed = allowedHosts.map((h) => h.toLowerCase());
  const http = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if ((req.method === "GET" || req.method === "HEAD") && (path === "/health" || path === "/mcp/health")) {
        if (req.method === "HEAD") {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end();
          return;
        }
        const body = healthBody();
        body.walletTools = includeWallet;
        sendJson(res, 200, body);
        return;
      }
      if (req.method === "GET" && path === "/") {
        sendJson(res, 200, {
          service: "scdo-agent-mcp",
          transport: "streamable-http",
          mcp: MCP_PATH,
          health: "/mcp/health",
          docs: "https://scdo.com.au/linux-agent/",
        });
        return;
      }
      if (path !== MCP_PATH) {
        sendJson(res, 404, { error: "not found", mcp: MCP_PATH, health: "/mcp/health" });
        return;
      }
      if (!originAllowed(req.headers.origin, allowed)) {
        sendJson(res, 403, { jsonrpc: "2.0", error: { code: -32000, message: "Forbidden origin" }, id: null });
        return;
      }
      const hostName = headerHostname(req.headers.host);
      if (hostName && !allowed.includes(hostName)) {
        sendJson(res, 403, { jsonrpc: "2.0", error: { code: -32000, message: "Forbidden host" }, id: null });
        return;
      }
      if (req.method !== "POST") {
        sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Streamable HTTP uses POST." }, id: null });
        return;
      }
      const parsed = await readBody(req, bodyLimit);
      const mcp = createServer(agent, { includeWallet, fetchImpl });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        Promise.resolve(transport.close()).catch(() => {});
        Promise.resolve(mcp.close()).catch(() => {});
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch (e) {
      if (!res.headersSent) {
        sendJson(res, e.status || 500, { jsonrpc: "2.0", error: { code: -32603, message: e.message || "internal error" }, id: null });
      }
    }
  });
  await new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, resolve);
  });
  return http;
}

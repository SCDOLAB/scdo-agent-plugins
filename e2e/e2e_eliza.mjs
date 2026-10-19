// E2E: run @scdo/plugin-eliza actions with a minimal runtime against the live ledger and Base mainnet.
import plugin from "@scdo/plugin-eliza";
import { readFileSync } from "node:fs";
const [, , url, capture] = process.argv;
const settings = { SCDO_AGENT_BOT: "dfa", SCDO_AGENT_AUTOSTART: "true", SCDO_AGENT_MAX_USDC: "0.20", SCDO_AGENT_DAILY_USDC: "0.50" };
const rt = { character: { name: "dfa" }, getSetting: (k) => settings[k] ?? process.env[k], logger: { warn: (m) => { console.log("WARN", m); process.exitCode = 1; } } };
await plugin.init({ SCDO_AGENT_AUTOSTART: "true" }, rt);
const prov = await plugin.providers[0].get(rt, {}, {}); console.log("== provider", prov.text);
const act = Object.fromEntries(plugin.actions.map((a) => [a.name, a]));
const run = async (n, msg, opts) => { const r = await act[n].handler(rt, { content: { text: msg } }, {}, opts, async (x) => { console.log("   say:", x.text); return []; }); console.log(`== ${n}`, r.success ? JSON.stringify(r.data) : "ERROR " + r.error); if (!r.success) process.exitCode = 1; return r.data; };
await run("SCDO_GET_BALANCE", "balance?");
const p = await run("SCDO_PAY_X402", `buy ${url} for up to 0.001 USDC`);
await new Promise((r) => setTimeout(r, 8000));
const cap = JSON.parse(readFileSync(capture, "utf8").trim().split("\n").pop());
const settlement = JSON.parse(Buffer.from(cap.response, "base64").toString());
console.log("captured settlement tx", settlement.transaction, "matches pay tx:", settlement.transaction === p?.tx);
await run("SCDO_BOOK_INCOME", "book it", { bot: "dfb", paymentPayload: cap.payment, settlement });

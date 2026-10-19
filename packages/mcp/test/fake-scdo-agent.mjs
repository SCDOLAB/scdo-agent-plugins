#!/usr/bin/env node
// Test double for the scdo-agent CLI. Writes only public files, never keys.
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
const a = process.argv.slice(2);
const get = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
const data = get("--data-dir");
appendFileSync(join(data, "calls.log"), JSON.stringify(a) + "\n");
const cmd = a[4];
if (cmd === "init") {
  const n = get("--name"); mkdirSync(join(data, n), { recursive: true });
  writeFileSync(join(data, n, "meta.json"), JSON.stringify({ address: "0x12522c713D49453f0FfD98A3D16Fca7aD4671960", payout: get("--payout") || "" }));
  console.log(`Agent ${n} is ready.`);
} else if (cmd === "wallet" && a[5] === "create") {
  const n = get("--bot");
  writeFileSync(join(data, n, "wallet.json"), JSON.stringify({ botId: n, address: "0x90306eF0Ab173FbfEf96E6CdE6fB591E0C8b1f8c", network: "eip155:8453", maxAtomic: "100000", dailyAtomic: "1000000" }));
  console.log("Bot wallet: 0x90306eF0Ab173FbfEf96E6CdE6fB591E0C8b1f8c");
} else if (cmd === "pay") {
  if (a.includes("--dry-run")) console.log(`Would pay ${process.env.FAKE_PRICE || "100000"} atomic units to 0x7f2F5DAB6B07b32b65286252bEd2d3c6C8081599.`);
  else { console.log("Bot wallet: 0x90306eF0Ab173FbfEf96E6CdE6fB591E0C8b1f8c"); console.log("Transaction: https://basescan.org/tx/0x" + "ab".repeat(32)); console.log("Ledger: booked mvf-test"); }
} else if (cmd === "run") {
  setTimeout(() => {}, 60000);
} else { console.error("usage"); process.exit(2); }

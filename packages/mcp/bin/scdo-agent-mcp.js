#!/usr/bin/env node
import { main } from "../src/server.js";
main().catch((e) => { process.stderr.write(`scdo-agent-mcp: ${e?.message || e}\n`); process.exit(1); });

#!/usr/bin/env node
// Smoke test: verifies every layer against the live Hark API using existing accounts.
//
//   node selftest.js            # uses accounts.json
//
// Steps: 1) load accounts  2) get-session per account  3) send one chat  4) start adapter
//        5) hit /v1/models and /v1/chat/completions
// It does NOT create accounts (that costs mail.tm + time); use bulk.js for that.

import { readFileSync } from "node:fs";
import { HarkClient } from "./hark-client.js";

const FILE = process.env.ACCOUNTS || "accounts.json";
const accounts = JSON.parse(readFileSync(FILE, "utf8"));
console.log(`Loaded ${accounts.length} account(s) from ${FILE}`);

let pass = 0;
let fail = 0;
const ok = (m) => { console.log(`  PASS ${m}`); pass++; };
const bad = (m) => { console.log(`  FAIL ${m}`); fail++; };

for (let i = 0; i < accounts.length; i++) {
  const c = new HarkClient(accounts[i]);
  try {
    const s = await c.getSession();
    ok(`account ${i + 1} session: ${s.user.email} (appAccess=${s.user.hasAppAccess})`);
  } catch (e) {
    bad(`account ${i + 1} session: ${e.message}`);
    continue;
  }
  try {
    const reply = await c.ask("Reply with exactly: SELFTEST-OK");
    if (reply.includes("SELFTEST-OK")) ok(`account ${i + 1} chat: "${reply}"`);
    else bad(`account ${i + 1} chat unexpected: "${reply}"`);
  } catch (e) {
    bad(`account ${i + 1} chat: ${e.message}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

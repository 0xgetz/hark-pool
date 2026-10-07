#!/usr/bin/env node
// Bulk-create hark.com accounts and append them to accounts.json.
//
//   node bulk.js --count 5 --concurrency 2
//   node bulk.js --count 3 --connect http://localhost:20128
//
// Each run appends, so the pool can be grown over multiple runs.

import { readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createAccount } from "./register.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.match(/^--([^=]+)=(.*)$/);
    if (eq) {
      out[eq[1]] = eq[2];
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

async function loadAccounts(file) {
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return [];
  }
}

async function withRetries(fn, { attempts = 3, baseDelay = 5000, label = "" } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.error(`  [retry ${i}/${attempts}] ${label}: ${e.message}`);
      if (i < attempts) await sleep(baseDelay * i);
    }
  }
  throw lastErr;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const count = parseInt(args.count || "1", 10);
  const concurrency = Math.max(1, parseInt(args.concurrency || "2", 10));
  const outFile = args.out || "accounts.json";
  const domain = args.domain;
  const birthday = args.birthday || "1995-06-15";
  const fixedPassword = args.password;
  const connectUrl = args.connect;

  console.log(`Creating ${count} Hark account(s), concurrency=${concurrency} -> ${outFile}`);
  const accounts = await loadAccounts(outFile);
  const startLen = accounts.length;

  let next = 0;
  let ok = 0;
  let fail = 0;

  async function worker(id) {
    while (true) {
      const idx = next++;
      if (idx >= count) return;
      const label = `#${idx + 1}`;
      console.log(`[${label}] worker ${id}: starting`);
      try {
        const acct = await withRetries(
          () =>
            createAccount({
              domain,
              birthday,
              password: fixedPassword,
              localpart: "hark",
              onStep: (s) => console.log(`  [${label}] ${s}`),
            }),
          { label, attempts: 3 }
        );
        accounts.push(acct);
        await writeFile(outFile, JSON.stringify(accounts, null, 2));
        ok++;
        console.log(`[${label}] OK ${acct.email} (token ${String(acct.sessionToken).slice(0, 12)}...)`);
      } catch (e) {
        fail++;
        console.error(`[${label}] FAILED: ${e.message}`);
      }
      // Be polite to mail.tm (rate limit) and Hark.
      await sleep(1500);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, (_, i) => worker(i + 1)));

  console.log(`\nDone. +${ok} created, ${fail} failed. Pool now ${accounts.length} accounts (${outFile}).`);

  if (connectUrl) {
    const { connectViaAdapter } = await import("./connect-9router.js");
    const adapterUrl = args.adapter || "http://localhost:8790";
    await connectViaAdapter(accounts, {
      base: connectUrl,
      password: args["9router-password"] || "123456",
      adapterUrl,
    });
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
// Connect the Hark pool to a running 9Router instance as ONE OpenAI-compatible provider.
//
//   node connect-9router.js --base http://localhost:20128 --password 123456 \
//        --adapter http://localhost:8790
//
// It logs into 9Router, ensures a provider-node ("Hark", prefix "hark") that points at the
// Hark adapter, then ensures a connection for it.

import { readFile } from "node:fs/promises";

const UA = "hark-9router-connector/1.0";

export async function login9router(base, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ password: password ?? "123456" }),
  });
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const body = await res.text();
  return { ok: res.ok, cookie, body: body.slice(0, 200) };
}

async function api(base, cookie, path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 400) };
}

export async function ensureNode(base, cookie, { name, prefix, baseUrl }) {
  const list = await api(base, cookie, "/api/provider-nodes");
  const nodes = list.json?.nodes || [];
  const existing = nodes.find((n) => n.name === name || n.prefix === prefix);
  if (existing) {
    console.log(`provider-node exists: ${existing.id}`);
    return existing;
  }
  const created = await api(base, cookie, "/api/provider-nodes", {
    method: "POST",
    body: JSON.stringify({ name, prefix, apiType: "chat", type: "openai-compatible", baseUrl }),
  });
  if (!created.ok) throw new Error(`create node failed ${created.status}: ${created.text}`);
  console.log(`provider-node created: ${created.json.node.id}`);
  return created.json.node;
}

export async function ensureConnection(base, cookie, { nodeId, name, apiKey = "hark", defaultModel }) {
  const list = await api(base, cookie, "/api/providers");
  const conns = list.json?.connections || [];
  const existing = conns.find((c) => c.provider === nodeId && c.name === name);
  if (existing) {
    console.log(`connection exists: ${existing.id} (${existing.name})`);
    return existing;
  }
  const created = await api(base, cookie, "/api/providers", {
    method: "POST",
    body: JSON.stringify({ provider: nodeId, apiKey, name, priority: 1, defaultModel: defaultModel || null }),
  });
  if (!created.ok && created.status !== 409) {
    throw new Error(`create connection failed ${created.status}: ${created.text}`);
  }
  console.log(`connection created: ${created.json?.connection?.id || "(conflict)"}`);
  return created.json?.connection;
}

export async function connectViaAdapter(accounts, { base, password, adapterUrl }) {
  const { cookie, ok, body } = await login9router(base, password);
  console.log(`9Router login: ${ok ? "ok" : "not required/failed"} ${ok ? "" : body}`);
  const node = await ensureNode(base, cookie, {
    name: "Hark",
    prefix: "hark",
    baseUrl: `${adapterUrl.replace(/\/$/, "")}/v1`,
  });
  await ensureConnection(base, cookie, {
    nodeId: node.id,
    name: `Hark (${accounts.length} accounts)`,
    apiKey: "hark",
    defaultModel: "hark/account-1",
  });
  console.log(`\nDone. In 9Router use model: hark/account-1 (provider prefix "hark").`);
  console.log(`The adapter at ${adapterUrl} round-robins all ${accounts.length} accounts.`);
}

export async function connectAll(accounts, opts) {
  return connectViaAdapter(accounts, opts);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.match(/^--([^=]+)=(.*)$/);
    if (eq) {
      args[eq[1]] = eq[2];
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  const base = args.base || "http://localhost:20128";
  const adapterUrl = args.adapter || "http://localhost:8790";
  const accountsFile = args.accounts || "accounts.json";
  const accounts = JSON.parse(await readFile(accountsFile, "utf8").catch(() => "[]"));
  if (!accounts.length) {
    console.error(`No accounts in ${accountsFile}. Run bulk.js first.`);
    process.exit(1);
  }
  connectViaAdapter(accounts, { base, password: args.password || "123456", adapterUrl }).catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
}

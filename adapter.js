#!/usr/bin/env node
// Hark pool -> OpenAI-compatible server.
//
//   PORT=8790 ACCOUNTS=accounts.json node adapter.js
//
// Exposes:
//   POST /v1/chat/completions   (translates to Hark send + history poll)
//   GET  /v1/models             (hark/account-1 .. hark/account-N + hark/hark)
//   GET  /health
//
// Accounts are used round-robin. A failed/expired account is skipped for a while.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { HarkClient } from "./hark-client.js";

const PORT = parseInt(process.env.PORT || "8790", 10);
const ACCOUNTS_FILE = process.env.ACCOUNTS || "accounts.json";
const COOLDOWN_MS = parseInt(process.env.COOLDOWN_MS || "60000", 10);

function loadAccounts() {
  try {
    const arr = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error(`Could not read ${ACCOUNTS_FILE}: ${e.message}`);
    return [];
  }
}

const accounts = loadAccounts();
if (!accounts.length) {
  console.error(`No accounts in ${ACCOUNTS_FILE}. Run: node bulk.js --count N`);
  process.exit(1);
}
console.log(`Loaded ${accounts.length} Hark account(s)`);

const clients = accounts.map((a) => new HarkClient(a));
const cooldownUntil = new Array(accounts.length).fill(0);
let rr = 0;

function pickClient() {
  const now = Date.now();
  for (let i = 0; i < clients.length; i++) {
    const idx = (rr + i) % clients.length;
    if (cooldownUntil[idx] <= now) {
      rr = (idx + 1) % clients.length;
      return { idx, client: clients[idx] };
    }
  }
  // all cooling down: use the one whose cooldown expires soonest
  let best = 0;
  for (let i = 1; i < cooldownUntil.length; i++) if (cooldownUntil[i] < cooldownUntil[best]) best = i;
  rr = (best + 1) % clients.length;
  return { idx: best, client: clients[best] };
}

// OpenAI messages[] -> a single prompt string for Hark.
function messagesToPrompt(messages) {
  if (!Array.isArray(messages)) return String(messages ?? "");
  const parts = [];
  for (const m of messages) {
    const role = m.role || "user";
    let content = m.content;
    if (Array.isArray(content)) {
      content = content.map((c) => (typeof c === "string" ? c : c?.text || "")).join("");
    }
    if (role === "system") parts.push(`System: ${content}`);
    else if (role === "assistant") parts.push(`Assistant: ${content}`);
    else parts.push(content);
  }
  // Hark takes one message; join the transcript so multi-turn context is preserved.
  return parts.join("\n\n").trim();
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function chatCompletion(body) {
  const prompt = messagesToPrompt(body.messages);
  const model = body.model || "hark/account-1";
  const { idx, client } = pickClient();
  try {
    const answer = await client.ask(prompt);
    return {
      id: id("chatcmpl"),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: answer },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      _hark_account: accounts[idx].email,
    };
  } catch (e) {
    // cool the account down and let the client retry against another
    cooldownUntil[idx] = Date.now() + COOLDOWN_MS;
    throw e;
  }
}

function listModels() {
  const created = Math.floor(Date.now() / 1000);
  const models = accounts.map((_, i) => ({
    id: `hark/account-${i + 1}`,
    object: "model",
    created,
    owned_by: "hark",
  }));
  models.push({ id: "hark/hark", object: "model", created, owned_by: "hark" });
  return { object: "list", data: models };
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, accounts: accounts.length });
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    return send(res, 200, listModels());
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return send(res, 400, { error: { message: "invalid JSON", type: "invalid_request_error" } });
    }

    const attempts = Math.min(3, accounts.length);
    let lastErr;
    for (let a = 0; a < attempts; a++) {
      try {
        const out = await chatCompletion(body);
        if (body.stream) {
          // Hark cannot stream incrementally; emit one SSE chunk then [DONE].
          const { choices, ...rest } = out;
          const delta = { ...rest, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: choices[0].message.content }, finish_reason: null }] };
          const done = { ...rest, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
          res.writeHead(200, { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" });
          res.write(`data: ${JSON.stringify(delta)}\n\n`);
          res.write(`data: ${JSON.stringify(done)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        return send(res, 200, out);
      } catch (e) {
        lastErr = e;
        if (e.code === "AUTH") continue; // try another account
        continue;
      }
    }
    return send(res, 502, {
      error: { message: `all Hark accounts failed: ${lastErr?.message || "unknown"}`, type: "upstream_error" },
    });
  }

  send(res, 404, { error: { message: `not found: ${req.method} ${url.pathname}` } });
});

server.listen(PORT, () => {
  console.log(`Hark OpenAI-compatible adapter on http://localhost:${PORT}`);
  console.log(`  models:  hark/account-1 .. hark/account-${accounts.length}`);
  console.log(`  test:    curl http://localhost:${PORT}/v1/models`);
});

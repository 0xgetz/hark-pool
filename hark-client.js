// Headless Hark chat client (cookie auth). One instance = one account.
//
//   const c = new HarkClient(account)
//   await c.ensureConversation()
//   const answer = await c.ask("hello")
//
// Hark's send is async: POST /api/messages/send returns {success:true}, then the
// answer is read by polling GET /api/messages/history.

const HARK = "https://hark.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Drop a trailing onboarding question ("And what should I call you?") that Hark appends
// to the model's first answer on a brand-new account.
function stripOnboarding(text) {
  return text
    .replace(/\s*(And\s+)?what should I call you\?\s*$/i, "")
    .replace(/\s*What(?:'s| is) your name\?\s*$/i, "")
    .trim();
}

export class HarkClient {
  constructor(account, { timeoutMs = 180000, pollMs = 2500 } = {}) {
    this.account = account;
    this.cookieHeader = account.cookieHeader;
    this.conversationId = account.conversationId || null;
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
  }

  headers(extra = {}) {
    return {
      "User-Agent": UA,
      Origin: HARK,
      accept: "application/json",
      cookie: this.cookieHeader,
      ...extra,
    };
  }

  async api(path, { method = "GET", body, query } = {}) {
    let url = `${HARK}${path}`;
    if (query) url += `?${new URLSearchParams(query).toString()}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      const err = new Error(`hark auth failed ${res.status}`);
      err.code = "AUTH";
      throw err;
    }
    if (!res.ok) throw new Error(`hark ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async getSession() {
    return this.api("/api/auth/get-session");
  }

  async ensureConversation() {
    if (this.conversationId) return this.conversationId;
    const list = await this.api("/api/conversations").catch(() => ({ conversations: [] }));
    const existing = (list.conversations || [])[0];
    if (existing) {
      this.conversationId = existing.id;
      await this.closeOnboarding().catch(() => {});
      return this.conversationId;
    }
    const created = await this.api("/api/conversations", {
      method: "POST",
      body: { timezone: "America/New_York" },
    });
    this.conversationId = created.conversationId;
    await this.closeOnboarding().catch(() => {});
    return this.conversationId;
  }

  // Close the guided onboarding ("What should I call you?") so prompts reach the model.
  // We first answer the pending name prompt (if any), then close the onboarding tail.
  async closeOnboarding() {
    const cid = this.conversationId;
    if (!cid) return;
    const h = await this.history().catch(() => ({ messages: [] }));
    const pending = (h.messages || []).find(
      (m) => m.role === "assistant" && m.onboarding?.awaitsReply
    );
    if (pending) {
      await this.api("/api/messages/send", {
        method: "POST",
        query: { cid },
        body: {
          timezone: "America/New_York",
          message: "Hark User",
          idempotencyKey: uuid(),
          responseMessageId: uuid(),
          conversationId: cid,
        },
      }).catch(() => {});
      await sleep(2500);
    }
    return this.api("/api/conversations/onboarding/close-tail", {
      method: "POST",
      body: { conversationId: cid },
    }).catch(() => {});
  }

  async history() {
    const cid = await this.ensureConversation();
    return this.api("/api/messages/history", { query: { conversationId: cid } });
  }

  // Send one user message and resolve with the assistant's text answer.
  async ask(message) {
    const cid = await this.ensureConversation();
    const before = await this.history().catch(() => ({ messages: [] }));
    const seen = new Set((before.messages || []).map((m) => m.id));

    await this.api("/api/messages/send", {
      method: "POST",
      query: { cid },
      body: {
        timezone: "America/New_York",
        message,
        idempotencyKey: uuid(),
        responseMessageId: uuid(),
        conversationId: cid,
      },
    });

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      await sleep(this.pollMs);
      let h;
      try {
        h = await this.history();
      } catch (e) {
        if (e.code === "AUTH") throw e;
        continue;
      }
      const fresh = (h.messages || []).filter(
        (m) => m.role === "assistant" && !seen.has(m.id) && m.content && m.content.trim()
      );
      for (const m of fresh) {
        // skip onboarding scripted bubbles ("What should I call you?")
        if (m.onboarding) {
          seen.add(m.id);
          if (m.onboarding.awaitsReply) {
            // answer the onboarding prompt so it advances, then keep waiting
            await this.api("/api/messages/send", {
              method: "POST",
              query: { cid },
              body: {
                timezone: "America/New_York",
                message: "Hark User",
                idempotencyKey: uuid(),
                responseMessageId: uuid(),
                conversationId: cid,
              },
            }).catch(() => {});
          }
          continue;
        }
        if (m.source === "send_bubble") return stripOnboarding(m.content.trim());
      }
    }
    throw new Error("timed out waiting for the Hark reply");
  }
}

export async function ask(account, message) {
  const c = new HarkClient(account);
  return c.ask(message);
}

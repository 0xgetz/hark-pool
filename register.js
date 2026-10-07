#!/usr/bin/env node
// Create ONE hark.com account headlessly and capture its session token + cookies.
//
// Flow (verified against hark.com, build release-2026.10.07.1):
//   1. mail.tm inbox
//   2. POST https://auth.hark.com/api/auth/sign-in/magic-link  { email, callbackURL }
//   3. poll mail.tm for "Your Hark sign-in link", extract the magic-link verify URL
//   4. GET the verify URL (sets session cookies, redirects to hark.com/set-password)
//   5. POST https://auth.hark.com/api/auth/set-password { newPassword }
//   6. GET  https://auth.hark.com/api/auth/get-session  -> token + cookies
//
// Usable as a module: `import { createAccount } from "./register.js"`.

import { randomBytes } from "node:crypto";

const MAILTM = "https://api.mail.tm";
const AUTH = "https://auth.hark.com/api/auth";
const HARK = "https://hark.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// mail.tm allows account creation roughly once per 60s per IP. Serialize creations
// across all workers with a shared gate so parallel bulk runs don't collide.
let mailCreateChain = Promise.resolve();
let lastMailCreate = 0;
const MAIL_CREATE_GAP_MS = 65000;

function rateLimitedCreate(fn) {
  const run = mailCreateChain.then(async () => {
    const wait = MAIL_CREATE_GAP_MS - (Date.now() - lastMailCreate);
    if (wait > 0) {
      console.error(`  [mail.tm] waiting ${Math.ceil(wait / 1000)}s for create rate limit`);
      await sleep(wait);
    }
    try {
      return await fn();
    } finally {
      lastMailCreate = Date.now();
    }
  });
  // keep the chain alive even if this attempt rejects
  mailCreateChain = run.catch(() => {});
  return run;
}

function randPassword() {
  return "Hark-" + randomBytes(9).toString("base64url") + "-92";
}

// ---- mail.tm ----------------------------------------------------------------

async function mailtmDomains() {
  const res = await fetch(`${MAILTM}/domains`, { headers: { accept: "application/json" } });
  const j = await res.json();
  const members = j["hydra:member"] || j;
  return members.filter((d) => d.isActive !== false).map((d) => d.domain);
}

export async function createMailbox({ domain, localpart } = {}) {
  const domains = await mailtmDomains();
  const dom = domain || domains[0];
  if (!dom) throw new Error("mail.tm returned no active domains");
  const user = (localpart || "hark") + randomBytes(4).toString("hex");
  const address = `${user}@${dom}`;
  const password = randomBytes(9).toString("base64url") + "aA1!";

  const res = await rateLimitedCreate(() =>
    fetch(`${MAILTM}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ address, password }),
    })
  );
  if (!res.ok && res.status !== 201) {
    const t = await res.text();
    throw new Error(`mail.tm create failed ${res.status}: ${t.slice(0, 200)}`);
  }
  const account = await res.json().catch(() => ({}));
  const token = await mailtmLogin(address, password);
  return { address, password, token, id: account.id };
}

export async function mailtmLogin(address, password) {
  const res = await fetch(`${MAILTM}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  if (!res.ok) throw new Error(`mail.tm login failed ${res.status}`);
  const j = await res.json();
  return j.token;
}

async function mailtmMessages(token) {
  const res = await fetch(`${MAILTM}/messages`, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (res.status === 429) throw new Error("mail.tm rate limit (429)");
  if (!res.ok) throw new Error(`mail.tm messages failed ${res.status}`);
  const j = await res.json();
  // mail.tm returns either a hydra collection ({"hydra:member":[...]}) or a plain array,
  // depending on the negotiated content type. Handle both.
  return Array.isArray(j) ? j : j["hydra:member"] || [];
}

async function mailtmMessage(token, id) {
  const res = await fetch(`${MAILTM}/messages/${id}`, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`mail.tm message failed ${res.status}`);
  return res.json();
}

const MAGIC_RE =
  /https:\/\/auth\.hark\.com\/api\/auth\/magic-link\/verify\?[^\s"'<>)\]]+/;

// mail.tm rate-limits the messages endpoint, so poll gently (>=15s) and retry on 429.
export async function waitForMagicLink(token, { timeoutMs = 180000, intervalMs = 15000, log = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const msgs = await mailtmMessages(token);
      log(`poll ${attempt}: ${msgs.length} message(s)`);
      for (const m of msgs) {
        if (/hark/i.test(m.from?.address || "") || /hark/i.test(m.subject || "")) {
          const full = await mailtmMessage(token, m.id).catch(() => null);
          if (!full) continue;
          const body = [
            ...(Array.isArray(full.html) ? full.html : full.html ? [full.html] : []),
            full.text || "",
          ].join("\n");
          const match = body.match(MAGIC_RE);
          if (match) return match[0].replace(/[)\]]+$/, "");
        }
      }
    } catch (e) {
      lastErr = e;
      log(`poll ${attempt}: error ${e.message}`);
      if (/429/.test(e.message)) {
        await sleep(intervalMs);
        continue;
      }
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `timed out waiting for the Hark magic-link email${lastErr ? ` (last error: ${lastErr.message})` : ""}`
  );
}

// ---- hark auth --------------------------------------------------------------

export async function requestMagicLink(email, { callbackURL = `${HARK}/set-password` } = {}) {
  const res = await fetch(`${AUTH}/sign-in/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ email, callbackURL }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`magic-link failed ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

function parseSetCookie(res) {
  const arr =
    typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const jar = {};
  for (const c of arr) {
    const [pair, ...attrs] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    jar[name] = value;
  }
  return jar;
}

function jarToHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// Replay a GET and follow redirects manually so we can harvest every Set-Cookie.
async function followGet(url, cookieJar, { maxHops = 6 } = {}) {
  let cur = url;
  for (let hop = 0; hop < maxHops; hop++) {
    const res = await fetch(cur, {
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        accept: "text/html,application/json",
        ...(Object.keys(cookieJar).length ? { cookie: jarToHeader(cookieJar) } : {}),
      },
    });
    Object.assign(cookieJar, parseSetCookie(res));
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { status: res.status, url: cur, body: "" };
      cur = new URL(loc, cur).toString();
      continue;
    }
    const body = await res.text().catch(() => "");
    return { status: res.status, url: cur, body };
  }
  return { status: 0, url: cur, body: "" };
}

export async function verifyMagicLink(verifyUrl, cookieJar = {}) {
  // The verify URL itself sets the session cookies before redirecting.
  const landing = await followGet(verifyUrl, cookieJar);
  return { landing, cookieJar };
}

export async function setPassword(cookieJar, newPassword) {
  const res = await fetch(`${AUTH}/set-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Origin: HARK,
      cookie: jarToHeader(cookieJar),
    },
    body: JSON.stringify({ newPassword }),
  });
  const text = await res.text();
  Object.assign(cookieJar, parseSetCookie(res));
  if (!res.ok) throw new Error(`set-password failed ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

// The age gate: new accounts have hasAppAccess:false / admission "age_required"
// until a birthday is submitted on PATCH /api/profile.
export async function submitBirthday(cookieJar, birthday) {
  const res = await fetch(`${HARK}/api/profile`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Origin: HARK,
      accept: "application/json",
      cookie: jarToHeader(cookieJar),
    },
    body: JSON.stringify({ updates: { birthday } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`profile/birthday failed ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

export async function getSession(cookieJar) {
  const res = await fetch(`${AUTH}/get-session`, {
    headers: {
      "User-Agent": UA,
      accept: "application/json",
      cookie: jarToHeader(cookieJar),
    },
  });
  if (!res.ok) throw new Error(`get-session failed ${res.status}`);
  const session = await res.json();
  return session;
}

// ---- orchestration ----------------------------------------------------------

export async function createAccount(opts = {}) {
  const {
    domain,
    localpart,
    password = randPassword(),
    birthday = "1995-06-15",
    onStep = () => {},
  } = opts;

  onStep("mailbox");
  const mailbox = await createMailbox({ domain, localpart });

  onStep("request-magic-link");
  await requestMagicLink(mailbox.address);

  onStep("wait-magic-link");
  const verifyUrl = await waitForMagicLink(mailbox.token, {
    log: (m) => onStep(`  ${m}`),
  });

  onStep("verify");
  const cookieJar = {};
  const { landing } = await verifyMagicLink(verifyUrl, cookieJar);

  onStep("set-password");
  await setPassword(cookieJar, password);

  onStep("birthday");
  await submitBirthday(cookieJar, birthday);

  onStep("session");
  const session = await getSession(cookieJar);
  if (!session?.user) throw new Error("no session after set-password");
  if (session.user.hasAppAccess !== true) {
    throw new Error(
      `account has no app access (admission=${JSON.stringify(session.user.admission)})`
    );
  }

  const cookies = {};
  for (const [k, v] of Object.entries(cookieJar)) {
    if (!v) continue; // drop cleared (Max-Age=0) cookies
    if (/^(hark|__Secure-hark)/i.test(k)) cookies[k] = v;
  }
  // app-access cookie may be delivered as empty on verify; ensure it is present.
  if (!cookies["__Secure-hark.access"]) cookies["__Secure-hark.access"] = "app";

  return {
    email: mailbox.address,
    password,
    userId: session.user.id,
    sessionToken: session.session?.token || null,
    sessionId: session.session?.id || null,
    expiresAt: session.session?.expiresAt || null,
    cookies,
    cookieHeader: jarToHeader(cookies),
    mailbox: { address: mailbox.address, password: mailbox.password, token: mailbox.token },
    birthday,
    region: session.user.region || "us",
    createdAt: new Date().toISOString(),
  };
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
  const onStep = (s) => console.error(`[step] ${s}`);
  createAccount({
    domain: args.domain,
    localpart: args.localpart,
    password: args.password,
    birthday: args.birthday,
    onStep,
  })
    .then((acct) => {
      console.log(JSON.stringify(acct, null, 2));
      console.error(`\nCreated ${acct.email} (password: ${acct.password})`);
    })
    .catch((e) => {
      console.error("FAILED:", e.message);
      process.exit(1);
    });
}

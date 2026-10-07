<div align="center">

<img src="assets/logo.svg" width="120" alt="hark-pool logo" />

# hark-pool

**Bulk-create Hark accounts and expose the whole pool as one OpenAI-compatible provider for 9Router.**

Headless signup · cookie-session capture · round-robin pool · zero dependencies

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](package.json)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI--compatible-6ea8fe?style=flat-square&logo=openai&logoColor=white)](https://platform.openai.com/docs/api-reference/chat)
[![9Router](https://img.shields.io/badge/integrates-9Router-8b5cf6?style=flat-square)](https://9router.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4?style=flat-square)](https://github.com/0xgetz/hark-pool/pulls)
[![Hark](https://img.shields.io/badge/upstream-hark.com-18181b?style=flat-square)](https://hark.com)

[English](README.md) · [Indonesia](docs/README.id.md) · [Español](docs/README.es.md) · [日本語](docs/README.ja.md) · [中文](docs/README.zh.md)

</div>

---

## What it is

`hark-pool` is a small, auditable toolkit that:

1. **Creates Hark accounts headlessly** — no browser. It spins up a [mail.tm](https://mail.tm)
   inbox, requests Hark's magic link, verifies it, sets a password and clears the age gate.
2. **Captures each session** — Hark uses Better-Auth **cookies** (there is no bearer token), so
   the toolkit stores `__Secure-hark.session_token` and the session id per account.
3. **Pools them behind one OpenAI endpoint** — `adapter.js` turns the cookie-based, poll-based
   Hark chat into a standard `POST /v1/chat/completions`.
4. **Wires the pool into 9Router** — one OpenAI-compatible provider-node ("Hark") that any
   CLI/IDE pointed at 9Router can use.

```
OpenAI client ──▶ 9Router :20128/v1 ──▶ provider-node "Hark"
              ──▶ adapter  :8790/v1  ──▶ round-robin N Hark accounts
              ──▶ hark.com /api/messages/{send,history}   (cookie auth)
```

> See **[STRUCTURE.md](STRUCTURE.md)** for the full topology, file map and data-flow diagrams.

---

## Why an adapter is needed

Hark's chat API is **not** OpenAI-shaped:

| Step | Hark | OpenAI |
|------|------|--------|
| Send | `POST /api/messages/send?cid=…` → `{success:true}` immediately | single call returns the answer |
| Receive | poll `GET /api/messages/history?conversationId=…` | returns inline (or SSE) |
| Auth | httpOnly cookie | `Authorization: Bearer` |

`adapter.js` hides that difference so 9Router and every downstream tool only ever see a normal
OpenAI provider. Accounts are used round-robin; a dead session is cooled down and the request
retries on another account.

---

## Requirements

- **Node.js 18+** (uses the built-in `fetch`). No `npm install`, no dependencies, no build step.
- Network access to `hark.com`, `auth.hark.com`, `api.mail.tm`, and your local 9Router.
- A running **[9Router](https://9router.com)** only for the connector step.

---

## Quick start

```bash
# 0) (optional) verify a pool you already have
node selftest.js

# 1) create accounts -> accounts.json
node bulk.js --count 5 --concurrency 2

# 2) run the OpenAI-compatible pool
PORT=8790 ACCOUNTS=accounts.json node adapter.js

# 3) install + run 9Router  (dashboard: http://localhost:20128)
npm install -g 9router && 9router
#    remote/first run: set INITIAL_PASSWORD before launching (default password: 123456)

# 4) connect Hark into 9Router
node connect-9router.js --base http://localhost:20128 --password 123456 \
     --adapter http://localhost:8790
```

Point any OpenAI client at 9Router:

```
Base URL : http://localhost:20128/v1
API Key  : <copy from the 9Router dashboard>
Model    : hark/account-1        # any hark/* model; the adapter round-robins the pool
```

---

## CLI reference

### `bulk.js`

| Flag | Default | Meaning |
|------|---------|---------|
| `--count N` | `1` | accounts to create |
| `--concurrency N` | `2` | parallel workers |
| `--out file` | `accounts.json` | output file (appended) |
| `--domain d` | first active mail.tm domain | mail.tm domain |
| `--birthday YYYY-MM-DD` | `1995-06-15` | birthday (must be 18+) |
| `--password "…"` | random | fixed Hark password (else random per account) |
| `--connect <url>` | — | run the 9Router connector afterwards |

Each run **appends** to `accounts.json`, so you can grow the pool over time. Failures retry 3×.

### `adapter.js` (environment)

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8790` | listen port |
| `ACCOUNTS` | `accounts.json` | pool file |
| `COOLDOWN_MS` | `60000` | how long a failed account is benched |

### `connect-9router.js`

| Flag | Default | Meaning |
|------|---------|---------|
| `--base` | `http://localhost:20128` | 9Router URL |
| `--password` | `123456` | 9Router dashboard password |
| `--adapter` | `http://localhost:8790` | adapter base URL |
| `--accounts` | `accounts.json` | pool file (for the connection label) |

---

## `accounts.json` shape

```json
{
  "email": "hark…@maxxspace.com",
  "password": "Hark-…",
  "userId": "f1Yz…",
  "sessionToken": "Tlsy…",
  "sessionId": "QFpj…",
  "expiresAt": "2026-11-06T11:13:11.077Z",
  "cookies": {
    "__Secure-hark.session_token": "…",
    "__Secure-hark.region": "us",
    "__Secure-hark.access": "app"
  },
  "cookieHeader": "__Secure-hark.session_token=…; __Secure-hark.region=us; __Secure-hark.access=app",
  "mailbox": { "address": "…", "password": "…", "token": "…" },
  "birthday": "1995-06-15",
  "region": "us",
  "createdAt": "2026-10-07T11:13:11.976Z"
}
```

> `accounts.json` holds live credentials and is **git-ignored**. Only `accounts.sample.json`
> (redacted) is committed.

---

## How signup works (reverse-engineered)

| # | Call | Notes |
|---|------|-------|
| 1 | `POST https://api.mail.tm/accounts` | create inbox, get address + JWT |
| 2 | `POST https://auth.hark.com/api/auth/sign-in/magic-link` `{email, callbackURL}` | → `{"status":true}` |
| 3 | poll `GET https://api.mail.tm/messages` | read "Your Hark sign-in link" |
| 4 | `GET …/magic-link/verify?token=…` | sets the session cookies |
| 5 | `POST …/set-password {newPassword}` | **requires `Origin: https://hark.com`** |
| 6 | `PATCH https://hark.com/api/profile {updates:{birthday}}` | flips `hasAppAccess` to `true` |
| 7 | `GET …/get-session` | confirms `emailVerified:true`, returns `session.token` |

**Chat:** `POST /api/messages/send?cid=…`, then poll `GET /api/messages/history?conversationId=…`
for the assistant's `send_bubble` message.

---

## Notes & limits

- Hark exposes **Claude Opus / Sonnet / Haiku** and chooses the model server-side; there is no
  chat model picker, so the adapter forwards your prompt as-is.
- **mail.tm rate limits:** ~1 account creation per 60s per IP, and reads are throttled. The bulk
  creator waits 65s between creations and polls gently.
- This uses Hark's **private web API**; it can change without notice. Treat endpoint shapes as
  unverified against future builds.
- Pooling many accounts draws on Hark's own usage meters and may trip abuse controls. Use responsibly.

---

## Contributing

Issues and pull requests are welcome. Keep the zero-dependency rule: if it isn't already in
Node 18, don't add it.

## Disclaimer

This project is unaffiliated with Hark or 9Router. It automates account creation against a
third-party service; you are responsible for complying with that service's terms of use and any
applicable law. Provided for educational and interoperability purposes.

## License

[MIT](LICENSE) © 2026 0xgetz

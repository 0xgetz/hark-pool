# Project structure

`hark-pool` is deliberately tiny and dependency-free: seven Node.js files, no `node_modules`,
no build step. This document shows how the pieces fit together and what each file owns.

---

## 1. Runtime topology

The pool sits between your OpenAI client and Hark, and is itself a provider inside 9Router.

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                    YOUR MACHINE                          │
                    │                                                          │
   OpenAI client    │   ┌─────────────┐        ┌────────────────────────────┐  │
   (Cursor / Cline  │   │  9Router     │  HTTP  │  adapter.js                │  │
    Claude Code /   ├──▶│  :20128/v1   ├───────▶│  :8790/v1                  │  │
    any SDK)        │   │             │        │                            │  │
                    │   │ provider-   │        │  round-robin over pool     │  │
                    │   │ node "Hark" │        │  ┌─────┬─────┬─────┐       │  │
                    │   └─────────────┘        │  │ a#1 │ a#2 │ a#N │       │  │
                    │                          │  └──┬──┴──┬──┴──┬──┘       │  │
                    │                          └─────┼─────┼─────┼──────────┘  │
                    └────────────────────────────────┼─────┼─────┼─────────────┘
                                                     │     │     │
                              cookie sessions        ▼     ▼     ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │                    hark.com (upstream)                   │
                    │                                                          │
                    │   POST /api/messages/send?cid=…      (job accepted)      │
                    │   GET  /api/messages/history?…       (poll the answer)   │
                    └──────────────────────────────────────────────────────────┘
```

---

## 2. File map

```
hark-pool/
├── register.js          ── 1 account:  mail.tm → magic link → verify → password → age gate
├── bulk.js              ── N accounts:  concurrency + retries, appends accounts.json
├── hark-client.js       ── 1 session:   send() + poll history  (ask() helper)
├── adapter.js           ── OpenAI API:  /v1/chat/completions  /v1/models  /health
├── connect-9router.js   ── 9Router:     provider-node + connection (idempotent)
├── selftest.js          ── verify:      session + chat for every account
├── package.json         ── scripts / bin / engines (no dependencies)
├── accounts.sample.json ── shape reference (redacted)
└── assets/  +  docs/
```

---

## 3. Signup data-flow (register.js)

Each arrow is one HTTP request; the left column is your machine, the right is upstream.

```
  register.js            mail.tm (api.mail.tm)          hark.com / auth.hark.com
      │                         │                                  │
      │  POST /accounts         │                                  │
      ├────────────────────────▶│  create inbox                    │
      │  ◀──── address + JWT ───┤                                  │
      │                         │                                  │
      │  POST /sign-in/magic-link ................................▶ │
      │  ◀........................... {"status": true}             │
      │                         │                                  │
      │  GET  /messages  (poll) │                                  │
      ├────────────────────────▶│  "Your Hark sign-in link"        │
      │  ◀── magic-link verify URL ──────────────────────────────┐ │
      │                                                          │ │
      │  GET magic-link/verify?token=… ..........................▶ │  set cookies
      │  ◀.............................. session_token cookie      │
      │                                                          │ │
      │  POST /api/auth/set-password   (Origin: hark.com) .......▶ │
      │  PATCH /api/profile            { birthday } ............▶ │  hasAppAccess = true
      │                                                          │ │
      │  GET  /api/auth/get-session .............................▶ │
      │  ◀── user + session.token + cookies ───────────────────── │
      │                                                          │ │
      ▼                                                          ▼ ▼
  accounts.json  { email, password, userId, sessionToken, cookies, cookieHeader, … }
```

---

## 4. Request data-flow (adapter.js)

```
  client ──JSON──▶ adapter                                         Hark upstream
    │              │
    │  {messages:[…]}                                               │
    │              │  messagesToPrompt()  ─┐                        │
    │              │  pickClient()        ─┼─ round-robin, cooldown │
    │              │                       ▼                        │
    │              │  POST /api/messages/send?cid=…  ────────────▶ │  {success:true}
    │              │  GET  /api/messages/history?…   ────────────▶ │  …
    │              │  (poll every 2.5s until send_bubble) ───────▶ │  assistant text
    │              │                       │                        │
    │  ◀── JSON ───┴── chat.completion ─────┘                        │
    │      (or one SSE chunk + [DONE] if stream:true)               │
```

On a failed account the adapter marks it cooling-down and retries another account
(up to 3 attempts), so one dead session never fails the whole pool.

---

## 5. State & lifecycle

| State | Where | Lifetime |
|-------|-------|----------|
| Hark session cookie | `accounts.json` → `cookieHeader` | ~30 days (Hark `Max-Age`) |
| Conversation per account | created lazily by `hark-client.js` | until archived |
| Account cooldown | in-memory in `adapter.js` | `COOLDOWN_MS` (default 60s) |
| mail.tm inbox | mail.tm servers | for signup verification only |

---

## 6. No-dependency rule

There is **no `npm install`**: everything uses the Node 18+ built-in `fetch`, `http` and `fs`.
That is what makes the whole toolkit auditable in one sitting and portable to any box with Node.

<div align="center">

<img src="../assets/logo.svg" width="120" alt="hark-pool 标志" />

# hark-pool

**批量创建 Hark 账号，并将整个账号池作为 9Router 的单一 OpenAI 兼容提供者对外暴露。**

无头注册 · 会话 Cookie 捕获 · 轮询池 · 零依赖

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](../LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](../package.json)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI--compatible-6ea8fe?style=flat-square&logo=openai&logoColor=white)](https://platform.openai.com/docs/api-reference/chat)
[![9Router](https://img.shields.io/badge/integrates-9Router-8b5cf6?style=flat-square)](https://9router.com)

[English](../README.md) · [Indonesia](README.id.md) · [Español](README.es.md) · [日本語](README.ja.md) · [中文](README.zh.md)

</div>

---

## 这是什么

`hark-pool` 是一套小巧、易于审计的工具集：

1. **无头创建 Hark 账号** — 无需浏览器。它会创建 [mail.tm](https://mail.tm) 邮箱、请求 Hark
   魔法链接、完成验证、设置密码并通过年龄门槛。
2. **捕获每个会话** — Hark 使用 Better-Auth 的 **Cookie**（没有 Bearer token），因此按账号保存
   `__Secure-hark.session_token` 和会话 ID。
3. **将它们汇聚在一个 OpenAI 端点之后** — `adapter.js` 把基于 Cookie 与轮询的 Hark 聊天转换为
   标准的 `POST /v1/chat/completions`。
4. **把账号池接入 9Router** — 创建一个 OpenAI 兼容的 provider-node（"Hark"），指向 9Router 的
   任意 CLI/IDE 都能使用。

```
OpenAI 客户端 ──▶ 9Router :20128/v1 ──▶ provider-node "Hark"
              ──▶ adapter  :8790/v1  ──▶ 轮询 N 个 Hark 账号
              ──▶ hark.com /api/messages/{send,history}   (Cookie 认证)
```

> 完整的拓扑、文件地图和数据流图请见 **[STRUCTURE.md](../STRUCTURE.md)**。

---

## 为什么需要适配器

Hark 的聊天 API **并非** OpenAI 形态：

| 步骤 | Hark | OpenAI |
|------|------|--------|
| 发送 | `POST /api/messages/send?cid=…` → 立即返回 `{success:true}` | 一次调用即返回答案 |
| 接收 | 轮询 `GET /api/messages/history?conversationId=…` | 内联返回（或 SSE） |
| 认证 | httpOnly Cookie | `Authorization: Bearer` |

`adapter.js` 屏蔽了这些差异，因此 9Router 及其下游所有工具只会看到一个普通的 OpenAI 提供者。
账号以轮询方式使用；失效的会话会被冷却，请求会在另一个账号上重试。

---

## 要求

- **Node.js 18+**（使用内置 `fetch`）。无需 `npm install`，无依赖，无构建步骤。
- 可访问 `hark.com`、`auth.hark.com`、`api.mail.tm` 以及你本地的 9Router。
- 仅在连接器步骤需要运行中的 **[9Router](https://9router.com)**。

---

## 快速开始

```bash
# 0)（可选）验证已有账号池
node selftest.js

# 1) 创建账号 -> accounts.json
node bulk.js --count 5 --concurrency 2

# 2) 运行 OpenAI 兼容账号池
PORT=8790 ACCOUNTS=accounts.json node adapter.js

# 3) 安装并运行 9Router（面板：http://localhost:20128）
npm install -g 9router && 9router
#    远程/首次：启动前设置 INITIAL_PASSWORD（默认密码：123456）

# 4) 将 Hark 接入 9Router
node connect-9router.js --base http://localhost:20128 --password 123456 \
     --adapter http://localhost:8790
```

将任意 OpenAI 客户端指向 9Router：

```
Base URL : http://localhost:20128/v1
API Key  : <从 9Router 面板复制>
Model    : hark/account-1        # 任意 hark/* 模型；适配器轮询账号池
```

---

## CLI 参考

### `bulk.js`

| 参数 | 默认 | 含义 |
|------|------|------|
| `--count N` | `1` | 创建的账号数 |
| `--concurrency N` | `2` | 并行 worker 数 |
| `--out file` | `accounts.json` | 输出文件（追加） |
| `--domain d` | 首个可用 mail.tm 域名 | mail.tm 域名 |
| `--birthday YYYY-MM-DD` | `1995-06-15` | 生日（须满 18 岁） |
| `--password "…"` | 随机 | 固定的 Hark 密码（否则每账号随机） |
| `--connect <url>` | — | 创建后运行 9Router 连接器 |

每次运行都会**追加**到 `accounts.json`。失败会重试 3 次。

### `adapter.js`（环境变量）

| 变量 | 默认 | 含义 |
|------|------|------|
| `PORT` | `8790` | 监听端口 |
| `ACCOUNTS` | `accounts.json` | 账号池文件 |
| `COOLDOWN_MS` | `60000` | 失效账号的冷却时间 |

### `connect-9router.js`

| 参数 | 默认 | 含义 |
|------|------|------|
| `--base` | `http://localhost:20128` | 9Router 地址 |
| `--password` | `123456` | 9Router 面板密码 |
| `--adapter` | `http://localhost:8790` | 适配器基础地址 |
| `--accounts` | `accounts.json` | 账号池文件（用于连接标签） |

---

## `accounts.json` 结构

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

> `accounts.json` 含有有效凭证，已被 **git 忽略**。仅提交脱敏后的
> `accounts.sample.json`。

---

## 注册流程（逆向所得）

| # | 调用 | 说明 |
|---|------|------|
| 1 | `POST https://api.mail.tm/accounts` | 创建邮箱，获得地址 + JWT |
| 2 | `POST https://auth.hark.com/api/auth/sign-in/magic-link` `{email, callbackURL}` | → `{"status":true}` |
| 3 | 轮询 `GET https://api.mail.tm/messages` | 读取 "Your Hark sign-in link" |
| 4 | `GET …/magic-link/verify?token=…` | 设置会话 Cookie |
| 5 | `POST …/set-password {newPassword}` | **需要 `Origin: https://hark.com`** |
| 6 | `PATCH https://hark.com/api/profile {updates:{birthday}}` | 将 `hasAppAccess` 置为 `true` |
| 7 | `GET …/get-session` | 确认 `emailVerified:true`，返回 `session.token` |

**聊天：** `POST /api/messages/send?cid=…`，然后轮询
`GET /api/messages/history?conversationId=…` 获取助手的 `send_bubble` 消息。

---

## 注意事项与限制

- Hark 提供 **Claude Opus / Sonnet / Haiku**，并由服务端选择模型；聊天界面没有模型选择器，
  因此适配器会原样转发你的提示。
- **mail.tm 速率限制：** 每个 IP 约每 60 秒只能创建 1 个账号，读取也受限。批量创建器在两次创建
  之间等待 65 秒，并温和地轮询。
- 本项目使用 Hark 的**私有 Web API**，可能随时变动。
- 汇集大量账号会消耗 Hark 自身的使用额度，并可能触发滥用控制。

---

## 贡献

欢迎提交 issue 和 pull request。请遵守零依赖原则：如果 Node 18 不自带，就不要引入。

## 免责声明

本项目与 Hark 或 9Router 均无关联。你有责任遵守第三方的服务条款及适用法律。仅供学习与互操作
之用。

## 许可证

[MIT](../LICENSE) © 2026 0xgetz

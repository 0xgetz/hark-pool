<div align="center">

<img src="../assets/logo.svg" width="120" alt="logotipo de hark-pool" />

# hark-pool

**Crea cuentas de Hark en masa y expón todo el pool como un único proveedor compatible con OpenAI para 9Router.**

Registro headless · captura de cookies de sesión · pool round-robin · sin dependencias

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](../LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](../package.json)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI--compatible-6ea8fe?style=flat-square&logo=openai&logoColor=white)](https://platform.openai.com/docs/api-reference/chat)
[![9Router](https://img.shields.io/badge/integrates-9Router-8b5cf6?style=flat-square)](https://9router.com)

[English](../README.md) · [Indonesia](README.id.md) · [Español](README.es.md) · [日本語](README.ja.md) · [中文](README.zh.md)

</div>

---

## Qué es

`hark-pool` es un conjunto de herramientas pequeño y auditable que:

1. **Crea cuentas de Hark sin navegador (headless)** — levanta un buzón de [mail.tm](https://mail.tm),
   pide el enlace mágico de Hark, lo verifica, define una contraseña y supera la verificación de edad.
2. **Captura cada sesión** — Hark usa **cookies** de Better-Auth (no hay bearer token), así que
   guarda `__Secure-hark.session_token` y el id de sesión por cuenta.
3. **Agrupa todo tras un endpoint OpenAI** — `adapter.js` convierte el chat de Hark (cookies +
   polling) en un `POST /v1/chat/completions` estándar.
4. **Conecta el pool a 9Router** — un único provider-node compatible con OpenAI ("Hark") que
   cualquier CLI/IDE apuntado a 9Router puede usar.

```
Cliente OpenAI ──▶ 9Router :20128/v1 ──▶ provider-node "Hark"
               ──▶ adapter  :8790/v1  ──▶ round-robin de N cuentas Hark
               ──▶ hark.com /api/messages/{send,history}   (auth por cookie)
```

> Consulta **[STRUCTURE.md](../STRUCTURE.md)** para la topología completa, el mapa de archivos y los diagramas de flujo.

---

## Por qué hace falta un adaptador

La API de chat de Hark **no** tiene forma de OpenAI:

| Paso | Hark | OpenAI |
|------|------|--------|
| Enviar | `POST /api/messages/send?cid=…` → `{success:true}` al instante | una llamada devuelve la respuesta |
| Recibir | polling a `GET /api/messages/history?conversationId=…` | se devuelve en línea (o SSE) |
| Auth | cookie httpOnly | `Authorization: Bearer` |

`adapter.js` oculta esa diferencia para que 9Router y todas las herramientas de abajo solo vean un
proveedor OpenAI normal. Las cuentas rotan en round-robin; una sesión muerta se enfría y la
petición se reintenta en otra cuenta.

---

## Requisitos

- **Node.js 18+** (usa el `fetch` integrado). Sin `npm install`, sin dependencias, sin build.
- Acceso de red a `hark.com`, `auth.hark.com`, `api.mail.tm` y tu 9Router local.
- Un **[9Router](https://9router.com)** en ejecución solo para el paso del conector.

---

## Inicio rápido

```bash
# 0) (opcional) verifica un pool existente
node selftest.js

# 1) crea cuentas -> accounts.json
node bulk.js --count 5 --concurrency 2

# 2) ejecuta el pool compatible con OpenAI
PORT=8790 ACCOUNTS=accounts.json node adapter.js

# 3) instala y ejecuta 9Router  (dashboard: http://localhost:20128)
npm install -g 9router && 9router
#    remoto/primera vez: define INITIAL_PASSWORD antes de lanzar (contraseña por defecto: 123456)

# 4) conecta Hark a 9Router
node connect-9router.js --base http://localhost:20128 --password 123456 \
     --adapter http://localhost:8790
```

Apunta cualquier cliente OpenAI a 9Router:

```
Base URL : http://localhost:20128/v1
API Key  : <copia del dashboard de 9Router>
Model    : hark/account-1        # cualquier modelo hark/*; el adaptador hace round-robin
```

---

## Referencia de CLI

### `bulk.js`

| Flag | Por defecto | Significado |
|------|-------------|-------------|
| `--count N` | `1` | cuentas a crear |
| `--concurrency N` | `2` | workers en paralelo |
| `--out file` | `accounts.json` | archivo de salida (se añade) |
| `--domain d` | primer dominio activo de mail.tm | dominio de mail.tm |
| `--birthday YYYY-MM-DD` | `1995-06-15` | fecha de nacimiento (18+) |
| `--password "…"` | aleatoria | contraseña fija de Hark (si no, aleatoria por cuenta) |
| `--connect <url>` | — | ejecuta el conector de 9Router después |

Cada ejecución **añade** a `accounts.json`. Los fallos se reintentan 3×.

### `adapter.js` (entorno)

| Var | Por defecto | Significado |
|-----|-------------|-------------|
| `PORT` | `8790` | puerto de escucha |
| `ACCOUNTS` | `accounts.json` | archivo del pool |
| `COOLDOWN_MS` | `60000` | cuánto se enfría una cuenta fallida |

### `connect-9router.js`

| Flag | Por defecto | Significado |
|------|-------------|-------------|
| `--base` | `http://localhost:20128` | URL de 9Router |
| `--password` | `123456` | contraseña del dashboard de 9Router |
| `--adapter` | `http://localhost:8790` | URL base del adaptador |
| `--accounts` | `accounts.json` | archivo del pool (para la etiqueta de conexión) |

---

## Forma de `accounts.json`

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

> `accounts.json` contiene credenciales activas y está **ignorado por git**. Solo se sube
> `accounts.sample.json` (censurado).

---

## Cómo funciona el registro (ingeniería inversa)

| # | Llamada | Notas |
|---|---------|-------|
| 1 | `POST https://api.mail.tm/accounts` | crea el buzón, obtiene dirección + JWT |
| 2 | `POST https://auth.hark.com/api/auth/sign-in/magic-link` `{email, callbackURL}` | → `{"status":true}` |
| 3 | polling `GET https://api.mail.tm/messages` | lee "Your Hark sign-in link" |
| 4 | `GET …/magic-link/verify?token=…` | establece las cookies de sesión |
| 5 | `POST …/set-password {newPassword}` | **requiere `Origin: https://hark.com`** |
| 6 | `PATCH https://hark.com/api/profile {updates:{birthday}}` | pasa `hasAppAccess` a `true` |
| 7 | `GET …/get-session` | confirma `emailVerified:true`, devuelve `session.token` |

**Chat:** `POST /api/messages/send?cid=…` y luego polling a
`GET /api/messages/history?conversationId=…` hasta el mensaje `send_bubble` del asistente.

---

## Notas y límites

- Hark ofrece **Claude Opus / Sonnet / Haiku** y elige el modelo en el servidor; no hay selector
  de modelo en el chat, así que el adaptador reenvía tu prompt tal cual.
- **Límites de mail.tm:** ~1 creación de cuenta por 60 s por IP, y las lecturas están limitadas.
  El bulk creator espera 65 s entre creaciones y hace polling suave.
- Usa la **API web privada de Hark**; puede cambiar sin aviso.
- Agrupar muchas cuentas consume los medidores de uso de Hark y puede activar controles de abuso.

---

## Contribuir

Issues y pull requests son bienvenidos. Mantén la regla de cero dependencias: si no está en
Node 18, no lo añadas.

## Descargo de responsabilidad

Este proyecto no está afiliado a Hark ni a 9Router. Eres responsable de cumplir los términos de
servicio de terceros y la ley aplicable. Se ofrece con fines educativos y de interoperabilidad.

## Licencia

[MIT](../LICENSE) © 2026 0xgetz

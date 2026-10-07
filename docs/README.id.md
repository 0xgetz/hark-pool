<div align="center">

<img src="../assets/logo.svg" width="120" alt="logo hark-pool" />

# hark-pool

**Buat akun Hark secara massal dan ekspos seluruh pool sebagai satu provider OpenAI-compatible untuk 9Router.**

Signup headless · ambil cookie session · pool round-robin · tanpa dependensi

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](../LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](../package.json)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI--compatible-6ea8fe?style=flat-square&logo=openai&logoColor=white)](https://platform.openai.com/docs/api-reference/chat)
[![9Router](https://img.shields.io/badge/integrates-9Router-8b5cf6?style=flat-square)](https://9router.com)

[English](../README.md) · [Indonesia](README.id.md) · [Español](README.es.md) · [日本語](README.ja.md) · [中文](README.zh.md)

</div>

---

## Apa ini

`hark-pool` adalah toolkit kecil yang mudah diaudit untuk:

1. **Membuat akun Hark tanpa browser (headless)** — membuat inbox [mail.tm](https://mail.tm),
   meminta magic link Hark, memverifikasinya, menetapkan password, dan melewati gerbang usia.
2. **Menangkap setiap sesi** — Hark memakai **cookie** Better-Auth (tidak ada bearer token), jadi
   toolkit menyimpan `__Secure-hark.session_token` dan id sesi per akun.
3. **Menggabungkan semuanya di balik satu endpoint OpenAI** — `adapter.js` mengubah chat Hark
   berbasis cookie dan polling menjadi `POST /v1/chat/completions` standar.
4. **Menghubungkan pool ke 9Router** — satu provider-node OpenAI-compatible ("Hark") yang bisa
   dipakai semua CLI/IDE yang menunjuk ke 9Router.

```
Klien OpenAI ──▶ 9Router :20128/v1 ──▶ provider-node "Hark"
             ──▶ adapter  :8790/v1  ──▶ round-robin N akun Hark
             ──▶ hark.com /api/messages/{send,history}   (auth cookie)
```

> Lihat **[STRUCTURE.md](../STRUCTURE.md)** untuk topologi lengkap, peta file, dan diagram alur data.

---

## Mengapa perlu adapter

API chat Hark **bukan** berbentuk OpenAI:

| Tahap | Hark | OpenAI |
|-------|------|--------|
| Kirim | `POST /api/messages/send?cid=…` → langsung `{success:true}` | satu panggilan mengembalikan jawaban |
| Terima | polling `GET /api/messages/history?conversationId=…` | dikembalikan inline (atau SSE) |
| Auth | cookie httpOnly | `Authorization: Bearer` |

`adapter.js` menyembunyikan perbedaan itu sehingga 9Router dan semua tool di hilirnya hanya
melihat provider OpenAI biasa. Akun dipakai round-robin; sesi mati akan dibekukan sementara lalu
request dicoba lagi ke akun lain.

---

## Kebutuhan

- **Node.js 18+** (memakai `fetch` bawaan). Tanpa `npm install`, tanpa dependensi, tanpa build.
- Akses jaringan ke `hark.com`, `auth.hark.com`, `api.mail.tm`, dan 9Router lokal Anda.
- **[9Router](https://9router.com)** yang berjalan hanya untuk langkah konektor.

---

## Mulai cepat

```bash
# 0) (opsional) verifikasi pool yang sudah ada
node selftest.js

# 1) buat akun -> accounts.json
node bulk.js --count 5 --concurrency 2

# 2) jalankan pool OpenAI-compatible
PORT=8790 ACCOUNTS=accounts.json node adapter.js

# 3) pasang + jalankan 9Router  (dashboard: http://localhost:20128)
npm install -g 9router && 9router
#    remote/pertama kali: set INITIAL_PASSWORD sebelum dijalankan (password default: 123456)

# 4) hubungkan Hark ke 9Router
node connect-9router.js --base http://localhost:20128 --password 123456 \
     --adapter http://localhost:8790
```

Arahkan klien OpenAI apa pun ke 9Router:

```
Base URL : http://localhost:20128/v1
API Key  : <salin dari dashboard 9Router>
Model    : hark/account-1        # model hark/* apa saja; adapter round-robin pool
```

---

## Referensi CLI

### `bulk.js`

| Flag | Default | Arti |
|------|---------|------|
| `--count N` | `1` | jumlah akun |
| `--concurrency N` | `2` | worker paralel |
| `--out file` | `accounts.json` | file keluaran (di-append) |
| `--domain d` | domain mail.tm aktif pertama | domain mail.tm |
| `--birthday YYYY-MM-DD` | `1995-06-15` | tanggal lahir (harus 18+) |
| `--password "…"` | acak | password Hark tetap (jika tidak, acak per akun) |
| `--connect <url>` | — | jalankan konektor 9Router setelahnya |

Setiap run **menambahkan** ke `accounts.json`. Kegagalan diulang 3×.

### `adapter.js` (environment)

| Var | Default | Arti |
|-----|---------|------|
| `PORT` | `8790` | port listen |
| `ACCOUNTS` | `accounts.json` | file pool |
| `COOLDOWN_MS` | `60000` | lama akun gagal dibekukan |

### `connect-9router.js`

| Flag | Default | Arti |
|------|---------|------|
| `--base` | `http://localhost:20128` | URL 9Router |
| `--password` | `123456` | password dashboard 9Router |
| `--adapter` | `http://localhost:8790` | URL dasar adapter |
| `--accounts` | `accounts.json` | file pool (untuk label koneksi) |

---

## Bentuk `accounts.json`

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

> `accounts.json` berisi kredensial aktif dan **di-ignore git**. Hanya `accounts.sample.json`
> (disunting) yang di-commit.

---

## Cara signup bekerja (hasil reverse-engineer)

| # | Panggilan | Catatan |
|---|-----------|---------|
| 1 | `POST https://api.mail.tm/accounts` | buat inbox, dapat alamat + JWT |
| 2 | `POST https://auth.hark.com/api/auth/sign-in/magic-link` `{email, callbackURL}` | → `{"status":true}` |
| 3 | polling `GET https://api.mail.tm/messages` | baca "Your Hark sign-in link" |
| 4 | `GET …/magic-link/verify?token=…` | menetapkan cookie sesi |
| 5 | `POST …/set-password {newPassword}` | **butuh `Origin: https://hark.com`** |
| 6 | `PATCH https://hark.com/api/profile {updates:{birthday}}` | mengubah `hasAppAccess` jadi `true` |
| 7 | `GET …/get-session` | memastikan `emailVerified:true`, mengembalikan `session.token` |

**Chat:** `POST /api/messages/send?cid=…`, lalu polling `GET /api/messages/history?conversationId=…`
untuk pesan `send_bubble` dari asisten.

---

## Catatan & batasan

- Hark menyediakan **Claude Opus / Sonnet / Haiku** dan memilih model di sisi server; tidak ada
  pemilih model di chat, jadi adapter meneruskan prompt Anda apa adanya.
- **Batas rate mail.tm:** sekitar 1 pembuatan akun / 60 detik / IP, dan pembacaan dibatasi.
  Bulk creator menunggu 65 detik antar pembuatan dan melakukan polling perlahan.
- Ini memakai **API web privat Hark**; bisa berubah tanpa pemberitahuan.
- Menggabungkan banyak akun menarik dari meter penggunaan Hark sendiri dan bisa memicu kontrol
  penyalahgunaan. Gunakan dengan bijak.

---

## Kontribusi

Issue dan pull request diterima. Pertahankan aturan nol-dependensi: jika belum ada di Node 18,
jangan ditambahkan.

## Disclaimer

Proyek ini tidak berafiliasi dengan Hark atau 9Router. Anda bertanggung jawab mematuhi ketentuan
layanan pihak ketiga dan hukum yang berlaku. Disediakan untuk tujuan edukasi dan interoperabilitas.

## Lisensi

[MIT](../LICENSE) © 2026 0xgetz

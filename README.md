<div align="center">
  <h1>Tormod</h1>
  <p><em>Þórmóðr — "the mind of Thor": thought wedded to the hammer.</em></p>
</div>

---

In the hall of `odin` — the hub of the homelab — the thinking is done by a **mind**, and the acting is done by a **hammer**. Tormod binds the two. The **mind** (Claude Code) reasons about the fleet; **Mjölnir** is the power to strike across it — restart a service, edit a file, run a command on any node. But in this telling the hammer never falls on its own: **you hold the last word.** Every blow that changes the world is shown to you, in plain text, before it lands.

Tormod is the remote interface to that mind. It lets you talk to Claude Code and command its sessions from your phone or browser — operating the homelab without ever opening an SSH session to `odin` yourself.

> **The server is the product; the brain is a client.** Tormod never talks to a language model and never holds an API key. The brain runs as a separate Claude Code process, behind a provider-neutral boundary, so it can be swapped without touching the rest of the system.

## Features

- **Chat with Claude Code remotely** — full agentic sessions, streamed token by token over SSE, rendered as Markdown with a collapsible "work balloon" for thinking and tool calls.
- **Session management** — start, list, resume (by sending), **close** (kill the process, keep the transcript) and **delete** (drop the transcript); many live at once; idle ones auto-close; live per-session status (working / waiting / idle) on the sidebar.
- **Approval cards** — anything that changes state pauses the brain and surfaces a card showing the **literal command**. You approve or deny. Read-only tools run free; destructive ones are denied outright. A per-session "free mode" can auto-approve the mutate tier (destructive stays blocked).
- **Single-user auth** — first run registers the owner (username · email · password, Argon2id); after that, password login over an httpOnly session cookie. **Origin-adaptive 2FA (TOTP):** skipped on the LAN/VPN, required from the public internet.
- **Settings** — max live sessions, idle-close window, default model/effort, environment context appended to every new session's system prompt, default approval mode.
- **Append-only audit** — every tool call is recorded in local SQLite. The log survives session deletion and never stores file contents.
- **Shared state with the terminal** — sessions live in the same `~/.claude` store, so you can start something in a terminal and pick it up from your phone.

## Objective

To be the **single management surface for the homelab** — starting with remote ops and chat, then growing by modules (dashboard, document workspace, configuration, usage) over an extensible shell. The long-term vision and the release ladder live in [`PRODUCT.md`](PRODUCT.md); the approved design of the current MVP is the source of truth in [`docs/superpowers/specs/2026-06-08-tormod-design.md`](docs/superpowers/specs/2026-06-08-tormod-design.md), with auth superseded by [`docs/superpowers/specs/2026-06-11-tormod-auth-design.md`](docs/superpowers/specs/2026-06-11-tormod-auth-design.md).

### Permission tiers

The decision layer is Claude Code's own permission system, surfaced in the UI:

| Tier | Token | Behaviour |
|---|---|---|
| read | 🟢 `safe` | runs directly (auto-allowed tools) |
| mutate | 🟡 `approve` | pauses the brain, shows the literal command in a card |
| destructive | 🔴 `danger` | denied outright (`rm`, `sudo`, …) |

> **Security invariant (non-negotiable):** nothing that mutates state runs without a card showing the literal command, and no auto-approved tool may leak data or change anything. This is the backstop that holds even if network, session and brain have all failed.

## Technologies

**Backend (built):**
- [Node](https://nodejs.org) + [Hono](https://hono.dev) — HTTP and SSE, typed routing.
- [`@anthropic-ai/claude-agent-sdk`](https://github.com/anthropics/claude-agent-sdk-typescript) — drives the real Claude Code process behind the `BrainAdapter` boundary (`TORMOD_BRAIN=claude`); a `FakeBrainAdapter` (default) runs the whole app LLM-free for tests.
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — append-only audit, session durability, settings, users and sessions.
- [@node-rs/argon2](https://github.com/napi-rs/node-rs) · [otplib](https://github.com/yeojz/otplib) · [qrcode](https://github.com/soldair/node-qrcode) — Argon2id hashing, TOTP, QR enrollment.
- TypeScript (strict) · [Vitest](https://vitest.dev) — tests, with the permission gate and the auth gate covered exhaustively.

**Frontend (built):**
- [Vite](https://vitejs.dev) + React 19 + TypeScript (strict) + [Tailwind](https://tailwindcss.com) v4 — SSE chat over a fetch reader, approval cards, settings drawer, auth screens.
- Reusable primitives via [class-variance-authority](https://cva.style); icons via lucide-react.

## Status

Tormod runs end to end: the real `ClaudeCodeAdapter` is wired, sessions stream live, auth and settings are in place, and a production image is deployed to a homologation environment by CI on every push to `main`. The project is in its **`0.x`** line — already usable as a daily driver, not yet declared stable. Between here and **1.0** stand the mobile app, push notifications, SSE reconnection and self-host packaging. See [Versioning](#versioning) and [Roadmap](#roadmap).

## Versioning

Tormod follows [Semantic Versioning](https://semver.org). It is currently in the **`0.x`** line: pre-1.0, so anything — the HTTP contract, the storage schema, behaviour — may still change between minor releases. There are no `alpha`/`beta` tags; `0.x` itself is the signal that the project is still stabilising. Releases are cut as git tags (`vMAJOR.MINOR.PATCH`) on `main` and published as Forgejo Releases; the Android build additionally carries an Android `versionCode`/`versionName` pair.

### What "Tormod 1.0" means

> A self-hostable remote control for Claude Code that anyone can stand up on their own machine, install on an Android phone, and use to operate their homelab from anywhere over WireGuard — safely, without losing state, and notified when the brain needs them.

`1.0` is reserved for the point where Tormod is **ready for someone other than the author to self-host and rely on**. That bar:

- [x] **Core** — chat, sessions, approval cards, permission gate, audit, single-user auth, settings, durability.
- [ ] **Installable Android app** — the React UI wrapped with Capacitor, talking to a user-entered server over WireGuard with token auth.
- [ ] **Push notifications** — be alerted on the phone when an approval card is waiting, with the app closed.
- [ ] **SSE reconnection** — `Last-Event-ID` replay so the live stream survives backgrounding and network changes.
- [ ] **Self-host packaging** — tagged Docker image + signed APK as release artifacts, plus setup docs good enough for a stranger to run their own instance.

Everything else — session resume/rename polish, real search, end-to-end tests, multi-server in one app, the future modules and Mimir — is **post-1.0** (the `1.x` line).

### Release ladder

The current release is **`0.4.0`** — the core is complete and a homolog instance is live. The remaining minors lead to 1.0:

| Version | Milestone | |
|---|---|---|
| `0.1.0`–`0.3.0` | Foundation · sessions + web · auth + settings | ✅ |
| **`0.4.0`** | Docker + CI + live homolog | ✅ **← current** |
| `0.5.0` | Token seam + installable Android app (Capacitor) | |
| `0.6.0` | Push notifications | |
| `0.7.0` | SSE reconnection (`Last-Event-ID`) | |
| `0.8.0` | Release packaging (signed image + APK) + self-host docs + polish | |
| `1.0.0` | The bar above, met — ready for others to self-host | |

## Requirements

- **Node.js ≥ 20** and npm (developed on Node 22).
- A POSIX host. In production this is intended to run as a non-root Docker container on `odin`, with `~/.ssh` mounted read-only and `~/.claude` read-write (see [`PRODUCT.md`](PRODUCT.md) for the deployment model — not yet containerized).
- For the real brain: a working Claude Code installation and auth under `~/.claude` on the host.

## Setup

Two processes during development — the API server and the Vite dev server (which proxies `/api` to the server, same-origin).

```bash
# Backend — apps/server
cd apps/server
npm install
npm test                  # vitest (LLM-free, uses the fake brain)
npm run typecheck         # tsc --noEmit
npx tsc                   # build to dist/

# Start the API server (binds 127.0.0.1:8790).
# TORMOD_BRAIN=claude drives the real Claude Code; omit it for the fake brain.
# TORMOD_COOKIE_SECURE=false is required when reaching it over plain HTTP on the LAN.
TORMOD_BRAIN=claude TORMOD_CWD=$HOME TORMOD_COOKIE_SECURE=false node dist/server.js
```

```bash
# Frontend — apps/web
cd apps/web
npm install
npm run dev               # Vite on 0.0.0.0:5173, proxies /api -> 127.0.0.1:8790
```

Open `http://<host>:5173`. On first run the app shows a **registration** screen (username, email, password); after that it's a **login** screen. There is no bearer token — auth rides in an httpOnly session cookie.

### HTTP API (current)

All routes live under `/api`. Everything except `/api/auth/{status,login,register}` requires a valid session — carried as the `tormod_session` httpOnly cookie (web, same-origin) or an `Authorization: Bearer <session id>` header (native client). Mutations require the `X-Tormod: 1` header (CSRF defense). Native clients send `X-Tormod-Client: native` on `login`/`register` to receive the session id in the response body.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/auth/status` | `{ registered, external, totpEnabled }` — drives register vs login |
| `POST` | `/api/auth/register` | create the single user (only when none exists) |
| `POST` | `/api/auth/login` | password (+ TOTP when external) → session cookie |
| `POST` | `/api/auth/logout` | revoke the session, clear the cookie |
| `GET` | `/api/auth/me` | current user profile |
| `POST` | `/api/auth/totp/{enroll,confirm,disable}` | manage 2FA (local origin only) |
| `GET` | `/api/sessions` | list sessions |
| `POST` | `/api/sessions` | start a session |
| `GET` | `/api/sessions/:id/history` | durable transcript of a session |
| `POST` | `/api/sessions/:id/messages` | send a message (resumes a closed session) |
| `POST` | `/api/sessions/:id/interrupt` | interrupt the brain mid-turn |
| `PUT` | `/api/sessions/:id/permission-mode` | per-session approval mode (`default`/`auto`) |
| `POST` | `/api/sessions/:id/close` | close (kill process, keep transcript) |
| `DELETE` | `/api/sessions/:id` | delete the transcript |
| `POST` | `/api/decisions/:toolUseId` | answer a pending approval card |
| `GET` | `/api/sessions/:id/stream` | SSE stream of one session's events |
| `GET` | `/api/stream` | SSE global channel (cross-session status) |
| `GET` `PUT` | `/api/settings` | read / update user settings |

## Folder structure

```
.
├── apps/
│   ├── server/                 # backend (Node + Hono)
│   │   ├── src/
│   │   │   ├── auth/           # users, sessions, password (argon2id), totp, origin, throttle
│   │   │   ├── permission/     # Permission Policy — the security gate (TDD)
│   │   │   ├── brain/          # BrainAdapter boundary + ClaudeCodeAdapter + FakeBrainAdapter
│   │   │   ├── audit/          # append-only SQLite audit
│   │   │   ├── session/        # SessionManager + SessionStore (durability)
│   │   │   ├── settings/       # SettingsStore
│   │   │   ├── http/           # Hono app — routes, session-cookie auth, SSE, auth routes
│   │   │   ├── server.ts       # entry point (binds 127.0.0.1:8790)
│   │   │   └── types.ts        # shared types
│   │   └── package.json
│   └── web/                    # frontend (Vite + React + Tailwind)
│       └── src/                # app, components (auth, chat, sessions, settings, ui), hooks, lib
├── docs/
│   └── superpowers/
│       ├── specs/              # design specs (MVP + auth)
│       └── plans/              # implementation plans
├── PRODUCT.md                  # long-term vision + roadmap
├── LICENSE                     # PolyForm Noncommercial 1.0.0
└── README.md
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8790` | listening port (binds `127.0.0.1`) |
| `TORMOD_BRAIN` | `fake` | `claude` drives the real Claude Code; `fake` is the LLM-free adapter |
| `TORMOD_CWD` | — | working directory for the brain (with `TORMOD_BRAIN=claude`) |
| `TORMOD_AUDIT` | `tormod-audit.db` | path to the SQLite file (audit + sessions + users + settings) |
| `TORMOD_SETTINGS` | = `TORMOD_AUDIT` | path to the settings SQLite file |
| `TORMOD_TRUSTED_CIDRS` | LAN/VPN/loopback | comma-separated CIDRs treated as "local" (2FA skipped) |
| `TORMOD_TRUSTED_PROXY` | — | proxy IP whose `X-Forwarded-For` is trusted for client-IP resolution |
| `TORMOD_COOKIE_SECURE` | `true` | set `false` for plain-HTTP LAN dev; keep `true` behind HTTPS |
| `TORMOD_CORS_ORIGINS` | — | comma-separated origins allowed by CORS (unset = CORS off; set to the Capacitor WebView origin `http://localhost` to enable the native app) |
| `TORMOD_SESSION_TTL_DAYS` | `30` | session cookie / server-side session lifetime |

## Roadmap

The MVP is the base; further surfaces plug into the front-end shell. Full detail in [`PRODUCT.md`](PRODUCT.md).

- [x] **Permission Policy** — the hardened security gate (exhaustive attack-matrix tests).
- [x] **`BrainAdapter` boundary** + `FakeBrainAdapter` for LLM-free testing.
- [x] **Audit + SessionManager + Hono app** — session routes, SSE.
- [x] **`ClaudeCodeAdapter`** — the real brain via the Claude Agent SDK (streaming, history, usage, durability).
- [x] **Web front-end** — React app: chat, sessions, approval cards, settings.
- [x] **Single-user auth** — register/login, httpOnly session, Argon2id, origin-adaptive TOTP.
- [x] **Docker + CI** — non-root container on `odin`, front served same-origin by Hono, deployed to homolog by Forgejo Actions on every push to `main`.

**The road to 1.0:**

- [ ] **Token auth seam** — backend accepts the session as an `Authorization: Bearer` header alongside the cookie, so decoupled clients can authenticate.
- [ ] **Mobile app (Capacitor)** — the React UI wrapped as an installable Android app, talking to a user-entered server over WireGuard.
- [ ] **Push notifications** — approval-card alerts on the phone with the app closed.
- [ ] **SSE reconnection** — `Last-Event-ID` replay across backgrounding and network changes.
- [ ] **Release & self-host packaging** — tagged Docker image + signed APK as release artifacts, plus setup docs for a stranger to run their own instance.

**Post-1.0 (`1.x`):**

- [ ] **Polish** — session resume/rename, real search, end-to-end tests.
- [ ] **Future modules** — config-as-tools, dashboard, document workspace, usage & observability.
- [ ] **Mimir** — companion microservice for long-term memory, history and metrics.

## Contributing

**Not open to external contributions at this time.** This is a personal homelab project under active design. Issues and discussion may be welcomed later, but pull requests are not being accepted for now.

## License

Licensed under the **[PolyForm Noncommercial License 1.0.0](LICENSE)**.

You may use, study, modify and share this software for **any noncommercial purpose**. **Commercial use is not permitted.** This is a *source-available* license, not an OSI "open source" license — the difference is precisely the noncommercial restriction.

Copyright © 2026 DIAS LABS SERVICOS DE TI LTDA (CNPJ 65.673.716/0001-03).

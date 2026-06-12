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

The backend and the web frontend are **built and running**: the real `ClaudeCodeAdapter` is wired, sessions stream live, and auth is in place. What remains for the v1 milestone is **packaging** — a Docker container on `odin`, the front served same-origin by Hono, a clean production build — plus two robustness items (SSE replay on reconnect, installable PWA). See [Roadmap](#roadmap).

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

All routes live under `/api`. Everything except `/api/auth/{status,login,register}` requires a valid session cookie; mutations require the `X-Tormod: 1` header (CSRF defense).

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
| `TORMOD_SESSION_TTL_DAYS` | `30` | session cookie / server-side session lifetime |

## Roadmap

The MVP is the base; further surfaces plug into the front-end shell. Full detail in [`PRODUCT.md`](PRODUCT.md).

- [x] **Permission Policy** — the hardened security gate (exhaustive attack-matrix tests).
- [x] **`BrainAdapter` boundary** + `FakeBrainAdapter` for LLM-free testing.
- [x] **Audit + SessionManager + Hono app** — session routes, SSE.
- [x] **`ClaudeCodeAdapter`** — the real brain via the Claude Agent SDK (streaming, history, usage, durability).
- [x] **Web front-end** — React app: chat, sessions, approval cards, settings.
- [x] **Single-user auth** — register/login, httpOnly session, Argon2id, origin-adaptive TOTP.
- [ ] **Docker + WireGuard** — non-root container on `odin`, front served same-origin, bound to the `wg0` IP, HTTPS at the edge.
- [ ] **Robustness** — SSE replay on reconnect (`Last-Event-ID`), installable PWA (manifest + service worker).
- [ ] **Future modules** — config-as-tools, dashboard, document workspace, usage & observability.
- [ ] **Mimir** — companion microservice for long-term memory, history and metrics.

## Contributing

**Not open to external contributions at this time.** This is a personal homelab project under active design. Issues and discussion may be welcomed later, but pull requests are not being accepted for now.

## License

Licensed under the **[PolyForm Noncommercial License 1.0.0](LICENSE)**.

You may use, study, modify and share this software for **any noncommercial purpose**. **Commercial use is not permitted.** This is a *source-available* license, not an OSI "open source" license — the difference is precisely the noncommercial restriction.

Copyright © 2026 DIAS LABS SERVICOS DE TI LTDA (CNPJ 65.673.716/0001-03).

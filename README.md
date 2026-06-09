<div align="center">
  <h1>Tormod</h1>
  <p><em>Þórmóðr — "the mind of Thor": thought wedded to the hammer.</em></p>
</div>

---

In the hall of `odin` — the hub of the homelab — the thinking is done by a **mind**, and the acting is done by a **hammer**. Tormod binds the two. The **mind** (Claude Code) reasons about the fleet; **Mjölnir** is the power to strike across it — restart a service, edit a file, run a command on any node. But in this telling the hammer never falls on its own: **you hold the last word.** Every blow that changes the world is shown to you, in plain text, before it lands.

Tormod is the remote interface to that mind. It lets you talk to Claude Code and command its sessions from your phone or browser — operating the homelab without ever opening an SSH session to `odin` yourself.

> **The server is the product; the brain is a client.** Tormod never talks to a language model and never holds an API key. The brain runs as a separate Claude Code process, behind a provider-neutral boundary, so it can be swapped without touching the rest of the system.

## Features

- **Chat with Claude Code remotely** — full agentic sessions, streamed token by token over SSE.
- **Session management** — start, list, resume, **close** (kill the process, keep the transcript) and **delete** (drop the transcript); many live at once; idle ones auto-close.
- **Approval cards** — anything that changes state pauses the brain and surfaces a card showing the **literal command**. You approve or deny. Read-only tools run free; destructive ones are denied outright.
- **Append-only audit** — every tool call is recorded in local SQLite. The log survives session deletion and never stores file contents.
- **Shared state with the terminal** — sessions live in the same `~/.claude` store, so you can start something in a terminal and pick it up from your phone.

## Objective

To be the **single management surface for the homelab** — starting with remote ops and chat, then growing by modules (dashboard, document workspace, configuration, usage) over an extensible shell. The long-term vision and the release ladder live in [`PRODUCT.md`](PRODUCT.md); the approved design of the current MVP is the source of truth in [`docs/superpowers/specs/2026-06-08-tormod-design.md`](docs/superpowers/specs/2026-06-08-tormod-design.md).

### Permission tiers

The decision layer is Claude Code's own permission system, surfaced in the UI:

| Tier | Token | Behaviour |
|---|---|---|
| read | 🟢 `safe` | runs directly (auto-allowed tools) |
| mutate | 🟡 `approve` | pauses the brain, shows the literal command in a card |
| destructive | 🔴 `danger` | denied outright (`rm`, `sudo`, …) |

> **Security invariant (non-negotiable):** nothing that mutates state runs without a card showing the literal command, and no auto-approved tool may leak data or change anything. This is the backstop that holds even if network, token and brain have all failed.

## Technologies

**Backend (built):**
- [Node](https://nodejs.org) + [Hono](https://hono.dev) — HTTP and SSE, typed routing.
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — append-only audit.
- TypeScript (strict) · [Vitest](https://vitest.dev) — tests, with the permission gate covered exhaustively.

**Brain (next milestone):**
- [`@anthropic-ai/claude-agent-sdk`](https://github.com/anthropics/claude-agent-sdk-typescript) — drives the Claude Code process behind the `BrainAdapter` boundary.

**Frontend (planned):**
- [Vite](https://vitejs.dev) + React + TypeScript + [Tailwind](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) — installable PWA, SSE stream, approval cards.

## Requirements

- **Node.js ≥ 20** and npm.
- A POSIX host. In production this runs as a non-root Docker container on `odin`, with `~/.ssh` mounted read-only and `~/.claude` read-write (see [`PRODUCT.md`](PRODUCT.md) for the deployment model).
- For the real brain (not yet wired): a working Claude Code installation and auth under `~/.claude` on the host.

> ⚠️ **Status:** the backend server runs today against a `FakeBrainAdapter` (no LLM). The real `ClaudeCodeAdapter` and the web front-end are not built yet — see [Roadmap](#roadmap).

## Setup

```bash
# 1. Install dependencies
cd apps/server
npm install

# 2. Run the test suite (no LLM, no network — uses the fake brain)
npm test          # vitest
npm run typecheck # tsc --noEmit

# 3. Start the server (binds 127.0.0.1:8790 by default)
TORMOD_TOKEN=$(openssl rand -hex 32) npx tsx src/server.ts
```

Every request must carry the bearer token:

```bash
curl -H "Authorization: Bearer $TORMOD_TOKEN" http://127.0.0.1:8790/api/sessions
```

### HTTP API (current)

All routes live under `/api` and require the bearer token.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/sessions` | list sessions |
| `POST` | `/api/sessions` | start a session |
| `POST` | `/api/sessions/:id/messages` | send a message to a session |
| `POST` | `/api/sessions/:id/close` | close (kill process, keep transcript) |
| `DELETE` | `/api/sessions/:id` | delete the transcript |
| `POST` | `/api/decisions/:toolUseId` | answer a pending approval card |
| `GET` | `/api/sessions/:id/stream` | SSE stream of a session's events |

## Folder structure

```
.
├── apps/
│   └── server/                 # backend (Node + Hono)
│       ├── src/
│       │   ├── permission/     # Permission Policy — the security gate (TDD)
│       │   ├── brain/          # BrainAdapter boundary + FakeBrainAdapter
│       │   ├── audit/          # append-only SQLite audit
│       │   ├── session/        # SessionManager — lifecycle, approval bridge
│       │   ├── http/           # Hono app — routes, bearer auth, SSE
│       │   ├── server.ts       # entry point (binds 127.0.0.1:8790)
│       │   └── types.ts        # shared types
│       └── package.json
│   └── web/                    # frontend PWA — planned (not built yet)
├── docs/
│   └── superpowers/
│       ├── specs/              # design specs (MVP source of truth)
│       └── plans/              # implementation plans
├── PRODUCT.md                  # long-term vision + roadmap
├── LICENSE                     # PolyForm Noncommercial 1.0.0
└── README.md
```

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `TORMOD_TOKEN` | **yes** | — | bearer token; the server refuses to start without it |
| `PORT` | no | `8790` | listening port |
| `TORMOD_AUDIT` | no | `tormod-audit.db` | path to the SQLite audit file |

Example `.env` (a real one is never committed — see `.gitignore`):

```dotenv
# .env.example
TORMOD_TOKEN=replace-with-a-long-random-secret
PORT=8790
TORMOD_AUDIT=./tormod-audit.db
```

## Roadmap

The MVP is the base; further surfaces plug into the front-end shell. Full detail in [`PRODUCT.md`](PRODUCT.md).

- [x] **Permission Policy** — the hardened security gate (exhaustive attack-matrix tests).
- [x] **`BrainAdapter` boundary** + `FakeBrainAdapter` for LLM-free testing.
- [x] **Audit + SessionManager + Hono app** — bearer auth, session routes, SSE.
- [ ] **`ClaudeCodeAdapter`** — the real brain via the Claude Agent SDK.
- [ ] **Web front-end** — React PWA: chat, sessions, approval cards.
- [ ] **Docker + WireGuard** — non-root container on `odin`, bound to the `wg0` IP, HTTPS at the edge.
- [ ] **Future modules** — config-as-tools, dashboard, document workspace, usage & observability.
- [ ] **Mimir** — companion microservice for long-term memory, history and metrics.

## Contributing

**Not open to external contributions at this time.** This is a personal homelab project under active design. Issues and discussion may be welcomed later, but pull requests are not being accepted for now.

## License

Licensed under the **[PolyForm Noncommercial License 1.0.0](LICENSE)**.

You may use, study, modify and share this software for **any noncommercial purpose**. **Commercial use is not permitted.** This is a *source-available* license, not an OSI "open source" license — the difference is precisely the noncommercial restriction.

Copyright © 2026 DIAS LABS SERVICOS DE TI LTDA (CNPJ 65.673.716/0001-03).

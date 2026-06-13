# Tormod Staging Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a local homologation server running the production build of Tormod (no dev mode), redeployed by a Forgejo Actions pipeline on push to `main`.

**Architecture:** Two parts. **Part 1** turns the app into a runnable production Docker image (front built by Vite, served same-origin by Hono) — this is the Plano 5 core, validable locally. **Part 2** wires Forgejo CI: a 2nd remote, an `act_runner` on odin, and a workflow that builds the image and (re)deploys the staging container on `main` pushes.

**Tech Stack:** Node 22, Hono, Vite/React, Docker + docker compose, Forgejo Actions (`act_runner`), better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-06-11-tormod-staging-pipeline-design.md`

---

## Outcome (2026-06-12) — DONE, verified live

The pipeline is complete and running. Push to `main` builds the image and redeploys the staging container at `http://192.168.0.10:8080` (production build, no Vite/HMR, data persisted). All tasks landed; two deviations from the plan as written:

- **Runner is `forgejo-runner` v12.11.1, not `act_runner` v3.x.** The Forgejo instance uses the modern registration flow (it hands out `uuid` + `token` for a `server.connections` config block), not the deprecated `register` subcommand. Setup: systemd `forgejo-runner.service` (`User=odin`, `Group=docker` → builds without root), config at `~/.config/act_runner/config.yaml` with `runner.labels: [host:host]` (matches `runs-on: host`) and the `server.connections.forgejo` block pointing at `http://192.168.0.126:30142/`. Helper: `~/setup-forgejo-runner.sh <uuid> <token>`.
- **Deploy step pins the compose project: `docker compose -p tormod -f compose.staging.yml up -d`.** Without `-p`, CI runs compose from its checkout dir (`~/.cache/act/<hash>/...`) → a different project name → `container_name: tormod-staging` collides with the existing container → deploy fails while the build succeeds. Pinning `-p tormod` makes CI adopt the same project regardless of the runner's workdir.

Verified live: two pushes (initial + the `-p tormod` fix); the second rebuilt the image and recreated the container automatically; `/data/tormod.db` (registered user + audit) survived the redeploy; served HTML is the bundled prod build with no `/@vite/client`.

**Branch:** work on `feat/web-ui` (the integration trunk). Promotion to staging happens later by merging `feat/web-ui` → `main` and pushing to Forgejo.

**Conventions:** TypeScript strict + ESM (`.js` import suffix in server, none in web). Frontend comment-free. Commit messages Conventional, English, **never** mention AI/Claude. SQLite stores follow the existing `static open(path)` pattern.

---

## File Structure

**Part 1 — create:**
- `apps/web/src/fontsource.d.ts` — ambient module decl for the side-effect font imports.
- `Dockerfile` (root) — multi-stage production image.
- `.dockerignore` (root) — keep build context lean.
- `compose.staging.yml` (root) — the staging container definition.

**Part 1 — modify:**
- `apps/web/src/lib/usageTone.ts` — narrow return type (fixes the StatusLine tsc error).
- `apps/server/src/http/app.ts` — serve the built web (`TORMOD_WEB_DIST`) with SPA fallback.
- `apps/server/src/http/app.test.ts` — test static serving + SPA fallback + `/api` precedence.
- `apps/server/src/server.ts` — bind a configurable `HOST`; pass `webDist` to `createApp`.

**Part 2 — create:**
- `.forgejo/workflows/staging.yml` — the CI workflow.

**Part 2 — infra (no repo files):** Forgejo repo `antonioisaacvd/tormod`, local `forgejo` remote, `act_runner` systemd service on odin.

---

# PART 1 — Production build & image

### Task 1: Fix the web TypeScript build errors

**Files:**
- Modify: `apps/web/src/lib/usageTone.ts`
- Create: `apps/web/src/fontsource.d.ts`

**Context:** `npm run build` runs `tsc -b && vite build`. It currently fails on 3 errors: `usageTone` is typed `Tone` (includes `'faint'`/`'safe'`) but `Meter`'s `tone` only accepts `arc|safe|approve|danger`; and the two `@fontsource-variable/*` side-effect imports in `main.tsx` have no type declarations.

- [ ] **Step 1: Narrow `usageTone` return type**

Replace the whole file `apps/web/src/lib/usageTone.ts` with:

```ts
export type MeterTone = 'arc' | 'approve' | 'danger'

export function usageTone(percentage: number): MeterTone {
  if (percentage >= 90) {
    return 'danger'
  }
  if (percentage >= 70) {
    return 'approve'
  }
  return 'arc'
}
```

(This is the value `usageTone` already returned; only the type widened too far. `MeterTone` is a subset of `Meter`'s accepted tones, so the StatusLine call type-checks.)

- [ ] **Step 2: Declare the font modules**

Create `apps/web/src/fontsource.d.ts`:

```ts
declare module '@fontsource-variable/roboto'
declare module '@fontsource-variable/roboto-mono'
```

- [ ] **Step 3: Verify the production build now passes**

Run: `cd /home/odin/tormod/apps/web && npm run build`
Expected: exits 0; `tsc -b` reports no errors; `vite build` writes `apps/web/dist/index.html` + `apps/web/dist/assets/`.

- [ ] **Step 4: Verify web tests still pass**

Run: `cd /home/odin/tormod/apps/web && npx vitest run`
Expected: 19 passed.

- [ ] **Step 5: Commit**

```bash
cd /home/odin/tormod && git add apps/web/src/lib/usageTone.ts apps/web/src/fontsource.d.ts && git commit -m "fix(web): clean production tsc build (narrow meter tone, declare font modules)"
```

---

### Task 2: Hono serves the built web with SPA fallback

**Files:**
- Modify: `apps/server/src/http/app.ts`
- Modify: `apps/server/src/http/app.test.ts`

**Context:** In production there is no Vite proxy — the server must serve `apps/web/dist` at `/` (same-origin with `/api`). `createApp` gains an optional `webDist` (absolute path). When set, static files are served and any non-`/api` route that isn't a file returns `index.html` (SPA). When unset (dev), nothing changes. `/api/*` keeps precedence because it is registered before the static block.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/src/http/app.test.ts` (uses the existing `ctx()`/`appWith` helpers; add the imports at the top of the file: `import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";`):

```ts
describe("createApp — static web", () => {
  function appWithWeb() {
    const dir = mkdtempSync(join(tmpdir(), "tormod-web-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Tormod</title><div id=root></div>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
    const settings = SettingsStore.open(":memory:");
    const mgr = new SessionManager(new FakeBrainAdapter(), Audit.open(":memory:"), undefined, settings);
    return createApp(mgr, { auth: ctx(), settings, webDist: dir });
  }

  it("serves index.html at the root", async () => {
    const res = await appWithWeb().request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Tormod");
  });

  it("serves static assets", async () => {
    const res = await appWithWeb().request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.log");
  });

  it("falls back to index.html for an unknown client route", async () => {
    const res = await appWithWeb().request("/some/spa/route");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Tormod");
  });

  it("keeps /api gated even with static serving on", async () => {
    const res = await appWithWeb().request("/api/sessions");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/odin/tormod/apps/server && npx vitest run src/http/app.test.ts`
Expected: FAIL — `webDist` not accepted / routes 404.

- [ ] **Step 3: Implement static serving in `app.ts`**

Add imports at the top of `apps/server/src/http/app.ts`:

```ts
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

Extend `AppOptions`:

```ts
export interface AppOptions {
  auth: AuthContext;
  settings: SettingsStore;
  webDist?: string;
}
```

Immediately before `return app;` at the end of `createApp`, add:

```ts
  if (opts.webDist) {
    const root = opts.webDist;
    const indexHtml = readFileSync(join(root, "index.html"), "utf8");
    app.use("/*", serveStatic({ root }));
    app.get("*", (c) => c.html(indexHtml));
  }

  return app;
```

(Delete the existing bare `return app;` so there is only the one above.)

- [ ] **Step 4: Run the http tests**

Run: `cd /home/odin/tormod/apps/server && npx vitest run src/http/app.test.ts`
Expected: PASS — the 4 new static tests plus the existing auth/session/settings tests.

If `serveStatic` does not resolve the absolute `root` (returns 404 for `/assets/app.js`), it needs the path relative to `process.cwd()`. In that case, change the static line to `app.use("/*", serveStatic({ root: "./", rewriteRequestPath: (p) => join(root, p) }))` and re-run. Pick whichever makes the asset test pass; keep the SPA fallback line unchanged.

- [ ] **Step 5: Full server suite + typecheck**

Run: `cd /home/odin/tormod/apps/server && npx vitest run && npx tsc --noEmit`
Expected: all pass, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
cd /home/odin/tormod && git add apps/server/src/http/app.ts apps/server/src/http/app.test.ts && git commit -m "feat(server): serve the built web same-origin with spa fallback"
```

---

### Task 3: Configurable bind host + wire webDist in the entrypoint

**Files:**
- Modify: `apps/server/src/server.ts`

**Context:** The server hardcodes `hostname: "127.0.0.1"`, which is correct for dev but makes the port unreachable from outside a container. Add a `HOST` env (default `127.0.0.1`) and pass `TORMOD_WEB_DIST` through to `createApp`.

- [ ] **Step 1: Edit `server.ts`**

Change the `createApp` call to include `webDist`:

```ts
const app = createApp(manager, { auth, settings, webDist: process.env.TORMOD_WEB_DIST });
```

Change the `serve(...)` call's hostname:

```ts
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" }, (info) => {
  console.error(`Tormod server listening on http://${process.env.HOST ?? "127.0.0.1"}:${info.port}`);
});
```

- [ ] **Step 2: Typecheck + build**

Run: `cd /home/odin/tormod/apps/server && npx tsc`
Expected: exit 0; `dist/server.js` updated.

- [ ] **Step 3: Smoke locally (dev unchanged: no webDist, 127.0.0.1)**

Run (then Ctrl-C):
```bash
cd /home/odin/tormod/apps/server && PORT=8791 node dist/server.js
```
Expected: `Tormod server listening on http://127.0.0.1:8791`. (Different port to avoid the running dev server.)

- [ ] **Step 4: Commit**

```bash
cd /home/odin/tormod && git add apps/server/src/server.ts && git commit -m "feat(server): configurable bind host and web-dist wiring"
```

---

### Task 4: Production Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile` (repo root)
- Create: `.dockerignore` (repo root)

**Context:** Multi-stage build: build the web, build the server, assemble a slim non-root runtime that serves both. `better-sqlite3` and `@node-rs/argon2` ship prebuilt binaries for linux x64 / node 22 glibc, so no compiler is needed; the runtime reuses the server's installed `node_modules`. A `/data` dir is created and chowned so a fresh named volume inherits non-root ownership.

- [ ] **Step 1: Create `.dockerignore`**

```
**/node_modules
**/dist
.git
.vite
*.log
apps/server/tormod-audit.db*
docs
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22 AS web-build
WORKDIR /app/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM node:22 AS server-build
WORKDIR /app/server
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci
COPY apps/server/ ./
RUN npx tsc
RUN npm prune --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /data && chown 1000:1000 /data
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/package.json ./package.json
COPY --from=web-build /app/web/dist ./web
ENV TORMOD_WEB_DIST=/app/web
ENV HOST=0.0.0.0
ENV PORT=8790
USER node
EXPOSE 8790
CMD ["node", "dist/server.js"]
```

- [ ] **Step 3: Build the image**

Run: `cd /home/odin/tormod && docker build -t tormod-staging:latest .`
Expected: completes; `docker images` lists `tormod-staging:latest`.

- [ ] **Step 4: Smoke the image with the FAKE brain (proves build + serving, no LLM)**

Run:
```bash
docker run --rm -d --name tormod-smoke -p 8095:8790 -e TORMOD_COOKIE_SECURE=false tormod-staging:latest
sleep 2
curl -s -o /dev/null -w "root: %{http_code}\n" http://127.0.0.1:8095/
curl -s -o /dev/null -w "spa fallback: %{http_code}\n" http://127.0.0.1:8095/whatever
curl -s -o /dev/null -w "api (no cookie): %{http_code}\n" http://127.0.0.1:8095/api/sessions
curl -s http://127.0.0.1:8095/api/auth/status
docker rm -f tormod-smoke
```
Expected: `root: 200`, `spa fallback: 200`, `api (no cookie): 401`, and a JSON `{"registered":false,...}`. (Default brain is `fake` — no LLM involved.)

- [ ] **Step 5: Commit**

```bash
cd /home/odin/tormod && git add Dockerfile .dockerignore && git commit -m "build: multi-stage production image serving the web same-origin"
```

---

### Task 5: Staging compose + real-brain wiring & live verification

**Files:**
- Create: `compose.staging.yml` (repo root)

**Context:** The staging container runs the **real Claude brain**, so it needs the brain's auth/config and the fleet SSH keys, and its process `HOME` must be `/home/odin` (where `~/.claude` and `~/.ssh` are mounted) so the Agent SDK finds `~/.claude/.credentials.json`. The Claude executable is bundled inside the `@anthropic-ai/claude-agent-sdk` package (copied via `node_modules`); **this task verifies that with a live smoke** and, only if the SDK cannot find an executable, falls back to installing the CLI in the image.

- [ ] **Step 1: Create `compose.staging.yml`**

```yaml
services:
  tormod-staging:
    image: tormod-staging:latest
    container_name: tormod-staging
    restart: unless-stopped
    ports:
      - "8080:8790"
    user: "1000:1000"
    environment:
      HOME: /home/odin
      TORMOD_BRAIN: claude
      TORMOD_CWD: /home/odin
      TORMOD_COOKIE_SECURE: "false"
      TORMOD_AUDIT: /data/tormod.db
      HOST: 0.0.0.0
    volumes:
      - /home/odin/.ssh:/home/odin/.ssh:ro
      - /home/odin/.claude:/home/odin/.claude:rw
      - tormod-staging-data:/data

volumes:
  tormod-staging-data:
```

- [ ] **Step 2: Bring up staging**

Run: `cd /home/odin/tormod && docker compose -f compose.staging.yml up -d`
Expected: container `tormod-staging` is `Up`. Check: `docker logs tormod-staging` shows `Tormod server listening on http://0.0.0.0:8790`.

- [ ] **Step 3: Register a staging user (fresh DB)**

Run:
```bash
curl -s -i -X POST http://127.0.0.1:8080/api/auth/register \
  -H 'Content-Type: application/json' -H 'X-Tormod: 1' \
  -d '{"username":"homolog","email":"homolog@diaslabs.dev","password":"homolog-staging-123"}' | grep -iE '^HTTP|set-cookie'
```
Expected: `201` + a `Set-Cookie: tormod_session=...`.

- [ ] **Step 4: LIVE VERIFY the real brain answers in the container**

Run (captures the cookie, creates a session, sends a ping, waits, reads the stream is not strictly needed — check logs):
```bash
C=$(curl -s -i -X POST http://127.0.0.1:8080/api/auth/login -H 'Content-Type: application/json' -H 'X-Tormod: 1' -d '{"username":"homolog","password":"homolog-staging-123"}' | grep -i set-cookie | sed 's/.*\(tormod_session=[^;]*\).*/\1/')
SID=$(curl -s -X POST http://127.0.0.1:8080/api/sessions -H 'Content-Type: application/json' -H 'X-Tormod: 1' -H "Cookie: $C" -d '{"title":"smoke"}' | sed 's/.*"id":"\([^"]*\)".*/\1/')
curl -s -X POST "http://127.0.0.1:8080/api/sessions/$SID/messages" -H 'Content-Type: application/json' -H 'X-Tormod: 1' -H "Cookie: $C" -d '{"text":"responda apenas: pong"}'
sleep 25
docker logs --tail 40 tormod-staging
```
Expected: the logs show the brain initialized and produced a result (no "executable not found" / spawn error). If you see the brain respond, the bundled executable works — **done, skip Step 5**.

- [ ] **Step 5: FALLBACK — only if Step 4 shows the brain cannot find a Claude executable**

If `docker logs` shows an error resolving/spawning the Claude executable, install the CLI in the runtime stage. Add to the `runtime` stage of `Dockerfile`, before `USER node`:

```dockerfile
RUN npm install -g @anthropic-ai/claude-code
```

Then rebuild and redeploy:
```bash
cd /home/odin/tormod && docker build -t tormod-staging:latest . && docker compose -f compose.staging.yml up -d
```
Re-run Step 4's verification. Expected: brain now responds.

- [ ] **Step 6: Verify persistence across redeploy**

Run:
```bash
docker compose -f compose.staging.yml up -d --force-recreate
curl -s http://127.0.0.1:8080/api/auth/status
```
Expected: `{"registered":true,...}` — the `homolog` user survived the recreate (named volume).

- [ ] **Step 7: Commit**

```bash
cd /home/odin/tormod && git add compose.staging.yml Dockerfile && git commit -m "build: staging compose running the real brain with persistent data"
```

**At this point Part 1 is complete: a production image runs the real app at `http://192.168.0.10:8080`, independently of any CI.**

---

# PART 2 — Forgejo CI pipeline

> Infra steps. Some require `sudo` and must be run by the human in a real terminal (the agent's shell cannot prompt for a sudo password). Those are marked **[USER]**.

### Task 6: Forgejo repo + second remote

**Files:** none (git/remote config)

- [ ] **Step 1 [USER]: Create the Forgejo repo**

In the Forgejo web UI (`http://192.168.0.126:30142`), create an **empty** repository `antonioisaacvd/tormod` (no README/license — it will receive a push).

- [ ] **Step 2: Add the `forgejo` remote (uses the existing SSH alias)**

Run: `cd /home/odin/tormod && git remote add forgejo forgejo:antonioisaacvd/tormod.git && git remote -v`
Expected: `forgejo` listed alongside `origin`. (The `forgejo` host alias in `~/.ssh/config` already encodes host `192.168.0.126`, port `30143`, user `git`, key `id_ed25519_forgejo`.)

- [ ] **Step 3: Verify SSH auth to Forgejo**

Run: `ssh -T forgejo 2>&1 | head -3` (or `git ls-remote forgejo: 2>&1 | head -1`)
Expected: a Forgejo greeting / no permission error. If it fails, confirm the public key `id_ed25519_forgejo.pub` is registered on the Forgejo account.

- [ ] **Step 4: Push the current branches to Forgejo (does NOT trigger CI yet — workflow added in Task 8)**

Run: `cd /home/odin/tormod && git push forgejo feat/web-ui`
Expected: branch appears in the Forgejo repo.

(No commit — this task only configures the remote.)

---

### Task 7: `act_runner` on odin

**Files:** none (host service)

**Context:** Forgejo Actions needs a runner. Install `act_runner` on odin as a systemd service, registered to the Forgejo instance, with access to the Docker socket so the workflow can build the image and run compose.

- [ ] **Step 1 [USER]: Get a runner registration token**

In Forgejo: **Site Administration → Actions → Runners → Create new Runner** (or repo-level **Settings → Actions → Runners**). Copy the registration token.

- [ ] **Step 2 [USER]: Install the `act_runner` binary**

```bash
sudo curl -fsSL -o /usr/local/bin/act_runner https://code.forgejo.org/forgejo/runner/releases/download/v6.3.1/forgejo-runner-6.3.1-linux-amd64
sudo chmod +x /usr/local/bin/act_runner
act_runner --version
```
(Use the current release URL from `code.forgejo.org/forgejo/runner` if v6.3.1 is stale.)
Expected: prints a version.

- [ ] **Step 3 [USER]: Register the runner**

```bash
sudo mkdir -p /etc/act_runner && cd /etc/act_runner
sudo act_runner register --no-interactive \
  --instance http://192.168.0.126:30142 \
  --token <REGISTRATION_TOKEN> \
  --name odin \
  --labels odin:host
```
Expected: writes `/etc/act_runner/.runner`; the runner appears Online in Forgejo. Label `odin:host` runs jobs directly on the host (so `docker` and the repo build context are available without nested containers).

- [ ] **Step 4 [USER]: systemd service**

Create `/etc/systemd/system/act_runner.service`:

```ini
[Unit]
Description=Forgejo act_runner
After=docker.service network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/act_runner daemon --config /etc/act_runner/config.yaml
WorkingDirectory=/etc/act_runner
User=odin
Group=docker
Restart=always

[Install]
WantedBy=multi-user.target
```

Generate a default config and enable:
```bash
sudo act_runner generate-config | sudo tee /etc/act_runner/config.yaml >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now act_runner
systemctl status act_runner --no-pager | head -5
```
Expected: `active (running)`; runner stays Online in Forgejo. `User=odin`, `Group=docker` gives Docker-socket access without root.

- [ ] **Step 5: Verify the runner is picked up**

In Forgejo's Runners page, confirm the `odin` runner is **Idle/Online** with label `host`.

(No commit — host config only.)

---

### Task 8: The workflow + end-to-end deploy

**Files:**
- Create: `.forgejo/workflows/staging.yml`

- [ ] **Step 1: Create the workflow**

`.forgejo/workflows/staging.yml`:

```yaml
name: staging
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: host
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Build image
        run: docker build -t tormod-staging:latest .
      - name: Deploy staging container
        run: docker compose -f compose.staging.yml up -d
```

- [ ] **Step 2: Commit the workflow**

```bash
cd /home/odin/tormod && git add .forgejo/workflows/staging.yml && git commit -m "ci: forgejo workflow building and deploying staging on main"
```

- [ ] **Step 3: Promote to staging — merge into `main` and push to Forgejo**

```bash
cd /home/odin/tormod
git checkout main
git merge --ff-only feat/web-ui
git push forgejo main
git checkout feat/web-ui
```
Expected: the push triggers the `staging` workflow in Forgejo.

- [ ] **Step 4: Watch the run**

In Forgejo → repo → **Actions**, open the running `staging` job. Expected: checkout → build image → compose up, all green. (`docker logs tormod-staging` on odin shows the new container.)

- [ ] **Step 5: End-to-end verification**

Open `http://192.168.0.10:8080` in a browser. Expected: the production app (no dev mode), login/register screen, and after logging in as `homolog`, a working chat with the real brain. Confirm in the page source there is no Vite client / HMR script.

- [ ] **Step 6: Confirm redeploy works on a second push**

Make a trivial change (e.g. a comment in `README.md`), commit on `feat/web-ui`, then repeat Step 3's merge+push. Expected: a new Actions run rebuilds and recreates the container; the change is live at `:8080`.

---

## Self-review notes (for the implementer)
- Part 1 is fully testable locally and is independently shippable (a runnable production image) before any CI exists.
- The single real unknown is the Claude executable inside the container (Task 5, Steps 4–5): verify-then-fallback, gated by a live smoke — do not skip the verification.
- `[USER]` steps need a real terminal for `sudo`; the agent should pause and ask the human to run them, then continue once confirmed.
- Keep `TORMOD_COOKIE_SECURE=false` only because staging is LAN-only HTTP; flip to `true` when an HTTPS edge is added (out of scope).

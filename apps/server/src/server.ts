import { serve } from "@hono/node-server";
import { createApp } from "./http/app.js";
import { SessionManager } from "./session/manager.js";
import { FakeBrainAdapter } from "./brain/fake.js";
import { ClaudeCodeAdapter } from "./brain/claude.js";
import type { BrainAdapter } from "./brain/adapter.js";
import { Audit } from "./audit/audit.js";
import { SessionStore } from "./session/store.js";
import { SettingsStore } from "./settings/store.js";
import { UserStore } from "./auth/users.js";
import { AuthSessionStore } from "./auth/authSessions.js";
import { Throttle } from "./auth/throttle.js";
import { authConfigFromEnv } from "./auth/context.js";

process.on("unhandledRejection", (reason) => console.error("unhandledRejection:", reason));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

const port = Number(process.env.PORT ?? 8790);
const auditPath = process.env.TORMOD_AUDIT ?? "tormod-audit.db";

const brainKind = process.env.TORMOD_BRAIN ?? "fake";
const cwd = process.env.TORMOD_CWD;
const brain: BrainAdapter =
  brainKind === "claude"
    ? new ClaudeCodeAdapter({ streaming: true, options: { ...(cwd ? { cwd } : {}) } })
    : new FakeBrainAdapter();

const settingsPath = process.env.TORMOD_SETTINGS ?? auditPath;
const settings = SettingsStore.open(settingsPath);
const manager = new SessionManager(brain, Audit.open(auditPath), SessionStore.open(auditPath), settings);

const authConfig = authConfigFromEnv(process.env as Record<string, string | undefined>);
const auth = {
  users: UserStore.open(auditPath),
  sessions: AuthSessionStore.open(auditPath, authConfig.sessionTtlDays),
  throttle: new Throttle(),
  config: authConfig,
};

const corsOrigins = (process.env.TORMOD_CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = createApp(manager, { auth, settings, webDist: process.env.TORMOD_WEB_DIST, corsOrigins });

const host = process.env.HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.error(`Tormod server listening on http://${host}:${info.port}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.allSettled(
    manager.list().filter((s) => s.status === "live").map((s) => manager.close(s.id)),
  );
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

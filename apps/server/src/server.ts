import { serve } from "@hono/node-server";
import { createApp } from "./http/app.js";
import { SessionManager } from "./session/manager.js";
import { FakeBrainAdapter } from "./brain/fake.js";
import { ClaudeCodeAdapter } from "./brain/claude.js";
import type { BrainAdapter } from "./brain/adapter.js";
import { Audit } from "./audit/audit.js";
import { SessionStore } from "./session/store.js";

// A stray rejection (e.g. a brain call failing mid-stream) must never take the
// daemon down — log and keep serving the other live sessions.
process.on("unhandledRejection", (reason) => console.error("unhandledRejection:", reason));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

const token = process.env.TORMOD_TOKEN;
if (!token) {
  console.error("TORMOD_TOKEN is required");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 8790);
const auditPath = process.env.TORMOD_AUDIT ?? "tormod-audit.db";

// "claude" drives real Claude Code via the Agent SDK (reuses ~/.claude auth +
// config); "fake" (default) is the LLM-less adapter for dev/smoke tests.
const brainKind = process.env.TORMOD_BRAIN ?? "fake";
const cwd = process.env.TORMOD_CWD;
const brain: BrainAdapter =
  brainKind === "claude"
    ? new ClaudeCodeAdapter({ streaming: true, options: { ...(cwd ? { cwd } : {}) } })
    : new FakeBrainAdapter();

const manager = new SessionManager(brain, Audit.open(auditPath), SessionStore.open(auditPath));
const app = createApp(manager, { token });

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.error(`Tormod server listening on http://127.0.0.1:${info.port}`);
});

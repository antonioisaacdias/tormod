import { serve } from "@hono/node-server";
import { createApp } from "./http/app.js";
import { SessionManager } from "./session/manager.js";
import { FakeBrainAdapter } from "./brain/fake.js";
import { Audit } from "./audit/audit.js";

const token = process.env.TORMOD_TOKEN;
if (!token) {
  console.error("TORMOD_TOKEN is required");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 8790);
const auditPath = process.env.TORMOD_AUDIT ?? "tormod-audit.db";

// Plan 2 wires the FakeBrainAdapter; Plan 3 swaps in the ClaudeCodeAdapter.
const manager = new SessionManager(new FakeBrainAdapter(), Audit.open(auditPath));
const app = createApp(manager, { token });

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.error(`Tormod server listening on http://127.0.0.1:${info.port}`);
});

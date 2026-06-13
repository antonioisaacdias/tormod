import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionManager } from "../session/manager.js";
import type { SettingsStore } from "../settings/store.js";
import type { AuthContext } from "../auth/context.js";
import { registerAuthRoutes, sessionMiddleware, CLIENT_IP } from "./auth.js";
import { resolveClientIp } from "../auth/origin.js";

export interface AppOptions {
  auth: AuthContext;
  settings: SettingsStore;
  webDist?: string;
  corsOrigins?: string[];
}

type Env = { Variables: { [CLIENT_IP]: string } };

export function createApp(manager: SessionManager, opts: AppOptions): Hono<Env> {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    let socketIp = "";
    try {
      socketIp = getConnInfo(c).remote.address ?? "";
    } catch {
      socketIp = "";
    }
    const xff = c.req.header("x-forwarded-for");
    c.set(CLIENT_IP, resolveClientIp(socketIp, xff, opts.auth.config.trustedProxy));
    await next();
  });

  if (opts.corsOrigins && opts.corsOrigins.length > 0) {
    app.use(
      "/api/*",
      cors({
        origin: opts.corsOrigins,
        allowHeaders: ["Content-Type", "Authorization", "X-Tormod", "X-Tormod-Client"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      }),
    );
  }

  registerAuthRoutes(app as any, opts.auth);

  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) return next();
    return sessionMiddleware(opts.auth)(c, next);
  });

  app.get("/api/sessions", (c) => c.json(manager.list()));

  app.get("/api/settings", (c) => c.json(opts.settings.get()));

  app.put("/api/settings", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return c.json(opts.settings.save(body));
  });

  app.get("/api/stream", (c) => {
    return streamSSE(c, async (stream) => {
      const unsub = manager.subscribeAll((event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
      stream.onAbort(() => unsub());
      while (!stream.aborted) {
        await stream.sleep(15000);
        await stream.writeSSE({ event: "ping", data: "{}" });
      }
    });
  });

  app.post("/api/sessions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { title?: unknown; cwd?: unknown };
    const meta = await manager.createSession({
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
    });
    return c.json(meta, 201);
  });

  app.get("/api/sessions/:id/history", async (c) => {
    return c.json(await manager.history(c.req.param("id")));
  });

  app.post("/api/sessions/:id/messages", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text : "";
    manager.send(c.req.param("id"), text).catch((err) => console.error("send failed:", err));
    return c.json({ accepted: true }, 202);
  });

  app.post("/api/sessions/:id/interrupt", async (c) => {
    await manager.interrupt(c.req.param("id"));
    return c.json({ interrupted: true });
  });

  app.put("/api/sessions/:id/permission-mode", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { mode?: unknown };
    if (body.mode !== "default" && body.mode !== "auto") return c.json({ error: "invalid mode" }, 400);
    manager.setPermissionMode(c.req.param("id"), body.mode);
    return c.json({ mode: body.mode });
  });

  app.post("/api/sessions/:id/close", async (c) => {
    await manager.close(c.req.param("id"));
    return c.json({ closed: true });
  });

  app.delete("/api/sessions/:id", (c) => {
    manager.remove(c.req.param("id"));
    return c.json({ removed: true });
  });

  app.post("/api/decisions/:toolUseId", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { allow?: unknown };
    manager.resolveDecision(c.req.param("toolUseId"), body.allow === true);
    return c.json({ ok: true });
  });

  app.get("/api/sessions/:id/stream", (c) => {
    const id = c.req.param("id");
    return streamSSE(c, async (stream) => {
      const unsub = manager.subscribe(id, (event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
      stream.onAbort(() => unsub());
      while (!stream.aborted) {
        await stream.sleep(15000);
        await stream.writeSSE({ event: "ping", data: "{}" });
      }
    });
  });

  if (opts.webDist) {
    const root = opts.webDist;
    const indexHtml = readFileSync(join(root, "index.html"), "utf8");
    app.use("/*", serveStatic({ root }));
    app.get("*", (c) => c.html(indexHtml));
  }

  return app;
}

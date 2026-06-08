import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SessionManager } from "../session/manager.js";

export interface AppOptions {
  token: string;
}

export function createApp(manager: SessionManager, opts: AppOptions): Hono {
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token !== opts.token) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  app.get("/api/sessions", (c) => c.json(manager.list()));

  app.post("/api/sessions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { title?: unknown; cwd?: unknown };
    const meta = await manager.createSession({
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
    });
    return c.json(meta, 201);
  });

  app.post("/api/sessions/:id/messages", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text : "";
    void manager.send(c.req.param("id"), text);
    return c.json({ accepted: true }, 202);
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

  return app;
}

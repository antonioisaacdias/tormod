import type { BrainAdapter, BrainEvent, HistoryItem, PermissionResponse } from "../brain/adapter.js";
import { classifyTool } from "../permission/policy.js";
import { Audit } from "../audit/audit.js";
import type { SessionStore } from "./store.js";
import type { GlobalEvent, ServerEvent, SessionActivity } from "./events.js";

export interface SessionMeta {
  id: string;
  status: "live" | "closed";
  title: string;
  cwd?: string;
  createdAt: string;
  /** Live activity while the session is live (drives the sidebar status dot). */
  activity?: "idle" | "working" | "waiting";
}

type Subscriber = (event: ServerEvent) => void;

interface Pending {
  resolve: (resp: PermissionResponse) => void;
}

/**
 * Owns session lifecycle and the permission bridge. Registers as the brain
 * adapter's event + permission handler; classifies each tool request and
 * either auto-resolves (auto/deny) or parks approval requests until a human
 * decision arrives via resolveDecision().
 */
export class SessionManager {
  private readonly sessions = new Map<string, SessionMeta>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly globalSubs = new Set<(event: GlobalEvent) => void>();
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly adapter: BrainAdapter,
    private readonly audit: Audit,
    private readonly store?: SessionStore,
    private readonly classify = classifyTool,
  ) {
    this.adapter.onEvent((sessionId, event) => this.onBrainEvent(sessionId, event));
    this.adapter.onPermissionRequest((sessionId, request, toolUseId) =>
      this.onPermission(sessionId, request, toolUseId),
    );
    this.adapter.onSessionId((sessionId, brainSessionId) =>
      this.store?.setClaudeId(sessionId, brainSessionId),
    );
    if (this.store) this.hydrate(this.store);
  }

  /**
   * Rebuilds the session list from the durable store on boot. Processes die on
   * restart, so every rehydrated session is marked closed; its brain id is fed
   * back to the adapter so history/resume keep working.
   */
  private hydrate(store: SessionStore): void {
    for (const row of store.all()) {
      const meta: SessionMeta = {
        id: row.id,
        status: "closed",
        title: row.title,
        ...(row.cwd ? { cwd: row.cwd } : {}),
        createdAt: row.createdAt,
      };
      this.sessions.set(row.id, meta);
      if (row.status !== "closed") store.setStatus(row.id, "closed");
      if (row.claudeId) this.adapter.registerSession(row.id, row.claudeId);
    }
  }

  async createSession(opts: { title?: string; cwd?: string }): Promise<SessionMeta> {
    const id = await this.adapter.startSession({ ...(opts.cwd ? { cwd: opts.cwd } : {}) });
    const meta: SessionMeta = {
      id,
      status: "live",
      title: opts.title ?? "Nova sessão",
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      createdAt: new Date().toISOString(),
    };
    meta.activity = "idle";
    this.sessions.set(id, meta);
    this.store?.upsert({
      id,
      title: meta.title,
      ...(meta.cwd ? { cwd: meta.cwd } : {}),
      status: "live",
      createdAt: meta.createdAt,
    });
    return meta;
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()];
  }

  async send(id: string, text: string): Promise<void> {
    const meta = this.sessions.get(id);
    if (!meta) return;
    if (meta.status !== "live") {
      await this.adapter.resumeSession(id);
      meta.status = "live";
      this.store?.setStatus(id, "live");
    }
    this.setActivity(id, "working");
    await this.adapter.sendMessage(id, text);
  }

  subscribeAll(fn: (event: GlobalEvent) => void): () => void {
    this.globalSubs.add(fn);
    return () => this.globalSubs.delete(fn);
  }

  private setActivity(id: string, activity: "idle" | "working" | "waiting"): void {
    const meta = this.sessions.get(id);
    if (!meta || meta.status !== "live" || meta.activity === activity) return;
    meta.activity = activity;
    this.broadcast({ type: "session_status", id, status: activity });
  }

  private broadcast(event: GlobalEvent): void {
    for (const fn of this.globalSubs) fn(event);
  }

  history(id: string): Promise<HistoryItem[]> {
    return this.adapter.history(id);
  }

  async close(id: string): Promise<void> {
    await this.adapter.close(id);
    const meta = this.sessions.get(id);
    if (meta) meta.status = "closed";
    this.store?.setStatus(id, "closed");
    this.broadcast({ type: "session_status", id, status: "closed" });
  }

  remove(id: string): void {
    this.sessions.delete(id);
    this.subscribers.delete(id);
    this.store?.remove(id);
  }

  subscribe(id: string, fn: Subscriber): () => void {
    let set = this.subscribers.get(id);
    if (!set) { set = new Set(); this.subscribers.set(id, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  resolveDecision(toolUseId: string, allow: boolean, message?: string): void {
    const p = this.pending.get(toolUseId);
    if (!p) return;
    this.pending.delete(toolUseId);
    p.resolve({ allow, ...(message ? { message } : {}) });
  }

  private emit(sessionId: string, event: ServerEvent): void {
    const set = this.subscribers.get(sessionId);
    if (set) for (const fn of set) fn(event);
  }

  private onBrainEvent(sessionId: string, event: BrainEvent): void {
    this.emit(sessionId, event);
    if (event.type === "result" || event.type === "error") this.setActivity(sessionId, "idle");
    else if (event.type === "text" || event.type === "thinking" || event.type === "tool_use" || event.type === "tool_result") {
      this.setActivity(sessionId, "working");
    }
  }

  private onPermission(
    sessionId: string,
    request: { tool: string; input: Record<string, unknown> },
    toolUseId: string,
  ): Promise<PermissionResponse> {
    const decision = this.classify(request);
    const node = typeof request.input.node === "string" ? request.input.node : undefined;
    const command = typeof request.input.command === "string" ? request.input.command : undefined;

    if (decision.tier === "auto") {
      this.audit.record({ sessionId, ...(node ? { node } : {}), tool: request.tool, ...(command ? { command } : {}), tier: "read", approved: 0 });
      return Promise.resolve({ allow: true });
    }
    if (decision.tier === "deny") {
      this.audit.record({ sessionId, ...(node ? { node } : {}), tool: request.tool, ...(command ? { command } : {}), tier: "destructive", approved: 2 });
      return Promise.resolve({ allow: false, message: decision.reason });
    }
    this.emit(sessionId, {
      type: "permission_request",
      toolUseId,
      request,
      tier: decision.tier,
      ...(decision.literal ? { literal: decision.literal } : {}),
    });
    this.setActivity(sessionId, "waiting");
    return new Promise<PermissionResponse>((resolve) => {
      this.pending.set(toolUseId, {
        resolve: (resp) => {
          this.audit.record({ sessionId, ...(node ? { node } : {}), tool: request.tool, ...(command ? { command } : {}), tier: "mutate", approved: resp.allow ? 1 : 2 });
          this.emit(sessionId, { type: "permission_resolved", toolUseId, allow: resp.allow });
          this.setActivity(sessionId, "working");
          resolve(resp);
        },
      });
    });
  }
}

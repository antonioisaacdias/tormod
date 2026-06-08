import type { BrainAdapter, BrainEvent, PermissionResponse } from "../brain/adapter.js";
import { classifyTool } from "../permission/policy.js";
import { Audit } from "../audit/audit.js";
import type { ServerEvent } from "./events.js";

export interface SessionMeta {
  id: string;
  status: "live" | "closed";
  title: string;
  cwd?: string;
  createdAt: string;
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
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly adapter: BrainAdapter,
    private readonly audit: Audit,
    private readonly classify = classifyTool,
  ) {
    this.adapter.onEvent((sessionId, event) => this.onBrainEvent(sessionId, event));
    this.adapter.onPermissionRequest((sessionId, request, toolUseId) =>
      this.onPermission(sessionId, request, toolUseId),
    );
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
    this.sessions.set(id, meta);
    return meta;
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()];
  }

  async send(id: string, text: string): Promise<void> {
    await this.adapter.sendMessage(id, text);
  }

  async close(id: string): Promise<void> {
    await this.adapter.close(id);
    const meta = this.sessions.get(id);
    if (meta) meta.status = "closed";
  }

  remove(id: string): void {
    this.sessions.delete(id);
    this.subscribers.delete(id);
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
    return new Promise<PermissionResponse>((resolve) => {
      this.pending.set(toolUseId, {
        resolve: (resp) => {
          this.audit.record({ sessionId, ...(node ? { node } : {}), tool: request.tool, ...(command ? { command } : {}), tier: "mutate", approved: resp.allow ? 1 : 2 });
          this.emit(sessionId, { type: "permission_resolved", toolUseId, allow: resp.allow });
          resolve(resp);
        },
      });
    });
  }
}

import type { BrainAdapter, BrainEvent, HistoryItem, PermissionResponse } from "../brain/adapter.js";
import { classifyTool } from "../permission/policy.js";
import { Audit } from "../audit/audit.js";
import type { SessionStore, UsageSnapshot } from "./store.js";
import type { GlobalEvent, ServerEvent } from "./events.js";
import { DEFAULTS, type PermissionMode, type Settings, type SettingsStore } from "../settings/store.js";

const MODEL_IDS: Record<"opus" | "sonnet" | "haiku", string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
};

export interface SessionMeta {
  id: string;
  status: "live" | "closed";
  title: string;
  cwd?: string;
  createdAt: string;
  lastActivityAt: string;
  /** Live activity while the session is live (drives the sidebar status dot). */
  activity?: "idle" | "working" | "waiting";
  /** Last-known usage (model/context/limits), so the infoline shows it on open. */
  usage?: UsageSnapshot;
  /** 'default' parks the approve tier on a card; 'auto' auto-approves it (deny stays). */
  permissionMode: PermissionMode;
}

type Subscriber = (event: ServerEvent) => void;

interface Pending {
  sessionId: string;
  /** The original permission_request event, replayed to subscribers that connect later (e.g. after a reload). */
  event: ServerEvent;
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
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly adapter: BrainAdapter,
    private readonly audit: Audit,
    private readonly store?: SessionStore,
    private readonly settingsStore?: SettingsStore,
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
    if (this.settingsStore) {
      this.sweepTimer = setInterval(() => void this.sweepIdle(), 60_000);
      this.sweepTimer.unref?.();
    }
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
        lastActivityAt: row.lastActivityAt,
        ...(row.usage ? { usage: row.usage } : {}),
        permissionMode: row.permissionMode ?? "default",
      };
      this.sessions.set(row.id, meta);
      if (row.status !== "closed") store.setStatus(row.id, "closed");
      if (row.claudeId) this.adapter.registerSession(row.id, row.claudeId);
    }
  }

  private settings(): Settings {
    return this.settingsStore?.get() ?? DEFAULTS;
  }

  async createSession(opts: { title?: string; cwd?: string }): Promise<SessionMeta> {
    const cfg = this.settings();
    const model = cfg.defaultModel === "auto" ? undefined : MODEL_IDS[cfg.defaultModel];
    const effort = cfg.defaultEffort === "auto" ? undefined : cfg.defaultEffort;
    const id = await this.adapter.startSession({
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(cfg.systemPrompt.trim() ? { systemPrompt: cfg.systemPrompt } : {}),
    });
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id,
      status: "live",
      title: opts.title ?? "Nova sessão",
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      createdAt: now,
      lastActivityAt: now,
      activity: "idle",
      permissionMode: cfg.defaultPermissionMode,
    };
    this.sessions.set(id, meta);
    this.store?.upsert({
      id,
      title: meta.title,
      ...(meta.cwd ? { cwd: meta.cwd } : {}),
      status: "live",
      createdAt: meta.createdAt,
      lastActivityAt: meta.lastActivityAt,
      permissionMode: meta.permissionMode,
    });
    await this.enforceCap(id);
    return meta;
  }

  private async enforceCap(exceptId: string): Promise<void> {
    const max = this.settings().maxLiveSessions;
    const live = [...this.sessions.values()].filter((m) => m.status === "live");
    if (live.length <= max) return;
    const idle = live
      .filter((m) => m.id !== exceptId && m.activity !== "working" && m.activity !== "waiting")
      .sort((x, y) => x.lastActivityAt.localeCompare(y.lastActivityAt));
    const toClose = idle.slice(0, live.length - max);
    for (const m of toClose) await this.close(m.id);
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
    this.touch(id, true);
    this.setActivity(id, "working");
    await this.adapter.sendMessage(id, text);
  }

  subscribeAll(fn: (event: GlobalEvent) => void): () => void {
    this.globalSubs.add(fn);
    return () => this.globalSubs.delete(fn);
  }

  private touch(id: string, persist: boolean): void {
    const meta = this.sessions.get(id);
    if (!meta) return;
    meta.lastActivityAt = new Date().toISOString();
    if (persist) this.store?.setActivity(id, meta.lastActivityAt);
  }

  private setActivity(id: string, activity: "idle" | "working" | "waiting"): void {
    const meta = this.sessions.get(id);
    this.touch(id, false);
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

  async interrupt(id: string): Promise<void> {
    await this.adapter.interrupt(id);
  }

  setPermissionMode(id: string, mode: PermissionMode): void {
    const meta = this.sessions.get(id);
    if (!meta || meta.permissionMode === mode) return;
    meta.permissionMode = mode;
    this.store?.setPermissionMode(id, mode);
  }

  async close(id: string): Promise<void> {
    await this.adapter.close(id);
    const meta = this.sessions.get(id);
    if (meta) meta.status = "closed";
    this.store?.setStatus(id, "closed");
    if (meta) this.store?.setActivity(id, meta.lastActivityAt);
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
    for (const p of this.pending.values()) if (p.sessionId === id) fn(p.event);
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
    if (event.type === "usage") {
      this.mergeUsage(sessionId, event);
      return;
    }
    if (event.type === "result" || event.type === "error") this.setActivity(sessionId, "idle");
    else if (event.type === "text" || event.type === "thinking" || event.type === "tool_use" || event.type === "tool_result") {
      this.setActivity(sessionId, "working");
    }
  }

  private mergeUsage(id: string, event: BrainEvent & { type: "usage" }): void {
    const meta = this.sessions.get(id);
    if (!meta) return;
    const snap: UsageSnapshot = { ...(meta.usage ?? {}) };
    if (event.model !== undefined) snap.model = event.model;
    if (event.contextTokens !== undefined) snap.contextTokens = event.contextTokens;
    if (event.contextWindow !== undefined) snap.contextWindow = event.contextWindow;
    if (event.fiveHourPct !== undefined) snap.fiveHourPct = event.fiveHourPct;
    if (event.sevenDayPct !== undefined) snap.sevenDayPct = event.sevenDayPct;
    meta.usage = snap;
    this.store?.setUsage(id, snap);
  }

  async sweepIdle(): Promise<void> {
    const hours = this.settings().idleCloseHours;
    if (hours <= 0) return;
    const cutoff = Date.now() - hours * 3600_000;
    const stale = [...this.sessions.values()].filter(
      (m) =>
        m.status === "live" &&
        m.activity !== "working" &&
        m.activity !== "waiting" &&
        Date.parse(m.lastActivityAt) < cutoff,
    );
    for (const m of stale) await this.close(m.id);
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
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
    if (this.sessions.get(sessionId)?.permissionMode === "auto") {
      this.audit.record({ sessionId, ...(node ? { node } : {}), tool: request.tool, ...(command ? { command } : {}), tier: "mutate", approved: 1 });
      return Promise.resolve({ allow: true });
    }
    const requestEvent: ServerEvent = {
      type: "permission_request",
      toolUseId,
      request,
      tier: decision.tier,
      ...(decision.literal ? { literal: decision.literal } : {}),
    };
    this.emit(sessionId, requestEvent);
    this.setActivity(sessionId, "waiting");
    return new Promise<PermissionResponse>((resolve) => {
      this.pending.set(toolUseId, {
        sessionId,
        event: requestEvent,
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

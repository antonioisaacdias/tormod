import type { PermissionDecision, ToolRequest } from "../types.js";

/** Events streamed from the brain to the host (provider-neutral). */
export type BrainEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; request: ToolRequest }
  | { type: "tool_result"; id: string; ok: boolean; summary: string }
  | { type: "result"; ok: boolean; costUsd?: number }
  | { type: "usage"; model?: string; contextTokens?: number; contextWindow?: number; fiveHourPct?: number; sevenDayPct?: number }
  | { type: "error"; message: string };

/** A past turn reconstructed from the durable transcript (provider-neutral). */
export type HistoryItem =
  | { role: "user"; text: string }
  | { role: "brain"; text: string }
  | { role: "tool"; tool: string; input: Record<string, unknown>; id?: string };

/** Decision returned to the brain for a pending tool use. */
export interface PermissionResponse {
  allow: boolean;
  /** Optional message shown to the brain when denied. */
  message?: string;
}

/**
 * Callback the host registers to decide on a tool use. Async: it may await a
 * human pressing a button in the browser. Mirrors the Agent SDK `canUseTool`.
 */
export type PermissionHandler = (
  sessionId: string,
  request: ToolRequest,
  toolUseId: string,
) => Promise<PermissionResponse>;

/**
 * The seam between Tormod and any "brain" (Claude Code today; Codex/local
 * later). Implementations live behind this interface so nothing above it is
 * provider-specific.
 */
export interface BrainAdapter {
  /** Start a fresh session; resolves with the session id. */
  startSession(opts: { cwd?: string; model?: string; effort?: string; systemPrompt?: string }): Promise<string>;
  /** Resume an existing session by id. */
  resumeSession(id: string): Promise<void>;
  /** Send a user message into a live session. */
  sendMessage(id: string, text: string): Promise<void>;
  /** Stop the current turn without closing the session (it stays live for more messages). */
  interrupt(id: string): Promise<void>;
  /** Tear down the live process for a session (transcript persists). */
  close(id: string): Promise<void>;
  /** Reconstruct past turns from the durable transcript (empty if unknown). */
  history(id: string): Promise<HistoryItem[]>;
  /** Register the stream handler for brain events. */
  onEvent(handler: (sessionId: string, event: BrainEvent) => void): void;
  /** Register the permission handler (the approval-card bridge). */
  onPermissionRequest(handler: PermissionHandler): void;
  /** Register a callback fired once the brain's durable session id is known. */
  onSessionId(handler: (sessionId: string, brainSessionId: string) => void): void;
  /** Seed a known session→brain-id mapping (e.g. rehydrated after a restart). */
  registerSession(sessionId: string, brainSessionId: string): void;
}

export type { PermissionDecision, ToolRequest };

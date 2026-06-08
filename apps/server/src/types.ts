/** Permission tier — maps to the palette colors safe/approve/danger. */
export type Tier = "auto" | "approve" | "deny";

/** A tool-use request as surfaced by the brain (provider-neutral shape). */
export interface ToolRequest {
  /** Tool name, e.g. "Read", "Edit", "Bash", "WebFetch". */
  tool: string;
  /** Tool-specific input. For Bash, expects `{ command: string }`. */
  input: Record<string, unknown>;
}

/** Result of classifying a ToolRequest. */
export interface PermissionDecision {
  tier: Tier;
  /** Short, human-readable reason shown in logs / the approval card. */
  reason: string;
  /** The literal command/diff to display when tier === "approve". */
  literal?: string;
}

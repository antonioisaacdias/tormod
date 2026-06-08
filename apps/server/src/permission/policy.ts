import { split } from "shlex";
import type { PermissionDecision, ToolRequest } from "../types.js";
import { DEFAULT_POLICY, type PolicyConfig } from "./defaults.js";

const deny = (reason: string): PermissionDecision => ({ tier: "deny", reason });
const auto = (reason: string): PermissionDecision => ({ tier: "auto", reason });
const approve = (reason: string, literal?: string): PermissionDecision => ({
  tier: "approve",
  reason,
  ...(literal === undefined ? {} : { literal }),
});

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Shell metacharacters that defeat argv-level reasoning (chaining, redirection, substitution). */
const META = /[;|&><$()`]/;

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}

/**
 * Classify a tool-use request into a permission tier. Pure function — no I/O.
 * Security gate: nothing that mutates state is `auto`; nothing `auto` can
 * exfiltrate or mutate. When safety cannot be PROVEN, default to `approve`.
 */
export function classifyTool(
  req: ToolRequest,
  config: PolicyConfig = DEFAULT_POLICY,
): PermissionDecision {
  if (config.outboundTools.has(req.tool)) {
    return approve("outbound tool — never auto (exfiltration risk)");
  }
  if (config.readOnlyTools.has(req.tool)) {
    return auto("read-only tool");
  }
  if (req.tool === "Bash") {
    const cmd = req.input.command;
    if (typeof cmd !== "string") {
      return approve("non-string Bash command — cannot prove safe");
    }
    return classifyBash(cmd, config);
  }
  return approve("mutating or unknown tool — requires approval");
}

function classifyBash(command: string, config: PolicyConfig): PermissionDecision {
  const trimmed = command.trim();
  if (trimmed === "") return approve("empty command", command);

  // 1. Destructive substring net on the raw command (catches chained/hidden rm -rf, fork bomb, etc.).
  const lower = trimmed.toLowerCase();
  for (const sub of config.destructiveSubstrings) {
    if (lower.includes(sub)) return deny(`destructive pattern: ${sub}`);
  }

  // 2. Tokenize. If we cannot parse it, we cannot prove it safe.
  let tokens: string[];
  try {
    tokens = split(trimmed);
  } catch {
    return approve("unparseable command — cannot prove safe", command);
  }
  if (tokens.length === 0) return approve("empty command", command);

  // 3. Strip leading NAME=value env assignments so we see the real binary.
  let i = 0;
  while (i < tokens.length && ASSIGNMENT.test(tokens[i] ?? "")) i++;
  const rest = tokens.slice(i);
  if (rest.length === 0) return approve("only environment assignments", command);

  // 4. Destructive binary (normalized via basename so /bin/rm == rm).
  const bin = basename(rest[0] ?? "");
  if (config.destructiveBins.has(bin)) return deny(`destructive binary: ${bin}`);

  // 5. Shell metacharacters (chaining/redirection/substitution) → cannot prove safe.
  if (META.test(trimmed)) return approve("shell metacharacters — cannot prove safe", command);

  // 6. Proven-safe single command?
  const two = rest.length >= 2 ? `${bin} ${rest[1]}` : "";
  if (config.safeBash.has(two) || config.safeBash.has(bin)) {
    return auto(`safe command: ${bin}`);
  }

  return approve("command not on safe allowlist — requires approval", command);
}

/** Tools that only read — run without an approval card. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "Read", "Grep", "Glob", "NotebookRead", "TodoRead", "ListMcpResources",
]);

/**
 * Outbound/network tools. NEVER auto — a tricked brain could exfiltrate
 * (read a secret, then POST it out). Always require approval.
 */
export const OUTBOUND_TOOLS: ReadonlySet<string> = new Set([
  "WebFetch", "WebSearch",
]);

/**
 * Bash first-token + (optional) second-token combos that are provably
 * read-only. Matched after shlex tokenization. A bare binary matches when
 * the command's argv[0] equals it; "bin sub" matches argv[0]+argv[1].
 */
export const SAFE_BASH: ReadonlySet<string> = new Set([
  "ls", "cat", "head", "tail", "pwd", "whoami", "id", "date", "uptime",
  "df", "free", "uname", "hostname", "ss",
  "ps", "top", "echo", "which", "stat", "wc", "grep",
  "docker ps", "docker logs", "docker images", "docker inspect",
  "systemctl status", "systemctl is-active", "systemctl is-enabled",
  "systemctl list-units", "journalctl",
  "git status", "git log", "git diff", "git show", "git branch",
  "wg show", "ufw status",
]);

/**
 * Destructive Bash binaries (argv[0]) — deny outright.
 */
export const DESTRUCTIVE_BINS: ReadonlySet<string> = new Set([
  "sudo", "su", "dd", "mkfs", "fdisk", "parted", "shutdown", "reboot",
  "halt", "poweroff", "init",
  "rm", "rmdir", "shred", "truncate",
]);

/** Substrings that, if present anywhere in a Bash command, force deny. */
export const DESTRUCTIVE_SUBSTRINGS: readonly string[] = [
  "rm -rf", "rm -fr", "rm -r", "rm -f",
  ":(){:|:&};:",
  "mkfs", "> /dev/sd", "of=/dev/",
  "chmod -R 777 /",
];

/** Config the policy is constructed with. Lets callers extend the defaults. */
export interface PolicyConfig {
  readOnlyTools: ReadonlySet<string>;
  outboundTools: ReadonlySet<string>;
  safeBash: ReadonlySet<string>;
  destructiveBins: ReadonlySet<string>;
  destructiveSubstrings: readonly string[];
}

export const DEFAULT_POLICY: PolicyConfig = {
  readOnlyTools: READ_ONLY_TOOLS,
  outboundTools: OUTBOUND_TOOLS,
  safeBash: SAFE_BASH,
  destructiveBins: DESTRUCTIVE_BINS,
  destructiveSubstrings: DESTRUCTIVE_SUBSTRINGS,
};

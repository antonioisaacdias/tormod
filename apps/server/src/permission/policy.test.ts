import { describe, it, expect } from "vitest";
import { classifyTool } from "./policy.js";

const bash = (command: string) => ({ tool: "Bash", input: { command } });

describe("classifyTool — read tools auto", () => {
  it("Read is auto", () => {
    expect(classifyTool({ tool: "Read", input: { file_path: "/x" } }).tier).toBe("auto");
  });
  it("Grep is auto", () => {
    expect(classifyTool({ tool: "Grep", input: { pattern: "x" } }).tier).toBe("auto");
  });
});

describe("classifyTool — outbound is never auto (exfiltration)", () => {
  it("WebFetch requires approval", () => {
    expect(classifyTool({ tool: "WebFetch", input: { url: "http://x" } }).tier).toBe("approve");
  });
  it("WebSearch requires approval", () => {
    expect(classifyTool({ tool: "WebSearch", input: { query: "x" } }).tier).toBe("approve");
  });
});

describe("classifyTool — mutating tools require approval", () => {
  it("Edit is approve", () => {
    expect(classifyTool({ tool: "Edit", input: { file_path: "/x" } }).tier).toBe("approve");
  });
  it("Write is approve", () => {
    expect(classifyTool({ tool: "Write", input: { file_path: "/x" } }).tier).toBe("approve");
  });
  it("unknown tool defaults to approve (safe default)", () => {
    expect(classifyTool({ tool: "SomeNewTool", input: {} }).tier).toBe("approve");
  });
});

describe("classifyTool — Bash safe commands are auto", () => {
  for (const cmd of ["df -h", "free -m", "uptime", "systemctl status forgejo",
                     "journalctl -u forgejo -n 40", "docker ps", "git status"]) {
    it(`auto: ${cmd}`, () => {
      expect(classifyTool(bash(cmd)).tier).toBe("auto");
    });
  }
});

describe("classifyTool — Bash mutating commands require approval", () => {
  for (const cmd of ["systemctl restart forgejo", "docker compose up -d",
                     "mv a b", "git push", "npm install"]) {
    it(`approve: ${cmd}`, () => {
      const d = classifyTool(bash(cmd));
      expect(d.tier).toBe("approve");
      expect(d.literal).toBe(cmd);
    });
  }
});

describe("classifyTool — destructive Bash is denied (prompt-injection backstop)", () => {
  for (const cmd of ["rm -rf /", "rm -rf ~/data", "sudo systemctl restart x",
                     "dd if=/dev/zero of=/dev/sda", "mkfs.ext4 /dev/sdb",
                     "echo hi && rm -rf /tmp/x", ":(){:|:&};:"]) {
    it(`deny: ${cmd}`, () => {
      expect(classifyTool(bash(cmd)).tier).toBe("deny");
    });
  }
});

describe("classifyTool — Bash parsing robustness", () => {
  it("a safe binary with a chained destructive command is NOT auto", () => {
    expect(classifyTool(bash("df -h ; rm -rf /")).tier).toBe("deny");
  });
  it("empty command is approve (cannot prove safe)", () => {
    expect(classifyTool(bash("")).tier).toBe("approve");
  });
  it("unparseable command is approve (cannot prove safe)", () => {
    expect(classifyTool(bash('echo "unterminated')).tier).toBe("approve");
  });
});

import { describe, it, expect } from "vitest";
import { Audit } from "./audit.js";

describe("Audit", () => {
  it("records and queries entries", () => {
    const audit = Audit.open(":memory:");
    audit.record({ node: "truenas", tool: "Bash", command: "systemctl restart x", tier: "mutate", approved: 1 });
    audit.record({ node: "odin", tool: "Read", tier: "read", approved: 0 });
    const all = audit.query({});
    expect(all.length).toBe(2);
    expect(all[0]!.tool).toBeDefined();
  });

  it("filters by node and tier", () => {
    const audit = Audit.open(":memory:");
    audit.record({ node: "truenas", tool: "Bash", tier: "mutate", approved: 1 });
    audit.record({ node: "odin", tool: "Bash", tier: "read", approved: 0 });
    expect(audit.query({ node: "truenas" }).length).toBe(1);
    expect(audit.query({ tier: "read" }).length).toBe(1);
  });

  it("auto-fills an ISO timestamp", () => {
    const audit = Audit.open(":memory:");
    audit.record({ tool: "Read", tier: "read", approved: 0 });
    expect(audit.query({})[0]!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

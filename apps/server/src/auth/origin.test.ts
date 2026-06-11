import { describe, it, expect } from "vitest";
import { resolveClientIp, isLocal } from "./origin.js";

const CIDRS = ["192.168.0.0/24", "10.0.0.0/24", "127.0.0.1/32", "::1/128"];

describe("resolveClientIp", () => {
  it("uses the socket peer when there is no trusted proxy", () => {
    expect(resolveClientIp("203.0.113.5", "192.168.0.9", null)).toBe("203.0.113.5");
  });

  it("honors XFF only when the peer is the trusted proxy", () => {
    expect(resolveClientIp("10.0.0.1", "203.0.113.5", "10.0.0.1")).toBe("203.0.113.5");
    expect(resolveClientIp("203.0.113.9", "192.168.0.9", "10.0.0.1")).toBe("203.0.113.9");
  });

  it("takes the left-most XFF entry", () => {
    expect(resolveClientIp("10.0.0.1", "203.0.113.5, 10.0.0.1", "10.0.0.1")).toBe("203.0.113.5");
  });
});

describe("isLocal", () => {
  it("matches LAN, VPN and loopback", () => {
    expect(isLocal("192.168.0.10", CIDRS)).toBe(true);
    expect(isLocal("10.0.0.11", CIDRS)).toBe(true);
    expect(isLocal("127.0.0.1", CIDRS)).toBe(true);
    expect(isLocal("::1", CIDRS)).toBe(true);
    expect(isLocal("::ffff:192.168.0.10", CIDRS)).toBe(true);
  });

  it("rejects public addresses", () => {
    expect(isLocal("203.0.113.5", CIDRS)).toBe(false);
    expect(isLocal("8.8.8.8", CIDRS)).toBe(false);
  });
});

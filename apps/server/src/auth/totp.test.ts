import { describe, it, expect } from "vitest";
import { generateSync, verifySync } from "otplib";
import { generateSecret, otpauthUri, verifyTotp, qrDataUrl } from "./totp.js";

describe("totp", () => {
  it("verifies a freshly generated code and rejects a wrong one", () => {
    const secret = generateSecret();
    const code = generateSync({ secret });
    expect(verifyTotp(code, secret)).toBe(true);
    expect(verifyTotp("000000", secret)).toBe(false);
  });

  it("builds an otpauth uri carrying issuer and account", () => {
    const uri = otpauthUri("odin", "JBSWY3DPEHPK3PXP");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("Tormod");
    expect(uri).toContain("odin");
  });

  it("renders the uri to a png data url", async () => {
    const url = await qrDataUrl("otpauth://totp/Tormod:odin?secret=JBSWY3DPEHPK3PXP&issuer=Tormod");
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });
});

import { generateSecret as otplibGenerateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

export function generateSecret(): string {
  return otplibGenerateSecret();
}

export function otpauthUri(username: string, secret: string): string {
  return generateURI({ issuer: "Tormod", label: username, secret });
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    return verifySync({ token, secret }).valid;
  } catch {
    return false;
  }
}

export function qrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}

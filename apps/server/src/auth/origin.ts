export function resolveClientIp(
  socketIp: string,
  xff: string | undefined,
  trustedProxy: string | null,
): string {
  if (trustedProxy && socketIp === trustedProxy && xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return socketIp;
}

function normalize(ip: string): string {
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function matchCidr(ip: string, cidr: string): boolean {
  const parts = cidr.split("/");
  const range = parts[0] ?? "";
  const bits = Number(parts[1] ?? "0");
  if (range.includes(":") || ip.includes(":")) return ip === range;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export function isLocal(ip: string, cidrs: string[]): boolean {
  const norm = normalize(ip);
  return cidrs.some((c) => matchCidr(norm, c) || matchCidr(ip, c));
}

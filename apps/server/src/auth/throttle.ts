const IP_WINDOW_MS = 60_000;
const IP_MAX = 5;
const IP_BLOCK_MS = 15 * 60_000;
const USER_MAX = 5;
const USER_LOCK_MS = 10 * 60_000;

interface IpState {
  hits: number[];
  blockedUntil: number;
}
interface UserState {
  failures: number;
  lockedUntil: number;
}

export class Throttle {
  private ips = new Map<string, IpState>();
  private users = new Map<string, UserState>();

  checkIp(ip: string, now: number = Date.now()): boolean {
    const s = this.ips.get(ip) ?? { hits: [], blockedUntil: 0 };
    if (now < s.blockedUntil) {
      this.ips.set(ip, s);
      return false;
    }
    s.hits = s.hits.filter((t) => now - t < IP_WINDOW_MS);
    if (s.hits.length >= IP_MAX) {
      s.blockedUntil = now + IP_BLOCK_MS;
      this.ips.set(ip, s);
      return false;
    }
    s.hits.push(now);
    this.ips.set(ip, s);
    return true;
  }

  isLocked(username: string, now: number = Date.now()): boolean {
    const s = this.users.get(username);
    return !!s && now < s.lockedUntil;
  }

  recordFailure(username: string, now: number = Date.now()): void {
    const s = this.users.get(username) ?? { failures: 0, lockedUntil: 0 };
    s.failures += 1;
    if (s.failures >= USER_MAX) s.lockedUntil = now + USER_LOCK_MS;
    this.users.set(username, s);
  }

  recordSuccess(username: string): void {
    this.users.delete(username);
  }
}

import { hash, verify } from "@node-rs/argon2";

// Algorithm is a const enum in @node-rs/argon2 (no runtime binding under isolatedModules);
// 2 is its Argon2id member.
const ARGON2ID = 2;
const OPTS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

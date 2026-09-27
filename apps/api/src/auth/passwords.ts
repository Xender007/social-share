import argon2 from 'argon2';

export const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Hash used to keep login timing similar when the email doesn't exist. */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$2Yx0oQ0mB9mXcR8H1m6Zr1q1x6pXjv2P0x3bM6qkq5w';

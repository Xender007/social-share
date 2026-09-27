import { randomBytes } from 'node:crypto';
import type { AppConfig } from '../config/app-config';
import { TokenCipher, tokenAad } from './token-cipher';

function cipherWith(keys: Record<number, Buffer>, active: number): TokenCipher {
  const env = { TOKEN_ENCRYPTION_KEYS: new Map(Object.entries(keys).map(([v, k]) => [Number(v), k])), TOKEN_ENCRYPTION_ACTIVE_VERSION: active };
  return new TokenCipher({ env } as unknown as AppConfig);
}

describe('TokenCipher', () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);
  const aad = tokenAad('provider_connections', 'row-1', 'access_token_enc');

  it('round-trips a token', () => {
    const cipher = cipherWith({ 1: k1 }, 1);
    const { data, keyVersion } = cipher.encrypt('ya29.secret-token', aad);
    expect(keyVersion).toBe(1);
    expect(Buffer.from(data).toString('utf8')).not.toContain('secret-token');
    expect(cipher.decrypt(data, aad)).toBe('ya29.secret-token');
  });

  it('produces different ciphertexts for the same plaintext', () => {
    const cipher = cipherWith({ 1: k1 }, 1);
    const a = Buffer.from(cipher.encrypt('same', aad).data);
    const b = Buffer.from(cipher.encrypt('same', aad).data);
    expect(a.equals(b)).toBe(false);
  });

  it('rejects a ciphertext moved to another row (AAD mismatch)', () => {
    const cipher = cipherWith({ 1: k1 }, 1);
    const { data } = cipher.encrypt('token', aad);
    expect(() => cipher.decrypt(data, tokenAad('provider_connections', 'row-2', 'access_token_enc'))).toThrow();
  });

  it('rejects tampered ciphertext', () => {
    const cipher = cipherWith({ 1: k1 }, 1);
    const { data } = cipher.encrypt('token', aad);
    data[data.length - 1] ^= 0xff;
    expect(() => cipher.decrypt(data, aad)).toThrow();
  });

  it('decrypts old-version values after rotation and encrypts with the new key', () => {
    const before = cipherWith({ 1: k1 }, 1);
    const old = before.encrypt('legacy', aad).data;
    const after = cipherWith({ 1: k1, 2: k2 }, 2);
    expect(after.decrypt(old, aad)).toBe('legacy');
    expect(TokenCipher.keyVersionOf(old)).toBe(1);
    const fresh = after.encrypt('legacy', aad);
    expect(fresh.keyVersion).toBe(2);
    expect(TokenCipher.keyVersionOf(fresh.data)).toBe(2);
  });

  it('fails clearly when a key version is missing', () => {
    const old = cipherWith({ 1: k1 }, 1).encrypt('x', aad).data;
    expect(() => cipherWith({ 2: k2 }, 2).decrypt(old, aad)).toThrow('v1 is not configured');
  });
});

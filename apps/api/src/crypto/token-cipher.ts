import { Global, Injectable, Module } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfig } from '../config/app-config';

const FORMAT_VERSION = 1;
const HEADER_BYTES = 3; // 1 byte format + 2 bytes key version
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedValue {
  data: Uint8Array<ArrayBuffer>;
  keyVersion: number;
}

/** Binds a ciphertext to the row and column it belongs to, so it can't be copied elsewhere. */
export const tokenAad = (table: string, rowId: string, column: string): string => `${table}:${rowId}:${column}`;

/**
 * AES-256-GCM encryption for provider OAuth tokens (§14).
 * Layout: [format][keyVersion u16][iv 12][tag 16][ciphertext].
 */
@Injectable()
export class TokenCipher {
  constructor(private readonly config: AppConfig) {}

  encrypt(plaintext: string, aad: string): EncryptedValue {
    const version = this.config.env.TOKEN_ENCRYPTION_ACTIVE_VERSION;
    const key = this.key(version);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const header = Buffer.alloc(HEADER_BYTES);
    header.writeUInt8(FORMAT_VERSION, 0);
    header.writeUInt16BE(version, 1);
    const out = Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]);
    return { data: new Uint8Array(out), keyVersion: version };
  }

  decrypt(data: Uint8Array, aad: string): string {
    const buf = Buffer.from(data);
    if (buf.length < HEADER_BYTES + IV_BYTES + TAG_BYTES) throw new Error('Encrypted token is truncated');
    if (buf.readUInt8(0) !== FORMAT_VERSION) throw new Error('Unsupported encrypted token format');
    const key = this.key(buf.readUInt16BE(1));
    const iv = buf.subarray(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
    const tag = buf.subarray(HEADER_BYTES + IV_BYTES, HEADER_BYTES + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(HEADER_BYTES + IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  }

  /** Key version embedded in a ciphertext, used by the rotation script. */
  static keyVersionOf(data: Uint8Array): number {
    return Buffer.from(data).readUInt16BE(1);
  }

  private key(version: number): Buffer {
    const key = this.config.env.TOKEN_ENCRYPTION_KEYS.get(version);
    if (!key) throw new Error(`Token encryption key v${version} is not configured`);
    return key;
  }
}

@Global()
@Module({ providers: [TokenCipher], exports: [TokenCipher] })
export class CryptoModule {}

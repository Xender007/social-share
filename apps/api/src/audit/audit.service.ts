import { Global, Injectable, Module } from '@nestjs/common';
import type { RequestMeta } from '../common/request-context';
import { toJsonValue } from '../common/time';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, PrismaTx } from '../prisma/prisma.service';

export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  meta?: RequestMeta;
}

const SECRET_KEYS = /token|secret|password|signed_?url|code_?verifier/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(v)]),
    );
  }
  return value;
}

const json = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined ? undefined : (toJsonValue(redact(value)) as Prisma.InputJsonValue);

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: PrismaTx): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        oldValue: json(entry.oldValue),
        newValue: json(entry.newValue),
        reason: entry.reason ?? null,
        ipAddress: entry.meta?.ip ?? null,
        requestId: entry.meta?.requestId ?? null,
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}

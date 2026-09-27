// Creates (or resets) the owner account. No signup endpoint exists in V1.
// Usage: pnpm --filter @sp/api create-owner -- --email you@example.com [--name "Your Name"] [--reset]
// The password is read from OWNER_PASSWORD so it never lands in shell history.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/auth/passwords';
import { PrismaClient } from '../src/generated/prisma/client';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name');
  const reset = process.argv.includes('--reset');
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) {
    console.error('Set OWNER_PASSWORD and pass --email <address>.');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('OWNER_PASSWORD must be at least 10 characters.');
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const owner = await prisma.accessLevel.findUnique({ where: { code: 'OWNER' } });
    if (!owner) throw new Error('Run the seed first (pnpm --filter @sp/api db:seed).');
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && !reset) {
      console.log(`User ${email} already exists. Use --reset to change the password.`);
      return;
    }
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, passwordHash, displayName: name ?? null, accessLevelId: owner.id },
      update: { passwordHash, accessLevelId: owner.id, status: 'ACTIVE', ...(name ? { displayName: name } : {}) },
    });
    await prisma.auditLog.create({ data: { actorUserId: user.id, action: existing ? 'user.password_reset' : 'user.created', entityType: 'user', entityId: user.id, newValue: { email, accessLevel: 'OWNER' } } });
    console.log(`${existing ? 'Updated' : 'Created'} owner ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

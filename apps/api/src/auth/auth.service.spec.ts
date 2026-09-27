import { AuthService } from './auth.service';

const meta = { requestId: 'req-1', ip: '127.0.0.1' };

function makeService(overrides: { user?: Record<string, unknown> } = {}) {
  const user = {
    id: 'u1',
    email: 'owner@example.com',
    displayName: 'Owner',
    accessLevel: { code: 'OWNER' },
    ...overrides.user,
  };

  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockImplementation(({ data }: { data: { displayName: string } }) =>
        Promise.resolve({ ...user, displayName: data.displayName }),
      ),
    },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new AuthService(prisma as never, undefined as never, undefined as never, audit as never);
  return { service, prisma, audit };
}

describe('AuthService.updateDisplayName', () => {
  it('updates the display name and returns the MeResponse shape', async () => {
    const { service, prisma } = makeService();

    const result = await service.updateDisplayName('u1', 'Suprotim', meta);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { displayName: 'Suprotim' },
      include: { accessLevel: true },
    });
    expect(result).toEqual({ id: 'u1', email: 'owner@example.com', displayName: 'Suprotim', accessLevel: 'OWNER' });
  });

  it('writes an audit log entry with the old and new display name', async () => {
    const { service, audit } = makeService({ user: { displayName: 'Owner' } });

    await service.updateDisplayName('u1', 'New Name', meta);

    expect(audit.record).toHaveBeenCalledWith({
      actorUserId: 'u1',
      action: 'user.updated',
      entityType: 'user',
      entityId: 'u1',
      oldValue: { displayName: 'Owner' },
      newValue: { displayName: 'New Name' },
      meta,
    });
  });
});

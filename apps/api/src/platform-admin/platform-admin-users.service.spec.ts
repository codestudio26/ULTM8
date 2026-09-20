import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminSubRole } from '@prisma/client';
import { PlatformAdminUsersService } from './platform-admin-users.service';

/**
 * Mocked-Prisma unit test, same convention as auth.service.spec.ts — used
 * here specifically for the revoke() lockout guard (a global count across
 * the whole AdminUser table, serialized behind a Postgres advisory lock),
 * which platform-admin-users.e2e-spec.ts deliberately does NOT attempt to
 * prove: that suite runs as one of several e2e spec files Jest executes in
 * parallel against the same real Postgres, and a global-count assertion
 * there would be racy against other suites' concurrently-seeded FULL_ADMIN
 * fixtures (and a real advisory lock can't be usefully exercised for
 * concurrency behavior through a single mocked-out $transaction call anyway).
 * A mocked Prisma client gives full, deterministic control over the count
 * instead — this proves the GUARD's branching logic, not the lock's actual
 * concurrency behavior (which is a Postgres-level guarantee, not this
 * service's own code to unit-test).
 */
describe('PlatformAdminUsersService', () => {
  let service: PlatformAdminUsersService;
  let prismaApp: any;
  let tx: any;
  let auditLog: any;

  const fullAdminCaller = { id: 'caller-1', revokedAt: null, subRole: AdminSubRole.FULL_ADMIN };

  beforeEach(() => {
    tx = {
      adminUser: { count: jest.fn(), update: jest.fn() },
      $executeRaw: jest.fn(),
    };
    prismaApp = {
      adminUser: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: any) => Promise<unknown>) => cb(tx)),
    };
    auditLog = { record: jest.fn() };
    service = new PlatformAdminUsersService(prismaApp, auditLog);
  });

  describe('revoke', () => {
    it('rejects a non-FULL_ADMIN caller before ever looking at the target', async () => {
      prismaApp.adminUser.findUnique.mockResolvedValueOnce({ id: 'caller-1', revokedAt: null, subRole: AdminSubRole.SUPPORT });
      await expect(service.revoke('caller-1', 'target-1')).rejects.toThrow(ForbiddenException);
      expect(prismaApp.$transaction).not.toHaveBeenCalled();
    });

    it('404s on a target that does not exist', async () => {
      prismaApp.adminUser.findUnique
        .mockResolvedValueOnce(fullAdminCaller) // assertFullAdmin's own lookup
        .mockResolvedValueOnce(null); // target lookup
      await expect(service.revoke('caller-1', 'missing')).rejects.toThrow(NotFoundException);
      expect(prismaApp.$transaction).not.toHaveBeenCalled();
    });

    it('is idempotent — an already-revoked target is returned as-is, no transaction, no audit write', async () => {
      prismaApp.adminUser.findUnique
        .mockResolvedValueOnce(fullAdminCaller)
        .mockResolvedValueOnce({ id: 'target-1', revokedAt: new Date('2026-01-01'), subRole: AdminSubRole.SUPPORT });
      prismaApp.adminUser.findUniqueOrThrow.mockResolvedValueOnce({ id: 'target-1', revokedAt: new Date('2026-01-01') });

      const result = await service.revoke('caller-1', 'target-1');

      expect(result).toMatchObject({ id: 'target-1' });
      expect(prismaApp.$transaction).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('revokes a non-FULL_ADMIN target without ever taking the advisory lock or checking the FULL_ADMIN count', async () => {
      prismaApp.adminUser.findUnique
        .mockResolvedValueOnce(fullAdminCaller)
        .mockResolvedValueOnce({ id: 'target-1', revokedAt: null, subRole: AdminSubRole.SUPPORT });
      tx.adminUser.update.mockResolvedValueOnce({ id: 'target-1', revokedAt: new Date() });

      const result = await service.revoke('caller-1', 'target-1');

      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.adminUser.count).not.toHaveBeenCalled();
      expect(tx.adminUser.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'target-1' }, data: { revokedAt: expect.any(Date) } }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ adminUserId: 'caller-1', action: 'REVOKE_ADMIN_USER', targetType: 'AdminUser', targetId: 'target-1' }),
      );
      expect(result).toMatchObject({ id: 'target-1' });
    });

    it('revokes a FULL_ADMIN target when at least one other active FULL_ADMIN exists, taking the advisory lock first', async () => {
      prismaApp.adminUser.findUnique
        .mockResolvedValueOnce(fullAdminCaller)
        .mockResolvedValueOnce({ id: 'target-1', revokedAt: null, subRole: AdminSubRole.FULL_ADMIN });
      tx.adminUser.count.mockResolvedValueOnce(1); // one other active FULL_ADMIN
      tx.adminUser.update.mockResolvedValueOnce({ id: 'target-1', revokedAt: new Date() });

      const result = await service.revoke('caller-1', 'target-1');

      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.adminUser.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subRole: AdminSubRole.FULL_ADMIN, revokedAt: null, id: { not: 'target-1' } },
        }),
      );
      expect(tx.adminUser.update).toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'target-1' });
    });

    it('refuses to revoke the last active FULL_ADMIN — 409, no update, no audit write', async () => {
      prismaApp.adminUser.findUnique
        .mockResolvedValueOnce(fullAdminCaller)
        .mockResolvedValueOnce({ id: 'caller-1', revokedAt: null, subRole: AdminSubRole.FULL_ADMIN });
      tx.adminUser.count.mockResolvedValueOnce(0); // no other active FULL_ADMIN — this IS the last one

      await expect(service.revoke('caller-1', 'caller-1')).rejects.toThrow(ConflictException);
      expect(tx.adminUser.update).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });
});

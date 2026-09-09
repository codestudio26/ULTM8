import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { resolveLimit } from '../common/pagination/cursor-paginate';
import { RegisterDeviceTokenDto } from './dto/device-token.dto';

/**
 * Phase 15 scope only: the read-side of a caller's own notifications (list,
 * mark-read) and DeviceToken registration/deregistration. See
 * `apps/api/src/jobs/notification-fanout.processor.ts` for the WRITE side —
 * that's a background job, not this service, since every Notification row this
 * phase is created for a target OTHER than the calling context (see that
 * processor's own header comment for why it runs via PrismaJobsService, not
 * this service).
 *
 * Everything here runs under the caller's own tenant context
 * (PrismaAppService.withTenantContext) — both Notification and DeviceToken are
 * self-only RLS, ALL commands, TO ultm8_app (see the Phase 15 migration), so a
 * caller can only ever read/mutate their own rows regardless of what id they
 * pass.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prismaApp: PrismaAppService) {}

  /**
   * FOUND ON REVIEW — a genuine defect in an earlier draft, not just a style
   * choice: this codebase's shared `cursorPaginate` helper always orders by
   * `id asc`, which is the right, established convention for every OTHER list
   * endpoint (where `id` is an opaque UUID and row order is otherwise
   * immaterial), but is actively wrong for a notification inbox — a random
   * UUID carries no chronological meaning, so reusing that helper here
   * produced a feed in effectively random order, not newest-first. This
   * method deliberately does NOT reuse `cursorPaginate` — it implements its
   * own keyset pagination ordered by `(createdAt, id)` descending, matching
   * the `Notification_userId_createdAt_id_idx` index the Phase 15 migration
   * adds for exactly this query shape. The cursor is an opaque base64url
   * JSON blob (`{createdAt, id}`), not just a bare id, since ordering now
   * needs two columns' worth of position to resume correctly.
   */
  async findAllForCaller(callerId: string, cursor?: string, limit?: number) {
    const take = resolveLimit(limit);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const decoded = cursor ? decodeCursor(cursor) : null;
      const where: Prisma.NotificationWhereInput = {
        userId: callerId,
        ...(decoded
          ? {
              OR: [
                { createdAt: { lt: decoded.createdAt } },
                { createdAt: decoded.createdAt, id: { lt: decoded.id } },
              ],
            }
          : {}),
      };
      const rows = await tx.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
      });
      const hasMore = rows.length > take;
      const items = hasMore ? rows.slice(0, take) : rows;
      return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
    });
  }

  /** Idempotent — marking an already-read Notification as read again is not a
   * conflicting state transition the way e.g. Booking status changes are (no
   * data loss, no double-processing risk), so this uses a plain `update`, not
   * the optimistic-concurrency `updateMany`+count-check pattern this codebase
   * uses for genuinely conflicting transitions. Unconditional (no `if
   * (existing.read) return existing` short-circuit) — found on review to be a
   * pure optimization with no behavioral difference worth the extra branch
   * and the comment needed to justify it. */
  async markRead(callerId: string, notificationId: string) {
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const existing = await tx.notification.findUnique({ where: { id: notificationId } });
      // RLS returns null (not another User's row) for a Notification outside the
      // caller's scope — a genuine 404 and an isolation-blocked read are
      // indistinguishable at this layer by design (ultm8-tenant-isolation §2).
      if (!existing) {
        throw new NotFoundException('Notification not found');
      }
      return tx.notification.update({ where: { id: notificationId }, data: { read: true } });
    });
  }

  /**
   * FOUND ON REVIEW — an earlier draft used a plain `upsert` keyed on `token`
   * and claimed a token already owned by a DIFFERENT User would be silently
   * "re-owned" by whoever re-registers it. That claim was wrong: DeviceToken
   * is self-only RLS (FORCE ROW LEVEL SECURITY), and Postgres's `INSERT ...
   * ON CONFLICT DO UPDATE` requires the conflicting row to pass the UPDATE
   * policy — a row belonging to someone else fails that check, so the
   * conflict resolution itself would have thrown a raw `unique_violation`
   * back through Prisma as an unhandled 500, not a controlled reassignment.
   *
   * This version never attempts a cross-user upsert at all: it first tries a
   * self-scoped `updateMany` (re-registration by the SAME User — the common
   * case, e.g. app relaunch — succeeds here). If that matches nothing, it
   * attempts a plain `create` (first-time registration for this token). If
   * THAT hits the unique constraint (P2002), the token already belongs to a
   * different User — surfaced as an explicit 409, not invented reassignment
   * behavior nothing confirmed. A genuinely new business rule (like
   * "resolve a token conflict by reassigning ownership") needs an actual
   * product/security decision, not a plausible-sounding guess — see
   * CLAUDE.md's standing escalation rule.
   */
  async registerDeviceToken(callerId: string, dto: RegisterDeviceTokenDto) {
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const updated = await tx.deviceToken.updateMany({
        where: { token: dto.token, userId: callerId },
        data: { platform: dto.platform, lastSeenAt: new Date() },
      });
      if (updated.count > 0) {
        return tx.deviceToken.findFirstOrThrow({ where: { token: dto.token, userId: callerId } });
      }

      try {
        return await tx.deviceToken.create({ data: { userId: callerId, platform: dto.platform, token: dto.token } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException(
            'This device token is already registered to a different account. Deregister it from that account first.',
          );
        }
        throw err;
      }
    });
  }

  async deregisterDeviceToken(callerId: string, deviceTokenId: string): Promise<void> {
    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const result = await tx.deviceToken.deleteMany({ where: { id: deviceTokenId, userId: callerId } });
      // deleteMany rather than delete — a plain `delete` throws P2025 (and 500s,
      // via the app's default exception mapping) for a row RLS already hides;
      // deleteMany simply deletes zero rows, which we then turn into an
      // explicit, correctly-shaped 404 — same reasoning as every other
      // self-only-RLS delete-by-id in this codebase.
      if (result.count === 0) {
        throw new NotFoundException('Device token not found');
      }
    });
  }
}

interface NotificationCursor {
  createdAt: Date;
  id: string;
}

function encodeCursor(n: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: n.createdAt.toISOString(), id: n.id })).toString('base64url');
}

function decodeCursor(cursor: string): NotificationCursor {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt: string; id: string };
  return { createdAt: new Date(parsed.createdAt), id: parsed.id };
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { resolveLimit } from '../common/pagination/cursor-paginate';
import { RegisterDeviceTokenDto } from './dto/device-token.dto';
import { SnoozeNotificationDto } from './dto/snooze-notification.dto';

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
        deletedAt: null,
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

  /**
   * v1.2 backend backlog ("Notifications page", Decision 204's Concept 5
   * finding) — a true, caller-wide total/unread count, not derived from
   * whatever page of `findAllForCaller` happens to be loaded client-side.
   * Same `withTenantContext` scoping as every other method here (self-only
   * RLS on `Notification`), plus the explicit `userId: callerId` filter —
   * belt-and-suspenders with RLS, matching `findAllForCaller`'s own
   * convention rather than relying on RLS alone.
   *
   * `unread` (v1.2 backend backlog — Snooze, approved by the product owner):
   * EXCLUDES a Notification currently snoozed (`snoozedUntil` in the future)
   * — live-computed here, the same "don't wait on a sweep job for
   * correctness" convention Membership.status's own live-computed expiry
   * already established in this codebase, rather than trusting
   * notification-unsnooze-sweep to have already cleared the column by the
   * time this runs. `snoozedUntil` in the PAST counts as unread even before
   * that sweep next runs — the live computation IS the source of truth here,
   * the sweep job only exists to return a snoozed Notification to the
   * ordinary unread list in storage (see that job's own header comment for
   * why it still needs to run regardless).
   *
   * `readWithin24hPercent`/`readWithin24hCount`/`readTotalCount` (v1.2
   * backend backlog — Read within 24h metric, approved by the product
   * owner): computed only over Notifications the caller has actually read
   * (`readAt` set) — see the response DTO's own header comment for why an
   * unread Notification is excluded from both the numerator and denominator
   * rather than counted as a miss.
   *
   * Deleted Notifications (Decision 277, `deletedAt` set) are left out of
   * `total`/`unread`, matching the list, but still count towards the
   * Read-within-24h metric: they were read, and "Clear all read" would
   * otherwise reset that metric to empty every time it is used.
   */
  async getCountsForCaller(callerId: string) {
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const now = new Date();
      const [total, unread, readRows] = await Promise.all([
        tx.notification.count({ where: { userId: callerId, deletedAt: null } }),
        tx.notification.count({
          where: { userId: callerId, deletedAt: null, read: false, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
        }),
        // Only the two timestamps are needed to compute the metric — not a
        // full row fetch of every read Notification the caller has ever had.
        tx.notification.findMany({
          where: { userId: callerId, readAt: { not: null } },
          select: { createdAt: true, readAt: true },
        }),
      ]);

      const readTotalCount = readRows.length;
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      const readWithin24hCount = readRows.filter(
        (n) => n.readAt !== null && n.readAt.getTime() - n.createdAt.getTime() <= ONE_DAY_MS,
      ).length;
      const readWithin24hPercent = readTotalCount > 0 ? Math.round((readWithin24hCount / readTotalCount) * 100) : null;

      return { total, unread, readWithin24hPercent, readWithin24hCount, readTotalCount };
    });
  }

  /** Idempotent — marking an already-read Notification as read again is not a
   * conflicting state transition the way e.g. Booking status changes are (no
   * data loss, no double-processing risk), so this uses a plain `update`, not
   * the optimistic-concurrency `updateMany`+count-check pattern this codebase
   * uses for genuinely conflicting transitions. Unconditional (no `if
   * (existing.read) return existing` short-circuit) — found on review to be a
   * pure optimization with no behavioral difference worth the extra branch
   * and the comment needed to justify it.
   *
   * `readAt` (v1.2 backend backlog — Read within 24h metric): set ONLY the
   * first time this fires for a given row — `existing.readAt ?? new Date()`
   * — never overwritten on a later call, so this stays genuinely "time to
   * first read" even though the rest of this method is already idempotent on
   * `read` itself. */
  async markRead(callerId: string, notificationId: string) {
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const existing = await tx.notification.findUnique({ where: { id: notificationId } });
      // RLS returns null (not another User's row) for a Notification outside the
      // caller's scope — a genuine 404 and an isolation-blocked read are
      // indistinguishable at this layer by design (ultm8-tenant-isolation §2).
      // A deleted Notification (Decision 277) is a 404 too: it is gone from
      // the caller's point of view.
      if (!existing || existing.deletedAt) {
        throw new NotFoundException('Notification not found');
      }
      return tx.notification.update({
        where: { id: notificationId },
        data: { read: true, readAt: existing.readAt ?? new Date() },
      });
    });
  }

  /**
   * PATCH /notifications/:id/snooze (v1.2 backend backlog — Snooze, approved
   * by the product owner). Exactly one of `dto.until`/`dto.minutes` must be
   * given — see SnoozeNotificationDto's own header comment for why that's
   * enforced here rather than at the DTO-decorator level. The resulting
   * `snoozedUntil` must be strictly in the future — snoozing "until now or
   * the past" would be a no-op that silently claims success, same reasoning
   * this codebase's other input-sanity checks (e.g. GradingActionDto's own)
   * apply elsewhere.
   *
   * Does not touch `read` — a snoozed Notification can be read or unread
   * independently; the only effect is on getCountsForCaller's own unread
   * total (see that method's own header comment) until
   * notification-unsnooze-sweep clears this column.
   */
  async snooze(callerId: string, notificationId: string, dto: SnoozeNotificationDto) {
    if (!dto.until && dto.minutes === undefined) {
      throw new BadRequestException('Provide either `until` or `minutes`.');
    }
    const snoozedUntil = dto.until ? new Date(dto.until) : new Date(Date.now() + dto.minutes! * 60_000);
    if (snoozedUntil.getTime() <= Date.now()) {
      throw new BadRequestException('`until`/`minutes` must resolve to a future time.');
    }
    // The same 7-day ceiling `minutes` has (SnoozeNotificationDto), so `until`
    // can't hide a notification for years.
    if (snoozedUntil.getTime() > Date.now() + MAX_SNOOZE_MS) {
      throw new BadRequestException('A notification can be snoozed for at most 7 days.');
    }

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const existing = await tx.notification.findUnique({ where: { id: notificationId } });
      if (!existing || existing.deletedAt) {
        throw new NotFoundException('Notification not found');
      }
      return tx.notification.update({ where: { id: notificationId }, data: { snoozedUntil } });
    });
  }

  /**
   * DELETE /notifications/:id (Decision 277). A soft delete: sets `deletedAt`
   * so the row leaves the caller's list and counts, but the record itself is
   * kept (Decision 244 — Notifications stay a permanent record, so payment
   * and waiver alerts are never actually erased). `updateMany` with a
   * `deletedAt: null` filter, then a count check, for the same reason
   * deregisterDeviceToken uses `deleteMany`: an RLS-hidden row, someone
   * else's row, and an already-deleted row all come back as zero rows
   * matched, which becomes one correctly-shaped 404.
   */
  async softDelete(callerId: string, notificationId: string): Promise<void> {
    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const result = await tx.notification.updateMany({
        where: { id: notificationId, userId: callerId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) {
        throw new NotFoundException('Notification not found');
      }
    });
  }

  /**
   * POST /notifications/me/clear-read (Decision 277). Soft-deletes every one
   * of the caller's read Notifications in one go, the "Clear all read" action.
   * Unread ones are never touched, snoozed or not. Returns how many were
   * cleared so the page can say so; clearing an inbox with nothing read is a
   * plain `{ cleared: 0 }`, not an error.
   */
  async clearRead(callerId: string): Promise<{ cleared: number }> {
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const result = await tx.notification.updateMany({
        where: { userId: callerId, read: true, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return { cleared: result.count };
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

const MAX_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

interface NotificationCursor {
  createdAt: Date;
  id: string;
}

function encodeCursor(n: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: n.createdAt.toISOString(), id: n.id })).toString('base64url');
}

/** A cursor that isn't one this service wrote is the caller's mistake (a 400),
 * not a server fault: JSON.parse and an Invalid Date used to surface as 500s. */
function decodeCursor(cursor: string): NotificationCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid cursor.');
  }
  const { createdAt, id } = (parsed ?? {}) as { createdAt?: unknown; id?: unknown };
  const date = typeof createdAt === 'string' ? new Date(createdAt) : null;
  if (!date || Number.isNaN(date.getTime()) || typeof id !== 'string') {
    throw new BadRequestException('Invalid cursor.');
  }
  return { createdAt: date, id };
}

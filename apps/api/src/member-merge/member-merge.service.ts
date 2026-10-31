import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { recordStaffActivity } from '../tenants/staff-activity/staff-activity';
import {
  MERGE_TABLES,
  MOVED_BY_STUDENT_ID,
  MOVED_BY_USER_ID,
  MOVED_UNLESS_KEPT_HAS,
  ONE_PER_SCHOOL,
  type MergeBlockerCode,
  type MergeTable,
} from './member-merge-tables';

type Tx = Prisma.TransactionClient;

export interface MergeBlocker {
  code: MergeBlockerCode;
  /** Style names (SAME_STYLE_*) or class titles (SAME_CLASS_*), when the portal can show them. */
  details: string[];
}

export interface MergeCounts {
  /** The duplicate's rows at this School, per table (preview), or the rows moved (merge). */
  records: Record<MergeTable, number>;
}

const WRITE_CONFLICT = 'Something changed while merging. Try again.';

/** A serialization failure, deadlock or unique clash with a concurrent
 * write (Prisma's own code, or Postgres's through a raw statement). */
function isWriteConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2034' || err.code === 'P2002') return true;
  const pgCode = (err.meta as { code?: string } | undefined)?.code;
  return err.code === 'P2010' && (pgCode === '40001' || pgCode === '40P01' || pgCode === '23505');
}

/** A table name from the fixed lists in member-merge-tables.ts, quoted for SQL. */
const tableSql = (table: MergeTable) => Prisma.raw(`"${table}"`);

/**
 * Merge duplicate members (Decision 315 item 13). Two Student records at the
 * same School are the same person: everything the duplicate has at this
 * School moves to the kept member, and the duplicate stops being a Student
 * there. Accounts are global identities, so the duplicate's account, its
 * login and everything it has at other Schools are never changed: only rows
 * of this School move (member-merge-tables.ts lists what happens per table).
 *
 * Owner only (the decision names no staff switch). Refused, with the reasons,
 * whenever moving the rows would break a rule (MERGE_BLOCKERS). Runs as one
 * serializable transaction on the jobs connection, after the caller has been
 * checked, and writes a line to the Staff page's activity log in the same
 * transaction.
 */
@Injectable()
export class MemberMergeService {
  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  /** What a merge would move and anything that stops it, without changing anything. */
  async preview(callerId: string, schoolId: string, keptId: string, duplicateId: string) {
    await this.assertMayMerge(callerId, schoolId, keptId, duplicateId);
    return this.prismaJobs.$transaction(async (tx) => {
      const [names, blockers, records] = await Promise.all([
        this.names(tx, [keptId, duplicateId]),
        this.blockers(tx, schoolId, keptId, duplicateId),
        this.countDuplicateRows(tx, schoolId, duplicateId),
      ]);
      return {
        kept: { id: keptId, name: names.get(keptId) ?? '' },
        duplicate: { id: duplicateId, name: names.get(duplicateId) ?? '' },
        blockers,
        records,
      };
    });
  }

  async merge(callerId: string, schoolId: string, keptId: string, duplicateId: string) {
    await this.assertMayMerge(callerId, schoolId, keptId, duplicateId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    try {
      return await this.prismaJobs.$transaction(
        async (tx) => {
          await this.lockEnrolments(tx, schoolId, keptId, duplicateId);
          const blockers = await this.blockers(tx, schoolId, keptId, duplicateId);
          if (blockers.length > 0) {
            throw new ConflictException({ code: 'MERGE_BLOCKED', message: "These two records can't be merged yet." });
          }
          const names = await this.names(tx, [keptId, duplicateId]);
          const result = await this.moveRows(tx, schoolId, keptId, duplicateId);

          // The duplicate is no longer a Student here. Their other roles here,
          // and everything they have at other Schools, stay as they are.
          await tx.$executeRaw`
            UPDATE "RoleGrant" SET "revokedAt" = now()
            WHERE "userId" = ${duplicateId} AND "schoolId" = ${schoolId} AND "role" = 'STUDENT' AND "revokedAt" IS NULL`;

          await recordStaffActivity(tx, {
            schoolId,
            actorId: callerId,
            targetUserId: keptId,
            action: 'MEMBERS_MERGED',
            details: {
              keptName: names.get(keptId) ?? '',
              duplicateId,
              duplicateName: names.get(duplicateId) ?? '',
              moved: result.records,
              waiverSignaturesLeft: result.waiverSignaturesLeft,
            },
          });
          return { keptStudentId: keptId, duplicateStudentId: duplicateId, ...result };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000, maxWait: 10_000 },
      );
    } catch (err) {
      // A booking, payment or second merge that changed one of these records
      // while this ran: nothing was changed, and the owner can try again.
      if (isWriteConflict(err)) throw new ConflictException(WRITE_CONFLICT);
      throw err;
    }
  }

  /** The owner of the School; two different people, both current Students there. */
  private async assertMayMerge(callerId: string, schoolId: string, keptId: string, duplicateId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    if (keptId === duplicateId) throw new BadRequestException('Choose two different students.');
    const enrolled = await this.prismaJobs.roleGrant.findMany({
      where: { userId: { in: [keptId, duplicateId] }, schoolId, role: 'STUDENT', revokedAt: null },
      select: { userId: true },
    });
    const ids = new Set(enrolled.map((g) => g.userId));
    if (!ids.has(keptId) || !ids.has(duplicateId)) throw new NotFoundException('This person is not a Student at this School.');
  }

  /** Locks both enrolments, in a fixed order, so two merges of the same pair
   * (either way round) run one after the other; the second then finds the
   * duplicate no longer enrolled. */
  private async lockEnrolments(tx: Tx, schoolId: string, keptId: string, duplicateId: string) {
    const rows = await tx.$queryRaw<Array<{ userId: string }>>`
      SELECT "userId" FROM "RoleGrant"
      WHERE "userId" IN (${keptId}, ${duplicateId}) AND "schoolId" = ${schoolId} AND "role" = 'STUDENT' AND "revokedAt" IS NULL
      ORDER BY "id"
      FOR UPDATE`;
    const ids = new Set(rows.map((r) => r.userId));
    if (!ids.has(keptId) || !ids.has(duplicateId)) throw new NotFoundException('This person is not a Student at this School.');
  }

  private async names(tx: Tx, ids: string[]) {
    const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, surname: true } });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.surname}`.trim()]));
  }

  private async blockers(tx: Tx, schoolId: string, keptId: string, duplicateId: string): Promise<MergeBlocker[]> {
    const both = [keptId, duplicateId];
    const blockers: MergeBlocker[] = [];
    const add = (code: MergeBlockerCode, details: string[] = []) => blockers.push({ code, details });
    const sharedBy = <T extends { studentId: string }>(rows: T[], key: (r: T) => string) => {
      const kept = new Set(rows.filter((r) => r.studentId === keptId).map(key));
      return [...new Set(rows.filter((r) => r.studentId === duplicateId).map(key))].filter((k) => kept.has(k));
    };

    const [guardianLinks, unlimited, subscriptions, pendingCard, recharges, ranks, corrections, bookings, waitlist, signUps, childInvites] =
      await Promise.all([
        tx.guardianLink.findMany({ where: { studentId: { in: both }, revokedAt: null }, select: { studentId: true, guardianId: true } }),
        tx.membership.findMany({ where: { schoolId, studentId: { in: both }, status: 'ACTIVE', classesRemaining: null }, select: { studentId: true } }),
        tx.membership.count({ where: { schoolId, studentId: duplicateId, status: 'ACTIVE', stripeSubscriptionId: { not: null } } }),
        tx.transaction.count({ where: { schoolId, studentId: { in: both }, status: 'PENDING', paymentMethod: 'STRIPE' } }),
        tx.packRecharge.count({ where: { schoolId, studentId: duplicateId, completedAt: null, expiresAt: { gt: new Date() } } }),
        tx.studentRank.findMany({ where: { schoolId, studentId: { in: both } }, select: { studentId: true, disciplineId: true } }),
        tx.rankCorrectionRequest.findMany({ where: { schoolId, studentId: { in: both }, status: 'PENDING' }, select: { studentId: true, disciplineId: true } }),
        tx.booking.findMany({ where: { schoolId, studentId: { in: both }, status: 'UPCOMING' }, select: { studentId: true, classId: true } }),
        tx.waitlistEntry.findMany({ where: { schoolId, studentId: { in: both }, status: { in: ['WAITING', 'NOTIFIED'] } }, select: { studentId: true, classId: true } }),
        tx.signUp.count({ where: { schoolId, userId: duplicateId, status: { in: ['PENDING', 'INVITED'] } } }),
        tx.childInvite.count({ where: { schoolId, studentId: duplicateId, status: 'PENDING' } }),
      ]);

    const guardiansOf = (id: string) =>
      guardianLinks
        .filter((g) => g.studentId === id)
        .map((g) => g.guardianId)
        .sort()
        .join(',');
    if (guardiansOf(keptId) !== guardiansOf(duplicateId)) add('GUARDIANS_DIFFER');
    if (unlimited.some((m) => m.studentId === keptId) && unlimited.some((m) => m.studentId === duplicateId)) add('BOTH_UNLIMITED_MEMBERSHIPS');
    if (subscriptions > 0) add('DUPLICATE_HAS_SUBSCRIPTION');
    if (pendingCard > 0) add('PENDING_CARD_PAYMENT');
    if (recharges > 0) add('OPEN_PACK_RECHARGE');

    const sameStyles = sharedBy(ranks, (r) => r.disciplineId);
    const sameCorrections = sharedBy(corrections, (r) => r.disciplineId);
    if (sameStyles.length > 0 || sameCorrections.length > 0) {
      const styles = await tx.discipline.findMany({ where: { id: { in: [...sameStyles, ...sameCorrections] } }, select: { id: true, name: true } });
      const name = new Map(styles.map((d) => [d.id, d.name]));
      if (sameStyles.length > 0) add('SAME_STYLE_RANK', sameStyles.map((id) => name.get(id) ?? ''));
      if (sameCorrections.length > 0) add('SAME_STYLE_CORRECTION', sameCorrections.map((id) => name.get(id) ?? ''));
    }

    const sameBooked = sharedBy(bookings, (b) => b.classId);
    const sameWaitlist = sharedBy(waitlist, (w) => w.classId);
    if (sameBooked.length > 0 || sameWaitlist.length > 0) {
      const classes = await tx.class.findMany({ where: { id: { in: [...sameBooked, ...sameWaitlist] } }, select: { id: true, title: true } });
      const title = new Map(classes.map((c) => [c.id, c.title]));
      if (sameBooked.length > 0) add('SAME_CLASS_BOOKED', sameBooked.map((id) => title.get(id) ?? ''));
      if (sameWaitlist.length > 0) add('SAME_CLASS_WAITLIST', sameWaitlist.map((id) => title.get(id) ?? ''));
    }

    if (signUps > 0) add('OPEN_SIGN_UP');
    if (childInvites > 0) add('PENDING_CHILD_INVITE');
    return blockers;
  }

  /** How many rows the duplicate has at this School, per table. */
  private async countDuplicateRows(tx: Tx, schoolId: string, duplicateId: string): Promise<Record<MergeTable, number>> {
    const counts = {} as Record<MergeTable, number>;
    for (const table of MERGE_TABLES) {
      const column = (MOVED_BY_USER_ID as readonly string[]).includes(table) ? Prisma.raw('"userId"') : Prisma.raw('"studentId"');
      const [row] = await tx.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM ${tableSql(table)} WHERE "schoolId" = ${schoolId} AND ${column} = ${duplicateId}`;
      counts[table] = Number(row?.n ?? 0);
    }
    return counts;
  }

  private async moveRows(tx: Tx, schoolId: string, keptId: string, duplicateId: string) {
    const records = {} as Record<MergeTable, number>;

    for (const table of MOVED_BY_STUDENT_ID) {
      records[table] = await tx.$executeRaw`
        UPDATE ${tableSql(table)} SET "studentId" = ${keptId} WHERE "schoolId" = ${schoolId} AND "studentId" = ${duplicateId}`;
    }
    for (const table of MOVED_BY_USER_ID) {
      records[table] = await tx.$executeRaw`
        UPDATE ${tableSql(table)} SET "userId" = ${keptId} WHERE "schoolId" = ${schoolId} AND "userId" = ${duplicateId}`;
    }
    for (const { table, key } of MOVED_UNLESS_KEPT_HAS) {
      const t = tableSql(table);
      const k = Prisma.raw(`"${key}"`);
      await tx.$executeRaw`
        DELETE FROM ${t} d WHERE d."schoolId" = ${schoolId} AND d."studentId" = ${duplicateId}
          AND EXISTS (SELECT 1 FROM ${t} k WHERE k."schoolId" = d."schoolId" AND k."studentId" = ${keptId} AND k.${k} = d.${k})`;
      records[table] = await tx.$executeRaw`
        UPDATE ${t} SET "studentId" = ${keptId} WHERE "schoolId" = ${schoolId} AND "studentId" = ${duplicateId}`;
    }
    for (const table of ONE_PER_SCHOOL) {
      const t = tableSql(table);
      const [kept] = await tx.$queryRaw<Array<{ found: number }>>`
        SELECT 1 AS found FROM ${t} WHERE "schoolId" = ${schoolId} AND "studentId" = ${keptId}`;
      if (!kept) {
        records[table] = await tx.$executeRaw`
          UPDATE ${t} SET "studentId" = ${keptId} WHERE "schoolId" = ${schoolId} AND "studentId" = ${duplicateId}`;
        continue;
      }
      if (table === 'StudentJoinDate') {
        // Keep the earliest join date (Decision 315 item 4).
        records[table] = await tx.$executeRaw`
          UPDATE "StudentJoinDate" k SET "joinedOn" = d."joinedOn", "updatedAt" = now()
          FROM "StudentJoinDate" d
          WHERE k."schoolId" = ${schoolId} AND k."studentId" = ${keptId} AND d."schoolId" = ${schoolId} AND d."studentId" = ${duplicateId} AND d."joinedOn" < k."joinedOn"`;
      } else {
        records[table] = 0;
      }
      await tx.$executeRaw`DELETE FROM ${t} WHERE "schoolId" = ${schoolId} AND "studentId" = ${duplicateId}`;
    }
    // Medical information moved from the duplicate keeps its consent; consent
    // the duplicate gave for themselves is now the kept member's, the same
    // person (as a waiver they signed themselves, below).
    await tx.$executeRaw`
      UPDATE "StudentMedicalInfo" SET "consentedById" = ${keptId}
      WHERE "schoolId" = ${schoolId} AND "studentId" = ${keptId} AND "consentedById" = ${duplicateId}`;

    const waivers = await this.moveWaiverSignatures(tx, schoolId, keptId, duplicateId);
    records.WaiverSignature = waivers.moved;
    return { records, waiverSignaturesLeft: waivers.left };
  }

  /**
   * Waiver signatures are legal records: never edited beyond whose record
   * they are on, never deleted (Decision 253). A member may hold one live
   * (not Expired) row per waiver, so where both have one for the same waiver:
   * - an Unsigned/Pending row carries no signature (it only says the waiver
   *   was given to them); it is removed in favour of the other one, and the
   *   duplicate's goes when neither has signed;
   * - when both have signed, the duplicate's signature stays exactly where it
   *   is, on the duplicate's record at this School (shown under former
   *   students, and in the signed-documents export).
   * A signature the duplicate signed themselves (signedById = the duplicate)
   * stays self-signed on the kept record; one a Guardian signed keeps its
   * Guardian.
   */
  private async moveWaiverSignatures(tx: Tx, schoolId: string, keptId: string, duplicateId: string) {
    const rows = await tx.waiverSignature.findMany({
      where: { schoolId, studentId: { in: [keptId, duplicateId] } },
      select: { id: true, studentId: true, waiverId: true, status: true, signedDate: true, signerFullName: true, signatureImageKey: true },
    });
    const blank = (r: (typeof rows)[number]) =>
      (r.status === 'UNSIGNED' || r.status === 'PENDING') && r.signedDate === null && r.signerFullName === null && r.signatureImageKey === null;
    const keptLive = new Map(rows.filter((r) => r.studentId === keptId && r.status !== 'EXPIRED').map((r) => [r.waiverId, r]));

    const remove: string[] = [];
    const leave: string[] = [];
    for (const d of rows.filter((r) => r.studentId === duplicateId && r.status !== 'EXPIRED')) {
      const k = keptLive.get(d.waiverId);
      if (!k) continue;
      if (blank(d)) remove.push(d.id);
      else if (blank(k)) remove.push(k.id);
      else leave.push(d.id);
    }
    if (remove.length > 0) {
      // Re-checked in SQL: only rows that carry no signature are ever deleted.
      await tx.$executeRaw`
        DELETE FROM "WaiverSignature"
        WHERE "id" IN (${Prisma.join(remove)}) AND "schoolId" = ${schoolId}
          AND "status" IN ('UNSIGNED', 'PENDING') AND "signedDate" IS NULL AND "signerFullName" IS NULL AND "signatureImageKey" IS NULL`;
    }
    const keepOut = leave.length > 0 ? Prisma.sql`AND "id" NOT IN (${Prisma.join(leave)})` : Prisma.empty;
    const moved = await tx.$executeRaw`
      UPDATE "WaiverSignature"
      SET "studentId" = ${keptId},
          "signedById" = CASE WHEN "signedById" = ${duplicateId} THEN ${keptId} ELSE "signedById" END
      WHERE "schoolId" = ${schoolId} AND "studentId" = ${duplicateId} AND "id" NOT IN (${Prisma.join(remove.length > 0 ? remove : [''])}) ${keepOut}`;
    return { moved, left: leave.length };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';

const BCRYPT_ROUNDS = 12;

/** Replaces the erased minor's date of birth. The column is required, and any
 * real-looking date would still be personal data or would pass an age check. */
const ERASED_DATE_OF_BIRTH = new Date('1900-01-01T00:00:00.000Z');

/**
 * `account-deletion-processing` (SKILL.md §14) for a Guardian-linked minor —
 * Decision 173. Called by GuardiansService.withdrawConsent() once the last active
 * baseline consent for the minor is withdrawn, after the RoleGrant cascade.
 *
 * Erases: grading (StudentRank, and through its ON DELETE CASCADE FKs the skill
 * statuses, promotion events and skill sign-off logs), home branches, bookings
 * (and through CASCADE their attendee rows), waitlist entries, notifications,
 * device tokens and Kid Mode delegations.
 *
 * Keeps, per Decision 173: Transaction and the Membership rows they paid for,
 * WaiverSignature (with its signature image), ConsentRecord, ConsentEvent and
 * GuardianLink. The User row is anonymised rather than deleted: Transaction and
 * WaiverSignature both have ON DELETE CASCADE FKs to User, so deleting it would
 * delete exactly the records being kept.
 *
 * Runs as ultm8_jobs — the withdrawing Guardian's own context cannot see the
 * minor's School-scoped rows — in one transaction, so a failure leaves nothing
 * half-erased and the caller's ConsentRecord stays ACTIVE for a retry. Safe to
 * run again on an already-erased minor.
 */
@Injectable()
export class MinorErasureService {
  private readonly logger = new Logger(MinorErasureService.name);

  constructor(private readonly prismaJobs: PrismaJobsService) {}

  async eraseMinor(studentId: string): Promise<void> {
    // A hash of a value nobody is ever told, same reasoning as createMinor().
    // Computed before the transaction: bcrypt is slow and needs no lock.
    const passcodeHash = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);
    const erasedId = randomUUID();

    const counts = await this.prismaJobs.$transaction(async (tx) => {
      const studentRanks = await tx.studentRank.deleteMany({ where: { studentId } });
      const homeBranches = await tx.studentHomeBranch.deleteMany({ where: { studentId } });
      const bookings = await tx.booking.deleteMany({ where: { studentId } });
      const waitlistEntries = await tx.waitlistEntry.deleteMany({ where: { studentId } });
      const notifications = await tx.notification.deleteMany({ where: { userId: studentId } });
      const deviceTokens = await tx.deviceToken.deleteMany({ where: { userId: studentId } });
      const delegations = await tx.bookingDelegation.deleteMany({ where: { studentId } });

      // updateMany, not update: update() returns the whole row, and ultm8_jobs may
      // read only a few User columns (column-level grants in the migrations).
      await tx.user.updateMany({
        where: { id: studentId },
        data: {
          email: `erased+${erasedId}@erased.ultm8.internal`,
          // Same digits-only, never-a-real-number '+000' prefix createMinor() uses.
          phone: `+000${erasedId.replace(/-/g, '').split('').map((c) => parseInt(c, 16) % 10).join('').slice(0, 12)}`,
          firstName: '[Erased]',
          surname: '[Erased]',
          username: null,
          passcodeHash,
          dateOfBirth: ERASED_DATE_OF_BIRTH,
          gender: null,
          nationality: null,
          language: null,
          currency: null,
          address: null,
          profilePhotoUrl: null,
          erasedAt: new Date(),
        },
      });

      return {
        studentRanks: studentRanks.count,
        homeBranches: homeBranches.count,
        bookings: bookings.count,
        waitlistEntries: waitlistEntries.count,
        notifications: notifications.count,
        deviceTokens: deviceTokens.count,
        delegations: delegations.count,
      };
    });

    this.logger.log(`account-deletion-processing: erased Student ${studentId} (Decision 173): ${JSON.stringify(counts)}`);
  }
}

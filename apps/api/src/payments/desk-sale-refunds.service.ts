import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { WAITLIST_CASCADE_PROCESSING_QUEUE } from '../jobs/queue.constants';
import { cancelFutureBookingsFundedByExpiredMembership } from '../jobs/membership-booking-cancellation';
import { paymentRefundNotice } from '../charges/charge-ledger';
import { assertWholeMinorUnits } from './stripe-amount';
import { PaymentsService } from './payments.service';
import { RefundDeskSaleDto } from './dto/refund-desk-sale.dto';

/** A second identical refund this soon after the first is a double tap (as
 * charge refunds, Decision 372 item 3 and Decision 431 MON-4). */
const DESK_REPEAT_WINDOW_MS = 60_000;

/**
 * Decision 431 (stress test round 5, MON-8): refunding a membership paid at
 * the desk. The School gave the money back by hand (cash, Pix, a bank
 * transfer, or its own card terminal), so only the records change: a
 * DeskSaleRefund row with the owner's note, the payment's refundedAmount
 * (Refunded once all of it is back), and, if the owner chooses, the
 * membership ends now, cancelling the future bookings it pays for (as when a
 * membership expires, Decision 122). Owner only. A card payment taken in the
 * app is refunded through Stripe, not here. There is no time limit (a "void
 * window" was rejected as an invented rule).
 *
 * Runs on the jobs connection once the caller is known to own the School, as
 * the webhook's refund path does: the owner's own context can't update a
 * Student's Transaction or Membership.
 */
@Injectable()
export class DeskSaleRefundsService {
  private readonly logger = new Logger(DeskSaleRefundsService.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly paymentsService: PaymentsService,
    @InjectQueue(WAITLIST_CASCADE_PROCESSING_QUEUE) private readonly waitlistCascadeQueue: Queue,
  ) {}

  async refund(callerId: string, transactionId: string, dto: RefundDeskSaleDto) {
    const found = await this.prismaJobs.transaction.findUnique({
      where: { id: transactionId },
      select: { id: true, schoolId: true, studentId: true },
    });
    if (!found) throw new NotFoundException('Transaction not found');
    if (!(await this.tenantAuth.isSchoolOwner(callerId, found.schoolId))) {
      if (found.studentId === callerId || (await this.tenantAuth.isStaffAtSchool(callerId, found.schoolId))) {
        throw new ForbiddenException("Only that School's Owner/Manager may perform this action.");
      }
      throw new NotFoundException('Transaction not found');
    }
    await this.tenantAuth.assertSchoolNotArchived(callerId, found.schoolId);
    const notes = dto.notes?.trim();
    if (!notes) {
      throw new BadRequestException({ code: 'REFUND_NOTES_REQUIRED', message: 'Add a note about this refund.' });
    }

    const result = await this.prismaJobs.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${transactionId} FOR UPDATE`;
      const t = await tx.transaction.findUniqueOrThrow({ where: { id: transactionId } });
      if (t.kind !== 'MEMBERSHIP') {
        throw new BadRequestException({ code: 'NOT_A_DESK_SALE', message: 'Only a membership paid at the desk can be refunded here.' });
      }
      if (t.paymentMethod === 'STRIPE') {
        throw new BadRequestException({ code: 'CARD_PAYMENT_REFUND', message: 'A card payment made in the app is refunded through Stripe, not here.' });
      }
      if (t.status === 'REFUNDED') {
        throw new ConflictException({ code: 'ALREADY_REFUNDED', message: 'This payment has already been refunded in full.' });
      }
      if (t.status !== 'SUCCESSFUL') {
        throw new BadRequestException({ code: 'PAYMENT_NOT_TAKEN', message: 'Only a payment that was taken can be refunded.' });
      }
      const currency = (t.currency ?? '').toUpperCase();
      assertWholeMinorUnits(dto.amount, currency || null);
      // Decision 431 (MON-4 applied here): the same amount on the same payment
      // a moment ago, by anyone, is a double tap.
      const recent = await tx.deskSaleRefund.findFirst({
        where: { transactionId, amount: dto.amount, createdAt: { gt: new Date(Date.now() - DESK_REPEAT_WINDOW_MS) } },
        select: { id: true },
      });
      if (recent) {
        throw new ConflictException({ code: 'DESK_REPEAT', message: 'This was just recorded. Check before adding another.' });
      }
      const already = t.refundedAmount ?? 0;
      const left = t.amount + t.surchargeAmount - already;
      if (dto.amount > left) {
        throw new BadRequestException({ code: 'REFUND_MORE_THAN_LEFT', message: 'That is more than is left to refund on this payment.' });
      }
      const refundedAmount = already + dto.amount;
      const status = refundedAmount >= t.amount + t.surchargeAmount ? ('REFUNDED' as const) : ('SUCCESSFUL' as const);
      let membershipEnded = false;
      let freedClassIds: string[] = [];
      if (dto.endMembership && t.membershipId) {
        const ended = await tx.membership.updateMany({ where: { id: t.membershipId, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
        if (ended.count > 0) {
          membershipEnded = true;
          freedClassIds = await cancelFutureBookingsFundedByExpiredMembership(tx, t.membershipId, this.logger);
        }
      }
      const refund = await tx.deskSaleRefund.create({
        data: {
          id: randomUUID(),
          schoolId: t.schoolId,
          transactionId,
          amount: dto.amount,
          currency,
          notes,
          endedMembership: membershipEnded,
          refundedById: callerId,
        },
        select: { id: true, transactionId: true, amount: true, currency: true, notes: true, endedMembership: true, createdAt: true },
      });
      await tx.transaction.update({ where: { id: transactionId }, data: { refundedAmount, status } });
      return { refund, refundedAmount, status, membershipEnded, freedClassIds, studentId: t.studentId, schoolId: t.schoolId };
    });

    // After the commit: tell the member (the usual "Refund" notice, Decision
    // 415 item 4) and the waitlists of the classes whose seats were freed.
    await this.paymentsService.sendRefundNotice(
      paymentRefundNotice(`desk-refund-${result.refund.id}`, 'GIVEN_BACK', result.refund.amount, result.refund.currency),
      result.studentId,
      result.schoolId,
    );
    if (result.freedClassIds.length > 0) {
      try {
        await this.waitlistCascadeQueue.addBulk(
          [...new Set(result.freedClassIds)].map((classId) => ({
            name: 'seat-freed',
            data: { classId },
            opts: { jobId: `seat-freed-desk-refund-${result.refund.id}-${classId}`, attempts: 3, backoff: { type: 'exponential' as const, delay: 5000 } },
          })),
        );
      } catch (err) {
        this.logger.error(`Desk refund ${result.refund.id}: could not tell the waitlists of the freed classes.`, err as Error);
      }
    }
    return { refund: result.refund, refundedAmount: result.refundedAmount, status: result.status, membershipEnded: result.membershipEnded };
  }
}

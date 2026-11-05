import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { Prisma, PlanContractSignature } from '@prisma/client';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../../tenants/tenant-authorization.service';
import { GuardiansService } from '../../guardians/guardians.service';
import { R2ClientService } from '../../common/object-storage/r2-client.service';
import { lockSchoolOpen } from '../../tenants/lock-school-open';
import { dayIn, dayToDate } from '../freeze/membership-freeze';
import { insertCharge, lockInvoiceNumbers } from '../../charges/charge-insert';
import { lockBalance } from '../../charges/charge-ledger';
import { computeCharge, formatInvoiceNumber } from '../../charges/charge-maths';
import { assertSchoolCurrencySet } from '../../common/school-currency';
import { NOTIFICATION_FANOUT_QUEUE } from '../../jobs/queue.constants';
import { NotificationFanoutJobData } from '../../jobs/notification-fanout.types';
import { SetPlanContractDto, SignPlanContractDto } from './plan-contract.dto';

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;

/** A signature older than this can't be used to buy: sign again. */
const SIGNATURE_VALID_FOR_MS = 24 * 60 * 60 * 1000;

export function contractSha256(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** The day the minimum term ends: the Membership's start plus the signed
 * number of whole months (calendar months, UTC). */
export function minimumTermEndsAt(startDate: Date, months: number): Date {
  return DateTime.fromJSDate(startDate, { zone: 'utc' }).plus({ months }).toJSDate();
}

/**
 * Whether cancelling now is "early" under a signed contract (Decision 316
 * item 6): the Membership ends (Stripe's cancel_at, the end of the paid
 * period) before the minimum term does. A fee of 0 or no term is never due.
 */
export function earlyExitFeeDue(
  contract: { minimumTermMonths: number | null; earlyExitFee: number | null },
  membership: { startDate: Date },
  endsAt: Date,
): boolean {
  if (!contract.minimumTermMonths || !contract.earlyExitFee || contract.earlyExitFee <= 0) return false;
  return endsAt < minimumTermEndsAt(membership.startDate, contract.minimumTermMonths);
}

function ageToday(dateOfBirth: Date, today: Date = new Date()): number {
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const m = today.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;
  return age;
}

type PurchaseResult = { transactionId?: string | null; membership?: { id: string } | null };

/**
 * Decision 316 item 6: the School's contract on a plan. The owner writes the
 * text and terms (minimum term and early-exit fee, Subscription only); the
 * member signs it in the app just before buying, like a waiver (typed name
 * and signature, an optional drawn signature uploaded to R2, a copy of what
 * was signed with its SHA-256); a Guardian signs for their child. Cancelling
 * before the minimum term ends puts the School's fee on the member's
 * balance, worked out from the signed copy.
 */
@Injectable()
export class PlanContractsService {
  private readonly logger = new Logger(PlanContractsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly guardiansService: GuardiansService,
    private readonly r2Client: R2ClientService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // The owner: the plan's contract
  // ---------------------------------------------------------------------------

  /** Sets, changes or removes (body null or blank) the plan's contract. Any
   * change to the text or terms is a new version; members who already signed
   * keep the copy they signed. */
  async setContract(callerId: string, planId: string, dto: SetPlanContractDto) {
    const plan = await this.prismaApp.withTenantContext(callerId, (tx) => tx.membershipPlan.findUnique({ where: { id: planId } }));
    if (!plan) throw new NotFoundException('MembershipPlan not found');
    await this.tenantAuth.assertSchoolOwner(callerId, plan.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, plan.schoolId);

    const body = dto.body?.trim() ? dto.body.trim() : null;
    const minimumTermMonths = body ? dto.minimumTermMonths ?? null : null;
    const earlyExitFee = body ? dto.earlyExitFee ?? null : null;
    if (body) {
      if (plan.type === 'FRIEND_PASS') {
        throw new BadRequestException('A Friend Pass is given, not bought, so it has no contract.');
      }
      if ((minimumTermMonths !== null || earlyExitFee !== null) && plan.type !== 'SUBSCRIPTION') {
        throw new BadRequestException('A minimum term and an early-exit fee are for Subscription plans only.');
      }
      if (earlyExitFee !== null && minimumTermMonths === null) {
        throw new BadRequestException('Set a minimum term before an early-exit fee.');
      }
      if (earlyExitFee && earlyExitFee > 0) {
        await this.prismaApp.withTenantContext(callerId, (tx) => assertSchoolCurrencySet(tx, plan.schoolId));
      }
    }
    const changed =
      body !== plan.contractBody || minimumTermMonths !== plan.contractMinimumTermMonths || earlyExitFee !== plan.contractEarlyExitFee;
    if (!changed) return plan;
    const contractVersion = body ? (plan.contractVersion ?? 0) + 1 : null;
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membershipPlan.update({
        where: { id: planId },
        data: { contractBody: body, contractMinimumTermMonths: minimumTermMonths, contractEarlyExitFee: earlyExitFee, contractVersion },
      }),
    );
  }

  /** The School's signed contracts for one Student, newest first, for the
   * owner's Student page. */
  async listForStudent(callerId: string, schoolId: string, studentId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.planContractSignature.findMany({ where: { schoolId, studentId }, orderBy: { signedAt: 'desc' }, take: 100 }),
    );
    return Promise.all(rows.map((r) => this.toResponse(r)));
  }

  // ---------------------------------------------------------------------------
  // The member: read, sign, buy
  // ---------------------------------------------------------------------------

  /** The contract to read before signing, for the member or a Guardian of
   * the member. */
  async getForSigning(callerId: string, planId: string, studentId?: string) {
    const target = await this.resolveSigner(callerId, studentId);
    const plan = await this.findPlanForMember(target, planId);
    if (plan.contractVersion == null || !plan.contractBody) throw new NotFoundException('This plan has no contract.');
    return {
      planId: plan.id,
      planTitle: plan.title,
      planType: plan.type,
      body: plan.contractBody,
      minimumTermMonths: plan.contractMinimumTermMonths,
      earlyExitFee: plan.contractEarlyExitFee,
      currency: await this.planCurrency(target, plan),
      version: plan.contractVersion,
    };
  }

  /** Step 1 of a drawn signature: where to upload the PNG. */
  async requestSignatureUploadUrl(callerId: string, planId: string, studentId?: string) {
    const target = await this.resolveSigner(callerId, studentId);
    const plan = await this.findPlanForMember(target, planId);
    const objectKey = `${this.keyPrefix(plan.schoolId, plan.id, target)}${randomUUID()}.png`;
    const uploadUrl = await this.r2Client.getPresignedUploadUrl(objectKey, 'image/png');
    return { uploadUrl, objectKey };
  }

  /** Signs the plan's current contract. The member signs for themselves
   * (18 or over); a Guardian signs for their child. */
  async sign(callerId: string, planId: string, dto: SignPlanContractDto) {
    const target = await this.resolveSigner(callerId, dto.studentId);
    const plan = await this.findPlanForMember(target, planId);
    if (plan.contractVersion == null || !plan.contractBody) throw new BadRequestException('This plan has no contract to sign.');
    if (plan.archivedAt || !plan.visible) throw new BadRequestException('This plan is not on sale.');
    await this.tenantAuth.assertSchoolNotArchived(target, plan.schoolId);
    await this.assertCurrentStudent(target, plan.schoolId);
    if (target === callerId) await this.assertAdult(callerId);

    const signerFullName = dto.signerFullName.trim();
    const signatureText = dto.signatureText.trim();
    if (!signerFullName || !signatureText) throw new BadRequestException('Type your full name and your signature.');
    if (dto.signatureImageKey) {
      if (!dto.signatureImageKey.startsWith(this.keyPrefix(plan.schoolId, plan.id, target))) {
        throw new BadRequestException('signatureImageKey does not match this plan and member.');
      }
      if (!(await this.r2Client.objectExists(dto.signatureImageKey))) {
        throw new BadRequestException('signatureImageKey does not reference an uploaded object — upload the image first.');
      }
    }
    const currency = await this.planCurrency(target, plan);
    const created = await this.prismaApp.withTenantContext(target, async (tx) => {
      // Read the terms being signed in this transaction, under a share lock,
      // so an edit at the same moment is either signed in full or refused.
      await tx.$queryRaw`SELECT id FROM "MembershipPlan" WHERE id = ${plan.id} FOR SHARE`;
      const current = await tx.membershipPlan.findUniqueOrThrow({ where: { id: plan.id } });
      if (current.contractVersion == null || current.contractBody == null || current.contractVersion !== dto.contractVersion) {
        throw new ConflictException('This contract was changed while you were reading it. Please read it again before signing.');
      }
      return tx.planContractSignature.create({
        data: {
          id: randomUUID(),
          schoolId: current.schoolId,
          membershipPlanId: current.id,
          studentId: target,
          signedById: callerId,
          signerFullName,
          signatureText,
          signatureImageKey: dto.signatureImageKey ?? null,
          planTitle: current.title,
          planType: current.type,
          contractBody: current.contractBody,
          minimumTermMonths: current.contractMinimumTermMonths,
          earlyExitFee: current.contractEarlyExitFee,
          currency: current.contractEarlyExitFee != null ? currency : null,
          contractVersion: current.contractVersion,
          contractSha256: contractSha256(current.contractBody),
        },
      });
    });
    return this.toResponse(created);
  }

  /**
   * Called by MembershipsService.purchase() for a plan with a contract,
   * under the member's own context: the signature must be the member's, for
   * this plan's current version, recent, and not used yet. It is marked used
   * at once (two buys at once can't both use it); `release` undoes that when
   * the purchase then fails, and `link` records what it bought.
   */
  async reserveForPurchase(
    studentId: string,
    plan: { id: string; contractVersion: number | null },
    signatureId: string | undefined,
  ): Promise<{ id: string } | null> {
    if (plan.contractVersion == null) return null;
    if (!signatureId) {
      throw new BadRequestException("Sign this plan's contract before buying it.");
    }
    return this.prismaApp.withTenantContext(studentId, async (tx) => {
      const sig = await tx.planContractSignature.findUnique({ where: { id: signatureId } });
      if (!sig || sig.studentId !== studentId || sig.membershipPlanId !== plan.id) {
        throw new BadRequestException('This contract signature is not for this plan.');
      }
      if (sig.contractVersion !== plan.contractVersion) {
        throw new ConflictException('This contract was changed while you were reading it. Please read it again before signing.');
      }
      if (sig.usedAt || Date.now() - sig.signedAt.getTime() > SIGNATURE_VALID_FOR_MS) {
        throw new BadRequestException("Sign this plan's contract before buying it.");
      }
      const { count } = await tx.planContractSignature.updateMany({ where: { id: sig.id, usedAt: null }, data: { usedAt: new Date() } });
      if (count === 0) throw new BadRequestException("Sign this plan's contract before buying it.");
      return { id: sig.id };
    });
  }

  async releaseReservation(studentId: string, signatureId: string): Promise<void> {
    await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.planContractSignature.updateMany({ where: { id: signatureId, transactionId: null, membershipId: null }, data: { usedAt: null } }),
    );
  }

  async linkPurchase(studentId: string, signatureId: string, result: PurchaseResult): Promise<void> {
    const transactionId = result.transactionId ?? null;
    const membershipId = result.membership?.id ?? null;
    if (!transactionId && !membershipId) return;
    try {
      await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.planContractSignature.update({ where: { id: signatureId }, data: { transactionId, membershipId } }),
      );
    } catch (err) {
      // A second Buy that returned the order already waiting (a double tap):
      // the signature given with that order stays its contract, and this
      // one is free to use again.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await this.releaseReservation(studentId, signatureId);
        return;
      }
      throw err;
    }
  }

  /** The signed contract behind a Membership, or null: linked directly (a
   * free plan) or through the order that created it. Read on the jobs
   * connection, after the caller's own checks. */
  async findForMembership(membershipId: string): Promise<PlanContractSignature | null> {
    const direct = await this.prismaJobs.planContractSignature.findUnique({ where: { membershipId } });
    if (direct) return direct;
    const orders = await this.prismaJobs.transaction.findMany({ where: { membershipId }, select: { id: true } });
    if (orders.length === 0) return null;
    return this.prismaJobs.planContractSignature.findFirst({ where: { transactionId: { in: orders.map((o) => o.id) } } });
  }

  /** What the member is shown before cancelling: when the minimum term ends
   * and the fee due if they leave before then. */
  async termsForMemberships(memberships: Array<{ id: string; startDate: Date }>) {
    const out = new Map<string, { minimumTermEndsAt: string; earlyExitFee: number; currency: string | null }>();
    for (const m of memberships) {
      const sig = await this.findForMembership(m.id);
      if (!sig?.minimumTermMonths) continue;
      out.set(m.id, {
        minimumTermEndsAt: minimumTermEndsAt(m.startDate, sig.minimumTermMonths).toISOString(),
        earlyExitFee: sig.earlyExitFee ?? 0,
        currency: sig.currency,
      });
    }
    return out;
  }

  /**
   * After the member (or their Guardian) cancelled a Subscription: when the
   * Membership ends before the signed minimum term, the signed early-exit fee
   * goes on the member's balance as a charge (Decision 316 item 6). Once per
   * contract (Charge.contractSignatureId is unique). The School's tax
   * settings apply, as for any price the School sets; due today in the
   * School's time zone; any credit is used on it at once. The member gets the
   * usual "New invoice" notice.
   */
  async chargeEarlyExitFee(membership: { id: string; schoolId: string; studentId: string; startDate: Date; cancelAt: Date | null }) {
    const sig = await this.findForMembership(membership.id);
    if (!sig) return null;
    const endsAt = membership.cancelAt ?? new Date();
    if (!earlyExitFeeDue(sig, membership, endsAt)) return null;
    const school = await this.prismaJobs.school.findUnique({
      where: { id: membership.schoolId },
      select: { defaultCurrency: true, timezone: true, taxCountry: true, taxRateBasisPoints: true, taxInclusive: true },
    });
    const currency = (sig.currency ?? school?.defaultCurrency)?.toUpperCase();
    if (!school || !currency) return null;
    const fee = sig.earlyExitFee!;
    const totals = computeCharge({ unitAmount: fee, discount: null, taxRateBasisPoints: school.taxRateBasisPoints, taxInclusive: school.taxInclusive });
    let created: { id: string; invoiceNumber: number };
    try {
      created = await this.prismaJobs.$transaction(async (tx) => {
        await lockSchoolOpen(tx, membership.schoolId);
        await lockInvoiceNumbers(tx, membership.schoolId);
        await lockBalance(tx, membership.schoolId, membership.studentId);
        return insertCharge(tx, {
          schoolId: membership.schoolId,
          studentId: membership.studentId,
          description: sig.planTitle,
          unitAmount: fee,
          discountType: null,
          discountValue: null,
          taxCountry: school.taxCountry,
          taxRateBasisPoints: school.taxRateBasisPoints,
          taxInclusive: school.taxInclusive,
          totals,
          currency,
          dueDate: dayToDate(dayIn(new Date(), school.timezone)),
          createdById: null,
          contractSignatureId: sig.id,
        });
      });
    } catch (err) {
      // Charged already (cancelled twice at the same moment).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
    const due = dayIn(new Date(), school.timezone);
    const key = `charge-created-${created.id}`;
    try {
      await this.fanoutQueue.add(
        'notify',
        {
          notificationId: key,
          userId: membership.studentId,
          title: 'New invoice',
          body: `Invoice ${formatInvoiceNumber(created.invoiceNumber)} for ${sig.planTitle}: ${money(totals.grossAmount, currency)}, due ${due}.`,
          type: 'CHARGE',
          schoolId: membership.schoolId,
          targetType: 'PAYMENT',
          targetId: created.id,
        } satisfies NotificationFanoutJobData,
        { jobId: key, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    } catch (err) {
      this.logger.warn(`Failed to enqueue the charge notice ${key}: ${err}`);
    }
    return created;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private keyPrefix(schoolId: string, planId: string, studentId: string): string {
    return `plan-contract-signatures/${schoolId}/${planId}/${studentId}/`;
  }

  /** Whose contract it is: the caller, or a child the caller is Guardian of. */
  private async resolveSigner(callerId: string, studentId?: string): Promise<string> {
    if (studentId && studentId !== callerId) {
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
      return studentId;
    }
    return callerId;
  }

  /** The plan as the member sees it (their own context), or 404. */
  private async findPlanForMember(studentId: string, planId: string) {
    const plan = await this.prismaApp.withTenantContext(studentId, (tx) => tx.membershipPlan.findUnique({ where: { id: planId } }));
    if (!plan) throw new NotFoundException('MembershipPlan not found');
    return plan;
  }

  private async assertCurrentStudent(studentId: string, schoolId: string): Promise<void> {
    const grant = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } }),
    );
    if (!grant) throw new ForbiddenException('Only a current Student of this School can sign its plan contracts.');
  }

  /** A contract binds the person who signs it: 18 or over, or a Guardian
   * signs for them. */
  private async assertAdult(userId: string): Promise<void> {
    const user = await this.prismaApp.withTenantContext(userId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dateOfBirth: true } }),
    );
    if (!user.dateOfBirth || ageToday(user.dateOfBirth) < 18) {
      throw new ForbiddenException("You're under 18, so a parent or guardian needs to sign this contract for you from their Guardian account.");
    }
  }

  private async planCurrency(studentId: string, plan: { schoolId: string; currency: string | null }): Promise<string | null> {
    if (plan.currency) return plan.currency.toUpperCase();
    const school = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.school.findUnique({ where: { id: plan.schoolId }, select: { defaultCurrency: true } }),
    );
    return school?.defaultCurrency?.toUpperCase() ?? null;
  }

  private async toResponse(r: PlanContractSignature) {
    let signatureImageUrl: string | null = null;
    if (r.signatureImageKey) {
      try {
        signatureImageUrl = await this.r2Client.getPresignedDownloadUrl(r.signatureImageKey);
      } catch (err) {
        this.logger.warn(`Could not make a view link for contract signature ${r.id}: ${err}`);
      }
    }
    return {
      id: r.id,
      schoolId: r.schoolId,
      membershipPlanId: r.membershipPlanId,
      studentId: r.studentId,
      signedById: r.signedById,
      signerFullName: r.signerFullName,
      signatureText: r.signatureText,
      signatureImageUrl,
      signedAt: r.signedAt.toISOString(),
      planTitle: r.planTitle,
      contractBody: r.contractBody,
      minimumTermMonths: r.minimumTermMonths,
      earlyExitFee: r.earlyExitFee,
      currency: r.currency,
      contractVersion: r.contractVersion,
      contractSha256: r.contractSha256,
      used: r.usedAt !== null,
    };
  }
}

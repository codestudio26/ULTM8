import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { WAIVER_SIGNATURE_REQUESTS_QUEUE } from '../jobs/queue.constants';
import { CreateWaiverDto } from './dto/create-waiver.dto';
import { UpdateWaiverDto } from './dto/update-waiver.dto';
import { SignWaiverDto } from './dto/sign-waiver.dto';

/**
 * Phase 10 scope only: Waiver CRUD + Student self-signing (typed name, not a
 * drawn-signature) + Student's own read of their signatures. No Guardian-signing
 * (Guardian/ConsentRecord don't exist in this codebase yet), no drawn-signature
 * capture, no Booking-time enforcement (Booking doesn't exist yet — Phase 11). See
 * the Phase 10 kickoff prompt for the full scoping rationale.
 *
 * sign() DOES enforce the confirmed age-of-majority gate (skills/ultm8-domain-
 * rules/SKILL.md §13 — see assertSelfAttestedAdult's own comment) — an under-18
 * caller is rejected outright, since there's no Guardian-linked path to redirect
 * them to yet. Found missing and fixed on code review, not shipped as a silent gap
 * the way the other two above are explicitly, deliberately deferred.
 */
@Injectable()
export class WaiversService {
  private readonly logger = new Logger(WaiversService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    @InjectQueue(WAIVER_SIGNATURE_REQUESTS_QUEUE) private readonly waiverSignatureRequestsQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // Waiver CRUD — School Owner/Manager only (Spec §8.2), same gate as
  // MembershipPlan/Class CRUD.
  // ---------------------------------------------------------------------------

  async createWaiver(callerId: string, schoolId: string, dto: CreateWaiverDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    const id = randomUUID();
    const waiver = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.waiver.create({ data: { id, schoolId, title: dto.title, body: dto.body } }),
    );

    // "Assignment" read structurally (§2.1 of the Phase 10 kickoff prompt) — this
    // Waiver's own creation IS the assignment event this job fires on, since no
    // separate assignment action/entity is confirmed anywhere in Spec 55.
    //
    // FOUND ON REVIEW: the Waiver row above is already durably committed
    // (withTenantContext's own $transaction returned) by the time this runs — an
    // earlier draft let a queue.add() failure (e.g. Redis unreachable, the exact
    // "warn and let it fail later" state QueueModule's own header comment already
    // documents as accepted) propagate uncaught, which would 500 the caller even
    // though the Waiver genuinely exists — inviting a retry that creates a
    // duplicate (no uniqueness constraint on schoolId+title). This job is a
    // notification side effect, not the primary outcome of this request; a
    // caller who successfully created a Waiver should get a 201 back regardless
    // of whether the job could be enqueued. Logged loudly instead of silently
    // swallowed.
    //
    // attempts/backoff added Phase 15, when this job stopped being a log-only
    // stub incapable of failing — same shape TwilioVerifyService.sendOtp
    // already established for otp-delivery.
    try {
      await this.waiverSignatureRequestsQueue.add(
        'notify',
        { waiverId: id, schoolId },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    } catch (err) {
      this.logger.error(
        `Waiver ${id} (School ${schoolId}) was created but enqueueing waiver-signature-requests failed — the notification job (log-only this phase) will never run for it.`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return waiver;
  }

  async findAllWaivers(callerId: string, schoolId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    await this.schoolsService.findOne(callerId, schoolId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.waiver.findMany({ ...args, where: { schoolId } }), cursor, limit),
    );
  }

  async findOneWaiver(callerId: string, waiverId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) => tx.waiver.findUnique({ where: { id: waiverId } }));
    if (!found) {
      throw new NotFoundException('Waiver not found');
    }
    return found;
  }

  async updateWaiver(callerId: string, waiverId: string, dto: UpdateWaiverDto) {
    const existing = await this.findOneWaiver(callerId, waiverId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.waiver.update({ where: { id: waiverId }, data: { title: dto.title, body: dto.body } }),
    );
  }

  // No delete method — same reasoning ClassesModule/School/Branch/MembershipPlan
  // already established (general tenant offboarding is [UNRESOLVED]).

  // ---------------------------------------------------------------------------
  // Signing — Student-authenticated only this phase (no Guardian path — see this
  // file's own header comment).
  // ---------------------------------------------------------------------------

  /**
   * FOUND ON REVIEW: skills/ultm8-domain-rules/SKILL.md §13 states, as
   * [CONFIRMED] (not [UNRESOLVED]): "whether a Student is self-attested-adult by
   * DOB, or must be Guardian-linked, is checked at the first consequential
   * action — a Membership purchase, a booking-triggered payment, or
   * waiver-signing, whichever comes first... If the check fails, that action is
   * blocked." An earlier draft of this method implemented no age check at all —
   * silently dropping a CONFIRMED rule rather than either building it or flagging
   * it the way Guardian-signing and drawn-signature-capture were both explicitly
   * flagged in this file's own header comment. Fixed: the age-of-majority half
   * (18, legally confirmed final per Decision 77, docs/decisions/POST-SPEC-55-
   * DECISION-LOG.md) is genuinely buildable now — User.dateOfBirth already
   * exists, no Guardian infrastructure is needed to REJECT an under-18 caller,
   * only to redirect them to a Guardian-linked enrollment path once one exists.
   * That redirect half stays unbuilt (Guardian/ConsentRecord don't exist in this
   * codebase — see this file's own header comment) — flagged, not guessed.
   *
   * Atomicity requirement (Phase 10 kickoff prompt §2.2 — a Developer-level
   * inferred constraint, not itself a literal Spec 55 quote): a Student may not
   * hold two non-Expired WaiverSignatures for the same Waiver. Enforced via a
   * partial unique index at the DB level (see this phase's migration) rather than
   * a separate findFirst-then-create check — the same atomic create()+caught-
   * unique-violation shape Phase 9 already established for the two-simultaneous-
   * Active-Membership rule, not a TOCTOU-prone check-then-insert.
   */
  async sign(callerId: string, waiverId: string, dto: SignWaiverDto) {
    const waiver = await this.findOneWaiver(callerId, waiverId);
    await this.assertSelfAttestedAdult(callerId);
    try {
      return await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.waiverSignature.create({
          data: {
            id: randomUUID(),
            waiverId: waiver.id,
            studentId: callerId,
            schoolId: waiver.schoolId,
            signerFullName: dto.signerFullName,
            signatureText: dto.signatureText,
          },
        }),
      );
    } catch (err) {
      if (this.isUniqueConstraintViolation(err)) {
        throw new ConflictException('This Student already holds a non-Expired signature for this Waiver.');
      }
      throw err;
    }
  }

  private isUniqueConstraintViolation(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002');
  }

  /** See sign()'s own header comment. Age-of-majority (18) computed from
   * User.dateOfBirth — a plain calendar-based calculation, not a rolling
   * 365.25-day approximation, so a Student who turns 18 today already passes. */
  private async assertSelfAttestedAdult(callerId: string): Promise<void> {
    const student = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: callerId }, select: { dateOfBirth: true } }),
    );
    const today = new Date();
    let age = today.getUTCFullYear() - student.dateOfBirth.getUTCFullYear();
    const hasHadBirthdayThisYear =
      today.getUTCMonth() > student.dateOfBirth.getUTCMonth() ||
      (today.getUTCMonth() === student.dateOfBirth.getUTCMonth() && today.getUTCDate() >= student.dateOfBirth.getUTCDate());
    if (!hasHadBirthdayThisYear) age -= 1;

    if (age < 18) {
      throw new ForbiddenException(
        'Signing a waiver requires a self-attested-adult Student (18+) or a Guardian-linked account. Guardian-linked enrollment is not yet available on this platform — see skills/ultm8-domain-rules/SKILL.md §14.',
      );
    }
  }

  async findMySignatures(callerId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.waiverSignature.findMany({ ...args, where: { studentId: callerId } }), cursor, limit),
    );
  }
}

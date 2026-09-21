import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { WaiverSignature } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { GuardiansService } from '../guardians/guardians.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { WAIVER_SIGNATURE_REQUESTS_QUEUE } from '../jobs/queue.constants';
import { CreateWaiverDto } from './dto/create-waiver.dto';
import { UpdateWaiverDto } from './dto/update-waiver.dto';
import { SignWaiverDto } from './dto/sign-waiver.dto';
import { RequestSignatureUploadUrlDto } from './dto/request-signature-upload-url.dto';
import { R2ClientService } from './r2-client.service';

/**
 * Phase 10 scope: Waiver CRUD + Student self-signing + Student's own read of
 * their signatures. Phase 34 added drawn-signature capture (typed name remains
 * the baseline — see sign()'s own header comment) on top of that same scope.
 * Phase 37 added Guardian-on-behalf-of signing (see sign()'s own header comment
 * for the full account, including a real remaining gap it surfaced: there is
 * still no Guardian-on-behalf-of ENROLLMENT path, so this is only reachable once
 * a minor already holds a STUDENT RoleGrant by some other means). See the Phase
 * 10 kickoff prompt for the full original scoping rationale.
 *
 * sign() DOES enforce the confirmed age-of-majority gate (skills/ultm8-domain-
 * rules/SKILL.md §13 — see assertSelfAttestedAdult's own comment) for the
 * self-signing path; a Guardian-authenticated caller takes a different branch
 * entirely (see sign()'s own comment) since Decision 67/SKILL.md §13's "or must
 * be Guardian-linked" half is satisfied directly by a verified GuardianLink.
 */
@Injectable()
export class WaiversService {
  private readonly logger = new Logger(WaiversService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly guardiansService: GuardiansService,
    private readonly r2Client: R2ClientService,
    @InjectQueue(WAIVER_SIGNATURE_REQUESTS_QUEUE) private readonly waiverSignatureRequestsQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // Waiver CRUD — School Owner/Manager only (Spec §8.2), same gate as
  // MembershipPlan/Class CRUD.
  // ---------------------------------------------------------------------------

  async createWaiver(callerId: string, schoolId: string, dto: CreateWaiverDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

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
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.waiver.update({ where: { id: waiverId }, data: { title: dto.title, body: dto.body } }),
    );
  }

  // No delete method — same reasoning ClassesModule/School/Branch/MembershipPlan
  // already established (general tenant offboarding is [UNRESOLVED]).

  // ---------------------------------------------------------------------------
  // Signing — Student self-signing, plus Guardian-on-behalf-of-a-linked-minor
  // signing as of Phase 37 (see sign()'s own header comment). Phase 34 added the
  // drawn-signature-capture upload flow (requestSignatureUploadUrl -> sign) on
  // top of the original self-signing-only shape.
  // ---------------------------------------------------------------------------

  /**
   * Step 1 of drawn-signature capture (Phase 34, Decision 74/78) — a presigned
   * PUT URL the caller uploads a raster (PNG) signature image to directly, then
   * passes the returned `objectKey` back as SignWaiverDto.signatureImageKey when
   * actually calling sign() (step 2). No age-of-majority check here, unlike
   * sign() itself — requesting an upload URL isn't the legally consequential
   * act (signing is; see assertSelfAttestedAdult's own comment), so an under-18
   * caller can still reach this without gaining anything, since sign() would
   * still reject them at the actual signing step.
   *
   * Object key deliberately encodes schoolId/waiverId/studentId in that order
   * (tenant-first, same "composite index leading with the tenant column"
   * convention Decision 30 already establishes for this schema's own indexes,
   * applied here to an object-key prefix instead) — sign() validates an
   * incoming signatureImageKey against this exact prefix before accepting it.
   *
   * `dto.studentId` (Phase 37) — same on-behalf-of shape as sign() itself: the
   * key MUST be prefixed with the actual Student's id (not the Guardian's), or
   * sign()'s own prefix check could never match it. The Waiver lookup runs
   * under the STUDENT's tenant context for exactly the same reason sign()'s own
   * comment gives — GuardianLink carries no School RoleGrant for Waiver's RLS
   * to recognize.
   */
  async requestSignatureUploadUrl(callerId: string, waiverId: string, dto?: RequestSignatureUploadUrlDto) {
    const studentId = dto?.studentId ?? callerId;
    if (dto?.studentId !== undefined && dto.studentId !== callerId) {
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    }
    const waiver = await this.findOneWaiver(studentId, waiverId); // 404s if not visible/doesn't exist
    const objectKey = `waiver-signatures/${waiver.schoolId}/${waiver.id}/${studentId}/${randomUUID()}.png`;
    const uploadUrl = await this.r2Client.getPresignedUploadUrl(objectKey, 'image/png');
    return { uploadUrl, objectKey };
  }

  /**
   * FOUND ON REVIEW: skills/ultm8-domain-rules/SKILL.md §13 states, as
   * [CONFIRMED] (not [UNRESOLVED]): "whether a Student is self-attested-adult by
   * DOB, or must be Guardian-linked, is checked at the first consequential
   * action — a Membership purchase, a booking-triggered payment, or
   * waiver-signing, whichever comes first... If the check fails, that action is
   * blocked." An earlier draft of this method implemented no age check at all —
   * silently dropping a CONFIRMED rule. Fixed: the age-of-majority half (18,
   * legally confirmed final per Decision 77) rejects an under-18 SELF-signing
   * caller outright. Phase 37 built the redirect half this comment used to flag
   * as unbuilt — see below.
   *
   * Guardian-on-behalf-of signing (Phase 37, SKILL.md §14, [CONFIRMED]: a
   * Guardian has "full access to... waiver-signing authority... for each linked
   * minor"). `dto.studentId` is the same on-behalf-of shape BookClassDto already
   * established (bookings.service.ts): omitted/equal-to-caller means ordinary
   * self-signing; naming someone else means a Guardian acting for a linked
   * minor, gated by assertGuardianOfStudent() instead of assertSelfAttestedAdult()
   * — a verified GuardianLink satisfies SKILL.md §13's "or must be Guardian-
   * linked" branch directly, no separate age check needed for that branch.
   *
   * The Waiver lookup (and the eventual WaiverSignature write) both run under
   * the STUDENT's own tenant context, not the caller's — for the ordinary
   * self-signing case that's a no-op (studentId === callerId already), but for
   * a Guardian it's load-bearing: Waiver's RLS (`waiver_tenant_isolation`)
   * requires an active RoleGrant AT THAT SCHOOL, and GuardianLink is
   * platform-scoped with no School dimension at all (Decision 92) — a Guardian
   * has no RoleGrant of their own to satisfy it. Same target-tenant-context
   * substitution Booking's own Staff-on-behalf-of write already established.
   *
   * KNOWN LIMITATION, flagged not guessed: this only actually works once the
   * target minor already holds a STUDENT RoleGrant at the School — and today
   * there is no Guardian-on-behalf-of ENROLLMENT path (SchoolsService.join() is
   * self-service-only, and a Guardian-managed minor's User row is permanently
   * blocked from independent login — see GuardiansService.createMinor()'s own
   * comment). Building that is a separate, larger gap this phase deliberately
   * does not solve — see this file's own header comment.
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
    const studentId = dto.studentId ?? callerId;
    const isGuardianAction = dto.studentId !== undefined && dto.studentId !== callerId;
    if (isGuardianAction) {
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    }

    const waiver = await this.findOneWaiver(studentId, waiverId);

    // See this method's own header comment — a verified GuardianLink itself
    // satisfies SKILL.md §13's "or must be Guardian-linked" branch, so only the
    // ordinary self-signing path needs the age-of-majority check.
    if (!isGuardianAction) {
      await this.assertSelfAttestedAdult(callerId);
    }

    if (dto.signatureImageKey) {
      // Same reasoning requestSignatureUploadUrl's own comment already gives
      // for the key's shape — reject anything that doesn't match THIS specific
      // waiver/student's own prefix, so a caller can't reference an object
      // uploaded for a different waiver, a different Student, or an arbitrary
      // key that was never actually issued by this endpoint.
      const expectedPrefix = `waiver-signatures/${waiver.schoolId}/${waiver.id}/${studentId}/`;
      if (!dto.signatureImageKey.startsWith(expectedPrefix)) {
        throw new BadRequestException('signatureImageKey does not match this waiver/student.');
      }
      // FOUND ON REVIEW — see R2ClientService.objectExists()'s own comment: the
      // prefix check alone only proves the key is SHAPED correctly, not that an
      // image was ever actually uploaded there. A legal record shouldn't accept
      // an unverified claim.
      if (!(await this.r2Client.objectExists(dto.signatureImageKey))) {
        throw new BadRequestException('signatureImageKey does not reference an uploaded object — upload the image first.');
      }
    }

    let created: WaiverSignature;
    try {
      created = await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.waiverSignature.create({
          data: {
            id: randomUUID(),
            waiverId: waiver.id,
            studentId,
            signedById: callerId,
            schoolId: waiver.schoolId,
            signerFullName: dto.signerFullName,
            signatureText: dto.signatureText,
            signatureImageKey: dto.signatureImageKey,
          },
        }),
      );
    } catch (err) {
      if (this.isUniqueConstraintViolation(err)) {
        throw new ConflictException('This Student already holds a non-Expired signature for this Waiver.');
      }
      throw err;
    }
    return this.toSignatureResponse(created);
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
    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.waiverSignature.findMany({ ...args, where: { studentId: callerId } }), cursor, limit),
    );
    // Presigned-URL generation is a pure local HMAC computation (no network
    // round-trip to R2 — see R2ClientService's own header comment), so mapping
    // every item in a page this way costs nothing beyond CPU, even for a full
    // page of signatures with images.
    const items = await Promise.all(page.items.map((item) => this.toSignatureResponse(item as WaiverSignature)));
    return { ...page, items };
  }

  /**
   * FOUND ON REVIEW, before this ever shipped: a first draft returned the raw
   * Prisma WaiverSignature object directly from sign()/findMySignatures() — this
   * codebase has no global response serializer (ClassSerializerInterceptor),
   * confirmed the same way PlatformAdminModule's own PLATFORM_ADMIN_SCHOOL_SELECT
   * finding already established for this exact class of bug — so the new
   * `signatureImageKey` column would have leaked the raw R2 object key straight
   * into the HTTP response instead of the intended presigned `signatureImageUrl`.
   * Every caller of sign()/findMySignatures() routes through this helper instead,
   * which strips the raw key and substitutes a freshly-generated, short-lived
   * presigned GET URL (or null, if no image was ever captured).
   *
   * ALSO FOUND ON REVIEW: the presign call below runs AFTER sign()'s own
   * withTenantContext transaction has already committed the WaiverSignature row —
   * same "the row already committed, don't let a downstream problem make the
   * caller think the primary action failed" reasoning createWaiver()'s own
   * queue.add() try/catch above already applies to its notification job. A
   * transient R2 failure (or R2 simply not configured) here must not turn an
   * already-successful signature into a client-visible 500 — logged loudly
   * instead, same as that precedent, with `signatureImageUrl` coming back null
   * rather than the request failing outright. The image itself isn't lost — the
   * key is durably stored; only this one response's convenience URL is affected.
   */
  private async toSignatureResponse(signature: WaiverSignature) {
    const { signatureImageKey, ...rest } = signature;
    let signatureImageUrl: string | null = null;
    if (signatureImageKey) {
      try {
        signatureImageUrl = await this.r2Client.getPresignedDownloadUrl(signatureImageKey);
      } catch (err) {
        this.logger.error(
          `Could not generate a presigned view URL for WaiverSignature ${signature.id} (key ${signatureImageKey}) — the signature itself is unaffected.`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    return { ...rest, signatureImageUrl };
  }
}

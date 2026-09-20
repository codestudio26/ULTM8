import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { CreateMinorDto } from './dto/create-minor.dto';
import { GrantConsentDto } from './dto/grant-consent.dto';

const BCRYPT_ROUNDS = 12;

/**
 * Phase 12 scope: Guardian linking a minor Student + two-tier ConsentRecord
 * grant/withdraw. See the Phase 12 kickoff prompt for the full scoping rationale —
 * age-13 limited login and a consent-management UI remain explicitly out of scope.
 * Waiver-signing (Phase 37), School enrollment (Phase 38, SchoolsService.join()),
 * Membership purchase (Phase 39, MembershipsService.purchase()), Booking creation
 * and cancellation (Phase 40/41, BookingsService.bookClass()/cancelBooking()),
 * and Waitlist join/withdraw/claim (Phase 42, WaitlistService, Decision 103) were
 * ALL deferred here originally, but each was revisited once this module existed
 * to build against — see assertGuardianOfStudent()'s own comment and each
 * consumer's own header comment for the full account. This closes the entire
 * originally-deferred Guardian-on-behalf-of chain.
 *
 * RLS shape (Decision 92): GuardianLink/ConsentRecord are narrow, self-only
 * (`guardianId = caller`), no shared-visibility branch at all — the first tables
 * in this schema with that shape (see schema.prisma's own model comments). Two
 * write paths in this file need a mechanism beyond that narrow policy, both found
 * on this phase's own verification/review passes before they ever shipped:
 *  - createMinor()'s User INSERT reuses the EXACT bootstrap trick
 *    AuthService.register() already established — User's own RLS WITH CHECK
 *    only permits inserting a row whose id equals the CURRENT tenant context, so
 *    the new minor's User row is created under ITS OWN (about-to-exist) id as
 *    tenant context, not the Guardian's.
 *  - withdrawConsent()'s baseline-cascade RoleGrant revocation runs via
 *    PrismaJobsService — RoleGrant's own existing RLS (`rolegrant_self_only`)
 *    would otherwise block the Guardian from ever writing to the MINOR's own
 *    RoleGrant rows under the Guardian's own tenant context.
 */
@Injectable()
export class GuardiansService {
  private readonly logger = new Logger(GuardiansService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
  ) {}

  /**
   * POST /guardians/me/minors. Creates a NEW minor User row (no independent login
   * by default — `phoneVerifiedAt` stays null, the same gate AuthService already
   * uses to block login until OTP verification; a minor's OTP verification never
   * runs, so this is a permanent, not merely initial, block) plus the linking
   * GuardianLink row.
   *
   * `email`/`phone` are both required+unique on User (Phase 1's own schema, not
   * designed with a "no independent contact info" minor case in mind) — synthetic,
   * guaranteed-unique placeholder values fill them; flagged explicitly as a
   * Developer-level workaround, not a confirmed field convention (Decision 92).
   * `passcodeHash` is a real bcrypt hash of a value nobody is ever told — belt-
   * and-braces alongside the phoneVerifiedAt gate, same reasoning
   * AuthService.DECOY_PASSCODE_HASH already established for "a hash of a value
   * that will never be typed," generated fresh per minor rather than a shared
   * constant since there's no timing-attack concern to keep it stable for here.
   */
  async createMinor(guardianId: string, dto: CreateMinorDto) {
    const minorId = randomUUID();
    const email = `minor+${minorId}@guardian-managed.ultm8.internal`;
    // E.164 numbers never start with a 0 after the '+' — this prefix is
    // guaranteed to never collide with a real phone number, same reasoning the
    // synthetic email domain uses. FOUND ON REVIEW: an earlier version sliced
    // raw hex characters from a UUID, which routinely produced letters (a-f) —
    // not valid E.164 at all, despite the field's own schema comment ("E.164,
    // validated at the DTO layer") and this comment's own claim otherwise. Fixed
    // to map each hex character down to a decimal digit instead, so the result
    // is guaranteed digits-only.
    const phone = `+000${randomUUID()
      .replace(/-/g, '')
      .split('')
      .map((c) => parseInt(c, 16) % 10)
      .join('')
      .slice(0, 12)}`;
    const passcodeHash = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);
    const dateOfBirth = new Date(dto.dateOfBirth);

    // FOUND ON REVIEW: the User insert and the GuardianLink insert were
    // originally two SEPARATE withTenantContext() calls — each opens and
    // commits its OWN transaction, so a failure on the second call (a transient
    // DB error, a pod restart between the two awaits) left the first one's
    // write permanently committed with no rollback: a real, unreachable minor
    // User row (synthetic identity, real bcrypt-hashed unguessable passcode)
    // with no GuardianLink pointing at it, invisible to findMyMinors() forever
    // and never cleaned up by anything. Fixed with withMultiTenantContext() —
    // both inserts now share ONE Postgres transaction, so either both commit or
    // neither does.
    const link = await this.prismaApp.withMultiTenantContext(async (tx, setContext) => {
      await setContext(minorId);
      await tx.user.create({
        data: {
          id: minorId,
          email,
          phone,
          firstName: dto.firstName,
          surname: dto.surname,
          dateOfBirth,
          gender: dto.gender,
          passcodeHash,
        },
      });

      await setContext(guardianId);
      return tx.guardianLink.create({
        data: { id: randomUUID(), guardianId, studentId: minorId },
      });
    });

    return {
      linkId: link.id,
      studentId: minorId,
      firstName: dto.firstName,
      surname: dto.surname,
      // Matches findMyMinors()'s own shape (a Prisma-read Date, JSON-serialized
      // as a full ISO datetime string) rather than echoing the client's raw
      // date-only input string back — FOUND ON REVIEW: the two endpoints
      // previously returned different formats for the identical value.
      dateOfBirth: dateOfBirth.toISOString(),
      gender: dto.gender ?? null,
    };
  }

  /** GET /guardians/me/minors. */
  async findMyMinors(guardianId: string) {
    const links = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.guardianLink.findMany({ where: { guardianId, revokedAt: null } }),
    );
    if (links.length === 0) return { items: [] };

    // Each minor's own User row is read under the MINOR's own tenant context
    // (the target-context mechanism already established in Phase 9/10b/11 for
    // Staff-reading-a-Student's-own-data) — the Guardian's own context can't see
    // it directly (User's shared-visibility branch is School-based, and this
    // pairing has no School).
    const minors = await Promise.all(
      links.map((link) =>
        this.prismaApp.withTenantContext(link.studentId, (tx) =>
          tx.user.findUniqueOrThrow({
            where: { id: link.studentId },
            select: { id: true, firstName: true, surname: true, dateOfBirth: true, gender: true },
          }),
        ),
      ),
    );

    const items = links.map((link, i) => ({
      linkId: link.id,
      studentId: minors[i].id,
      firstName: minors[i].firstName,
      surname: minors[i].surname,
      dateOfBirth: minors[i].dateOfBirth,
      gender: minors[i].gender,
    }));
    return { items };
  }

  /**
   * Shared authorization primitive for OTHER modules doing Guardian-on-behalf-of
   * work (consumers: WaiversModule's sign()/requestSignatureUploadUrl(), Phase 37;
   * SchoolsService.join(), Phase 38; MembershipsService.purchase(), Phase 39;
   * BookingsService.bookClass()/cancelBooking(), Phase 40/41;
   * WaitlistService.joinWaitlist()/withdraw()/claim(), Phase 42) — mirrors
   * TenantAuthorizationService.assertStaffAtSchool()'s shape
   * and call-then-throw convention, but can't reuse that helper directly:
   * GuardianLink has no School dimension to key off at all (Decision 92; see
   * this class's own header comment), unlike a RoleGrant.
   *
   * No ConsentRecord check here, deliberately: SKILL.md §14 states the GuardianLink
   * itself (active, not revoked) is what confers "full access to... waiver-signing
   * authority... for each linked minor" — ConsentRecord is a separate, unrelated
   * legal concept (SKILL.md §16: "a different legal concept entirely"), not a
   * documented prerequisite gate for this specific authority. Not invented here —
   * applying the already-[CONFIRMED] text directly, not filling a gap with a guess.
   */
  async assertGuardianOfStudent(guardianId: string, studentId: string): Promise<void> {
    const link = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.guardianLink.findUnique({ where: { guardianId_studentId: { guardianId, studentId } } }),
    );
    if (!link || link.revokedAt) {
      throw new ForbiddenException('You are not an active Guardian for this Student.');
    }
  }

  /** POST /guardians/me/minors/{studentId}/consent. Upserts — re-granting after a
   * withdrawal reactivates the same (guardian, student, tier) row rather than
   * erroring, since @@unique([guardianId, studentId, tier]) would otherwise
   * reject a second INSERT outright. */
  async grantConsent(guardianId: string, studentId: string, dto: GrantConsentDto) {
    const link = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.guardianLink.findUnique({ where: { guardianId_studentId: { guardianId, studentId } } }),
    );
    if (!link || link.revokedAt) {
      throw new BadRequestException('This Guardian has no active link to this Student.');
    }

    return this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.consentRecord.upsert({
        where: { guardianId_studentId_tier: { guardianId, studentId, tier: dto.tier } },
        create: {
          id: randomUUID(),
          guardianId,
          studentId,
          tier: dto.tier,
          policyVersion: dto.policyVersion,
        },
        update: {
          status: 'ACTIVE',
          policyVersion: dto.policyVersion,
          consentedAt: new Date(),
          withdrawnAt: null,
        },
      }),
    );
  }

  /** GET /guardians/me/consent. */
  async findMyConsentRecords(guardianId: string) {
    const items = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.consentRecord.findMany({ where: { guardianId } }),
    );
    return { items };
  }

  /**
   * PATCH /guardians/me/consent/{id}/withdraw. Withdrawal is proportional to
   * tier (SKILL.md §14, quoted): BASELINE triggers "the full cascade — the same
   * RoleGrant-revocation cascade as Guardian-account revocation, plus the
   * account-deletion-processing job, scoped to that one Student." CAMERA-tier-
   * only "does NOT delete the account or touch grading history... marks only
   * that ConsentRecord Withdrawn... blocks future self-service QR check-in...
   * clears any already-stored profile photo."
   *
   * Multi-Guardian interaction (a second Guardian's own baseline consent for the
   * same Student staying Active) isn't addressed anywhere in the confirmed text —
   * resolved to the literal reading: THIS withdrawal triggers the cascade
   * regardless of any other Guardian's own consent state (Decision 92), not an
   * invented "unless someone else still consents" exception.
   */
  async withdrawConsent(guardianId: string, consentRecordId: string) {
    const existing = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.consentRecord.findUnique({ where: { id: consentRecordId } }),
    );
    if (!existing || existing.guardianId !== guardianId) {
      throw new NotFoundException('Consent record not found');
    }
    if (existing.status !== 'ACTIVE') {
      throw new ConflictException('This consent record is already Withdrawn.');
    }

    // FOUND ON REVIEW: an earlier version flipped ConsentRecord to WITHDRAWN
    // FIRST, then ran the side effect (RoleGrant cascade / profile-photo clear)
    // after. The BASELINE cascade genuinely can't share one Postgres
    // transaction with the ConsentRecord update — it runs via
    // PrismaJobsService, a separate role/connection entirely — so a failure in
    // the side effect left the record permanently WITHDRAWN with no
    // reconciliation path: a retry hit "already Withdrawn" instead of retrying
    // the cascade, silently stranding the RoleGrant revocation forever. Fixed
    // by reordering: the side effect runs FIRST, and both possible side effects
    // are naturally idempotent (setting profilePhotoUrl=null twice, or
    // re-revoking already-revoked RoleGrant rows, are harmless no-ops the
    // second time) — if it fails, ConsentRecord stays ACTIVE and a retry safely
    // redoes everything; only once the side effect has genuinely succeeded does
    // the record flip to WITHDRAWN.
    if (existing.tier === 'CAMERA') {
      await this.prismaApp.withTenantContext(existing.studentId, (tx) =>
        tx.user.update({ where: { id: existing.studentId }, data: { profilePhotoUrl: null } }),
      );
    } else {
      // BASELINE — the full cascade. Runs via PrismaJobsService (ultm8_jobs) —
      // see this class's own header comment for why RoleGrant's existing narrow
      // RLS would otherwise block the Guardian from writing to the Student's
      // own rows.
      const cascadeResult = await this.prismaJobs.roleGrant.updateMany({
        where: { userId: existing.studentId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.log(
        `withdrawConsent (BASELINE): revoked ${cascadeResult.count} active RoleGrant(s) for Student ${existing.studentId}.`,
      );

      // account-deletion-processing — a genuine confirmed job NAME (SKILL.md
      // §14, quoted), but its own real data-erasure mechanics are explicitly
      // out of scope this phase (Phase 12 kickoff prompt §2) — log-only stub,
      // same established precedent as WaiverSignatureRequestsProcessor before
      // NotificationsModule existed.
      this.logger.log(
        `account-deletion-processing: Student ${existing.studentId} — no data-erasure pipeline yet (Phase 12 scope), recorded only.`,
      );
    }

    const result = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.consentRecord.updateMany({
        where: { id: consentRecordId, status: 'ACTIVE' },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      }),
    );
    if (result.count === 0) {
      // Lost a race against a concurrent withdrawal of the same record — the
      // side effect above already ran (harmlessly redundant with the other
      // request's own), so this is a benign race, not a partial-failure state.
      throw new ConflictException('This consent record is already Withdrawn.');
    }

    return this.prismaApp.withTenantContext(guardianId, (tx) => tx.consentRecord.findUniqueOrThrow({ where: { id: consentRecordId } }));
  }
}

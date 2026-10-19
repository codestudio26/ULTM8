import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import type { ConsentRecord } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AGE_OF_MAJORITY, calendarAge } from '../common/calendar-age';
import { getCurrentPolicyVersion, PRIVACY_NOTICE_SLUG } from '../settings/legal-policy-version';
import { CreateMinorDto } from './dto/create-minor.dto';
import { GrantConsentDto } from './dto/grant-consent.dto';
import { MinorErasureService } from './minor-erasure.service';

const BCRYPT_ROUNDS = 12;

// Decision 123 — same "named, explicit, Developer-level placeholder" tier of
// judgment call as QR_ATTENDANCE_TOKEN_TTL_SECONDS/
// PLATFORM_ADMIN_IMPERSONATION_TTL_SECONDS. Short enough that a captured/stale
// Kid-Mode token is useless quickly on its own — BookingsController's live
// BookingDelegation re-check (mintKidModeToken()'s own comment) is the real
// backstop, this is a second, independent one.
const KID_MODE_TOKEN_TTL_SECONDS = Number(process.env.KID_MODE_TOKEN_TTL_SECONDS ?? 300);

// Second argument to hashtextextended() for the per-Student baseline-consent
// advisory lock (Decision 173), so these lock keys can't collide with any
// other advisory lock that hashes a Student id.
const BASELINE_CONSENT_LOCK_SEED = 173;

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
    private readonly jwt: JwtService,
    private readonly minorErasure: MinorErasureService,
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
   *
   * Decision 172: the Guardian must be an adult, and the minor must really be a
   * minor, both by the same calendar-based age the waiver check uses.
   */
  async createMinor(guardianId: string, dto: CreateMinorDto) {
    const dateOfBirth = new Date(dto.dateOfBirth);
    const today = new Date();
    if (dateOfBirth.getTime() > today.getTime()) {
      throw new BadRequestException('dateOfBirth cannot be in the future.');
    }
    if (calendarAge(dateOfBirth, today) >= AGE_OF_MAJORITY) {
      throw new BadRequestException(
        `A Guardian can only link a minor (under ${AGE_OF_MAJORITY}). An adult registers their own Student account.`,
      );
    }
    const guardian = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: guardianId }, select: { dateOfBirth: true } }),
    );
    if (calendarAge(guardian.dateOfBirth, today) < AGE_OF_MAJORITY) {
      throw new ForbiddenException(`Only an adult (${AGE_OF_MAJORITY} or over) can be a Guardian.`);
    }

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
      confirmedAt: null,
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
      confirmedAt: link.confirmedAt,
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
   * reject a second INSERT outright.
   *
   * Refused unless a School has confirmed the link (Decision 172) and
   * `policyVersion` is the privacy notice version currently published (Decision
   * 171) — so consent stays blocked until counsel's notice is published. The
   * parental-responsibility declaration is required by the DTO (Decision 172).
   * The upsert and its ConsentEvent (Decision 170) commit together. */
  async grantConsent(guardianId: string, studentId: string, dto: GrantConsentDto) {
    const link = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.guardianLink.findUnique({ where: { guardianId_studentId: { guardianId, studentId } } }),
    );
    if (!link || link.revokedAt) {
      throw new BadRequestException('This Guardian has no active link to this Student.');
    }
    if (!link.confirmedAt) {
      throw new ForbiddenException(
        "A School has not confirmed you as this Student's Guardian yet. Consent can be given once a School the Student is enrolled at confirms it.",
      );
    }

    const currentPolicyVersion = await getCurrentPolicyVersion(this.prismaApp, PRIVACY_NOTICE_SLUG);
    if (!currentPolicyVersion) {
      throw new ConflictException('Consent is not available yet: the privacy notice has not been published.');
    }
    if (dto.policyVersion !== currentPolicyVersion) {
      throw new ConflictException(
        `policyVersion must be the current privacy notice version (${currentPolicyVersion}). Show the Guardian the current notice and try again.`,
      );
    }

    return this.prismaApp.withTenantContext(guardianId, async (tx) => {
      const record = await tx.consentRecord.upsert({
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
      });
      await tx.consentEvent.create({
        data: {
          id: randomUUID(),
          consentRecordId: record.id,
          guardianId,
          studentId,
          tier: record.tier,
          type: 'GRANTED',
          policyVersion: record.policyVersion,
          parentalResponsibilityDeclared: dto.parentalResponsibilityDeclared,
          occurredAt: record.consentedAt,
        },
      });
      return { ...record, isCurrentPolicyVersion: true };
    });
  }

  /** GET /guardians/me/consent. Each record also says whether it was given
   * against the privacy notice version currently published (Decision 171). */
  async findMyConsentRecords(guardianId: string) {
    const [records, currentPolicyVersion] = await Promise.all([
      this.prismaApp.withTenantContext(guardianId, (tx) => tx.consentRecord.findMany({ where: { guardianId } })),
      getCurrentPolicyVersion(this.prismaApp, PRIVACY_NOTICE_SLUG),
    ]);
    const items = records.map((r) => ({ ...r, isCurrentPolicyVersion: r.policyVersion === currentPolicyVersion }));
    return { items };
  }

  /** GET /guardians/me/consent-events (Decision 170) — the calling Guardian's own
   * append-only consent history, newest first. */
  async findMyConsentEvents(guardianId: string) {
    const items = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.consentEvent.findMany({ where: { guardianId }, orderBy: { occurredAt: 'desc' } }),
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
   * Multi-Guardian interaction (Decision 173, replacing Decision 92's literal
   * reading): while another Guardian with an active link still has ACTIVE
   * baseline consent, a BASELINE withdrawal only withdraws this consent and
   * revokes this Guardian's own link — the minor's data and enrolments stay.
   * Once no such consent is left, the full cascade runs: RoleGrant revocation,
   * then MinorErasureService (`account-deletion-processing`).
   *
   * Every withdrawal also appends a WITHDRAWN ConsentEvent (Decision 170), in the
   * same transaction as the status flip.
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
      return this.markWithdrawn(guardianId, existing);
    }

    // BASELINE. Serialised per Student (Decision 173): without the lock, two
    // Guardians withdrawing at the same moment could each still see the other's
    // consent as ACTIVE, so neither would erase. With it, the second one waits
    // until the first has committed its WITHDRAWN status, then sees it.
    return this.withStudentBaselineLock(existing.studentId, async () => {
      if (await this.hasOtherActiveBaselineConsent(guardianId, existing.studentId)) {
        // Another Guardian still consents: keep the minor's data; this Guardian
        // steps away. Idempotent like the other side effects here — revoking an
        // already-revoked link changes nothing.
        await this.prismaApp.withTenantContext(guardianId, (tx) =>
          tx.guardianLink.updateMany({
            where: { guardianId, studentId: existing.studentId, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
        );
        this.logger.log(
          `withdrawConsent (BASELINE): another Guardian still consents for Student ${existing.studentId}; revoked only this Guardian's link.`,
        );
      } else {
        // Last consent — the full cascade. Runs via PrismaJobsService
        // (ultm8_jobs) — see this class's own header comment for why RoleGrant's
        // existing narrow RLS would otherwise block the Guardian from writing to
        // the Student's own rows.
        const cascadeResult = await this.prismaJobs.roleGrant.updateMany({
          where: { userId: existing.studentId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        this.logger.log(
          `withdrawConsent (BASELINE): revoked ${cascadeResult.count} active RoleGrant(s) for Student ${existing.studentId}.`,
        );

        // account-deletion-processing (SKILL.md §14), Decision 173.
        await this.minorErasure.eraseMinor(existing.studentId);
      }
      return this.markWithdrawn(guardianId, existing);
    });
  }

  /** Flips the record to WITHDRAWN and appends its ConsentEvent (Decision 170),
   * in one transaction. Runs only after withdrawConsent()'s side effect has
   * succeeded — see the ordering comment there. */
  private async markWithdrawn(guardianId: string, existing: ConsentRecord) {
    const consentRecordId = existing.id;
    const withdrawnAt = new Date();
    return this.prismaApp.withTenantContext(guardianId, async (tx) => {
      const result = await tx.consentRecord.updateMany({
        where: { id: consentRecordId, status: 'ACTIVE' },
        data: { status: 'WITHDRAWN', withdrawnAt },
      });
      if (result.count === 0) {
        // Lost a race against a concurrent withdrawal of the same record — the
        // caller's side effect already ran (harmlessly redundant with the other
        // request's own), so this is a benign race, not a partial-failure state.
        throw new ConflictException('This consent record is already Withdrawn.');
      }
      await tx.consentEvent.create({
        data: {
          id: randomUUID(),
          consentRecordId,
          guardianId,
          studentId: existing.studentId,
          tier: existing.tier,
          type: 'WITHDRAWN',
          policyVersion: existing.policyVersion,
          occurredAt: withdrawnAt,
        },
      });
      return tx.consentRecord.findUniqueOrThrow({ where: { id: consentRecordId } });
    });
  }

  /** Runs `fn` while holding a transaction-scoped Postgres advisory lock for this
   * Student's baseline consent (Decision 173). The lock lives on a ultm8_jobs
   * connection and is released when that transaction ends, after `fn` — and so
   * markWithdrawn()'s own commit — has finished. The transaction itself writes
   * nothing. Its timeout covers the erasure (bcrypt plus several deletes). */
  private async withStudentBaselineLock<T>(studentId: string, fn: () => Promise<T>): Promise<T> {
    return this.prismaJobs.$transaction(
      async (tx) => {
        // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, which
        // Prisma cannot deserialize as a query result.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${studentId}, ${BASELINE_CONSENT_LOCK_SEED}))`;
        return fn();
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  /** Decision 173 — does any OTHER Guardian, whose link is still active, hold
   * ACTIVE baseline consent for this minor? Read via ultm8_jobs: ConsentRecord and
   * GuardianLink are self-only for the Guardian, so other Guardians' rows are
   * invisible from this Guardian's own context. */
  private async hasOtherActiveBaselineConsent(guardianId: string, studentId: string): Promise<boolean> {
    const others = await this.prismaJobs.consentRecord.findMany({
      where: { studentId, tier: 'BASELINE', status: 'ACTIVE', guardianId: { not: guardianId } },
      select: { guardianId: true },
    });
    if (others.length === 0) return false;
    const activeLinks = await this.prismaJobs.guardianLink.count({
      where: { studentId, guardianId: { in: others.map((o) => o.guardianId) }, revokedAt: null },
    });
    return activeLinks > 0;
  }

  /** POST /guardians/me/minors/{studentId}/booking-delegation (Decision 123).
   * Upserts — same re-grant-after-withdrawal shape grantConsent() already
   * established, since @@unique([guardianId, studentId]) would otherwise reject
   * a second INSERT outright. */
  async grantBookingDelegation(guardianId: string, studentId: string) {
    const link = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.guardianLink.findUnique({ where: { guardianId_studentId: { guardianId, studentId } } }),
    );
    if (!link || link.revokedAt) {
      throw new BadRequestException('This Guardian has no active link to this Student.');
    }

    return this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.bookingDelegation.upsert({
        where: { guardianId_studentId: { guardianId, studentId } },
        create: { id: randomUUID(), guardianId, studentId },
        update: { status: 'ACTIVE', grantedAt: new Date(), withdrawnAt: null },
      }),
    );
  }

  /** PATCH /guardians/me/booking-delegation/{id}/withdraw (Decision 123). Per the
   * approved design, revoking delegation neither auto-keeps nor auto-cancels an
   * already-made Kid-Mode booking — it flags every still-UPCOMING Booking this
   * minor made via Kid Mode (bookedViaKidMode: true) as pendingGuardianReview,
   * routing it back to the Guardian for an explicit Confirm/Cancel.
   *
   * Same ordering discipline withdrawConsent() already established for its own
   * BASELINE cascade: the side effect runs FIRST — under the MINOR's own tenant
   * context, since the Guardian's own context has no direct visibility into
   * Booking at all (no School RoleGrant, Decision 92) — and only once it has
   * genuinely succeeded does BookingDelegation flip to WITHDRAWN. If the
   * flagging step fails, the record stays ACTIVE and a retry safely redoes
   * everything; both steps are idempotent (re-flagging an already-flagged
   * Booking, or re-revoking an already-WITHDRAWN delegation, are harmless
   * no-ops the second time).
   */
  async withdrawBookingDelegation(guardianId: string, id: string) {
    const existing = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.bookingDelegation.findUnique({ where: { id } }),
    );
    if (!existing || existing.guardianId !== guardianId) {
      throw new NotFoundException('Booking delegation not found');
    }
    if (existing.status !== 'ACTIVE') {
      throw new ConflictException('This booking delegation is already Withdrawn.');
    }

    await this.prismaApp.withTenantContext(existing.studentId, (tx) =>
      tx.booking.updateMany({
        where: { studentId: existing.studentId, status: 'UPCOMING', bookedViaKidMode: true },
        data: { pendingGuardianReview: true },
      }),
    );

    const result = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.bookingDelegation.updateMany({
        where: { id, status: 'ACTIVE' },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      }),
    );
    if (result.count === 0) {
      // Lost a race against a concurrent withdrawal of the same record — the
      // flagging side effect above already ran (harmlessly redundant with the
      // other request's own), same benign-race shape withdrawConsent() already
      // documents for itself.
      throw new ConflictException('This booking delegation is already Withdrawn.');
    }

    return this.prismaApp.withTenantContext(guardianId, (tx) => tx.bookingDelegation.findUniqueOrThrow({ where: { id } }));
  }

  /** GET /guardians/me/booking-delegation (Decision 123). */
  async findMyBookingDelegations(guardianId: string) {
    const items = await this.prismaApp.withTenantContext(guardianId, (tx) => tx.bookingDelegation.findMany({ where: { guardianId } }));
    return { items };
  }

  /** Shared authorization primitive for BookingsController's live pre-booking
   * check (Decision 123) — same "re-check live, never trust the JWT claim alone"
   * discipline assertGuardianOfStudent() already establishes for GuardianLink;
   * a Kid-Mode token's own `kidMode.studentId` claim is necessary but never
   * sufficient on its own. */
  async assertBookingDelegationActive(guardianId: string, studentId: string): Promise<void> {
    const delegation = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.bookingDelegation.findUnique({ where: { guardianId_studentId: { guardianId, studentId } } }),
    );
    if (!delegation || delegation.status !== 'ACTIVE') {
      throw new ForbiddenException('This Guardian has no active booking delegation for this Student.');
    }
  }

  /** POST /guardians/me/minors/{studentId}/kid-mode-token (Decision 123). Checks
   * BOTH the GuardianLink and the BookingDelegation live before signing —
   * deliberately not assuming an active BookingDelegation implies an active
   * GuardianLink, even though withdrawBookingDelegation() is the only place that
   * writes WITHDRAWN today; re-verifying both independently costs one extra
   * query and removes the assumption entirely. See the module-level
   * KID_MODE_TOKEN_TTL_SECONDS comment for why this token is deliberately
   * short-lived. `grants: []` matches every other Guardian token this codebase
   * already issues (Decision 92 — a Guardian holds zero RoleGrant anywhere).
   */
  async mintKidModeToken(guardianId: string, studentId: string) {
    await this.assertGuardianOfStudent(guardianId, studentId);
    await this.assertBookingDelegationActive(guardianId, studentId);

    const guardian = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: guardianId }, select: { email: true } }),
    );

    const payload: JwtPayload = { sub: guardianId, email: guardian.email, grants: [], kidMode: { studentId } };
    const accessToken = this.jwt.sign(payload, { expiresIn: KID_MODE_TOKEN_TTL_SECONDS });
    const expiresAt = new Date(Date.now() + KID_MODE_TOKEN_TTL_SECONDS * 1000);
    return { accessToken, expiresAt: expiresAt.toISOString() };
  }

  /** GET /guardians/me/bookings-pending-review (Decision 123). Loops across
   * every linked minor's own tenant context — same shape findMyMinors() already
   * established — since the Guardian's own context has no direct visibility
   * into Booking at all (no School RoleGrant, Decision 92). Narrow projection
   * (id/studentId/classId/status only), not the full Booking shape — the review
   * screen only needs enough to render a row and target cancelBooking()'s
   * existing on-behalf-of path.
   */
  async findPendingReviewBookings(guardianId: string) {
    const links = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.guardianLink.findMany({ where: { guardianId, revokedAt: null } }),
    );
    if (links.length === 0) return { items: [] };

    const perMinor = await Promise.all(
      links.map((link) =>
        this.prismaApp.withTenantContext(link.studentId, (tx) =>
          tx.booking.findMany({
            where: { studentId: link.studentId, pendingGuardianReview: true },
            select: { id: true, studentId: true, classId: true, status: true },
          }),
        ),
      ),
    );
    return { items: perMinor.flat() };
  }

  /** PATCH /guardians/me/bookings-pending-review/{bookingId}/confirm (Decision
   * 123). `studentId` is the same CancelBookingDto-style hint every other
   * Guardian-on-behalf-of consumer needs — the Guardian's own context can't see
   * the Booking directly to resolve it itself — already known to the client
   * from findPendingReviewBookings()'s own response, so required here rather
   * than optional. Confirm never touches refundResolution/credit: the Booking
   * was never cancelled, this only clears the review flag so it stops
   * surfacing — Cancel instead reuses cancelBooking()'s existing on-behalf-of
   * path unchanged.
   */
  async confirmPendingReviewBooking(guardianId: string, bookingId: string, studentId: string) {
    await this.assertGuardianOfStudent(guardianId, studentId);

    const result = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.booking.updateMany({
        where: { id: bookingId, studentId, pendingGuardianReview: true },
        data: { pendingGuardianReview: false },
      }),
    );
    if (result.count === 0) {
      throw new NotFoundException('No pending-review Booking found with this id for this Student.');
    }

    return this.prismaApp.withTenantContext(studentId, (tx) => tx.booking.findUniqueOrThrow({ where: { id: bookingId } }));
  }
}

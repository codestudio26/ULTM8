import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { StepUpService } from '../auth/step-up.service';
import { eighteenthBirthday, isAdultOn, localDateIn } from '../common/decorators/is-birth-date.decorator';
import { schoolZone } from '../common/school-zone';
import { sameDay, sameName } from '../common/same-person';
import { NOTIFICATION_FANOUT_QUEUE } from '../jobs/queue.constants';
import type { NotificationFanoutJobData } from '../jobs/notification-fanout.types';
import { recordStaffActivity } from '../tenants/staff-activity/staff-activity';
import { CreateMinorDto } from './dto/create-minor.dto';
import { GrantConsentDto } from './dto/grant-consent.dto';
import { baselineConsentState } from './baseline-consent';

/**
 * What a parent is doing for their child (Decision 430 item 7, FAM-7). From
 * the child's 18th birthday (on the School's own date when a School is
 * known) a parent no longer acts for them: no booking, waitlist, waiver or
 * contract signing, consent or Kid Mode ('act'). For 30 more days they can
 * still pay ('pay') and read the child's history ('read'); then the link
 * stops working for those too. The adult is prompted to make their own
 * account (SKILL.md §14: a fresh account at 18, never a migrated one).
 */
export type GuardianPurpose = 'act' | 'pay' | 'read';

/** Days after the 18th birthday a parent can still pay and read history. */
export const ADULT_CHILD_GRACE_DAYS = 30;

export interface GuardianCheckOptions {
  purpose?: GuardianPurpose;
  /** The School (and Branch) the action is at, for the local date. */
  schoolId?: string | null;
  branchId?: string | null;
}

const BCRYPT_ROUNDS = 12;

// Decision 123 — same "named, explicit, Developer-level placeholder" tier of
// judgment call as QR_ATTENDANCE_TOKEN_TTL_SECONDS/
// PLATFORM_ADMIN_IMPERSONATION_TTL_SECONDS. Short enough that a captured/stale
// Kid-Mode token is useless quickly on its own — BookingsController's live
// BookingDelegation re-check (mintKidModeToken()'s own comment) is the real
// backstop, this is a second, independent one.
const KID_MODE_TOKEN_TTL_SECONDS = Number(process.env.KID_MODE_TOKEN_TTL_SECONDS ?? 300);

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
/** The placeholder email domain of a Guardian-managed minor's account
 * (createMinor). Never a real inbox; the Students page shows "Managed by a
 * Guardian" instead (Decision 341). */
export const GUARDIAN_MANAGED_EMAIL_DOMAIN = 'guardian-managed.ultm8.internal';

@Injectable()
export class GuardiansService {
  private readonly logger = new Logger(GuardiansService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly jwt: JwtService,
    private readonly stepUpService: StepUpService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
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
    // Decision 430 items 2 and 3 (FAM-2, FAM-3): a parent is 18 or over (an
    // unknown date of birth is allowed: a Guardian account the School made
    // has none), and a child is under 18.
    await this.assertGuardianNotUnder18(guardianId);
    if (isAdultOn(new Date(dto.dateOfBirth))) {
      throw new BadRequestException({ code: 'NOT_A_MINOR', message: 'This is for children (under 18). An adult makes their own account.' });
    }
    const minorId = randomUUID();
    const email = `minor+${minorId}@${GUARDIAN_MANAGED_EMAIL_DOMAIN}`;
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
    const consentVersion = dto.consentPolicyVersion?.trim() || null;
    const created = await this.prismaApp.withMultiTenantContext(async (tx, setContext) => {
      // Decision 430 item 4 (FAM-4): one add at a time per parent, and the
      // same child (name and date of birth, see same-person.ts) added again
      // — a retry on a bad connection — is the child already there.
      await setContext(guardianId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'minor-create:' + guardianId}, 0))`;
      const existing = await this.findSameMinor(guardianId, dto);
      if (existing) return { existing };

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
      const link = await tx.guardianLink.create({
        data: { id: randomUUID(), guardianId, studentId: minorId },
      });
      // Decision 430 item 9 (FAM-9): the parent's BASELINE consent, ticked
      // when adding the child, recorded with the policy version they saw.
      if (consentVersion) {
        await tx.consentRecord.create({ data: { id: randomUUID(), guardianId, studentId: minorId, tier: 'BASELINE', policyVersion: consentVersion } });
      }
      return { link };
    });
    if ('existing' in created && created.existing) {
      const same = created.existing;
      if (consentVersion) await this.recordBaselineConsent(guardianId, same.studentId, consentVersion);
      return { ...same, alreadyAdded: true };
    }
    const { link } = created as { link: { id: string } };

    return {
      alreadyAdded: false,
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
    // Decision 430 items 7 and 9: whether the child still needs a parent's
    // consent, and whether they are 18 now (the app then asks them to make
    // their own account, and the parent's access ends after 30 days).
    const now = new Date();
    const consent = await Promise.all(links.map((link) => baselineConsentState(this.prismaJobs, link.studentId, null, now)));

    const items = links.map((link, i) => ({
      linkId: link.id,
      studentId: minors[i].id,
      firstName: minors[i].firstName,
      surname: minors[i].surname,
      dateOfBirth: minors[i].dateOfBirth,
      gender: minors[i].gender,
      consent: consent[i],
      ...this.adultStatus(minors[i].dateOfBirth, now, null),
    }));
    return { items };
  }

  /** Whether the child is 18 on `now` (in `zone`), and the last day a parent
   * can still pay and read their history (Decision 430 item 7). */
  private adultStatus(dateOfBirth: Date | null, now: Date, zone: string | null) {
    if (!dateOfBirth || !isAdultOn(dateOfBirth, now, zone)) return { isAdult: false, parentAccessEndsOn: null as string | null };
    const turned = new Date(`${eighteenthBirthday(dateOfBirth)}T00:00:00Z`);
    turned.setUTCDate(turned.getUTCDate() + ADULT_CHILD_GRACE_DAYS);
    return { isAdult: true, parentAccessEndsOn: turned.toISOString().slice(0, 10) };
  }

  /** The live child already on this parent's account with the same name and
   * date of birth, read on the jobs connection inside createMinor's lock. */
  private async findSameMinor(guardianId: string, dto: Pick<CreateMinorDto, 'firstName' | 'surname' | 'dateOfBirth'>) {
    const links = await this.prismaJobs.guardianLink.findMany({ where: { guardianId, revokedAt: null }, select: { id: true, studentId: true } });
    if (links.length === 0) return null;
    const users = await this.prismaJobs.user.findMany({
      where: { id: { in: links.map((l) => l.studentId) } },
      select: { id: true, firstName: true, surname: true, dateOfBirth: true },
    });
    const same = users.find((u) => sameName(u.firstName, dto.firstName) && sameName(u.surname, dto.surname) && sameDay(u.dateOfBirth, dto.dateOfBirth));
    if (!same) return null;
    const link = links.find((l) => l.studentId === same.id)!;
    return {
      linkId: link.id,
      studentId: same.id,
      firstName: same.firstName,
      surname: same.surname,
      dateOfBirth: same.dateOfBirth!.toISOString(),
      gender: null as string | null,
    };
  }

  /** Decision 430 item 2 (FAM-2): a Guardian whose date of birth shows them
   * under 18 can't add or act for a child. Unknown is allowed. */
  private async assertGuardianNotUnder18(guardianId: string): Promise<void> {
    const me = await this.prismaJobs.user.findUnique({ where: { id: guardianId }, select: { dateOfBirth: true } });
    if (me?.dateOfBirth && !isAdultOn(me.dateOfBirth)) {
      throw new ForbiddenException({ code: 'GUARDIAN_UNDER_18', message: 'A Guardian must be 18 or over.' });
    }
  }

  /** True when `guardianId` has a live link to `studentId` (Decision 430
   * item 1, FAM-1): bookings and the waitlist decide a parent's request by
   * the relationship first, not by whether the parent can see the Class. */
  async isActiveGuardianOf(guardianId: string, studentId: string): Promise<boolean> {
    if (guardianId === studentId) return false;
    const link = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.guardianLink.findUnique({ where: { guardianId_studentId: { guardianId, studentId } }, select: { revokedAt: true } }),
    );
    return !!link && !link.revokedAt;
  }

  /** Records (or renews) a parent's BASELINE consent. */
  async recordBaselineConsent(guardianId: string, studentId: string, policyVersion: string) {
    await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.consentRecord.upsert({
        where: { guardianId_studentId_tier: { guardianId, studentId, tier: 'BASELINE' } },
        create: { id: randomUUID(), guardianId, studentId, tier: 'BASELINE', policyVersion },
        update: { status: 'ACTIVE', policyVersion, consentedAt: new Date(), withdrawnAt: null },
      }),
    );
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
  async assertGuardianOfStudent(guardianId: string, studentId: string, opts: GuardianCheckOptions = {}): Promise<void> {
    const link = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.guardianLink.findUnique({ where: { guardianId_studentId: { guardianId, studentId } } }),
    );
    if (!link || link.revokedAt) {
      throw new ForbiddenException('You are not an active Guardian for this Student.');
    }
    // Decision 430 item 2 (FAM-2): never a Guardian under 18.
    await this.assertGuardianNotUnder18(guardianId);
    // Decision 430 item 7 (FAM-7): a parent's authority ends at 18.
    await this.assertChildNotAdult(studentId, opts);
  }

  /** See GuardianPurpose. Reads by default (every caller that only shows a
   * parent their child's data); acting and paying callers say so. An unknown
   * date of birth stays a child's, as before. */
  private async assertChildNotAdult(studentId: string, opts: GuardianCheckOptions): Promise<void> {
    const child = await this.prismaJobs.user.findUnique({ where: { id: studentId }, select: { firstName: true, dateOfBirth: true } });
    if (!child?.dateOfBirth) return;
    const now = new Date();
    const zone = opts.schoolId || opts.branchId ? await schoolZone(this.prismaJobs, opts.schoolId, opts.branchId) : null;
    const status = this.adultStatus(child.dateOfBirth, now, zone);
    if (!status.isAdult) return;
    const purpose = opts.purpose ?? 'read';
    if (purpose === 'act') {
      throw new ForbiddenException({
        code: 'CHILD_IS_ADULT',
        message: `${child.firstName} is 18 now and signs for themselves. They can make their own ULTM8 account.`,
      });
    }
    if (localDateIn(now, zone) > status.parentAccessEndsOn!) {
      throw new ForbiddenException({
        code: 'CHILD_ADULT_ACCESS_ENDED',
        message: `${child.firstName} turned 18 more than ${ADULT_CHILD_GRACE_DAYS} days ago, so their account is no longer managed from a parent's account.`,
      });
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
    // Decision 430 item 7: no consent for an adult.
    await this.assertGuardianNotUnder18(guardianId);
    await this.assertChildNotAdult(studentId, { purpose: 'act' });

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
   *
   * Decision 236 — BASELINE withdrawal (the irreversible, account-revoking path)
   * requires a fresh step-up proof (`StepUpService.assertVerified()`, checked
   * BEFORE the record is looked up for tier, see below) minted by
   * `POST /auth/step-up/verify`; CAMERA withdrawal does not, since it's
   * reversible and a plain confirm is proportionate (Decision 236's own text).
   * The tier gate happens only once `existing` is loaded — this is still a
   * single combined check, not two round-trips, since StepUpService.
   * assertVerified() does no DB I/O of its own.
   */
  async withdrawConsent(guardianId: string, consentRecordId: string, stepUpToken?: string) {
    const existing = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.consentRecord.findUnique({ where: { id: consentRecordId } }),
    );
    if (!existing || existing.guardianId !== guardianId) {
      throw new NotFoundException('Consent record not found');
    }
    if (existing.status !== 'ACTIVE') {
      throw new ConflictException('This consent record is already Withdrawn.');
    }
    if (existing.tier === 'BASELINE') {
      this.stepUpService.assertVerified(guardianId, stepUpToken);
    }
    // Decision 430 item 7: no consent decisions for an adult.
    await this.assertChildNotAdult(existing.studentId, { purpose: 'act' });

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
      // Their home branches go with the enrolments (Decision 341, S13), as
      // RoleGrantsService.revoke does.
      await this.prismaJobs.studentHomeBranch.deleteMany({ where: { studentId: existing.studentId } });
      // Decision 315 item 10: medical information is erased with the
      // account, and withdrawing baseline consent is the account-deletion
      // path for a child.
      await this.prismaJobs.studentMedicalInfo.deleteMany({ where: { studentId: existing.studentId } });
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
      // Decision 430 item 9: from now on the child needs fresh consent before
      // re-enrolling, booking or checking in, whichever parent's link it is.
      await this.prismaJobs.guardianLink.updateMany({ where: { studentId: existing.studentId, consentGrandfathered: true }, data: { consentGrandfathered: false } });
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
    // Decision 430 item 9: the child's other parents are told.
    await this.notifyOtherGuardians(guardianId, existing.studentId, existing.tier, existing.id);

    return this.prismaApp.withTenantContext(guardianId, (tx) => tx.consentRecord.findUniqueOrThrow({ where: { id: consentRecordId } }));
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
    // Decision 430 item 7: no Kid Mode for an adult.
    await this.assertGuardianNotUnder18(guardianId);
    await this.assertChildNotAdult(studentId, { purpose: 'act' });

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
    await this.assertGuardianOfStudent(guardianId, studentId, { purpose: 'act' });
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
    await this.assertGuardianOfStudent(guardianId, studentId, { purpose: 'act' });

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

  // ---------------------------------------------------------------------------
  // Decision 430 items 8 and 9: two parents of one child
  // ---------------------------------------------------------------------------

  /**
   * GET /guardians/me/minors/{studentId}/consent (Decision 430 item 9). Every
   * parent's consent for this child, each read-only to the others: who, which
   * tier, Active or Withdrawn, and when; plus whether the child still needs
   * consent. Read on the jobs connection (each parent's records are their own
   * under RLS) once the caller's own link is checked; only names leave.
   */
  async findChildConsent(guardianId: string, studentId: string) {
    await this.assertGuardianOfStudent(guardianId, studentId);
    const links = await this.prismaJobs.guardianLink.findMany({
      where: { studentId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { guardianId: true },
    });
    const ids = links.map((l) => l.guardianId);
    const [records, people, state] = await Promise.all([
      this.prismaJobs.consentRecord.findMany({ where: { studentId, guardianId: { in: ids } }, orderBy: { consentedAt: 'asc' } }),
      this.prismaJobs.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, surname: true } }),
      baselineConsentState(this.prismaJobs, studentId),
    ]);
    const name = new Map(people.map((p) => [p.id, `${p.firstName} ${p.surname}`.trim()]));
    return {
      state,
      guardians: ids.map((id) => ({
        guardianId: id,
        name: name.get(id) ?? '',
        isMe: id === guardianId,
        records: records
          .filter((r) => r.guardianId === id)
          .map((r) => ({
            // Only the caller's own record ids: theirs to withdraw, the others' read-only.
            id: id === guardianId ? r.id : null,
            tier: r.tier,
            status: r.status,
            policyVersion: r.policyVersion,
            consentedAt: r.consentedAt.toISOString(),
            withdrawnAt: r.withdrawnAt ? r.withdrawnAt.toISOString() : null,
          })),
      })),
    };
  }

  /** Tells the child's other active parents that one withdrew consent. */
  private async notifyOtherGuardians(guardianId: string, studentId: string, tier: 'BASELINE' | 'CAMERA', recordId: string) {
    const [others, who, child] = await Promise.all([
      this.prismaJobs.guardianLink.findMany({ where: { studentId, revokedAt: null, guardianId: { not: guardianId } }, select: { guardianId: true } }),
      this.prismaJobs.user.findUnique({ where: { id: guardianId }, select: { firstName: true, surname: true } }),
      this.prismaJobs.user.findUnique({ where: { id: studentId }, select: { firstName: true } }),
    ]);
    if (others.length === 0) return;
    const parent = `${who?.firstName ?? ''} ${who?.surname ?? ''}`.trim();
    const title = 'Consent withdrawn';
    const body =
      tier === 'BASELINE'
        ? `${parent} withdrew consent for ${child?.firstName ?? ''}. ${child?.firstName ?? ''} can't book or check in until a parent gives consent again in the app.`
        : `${parent} withdrew camera consent for ${child?.firstName ?? ''}. Staff will check them in by hand.`;
    for (const { guardianId: other } of others) {
      const id = `consent-withdrawn-${recordId}-${other}-${Date.now()}`;
      try {
        await this.fanoutQueue.add(
          'notify',
          { notificationId: id, userId: other, title, body, type: 'CONSENT_WITHDRAWN', guardianCopyOf: studentId } satisfies NotificationFanoutJobData,
          { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
        );
      } catch (err) {
        this.logger.warn(`Could not tell Guardian ${other} that consent was withdrawn: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * DELETE /guardians/me/minors/{studentId} — "Remove me" (Decision 430 item
   * 8): a parent ends their own link to a child. Never the last parent of a
   * child still enrolled at a School (the child would have nobody to act for
   * them); the owner can still remove a parent from the portal under the same
   * rule. Logged in each of the child's Schools' activity. The parent's own
   * account and the child's account are left as they are (no cascade).
   */
  async removeMe(guardianId: string, studentId: string) {
    const link = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.guardianLink.findUnique({ where: { guardianId_studentId: { guardianId, studentId } } }),
    );
    if (!link || link.revokedAt) throw new NotFoundException('This child is not on your account.');
    const schoolIds = await this.assertNotLastGuardian(guardianId, studentId);
    const { count } = await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.guardianLink.updateMany({ where: { id: link.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    );
    if (count === 0) throw new NotFoundException('This child is not on your account.');
    await this.logLinkEnded(schoolIds, guardianId, guardianId, studentId, 'GUARDIAN_LEFT');
  }

  /**
   * Decision 430 item 8: the owner's "Remove Guardian" (StudentAccessService
   * checks the owner and the School first). Ends the link on the jobs
   * connection, since the link is the parent's own row under RLS.
   */
  async removeGuardianLink(actorId: string, guardianId: string, studentId: string, schoolId: string) {
    const link = await this.prismaJobs.guardianLink.findUnique({ where: { guardianId_studentId: { guardianId, studentId } }, select: { id: true, revokedAt: true } });
    if (!link || link.revokedAt) throw new NotFoundException("This person isn't a parent or guardian of this student.");
    await this.assertNotLastGuardian(guardianId, studentId);
    const { count } = await this.prismaJobs.guardianLink.updateMany({ where: { id: link.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count === 0) throw new NotFoundException("This person isn't a parent or guardian of this student.");
    await this.logLinkEnded([schoolId], actorId, guardianId, studentId, 'GUARDIAN_REMOVED');
  }

  /** The Schools the child is enrolled at; refuses to end the only active
   * link of a child enrolled at any School. */
  private async assertNotLastGuardian(guardianId: string, studentId: string): Promise<string[]> {
    const [others, grants] = await Promise.all([
      this.prismaJobs.guardianLink.count({ where: { studentId, revokedAt: null, guardianId: { not: guardianId } } }),
      this.prismaJobs.roleGrant.findMany({ where: { userId: studentId, role: 'STUDENT', revokedAt: null, schoolId: { not: null } }, select: { schoolId: true }, distinct: ['schoolId'] }),
    ]);
    if (others === 0 && grants.length > 0) {
      throw new ConflictException({
        code: 'LAST_GUARDIAN',
        message: "This is the only parent or guardian of a child who is still enrolled, so the link can't be removed. Add another parent or guardian first, or the School can remove the child.",
      });
    }
    return grants.map((g) => g.schoolId!);
  }

  private async logLinkEnded(schoolIds: string[], actorId: string, guardianId: string, studentId: string, action: 'GUARDIAN_REMOVED' | 'GUARDIAN_LEFT') {
    if (schoolIds.length === 0) return;
    const people = await this.prismaJobs.user.findMany({ where: { id: { in: [guardianId, studentId] } }, select: { id: true, firstName: true, surname: true } });
    const nameOf = (id: string) => {
      const p = people.find((x) => x.id === id);
      return p ? `${p.firstName} ${p.surname}`.trim() : '';
    };
    for (const schoolId of schoolIds) {
      await recordStaffActivity(this.prismaJobs, {
        schoolId,
        actorId,
        targetUserId: guardianId,
        action,
        details: { studentId, studentName: nameOf(studentId), guardianName: nameOf(guardianId) },
      });
    }
  }

  /** Decision 430 item 6: links a parent to a child already on ULTM8 (the
   * owner's "Add another Guardian", accepted in the app), or restores a link
   * that was removed. Written as the parent: the link is their own row. */
  async linkExistingChild(guardianId: string, studentId: string) {
    await this.assertGuardianNotUnder18(guardianId);
    await this.prismaApp.withTenantContext(guardianId, (tx) =>
      tx.guardianLink.upsert({
        where: { guardianId_studentId: { guardianId, studentId } },
        create: { id: randomUUID(), guardianId, studentId },
        // A link brought back is a new one: it never carries the pre-rule consent mark.
        update: { revokedAt: null, consentGrandfathered: false },
      }),
    );
  }

  /** A notice to every active parent of the child (Decision 430 item 6). */
  async tellGuardians(studentId: string, title: string, body: string, key: string, schoolId?: string) {
    const links = await this.prismaJobs.guardianLink.findMany({ where: { studentId, revokedAt: null }, select: { guardianId: true } });
    for (const { guardianId } of links) {
      const id = `${key}-${guardianId}`;
      try {
        await this.fanoutQueue.add(
          'notify',
          { notificationId: id, userId: guardianId, title, body, type: 'GUARDIAN_ADDED', guardianCopyOf: studentId, schoolId } satisfies NotificationFanoutJobData,
          { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
        );
      } catch (err) {
        this.logger.warn(`Could not tell Guardian ${guardianId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { resolveInstructorSpecializations } from './instructor-specializations';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { CreateInstructorDto } from './dto/create-instructor.dto';
import { UpdateInstructorDto } from './dto/update-instructor.dto';
import { CreateInstructorManuallyDto } from './dto/create-instructor-manually.dto';
import { CompleteInstructorProfileDto } from './dto/complete-instructor-profile.dto';
import { RequestCertificationUploadUrlDto } from './dto/request-certification-upload-url.dto';
import { addressWriteData } from '../common/address/postal-address.dto';

const BCRYPT_ROUNDS = 12;
const RETENTION_WINDOW_DAYS = 90;

@Injectable()
export class InstructorsService {
  private readonly logger = new Logger(InstructorsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly delivery: NotificationDeliveryService,
    private readonly r2Client: R2ClientService,
  ) {}

  /**
   * School Owner/Manager only (Spec §8.2) — same gate as Class/TimetableSlot CRUD;
   * Instructor's own confirmed permissions explicitly exclude "instructor management".
   *
   * This module does NOT grant the RoleGrant itself — that's RoleGrantsService's
   * existing job (POST /schools/{id}/role-grants, Phase 2). Creating a profile here
   * requires the grant to already exist, matching the confirmed "provisioned by School
   * invite" flow (invite/grant first, profile second, two distinct concerns).
   */
  async create(callerId: string, schoolId: string, dto: CreateInstructorDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    if (dto.branchId) {
      await this.assertBranchUsable(callerId, dto.branchId, schoolId);
    }
    // Validates dto.userId holds an active INSTRUCTOR RoleGrant matching this profile's
    // own scope — this table is never itself the source of truth for role-holding, see
    // schema.prisma's Instructor model comment.
    await this.assertRoleCoversProfile(callerId, dto.userId, schoolId, dto.branchId ?? null);

    // Pre-check the schoolId+userId uniqueness explicitly (same convention
    // RoleGrantsService.create() uses) rather than relying on the generic P2002
    // catch-all in HttpExceptionFilter, so the caller gets a specific message.
    const duplicate = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.instructor.findUnique({
        where: { schoolId_userId: { schoolId, userId: dto.userId } },
        select: { id: true },
      }),
    );
    if (duplicate) {
      throw new ConflictException('This user already has an Instructor profile at this School.');
    }

    const instructorId = randomUUID();
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const specs = await resolveInstructorSpecializations(tx, schoolId, dto.specializationStyleIds, dto.specializations);
      return tx.instructor.create({
        data: {
          id: instructorId,
          userId: dto.userId,
          schoolId,
          branchId: dto.branchId,
          photoUrl: dto.photoUrl,
          specializations: specs?.specializations ?? [],
          specializationStyleIds: specs?.specializationStyleIds ?? [],
          phone: dto.phone,
          yearsOfExperience: dto.yearsOfExperience,
          bio: dto.bio,
        },
      });
    });
  }

  private portalBaseUrl(): string {
    const url = process.env.PORTAL_BASE_URL?.trim().replace(/\/+$/, '');
    if (!url) throw new ServiceUnavailableException('Instructor "Add Manually" is not set up yet: PORTAL_BASE_URL is not configured.');
    return url;
  }

  /**
   * POST /schools/:schoolId/instructors/add-manually (Decision 1/230) — a real
   * User + RoleGrant + Instructor created in one transaction from just
   * name+email, no invite/acceptance step: the product owner's own answer was
   * "only Name and Email are required at creation... everything else is left
   * blank and the instructor fills it in themselves after their first login."
   * Supersedes Decision 206/211's unbuilt account-claim-invitation design for
   * this same problem (Decision 237).
   *
   * School Owner/Manager only — same gate create() above already uses (Spec
   * §8.2: Instructor's own confirmed permissions explicitly exclude
   * "instructor management"), not CoachInvitesService's broader
   * "Can invite coaches" staff permission — nothing approved here extends that
   * permission to this new creation path.
   */
  async createManually(callerId: string, schoolId: string, dto: CreateInstructorManuallyDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const email = dto.email.trim().toLowerCase();
    const baseUrl = this.portalBaseUrl();

    if (dto.branchId) {
      await this.assertBranchUsable(callerId, dto.branchId, schoolId);
    }
    // Decision 169: an instructor always belongs to something — same rule
    // RoleGrantsService.create() already applies for an INSTRUCTOR grant.
    const branches = await this.prismaApp.withTenantContext(callerId, (tx) => tx.branch.findMany({ where: { schoolId }, select: { id: true } }));
    if (branches.length > 0 && !dto.branchId) {
      throw new BadRequestException('This School has branches: choose the branch this instructor belongs to (branchId).');
    }

    // Decision 116's existing-email check, same PrismaAuthService pre-tenant-
    // context lookup RoleGrantsService.create()'s target-existence check and
    // AuthService.register() both already use — closes the risk of two
    // divergent paths (Add Manually vs. an existing account) ever producing
    // two accounts for one person.
    const existingUser = await this.prismaAuth.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists — use "Invite to Instructor Role" instead.');
    }

    const userId = randomUUID();
    const instructorId = randomUUID();
    const roleGrantId = randomUUID();
    const tempPasscode = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const passcodeHash = await bcrypt.hash(tempPasscode, BCRYPT_ROUNDS);

    const { instructor } = await this.prismaApp.withMultiTenantContext(async (tx, setContext) => {
      // Bootstrap trick (AuthService.register()'s own pattern, reused by
      // GuardiansService.createMinor()): User's RLS WITH CHECK only permits
      // inserting a row whose id equals the CURRENT tenant context, so the new
      // Instructor's User row is created under ITS OWN (about-to-exist) id.
      await setContext(userId);
      await tx.user.create({
        data: {
          id: userId,
          email,
          firstName: dto.firstName,
          surname: dto.surname,
          passcodeHash,
          mustChangePasscode: true,
          // phone/dateOfBirth deliberately left null — filled in by the
          // Instructor themselves after first login (Decision 1/230).
        },
      });

      await setContext(callerId);
      await tx.roleGrant.create({
        data: { id: roleGrantId, role: 'INSTRUCTOR', userId, schoolId, branchId: dto.branchId, grantedById: callerId },
      });
      const instructor = await tx.instructor.create({
        data: { id: instructorId, userId, schoolId, branchId: dto.branchId },
      });
      return { instructor };
    });

    // Same non-blocking-email-failure shape as CoachInvitesService.create():
    // creation already succeeded; only the delivery can fail independently.
    let emailSent = true;
    try {
      await this.delivery.sendEmail(
        email,
        "Your ULTM8 instructor account is ready",
        [
          "You've been added as an Instructor on ULTM8.",
          '',
          `Sign in with this email address (${email}) and the temporary passcode below — you'll be asked to choose your own passcode right away.`,
          '',
          `Temporary passcode: ${tempPasscode}`,
          '',
          `${baseUrl}/login`,
        ].join('\n'),
      );
    } catch (err) {
      emailSent = false;
      this.logger.warn(`Instructor ${instructor.id}: the temp-passcode email could not be sent — ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      ...instructor,
      firstName: dto.firstName,
      surname: dto.surname,
      email,
      status: 'ACTIVE' as const,
      awaitingFirstLogin: true,
      emailSent,
    };
  }

  /**
   * PATCH /instructors/me/profile (Decision 1/217) — self-service completion
   * of the four fields "Add Manually" leaves blank at creation. Applied
   * across every Instructor row the caller holds — flagged, not resolved: a
   * multi-School instructor can't set different values per School through
   * this one endpoint.
   */
  async completeMyProfile(callerId: string, dto: CompleteInstructorProfileDto) {
    // Upload-then-confirm, same discipline R2ClientService.objectExists()
    // already enforces for waiver signatures — never trust a caller-supplied
    // key as proof something was actually uploaded there.
    if (dto.certificationKey) {
      const exists = await this.r2Client.objectExists(dto.certificationKey);
      if (!exists) {
        throw new BadRequestException('certificationKey does not correspond to an uploaded file — request a fresh upload URL and upload first.');
      }
    }

    const existingRows = await this.prismaApp.withTenantContext(callerId, (tx) => tx.instructor.findMany({ where: { userId: callerId } }));
    if (existingRows.length === 0) {
      throw new NotFoundException('You have no Instructor profile.');
    }

    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.instructor.updateMany({
        where: { userId: callerId },
        data: {
          ...addressWriteData(dto),
          activities: dto.activities,
          certificationKey: dto.certificationKey,
          // Can only move from unset to set, never clear — see this DTO's own
          // header comment.
          certificationConsentedAt: dto.certificationConsent ? new Date() : undefined,
        },
      }),
    );

    return this.findMyProfiles(callerId);
  }

  /** GET /instructors/me/profile (Decision 312) — every Instructor row the
   * caller holds, so the Complete Profile page can show what's already saved.
   * An empty list, not a 404, for someone with no profile. */
  async findMyProfiles(callerId: string) {
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) => tx.instructor.findMany({ where: { userId: callerId } }));
    const names = await resolveUserNames(this.prismaAuth, [callerId]);
    const name = names.get(callerId);
    const awaiting = await this.resolveAwaitingFirstLogin([callerId]);
    const statusByRow = await Promise.all(
      rows.map((row) => this.resolveInstructorStatuses(callerId, row.schoolId, [callerId])),
    );

    return {
      items: rows.map((row, i) => ({
        ...row,
        firstName: name?.firstName ?? '',
        surname: name?.surname ?? '',
        email: name?.email ?? '',
        status: statusByRow[i].get(callerId) ?? ('REVOKED' as const),
        awaitingFirstLogin: awaiting.has(callerId),
      })),
      nextCursor: null,
    };
  }

  /** POST /instructors/me/certification-upload-url (Decision 1/217/218) —
   * reuses R2ClientService's presigned-URL pattern, the only existing
   * precedent (waiver signature images). For a multi-School Instructor, uses
   * the first profile found — same flagged limitation as completeMyProfile(). */
  async requestCertificationUploadUrl(callerId: string, dto: RequestCertificationUploadUrlDto) {
    const instructor = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.instructor.findFirst({ where: { userId: callerId }, select: { id: true, schoolId: true } }),
    );
    if (!instructor) {
      throw new NotFoundException('You have no Instructor profile.');
    }
    const extension = dto.contentType === 'application/pdf' ? 'pdf' : dto.contentType === 'image/png' ? 'png' : 'jpg';
    const objectKey = `instructor-certifications/${instructor.schoolId}/${instructor.id}/${randomUUID()}.${extension}`;
    const uploadUrl = await this.r2Client.getPresignedUploadUrl(objectKey, dto.contentType);
    return { uploadUrl, objectKey };
  }

  /** Profiles visible to the caller under one School — RLS restricts this to a School-
   * level grant (sees every profile, any Branch) or a Branch-scoped grant (their own
   * Branch's profiles plus School-wide ones — instructor_tenant_isolation, this
   * phase's migration; same three-way structure as class_tenant_isolation).
   *
   * Names are resolved via PrismaAuthService/resolveUserNames (Decision 117's
   * pattern), not a Prisma `include` on `user` — closes the same real, verified gap
   * Decision 117 found for Bookings/Waitlist/RoleGrant/Transactions: this endpoint's
   * own list of profiles is exactly where InstructorsPage's Name column and every
   * other page reusing this same hook (Classes, Timetable) look up an Instructor's
   * display name, and none of them had one to show before this. */
  /** Decision 226 — `includeArchived` (default false) excludes archived
   * profiles from the default view. */
  async findAllForSchool(callerId: string, schoolId: string, cursor?: string, limit?: number, includeArchived?: boolean) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate(
        (args) => tx.instructor.findMany({ ...args, where: { schoolId, ...(includeArchived ? {} : { archivedAt: null }) } }),
        cursor,
        limit,
      ),
    );
    const userIds = page.items.map((i) => i.userId);
    const names = await resolveUserNames(this.prismaAuth, userIds);
    const statuses = await this.resolveInstructorStatuses(callerId, schoolId, userIds);
    const awaiting = await this.resolveAwaitingFirstLogin(userIds);
    return {
      ...page,
      items: page.items.map((i) => ({
        ...i,
        firstName: names.get(i.userId)?.firstName ?? '',
        surname: names.get(i.userId)?.surname ?? '',
        email: names.get(i.userId)?.email ?? '',
        status: statuses.get(i.userId) ?? 'REVOKED',
        awaitingFirstLogin: awaiting.has(i.userId),
      })),
    };
  }

  /** Active/Revoked pill (v1.2 backlog, Instructors page) — whether the linked User
   * still holds a non-revoked INSTRUCTOR RoleGrant at this School, same "active"
   * definition assertValidInstructor already uses (revokedAt: null), just without its
   * Branch-matching concern since this is a display status, not an authorization
   * check. Batched in one query, same shape as resolveUserNames, not per-row. */
  private async resolveInstructorStatuses(
    callerId: string,
    schoolId: string,
    userIds: string[],
  ): Promise<Map<string, 'ACTIVE' | 'REVOKED'>> {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return new Map();
    const activeGrants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({
        where: { userId: { in: uniqueIds }, schoolId, role: 'INSTRUCTOR', revokedAt: null },
        select: { userId: true },
        distinct: ['userId'],
      }),
    );
    const activeIds = new Set(activeGrants.map((g) => g.userId));
    return new Map(uniqueIds.map((id) => [id, activeIds.has(id) ? 'ACTIVE' : 'REVOKED']));
  }

  /** Decision 312 — which of these Users still have "Add Manually"'s temporary
   * passcode, i.e. haven't signed in yet. Same PrismaAuthService lookup as
   * resolveUserNames (a revoked instructor's User row is hidden by RLS), for
   * ids the caller already reached through an RLS-scoped Instructor read. */
  private async resolveAwaitingFirstLogin(userIds: string[]): Promise<Set<string>> {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return new Set();
    const users = await this.prismaAuth.user.findMany({
      where: { id: { in: uniqueIds }, mustChangePasscode: true },
      select: { id: true },
    });
    return new Set(users.map((u) => u.id));
  }

  /** Candidate pool for InstructorFormModal's picker (Decision 115) — Users holding an
   * active INSTRUCTOR RoleGrant at this School and no profile here yet, with the
   * branches their role covers so the form can pick the right one (Decision 311).
   * School Owner/Manager only, same gate as
   * create(). Deliberately unpaginated (bounded by realistic Instructor headcount) and
   * hardcoded to INSTRUCTOR — no generic role param, since this is the only consumer. */
  async findEligibleInstructorUsers(callerId: string, schoolId: string) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    const [grants, profiles] = await this.prismaApp.withTenantContext(callerId, (tx) =>
      Promise.all([
        tx.roleGrant.findMany({
          where: { schoolId, role: 'INSTRUCTOR', revokedAt: null },
          select: { branchId: true, user: { select: { id: true, firstName: true, surname: true, email: true } } },
        }),
        tx.instructor.findMany({ where: { schoolId }, select: { userId: true } }),
      ]),
    );
    // Decision 311 (I9): someone who already has a profile here (archived
    // included) can't get a second one, so they aren't offered.
    const profiled = new Set(profiles.map((p) => p.userId));
    const byUser = new Map<string, { id: string; firstName: string; surname: string; email: string; schoolWide: boolean; branchIds: string[] }>();
    for (const g of grants) {
      if (profiled.has(g.user.id)) continue;
      const entry = byUser.get(g.user.id) ?? { ...g.user, schoolWide: false, branchIds: [] };
      if (g.branchId === null) entry.schoolWide = true;
      else if (!entry.branchIds.includes(g.branchId)) entry.branchIds.push(g.branchId);
      byUser.set(g.user.id, entry);
    }
    return { items: [...byUser.values()] };
  }

  async findOne(callerId: string, instructorId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.instructor.findUnique({ where: { id: instructorId } }),
    );
    // RLS returns null (not another tenant's row) for a profile outside the caller's
    // scope — a genuine 404 and a cross-tenant-blocked read are indistinguishable at
    // this layer by design (ultm8-tenant-isolation §2).
    if (!found) {
      throw new NotFoundException('Instructor profile not found');
    }
    // Resolved the same way findAllForSchool() does (v1.2 backlog) — findOne() never
    // actually resolved firstName/surname either, despite InstructorResponseDto
    // declaring them required; Instructor Detail was silently relying on
    // InstructorsPage's list fetch for names until now.
    const names = await resolveUserNames(this.prismaAuth, [found.userId]);
    const statuses = await this.resolveInstructorStatuses(callerId, found.schoolId, [found.userId]);
    const awaiting = await this.resolveAwaitingFirstLogin([found.userId]);
    return {
      ...found,
      firstName: names.get(found.userId)?.firstName ?? '',
      surname: names.get(found.userId)?.surname ?? '',
      email: names.get(found.userId)?.email ?? '',
      status: statuses.get(found.userId) ?? 'REVOKED',
      awaitingFirstLogin: awaiting.has(found.userId),
    };
  }

  /** GET /instructors/:id/certification-url (Decision 312) — a 15-minute
   * download link for the certification the instructor uploaded, for the
   * School Owner/Manager only (the same people who manage instructors). */
  async getCertificationUrl(callerId: string, instructorId: string) {
    const existing = await this.findOne(callerId, instructorId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    if (!existing.certificationKey) {
      throw new NotFoundException("This instructor hasn't uploaded a certification.");
    }
    return { url: await this.r2Client.getPresignedDownloadUrl(existing.certificationKey) };
  }

  /**
   * GET /instructors/{id}/classes (v1.2 backend backlog) — the real
   * replacement for the School Portal's own client-side filter-the-School's-
   * Classes-by-instructorId workaround (see InstructorClassResponseDto's own
   * header comment for the full citation). `instructorId` on Class is a
   * User.id FK (§6.1, confirmed by the backlog itself: "the filter has to
   * match Instructor.userId against Class.instructorId"), not this
   * Instructor row's own `id` — resolved via findOne() below, same as every
   * other method here that needs this profile's schoolId/userId.
   *
   * Staff-gated (assertStaffAtSchool, same defense-in-depth convention
   * BookingsService.findAllForClass already established for a Booking-
   * derived read) — findOne() itself only enforces RLS visibility (any
   * active RoleGrant holder), but computing enrolledCount below reads
   * Booking rows, whose broad SELECT policy is Staff-only (domain-rules
   * §10/Decision 89) — this endpoint is the School Portal's own Staff-facing
   * Instructor Detail screen, so there's no real caller this excludes.
   */
  async findClassesForInstructor(callerId: string, instructorId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    const instructor = await this.findOne(callerId, instructorId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertStaffAtSchool(callerId, instructor.schoolId, instructor.branchId);

    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate(
        (args) => tx.class.findMany({ ...args, where: { schoolId: instructor.schoolId, instructorId: instructor.userId, archivedAt: null } }),
        cursor,
        limit,
      ),
    );
    const enrolledCounts = await this.resolveEnrolledCounts(callerId, page.items.map((c) => c.id));
    return {
      ...page,
      items: page.items.map((c) => ({ ...c, enrolledCount: enrolledCounts.get(c.id) ?? 0 })),
    };
  }

  /** Batched "every attendee across every UPCOMING Booking" count (domain-rules
   * §9's own Full-status definition, reused here rather than invented a second
   * time) across an entire page of Classes in two queries total — not
   * BookingsService.countOccupiedSeats()'s own per-Class pair of queries, which
   * would be a real N+1 here. BookingAttendee has no classId column of its own
   * (only bookingId — see its own schema comment), so its rows are attributed
   * to a Class via a nested select through the Booking relation rather than a
   * groupBy (this codebase has no existing groupBy precedent to follow; a
   * fetch-then-count-in-JS pass matches the established convention
   * resolveInstructorStatuses/resolveUserNames already use for this exact class
   * of "batch it, don't N+1 it" problem). */
  private async resolveEnrolledCounts(callerId: string, classIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>(classIds.map((id) => [id, 0]));
    if (classIds.length === 0) return counts;
    const [bookings, attendees] = await this.prismaApp.withTenantContext(callerId, (tx) =>
      Promise.all([
        tx.booking.findMany({ where: { classId: { in: classIds }, status: 'UPCOMING' }, select: { classId: true } }),
        tx.bookingAttendee.findMany({
          where: { booking: { classId: { in: classIds }, status: 'UPCOMING' } },
          select: { booking: { select: { classId: true } } },
        }),
      ]),
    );
    for (const b of bookings) counts.set(b.classId, (counts.get(b.classId) ?? 0) + 1);
    for (const a of attendees) counts.set(a.booking.classId, (counts.get(a.booking.classId) ?? 0) + 1);
    return counts;
  }

  /** School Owner/Manager only — resolved via the profile's own schoolId, not a route param. */
  async update(callerId: string, instructorId: string, dto: UpdateInstructorDto) {
    // Reuses findOne() rather than re-running the same fetch-and-404 query a second
    // time in this file (unlike TimetableService's update(), which can't do this).
    // findOne() now resolves firstName/surname/email/status onto the row (v1.2
    // backlog) — still safe to reuse here since this method only reads the raw
    // Instructor columns (schoolId/branchId/userId) off it, all of which survive that
    // resolution untouched; see the return below for where the resolved fields
    // themselves get carried into this method's own response.
    const existing = await this.findOne(callerId, instructorId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);

    // Only a real branch change is checked (Decision 311, I8): the profile of
    // someone whose role was revoked stays editable, and keeping an archived
    // branch the profile already has is fine; moving to one is not.
    if (dto.branchId !== undefined && dto.branchId !== existing.branchId) {
      if (dto.branchId) {
        await this.assertBranchUsable(callerId, dto.branchId, existing.schoolId);
      }
      await this.assertRoleCoversProfile(callerId, existing.userId, existing.schoolId, dto.branchId);
    }

    // `specializations` is NOT NULL on the Instructor model (String[] @default([])) —
    // but `@IsOptional()` on UpdateInstructorDto only skips validation for `undefined`,
    // not an explicit `null` (class-validator's own IsOptional behavior), so a body
    // like `{"specializations": null}` would otherwise reach Prisma as a literal null
    // and hit a NOT NULL violation the global exception filter doesn't map to a clean
    // 400 (HttpExceptionFilter only handles P2002/P2025/P2003). Reject it explicitly
    // here instead of guessing at a silent reinterpretation (e.g. treating null as "").
    if (dto.specializations === null) {
      throw new BadRequestException('specializations cannot be null — send [] to clear it, or omit the field to leave it unchanged.');
    }
    if ((dto as { specializationStyleIds?: unknown }).specializationStyleIds === null) {
      throw new BadRequestException('specializationStyleIds cannot be null — send [] to clear it, or omit the field to leave it unchanged.');
    }

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      // Replaced when sent, kept when omitted (Decision 152).
      const specs = await resolveInstructorSpecializations(tx, existing.schoolId, dto.specializationStyleIds, dto.specializations, existing.specializationStyleIds);
      const updated = await tx.instructor.update({
        where: { id: instructorId },
        data: {
          branchId: dto.branchId,
          photoUrl: dto.photoUrl,
          specializations: specs?.specializations,
          specializationStyleIds: specs?.specializationStyleIds,
          phone: dto.phone,
          yearsOfExperience: dto.yearsOfExperience,
          bio: dto.bio,
        },
      });
      // InstructorResponseDto declares firstName/surname/email/status required, but
      // none of this patch can change any of them (they're User/RoleGrant-derived,
      // not Instructor columns) — carried over from the already-resolved `existing`
      // rather than re-querying resolveUserNames/resolveInstructorStatuses for values
      // that can't have changed.
      return { ...updated, firstName: existing.firstName, surname: existing.surname, email: existing.email, status: existing.status, awaitingFirstLogin: existing.awaitingFirstLogin };
    });
  }

  // ---------------------------------------------------------------------------
  // Decision 226 — entity-level tenant offboarding. Same shape/reasoning as
  // BranchesService's own archive()/unarchive() pair. Archiving this profile
  // never touches the underlying User or their INSTRUCTOR RoleGrant — the
  // same deliberate separation update()'s own gate already relies on (this
  // table is a profile extension, never the source of truth for role-
  // holding, per this model's own schema.prisma comment).
  // ---------------------------------------------------------------------------

  /** Active dependents that block archiving an Instructor profile — the
   * task's own hint, resolved against the real schema: Class.instructorId/
   * TimetableSlot.instructorId are User FKs, NOT Instructor FKs (this
   * model's own header comment), so this checks the profile's `userId`,
   * never its own `id`. "Assigned to any upcoming Class/TimetableSlot" reads
   * as: a Class that hasn't ended yet, or an ON (active) TimetableSlot that
   * will keep generating future occurrences for them. */
  private async assertNoActiveDependents(callerId: string, schoolId: string, instructorUserId: string): Promise<void> {
    const now = new Date();
    const [upcomingClasses, activeSlots] = await this.prismaApp.withTenantContext(callerId, (tx) =>
      Promise.all([
        // This School only, and not archived rows the owner can't see
        // (Decision 311, I6).
        tx.class.count({ where: { schoolId, instructorId: instructorUserId, endDate: { gte: now }, archivedAt: null } }),
        tx.timetableSlot.count({ where: { schoolId, instructorId: instructorUserId, status: 'ON', archivedAt: null } }),
      ]),
    );
    const reasons: string[] = [];
    if (upcomingClasses > 0) reasons.push(`${upcomingClasses} upcoming Class${upcomingClasses === 1 ? '' : 'es'}`);
    if (activeSlots > 0) reasons.push(`${activeSlots} active TimetableSlot${activeSlots === 1 ? '' : 's'}`);
    if (reasons.length > 0) {
      throw new ConflictException(
        `This Instructor can't be archived while they're assigned to ${reasons.join(' and ')}. Reassign them first.`,
      );
    }
  }

  async archive(callerId: string, instructorId: string) {
    const existing = await this.findOne(callerId, instructorId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (existing.archivedAt) {
      return existing;
    }
    await this.assertNoActiveDependents(callerId, existing.schoolId, existing.userId);

    const now = new Date();
    const purgeAt = new Date(now.getTime() + RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.instructor.updateMany({ where: { id: instructorId, archivedAt: null }, data: { archivedAt: now, purgeAt } }),
    );
    return this.findOne(callerId, instructorId);
  }

  async unarchive(callerId: string, instructorId: string) {
    const existing = await this.findOne(callerId, instructorId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (!existing.archivedAt) {
      return existing;
    }
    if (existing.purgedAt) {
      throw new ConflictException('This Instructor profile has already been purged and cannot be unarchived.');
    }
    const { count } = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.instructor.updateMany({
        where: { id: instructorId, archivedAt: { not: null }, purgedAt: null },
        data: { archivedAt: null, purgeAt: null },
      }),
    );
    if (count === 0) {
      const current = await this.findOne(callerId, instructorId);
      if (current.purgedAt) {
        throw new ConflictException('This Instructor profile has already been purged and cannot be unarchived.');
      }
      return current;
    }
    return this.findOne(callerId, instructorId);
  }

  /**
   * POST /instructors/:id/reassign (Decision 312) — hands every upcoming Class
   * and active Timetable slot of this instructor at this School to another
   * one: exactly what archive()'s 409 asks the owner to do first, in one step
   * instead of editing each row. Uses the same "upcoming"/"active" test as
   * assertNoActiveDependents, so archiving works right after. Each row's
   * branch is checked the way a Class/slot edit checks a new instructor
   * (assertInstructorAssignable), and nothing moves unless every row can.
   * Like a Class/slot edit, it sends no notifications, and Classes already
   * made from a moved slot are moved only if they're upcoming themselves.
   */
  async reassign(callerId: string, instructorId: string, toUserId: string) {
    const existing = await this.findOne(callerId, instructorId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (toUserId === existing.userId) {
      throw new BadRequestException('Choose a different instructor to take over.');
    }

    const schoolId = existing.schoolId;
    const now = new Date();
    const [classes, slots] = await this.prismaApp.withTenantContext(callerId, (tx) =>
      Promise.all([
        tx.class.findMany({ where: { schoolId, instructorId: existing.userId, endDate: { gte: now }, archivedAt: null }, select: { id: true, branchId: true } }),
        tx.timetableSlot.findMany({ where: { schoolId, instructorId: existing.userId, status: 'ON', archivedAt: null }, select: { id: true, branchId: true } }),
      ]),
    );
    if (classes.length === 0 && slots.length === 0) {
      return { classesMoved: 0, slotsMoved: 0 };
    }
    const branchIds = [...new Set([...classes, ...slots].map((r) => r.branchId))];
    for (const branchId of branchIds) {
      await this.tenantAuth.assertInstructorAssignable(callerId, toUserId, schoolId, branchId);
    }

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const movedClasses = await tx.class.updateMany({
        where: { id: { in: classes.map((c) => c.id) }, instructorId: existing.userId },
        data: { instructorId: toUserId },
      });
      const movedSlots = await tx.timetableSlot.updateMany({
        where: { id: { in: slots.map((t) => t.id) }, instructorId: existing.userId },
        data: { instructorId: toUserId },
      });
      return { classesMoved: movedClasses.count, slotsMoved: movedSlots.count };
    });
  }

  /** A branch of this School that isn't archived (Decision 311, I4) — the
   * same rule Decision 296 applies to staff and coach grants. */
  private async assertBranchUsable(callerId: string, branchId: string, schoolId: string): Promise<void> {
    await this.tenantAuth.assertBranchBelongsToSchool(callerId, branchId, schoolId);
    const branch = await this.prismaApp.withTenantContext(callerId, (tx) => tx.branch.findUnique({ where: { id: branchId }, select: { archivedAt: true } }));
    if (branch?.archivedAt) {
      throw new BadRequestException('This branch has been archived. Choose another branch.');
    }
  }

  /** The profile's scope must be one the person's Instructor role covers
   * (Decision 311, I13): a whole-School profile needs a whole-School role; a
   * branch profile needs a whole-School role or one at that branch. Plain
   * messages instead of assertValidInstructor's technical one. */
  private async assertRoleCoversProfile(callerId: string, userId: string, schoolId: string, branchId: string | null): Promise<void> {
    const grants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({ where: { userId, schoolId, role: 'INSTRUCTOR', revokedAt: null }, select: { branchId: true } }),
    );
    if (grants.length === 0) {
      throw new BadRequestException('This person is no longer an instructor at this School.');
    }
    if (grants.some((g) => g.branchId === null)) return;
    if (branchId === null) {
      throw new BadRequestException("Their Instructor role is for certain branches only, so their profile can't be for the whole School. Choose their branch.");
    }
    if (!grants.some((g) => g.branchId === branchId)) {
      throw new BadRequestException("Their Instructor role doesn't cover this branch. Give them the role there on the Staff page first, or choose their branch.");
    }
  }

  // No delete endpoint (beyond the archive/unarchive pair above) — same
  // "general tenant offboarding is [UNRESOLVED]" reasoning every other
  // module used BEFORE Decision 226 (ultm8-app-publishing §4); no hard-delete
  // was built for Instructor by this decision either, only the reversible
  // soft-archive pair above.
  //
  // What happens to this profile when the underlying RoleGrant is later revoked is NOT
  // addressed anywhere in Spec 55 — left untouched on revocation here, same
  // conservative default Phase 5 used for TimetableSlot edits vs. already-materialized
  // Classes (see the Phase 6 kickoff prompt). Since Decision 311 the owner can
  // still edit a revoked instructor's profile; only moving it to another branch
  // checks the role again.
}

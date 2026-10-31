import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { isAdultOn } from '../common/decorators/is-birth-date.decorator';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { RoleGrantsService } from '../tenants/role-grants/role-grants.service';
import { StudentAccessService } from '../student-access/student-access.service';
import { GradingService } from '../ranks/grading.service';
import { StaffAttendanceService, LOG_ATTENDANCE_MAX_DAYS_BACK } from '../attendance/staff-attendance.service';
import { SubscriptionGateService } from '../subscription-plans/subscription-gate.service';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';
import { safeZone } from '../bookings/booking-week';
import { localDay } from '../ranks/engine';
import { lockSchoolOpen } from '../tenants/lock-school-open';
import { setJoinDate } from '../tenants/schools/student-join-dates';
import { assertCanCreateMembership, GENERAL_ACCESS_TYPES, GeneralAccessConflictError, isMembershipLive } from '../memberships/membership-creation-guard';
import { hasCountingWaiverSignature } from '../waivers/waiver-signed-check';
import type { AddChildManuallyDto } from '../student-access/dto/student-access.dto';
import {
  IMPORT_COLUMNS,
  IMPORT_KINDS,
  MAX_IMPORT_ROWS,
  MAX_ROWS_PER_REQUEST,
  RowProblem,
  RowValues,
  parseBelts,
  parseBirthDate,
  parseCount,
  parseDay,
  parseEmail,
  parseGender,
  parsePhone,
  parseTime,
  rowError,
  rowSkip,
  sameText,
  type ImportKind,
  type ImportRowCode,
  type ImportRowOutcome,
  type ImportRowResult,
  type ImportWarning,
} from './import-rows';
import type { DataImportResponseDto, ImportLimitsDto, ImportPreviewResponseDto, ImportRowDto, ImportRowsResponseDto, StartImportDto } from './dto/data-imports.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
/** GradingService's own words when a caller has no grading permission for a style. */
const NO_GRADING_PERMISSION = 'You do not have grading permission for this style. The School owner grants it.';

/** Who is importing, into which School, as of when. */
interface ImportContext {
  callerId: string;
  schoolId: string;
  isOwner: boolean;
  schoolName: string;
  ranksOn: boolean;
  zone: string;
  now: Date;
  today: string;
  /** Branch Staff: the students they cover (staffBranchCoverage). Null for the owner. */
  coverage: { hasBranches: boolean; branchIds: Set<string> } | null;
}

interface Belt {
  style: string;
  disciplineId: string;
  rungId: string;
}

/** What a member row will do, once checked. */
type MemberPlan =
  | {
      kind: 'ADULT';
      email: string;
      firstName: string;
      surname: string;
      dateOfBirth: string;
      gender: 'FEMALE' | 'MALE' | null;
      phone: string | null;
      joinedOn: string | null;
      branchId: string | undefined;
      belts: Belt[];
    }
  | {
      kind: 'CHILD';
      firstName: string;
      surname: string;
      dateOfBirth: string;
      gender: 'FEMALE' | 'MALE' | null;
      joinedOn: string | null;
      branchId: string | undefined;
      belts: Belt[];
      guardian: { email: string; firstName: string; surname: string; exists: boolean };
    };

interface MembershipPlanRow {
  studentId: string;
  plan: { id: string; type: string; classesIncluded: number | null; expiryDurationDays: number | null; scopedClassId: string | null };
  startDate: Date;
  expiryDate: Date | null;
  classesRemaining: number | null;
  live: boolean;
}

interface AttendanceRow {
  studentId: string;
  classId: string;
}

/** A row checked: either a problem, or what will be done (with its code). */
type Checked<T> = { problem: RowProblem } | { code: ImportRowCode; message: string; warnings: ImportWarning[]; plan: T };

const READY_MESSAGES: Partial<Record<ImportRowCode, string>> = {
  NEW_MEMBER: 'A new member account will be made and sent a temporary passcode.',
  NEW_CHILD_NEW_GUARDIAN: 'The child will be added, with a new account for their Guardian, who is sent a temporary passcode.',
  NEW_CHILD_GUARDIAN_INVITED: 'The Guardian already has an account: they get an invite to accept in the app, which adds the child.',
  NEW_MEMBERSHIP: 'The membership will be recorded. No payment is taken.',
  NEW_ATTENDANCE: 'The class will be logged as attended.',
};

/**
 * Spreadsheet imports (Decision 315 items 12 and 13; backlog 5.13): members,
 * memberships and past attendance.
 *
 * - **Who:** the owner, or Branch Staff the owner switched on ("Import data",
 *   importScope), for the students of their own Branches. Adding a child stays
 *   the owner's, as Add manually does (Decision 403).
 * - **How:** the portal reads the file and sends its rows. A preview checks
 *   every row and changes nothing. The import itself is started, then its
 *   rows are sent in batches; each row's result is kept, so a batch sent again
 *   (a retry after a dropped connection) returns the same results and imports
 *   nothing twice. At most MAX_IMPORT_ROWS rows per import.
 * - **Members** (item 12): made exactly as Add manually makes them. An adult
 *   gets an account with a temporary passcode (Decision 371/403). A child
 *   (under 18) is added with their Guardian's email (AddChildManually): a new
 *   Guardian gets an account with the temporary passcode; a Guardian who
 *   already has an account gets an invite to accept in the app (ChildInvite).
 *   A row whose email already has an account is skipped and listed. Belts are
 *   given through grading's own promote, so its rules and permissions apply.
 * - **Memberships** (item 13): recorded against an existing plan, with the
 *   dates given. No Transaction and no Stripe: no money moves. A Subscription
 *   is card-only (Spec 55 §6.1), so it can't be imported this way.
 * - **Past attendance** (item 13): each row is logged exactly as "Log
 *   attendance" logs it (Decision 317 item 4): up to 30 days back, counting
 *   like a check-in, never twice.
 *
 * Everything is scoped to the School: rows only ever match its own branches,
 * styles, plans, classes and students.
 */
@Injectable()
export class DataImportsService {
  private readonly logger = new Logger(DataImportsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schools: SchoolsService,
    private readonly roleGrants: RoleGrantsService,
    private readonly studentAccess: StudentAccessService,
    private readonly grading: GradingService,
    private readonly staffAttendance: StaffAttendanceService,
    private readonly subscriptionGate: SubscriptionGateService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  // ---------------------------------------------------------------------------
  // Endpoints
  // ---------------------------------------------------------------------------

  async limits(callerId: string, schoolId: string): Promise<ImportLimitsDto> {
    await this.context(callerId, schoolId);
    return {
      maxRows: MAX_IMPORT_ROWS,
      maxRowsPerRequest: MAX_ROWS_PER_REQUEST,
      attendanceMaxDaysBack: LOG_ATTENDANCE_MAX_DAYS_BACK,
      columns: Object.fromEntries(IMPORT_KINDS.map((k) => [k, [...IMPORT_COLUMNS[k]]])) as Record<ImportKind, string[]>,
    };
  }

  /** Checks every row and changes nothing. */
  async preview(callerId: string, schoolId: string, kind: ImportKind, rows: ImportRowDto[]): Promise<ImportPreviewResponseDto> {
    assertDistinctRows(rows);
    const ctx = await this.context(callerId, schoolId);
    const checked = await this.check(ctx, kind, rows);
    const results = rows.map((row, i) => resultOf(row.rowNumber, checked[i], 'READY'));
    return { kind, rows: results, counts: countOf(results) };
  }

  async start(callerId: string, schoolId: string, dto: StartImportDto): Promise<DataImportResponseDto> {
    await this.context(callerId, schoolId);
    await this.subscriptionGate.assertNotDegraded(callerId, schoolId);
    const created = await this.prismaJobs.dataImport.create({
      data: { schoolId, kind: dto.kind, createdById: callerId, fileName: dto.fileName?.trim() || null, totalRows: dto.totalRows },
    });
    return present(created, []);
  }

  async find(callerId: string, schoolId: string, importId: string): Promise<DataImportResponseDto> {
    const ctx = await this.context(callerId, schoolId);
    const found = await this.loadImport(ctx, importId);
    const rows = await this.prismaJobs.dataImportRow.findMany({ where: { importId }, orderBy: { rowNumber: 'asc' } });
    return present(found, rows);
  }

  /** Imports the next batch. Rows already imported return their kept result. */
  async importRows(callerId: string, schoolId: string, importId: string, rows: ImportRowDto[]): Promise<ImportRowsResponseDto> {
    assertDistinctRows(rows);
    const ctx = await this.context(callerId, schoolId);
    const found = await this.loadImport(ctx, importId);
    if (rows.some((r) => r.rowNumber > found.totalRows + 1)) {
      throw new BadRequestException('A row number is past the end of this import.');
    }
    await this.subscriptionGate.assertNotDegraded(callerId, schoolId);
    const kind = found.kind as ImportKind;

    const kept = new Map(
      (await this.prismaJobs.dataImportRow.findMany({ where: { importId, rowNumber: { in: rows.map((r) => r.rowNumber) } } })).map((r) => [r.rowNumber, r]),
    );
    const todo = rows.filter((r) => !kept.has(r.rowNumber));
    const checked = todo.length ? await this.check(ctx, kind, todo) : [];

    for (const [i, row] of todo.entries()) {
      const outcome = checked[i];
      const record: RowRecord =
        'problem' in outcome
          ? { result: resultOf(row.rowNumber, outcome, 'CREATED') }
          : await this.run(ctx, kind, row.rowNumber, outcome);
      kept.set(row.rowNumber, await this.keep(importId, record));
    }
    return { rows: rows.map((r) => rowResult(kept.get(r.rowNumber)!)) };
  }

  // ---------------------------------------------------------------------------
  // Access and records
  // ---------------------------------------------------------------------------

  private async context(callerId: string, schoolId: string): Promise<ImportContext> {
    await this.schools.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    const { isOwner } = await this.tenantAuth.importScope(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    // Read via ultm8_jobs, after the caller's access check: School settings.
    const school = await this.prismaJobs.school.findUnique({ where: { id: schoolId }, select: { name: true, timezone: true, ranksToggle: true } });
    if (!school) throw new NotFoundException('School not found');
    const zone = safeZone(school.timezone);
    const now = new Date();
    return {
      callerId,
      schoolId,
      isOwner,
      schoolName: school.name,
      ranksOn: school.ranksToggle,
      zone,
      now,
      today: localDay(now, zone),
      coverage: isOwner ? null : await this.tenantAuth.staffBranchCoverage(callerId, schoolId),
    };
  }

  /** The import, for the person who started it or an owner. */
  private async loadImport(ctx: ImportContext, importId: string) {
    const found = await this.prismaJobs.dataImport.findFirst({ where: { id: importId, schoolId: ctx.schoolId } });
    if (!found || (!ctx.isOwner && found.createdById !== ctx.callerId)) throw new NotFoundException('Import not found');
    return found;
  }

  private async keep(importId: string, record: RowRecord) {
    const { result } = record;
    try {
      return await this.prismaJobs.dataImportRow.create({
        data: {
          importId,
          rowNumber: result.rowNumber,
          outcome: result.outcome,
          code: result.code,
          column: result.column,
          message: result.message,
          warnings: result.warnings.length ? (result.warnings as unknown as Prisma.InputJsonValue) : undefined,
          studentId: record.studentId ?? null,
          membershipId: record.membershipId ?? null,
          bookingId: record.bookingId ?? null,
          childInviteId: record.childInviteId ?? null,
          phone: record.phone ?? null,
        },
      });
    } catch (err) {
      // The same batch sent twice at once: the first one's result stands.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prismaJobs.dataImportRow.findUniqueOrThrow({ where: { importId_rowNumber: { importId, rowNumber: result.rowNumber } } });
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Checking rows (preview and import alike)
  // ---------------------------------------------------------------------------

  private async check(ctx: ImportContext, kind: ImportKind, rows: ImportRowDto[]): Promise<Array<Checked<unknown>>> {
    const values = rows.map((r) => new RowValues(r.values ?? {}));
    if (kind === 'MEMBERS') return this.checkMembers(ctx, values);
    if (kind === 'MEMBERSHIPS') return this.checkMemberships(ctx, values);
    return this.checkAttendance(ctx, values);
  }

  private async checkMembers(ctx: ImportContext, rows: RowValues[]): Promise<Array<Checked<MemberPlan>>> {
    // Everything the rows can name, read once for the batch.
    const [branches, styles] = await Promise.all([
      this.prismaJobs.branch.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true, archivedAt: true } }),
      this.prismaJobs.discipline.findMany({
        where: { schoolId: ctx.schoolId, archivedAt: null },
        select: {
          id: true,
          name: true,
          ranks: { where: { archivedAt: null }, select: { id: true, name: true, stripeTiers: { orderBy: { order: 'asc' }, take: 1, select: { id: true } } } },
        },
      }),
    ]);
    const hasBranches = branches.some((b) => !b.archivedAt);
    const emails = rows.flatMap((r) => [cell(r, 'email'), cell(r, 'guardian_email')]).filter(Boolean).map((e) => e.toLowerCase());
    const accounts = emails.length
      ? await this.prismaAuth.user.findMany({ where: { email: { in: [...new Set(emails)] } }, select: { id: true, email: true, dateOfBirth: true } })
      : [];
    const accountByEmail = new Map(accounts.map((a) => [a.email, a]));
    const guardianIds = accounts.map((a) => a.id);
    const [invites, links] = guardianIds.length
      ? await Promise.all([
          this.prismaJobs.childInvite.findMany({
            where: { guardianId: { in: guardianIds }, schoolId: ctx.schoolId, status: 'PENDING' },
            select: { guardianId: true, childFirstName: true, childSurname: true, childDateOfBirth: true },
          }),
          this.prismaJobs.guardianLink.findMany({ where: { guardianId: { in: guardianIds }, revokedAt: null }, select: { guardianId: true, studentId: true } }),
        ])
      : [[], []];
    const minors = links.length
      ? await this.prismaAuth.user.findMany({ where: { id: { in: links.map((l) => l.studentId) } }, select: { id: true, firstName: true, surname: true, dateOfBirth: true } })
      : [];
    const enrolledMinors = links.length
      ? new Set(
          (
            await this.prismaJobs.roleGrant.findMany({
              where: { userId: { in: links.map((l) => l.studentId) }, schoolId: ctx.schoolId, role: 'STUDENT', revokedAt: null },
              select: { userId: true },
            })
          ).map((g) => g.userId),
        )
      : new Set<string>();
    const promotable = ctx.isOwner
      ? null
      : new Set(
          // The caller's own permissions, read under their own context (as grading does).
          (
            await this.prismaApp.withTenantContext(ctx.callerId, (tx) =>
              tx.gradingPermission.findMany({ where: { userId: ctx.callerId, schoolId: ctx.schoolId, canPromote: true }, select: { disciplineId: true } }),
            )
          ).map((p) => p.disciplineId),
        );

    // Accounts this batch will make, so a later row sees them as existing.
    const madeInBatch = new Set<string>();
    const seen = new Set<string>();

    return rows.map((values) =>
      attempt<MemberPlan>(() => {
        const firstName = values.required('first_name');
        const surname = values.required('last_name');
        const dateOfBirth = parseBirthDate(values, ctx.now);
        const gender = parseGender(values);
        const joinedOn = parseDay(values, 'join_date', false);
        if (joinedOn && joinedOn > ctx.today) throw rowError('FUTURE_DATE', "join_date can't be in the future.", 'join_date');

        // Home branch (Decision 371): one of the School's open branches, while it has any.
        const branchName = values.get('branch');
        let branchId: string | undefined;
        if (hasBranches) {
          if (!branchName) throw rowError('BRANCH_REQUIRED', 'This School has branches: name the home branch.', 'branch');
          const branch = branches.find((b) => !b.archivedAt && sameText(b.name, branchName));
          if (!branch) throw rowError('UNKNOWN_BRANCH', `This School has no open branch named "${branchName}".`, 'branch');
          if (ctx.coverage?.hasBranches && !ctx.coverage.branchIds.has(branch.id)) {
            throw rowError('NOT_YOUR_BRANCH', `You can only import into your own branches.`, 'branch');
          }
          branchId = branch.id;
        } else if (branchName) {
          throw rowError('NO_BRANCHES', 'This School has no branches: leave branch empty.', 'branch');
        }

        // Belts per style, matched to the School's own styles and belts by name.
        const warnings: ImportWarning[] = [];
        const belts: Belt[] = parseBelts(values).map(({ style, belt }) => {
          if (!ctx.ranksOn) throw rowError('BELTS_OFF', 'Ranks are switched off for this School, so belts can\'t be set.', 'belts');
          const discipline = styles.find((s) => sameText(s.name, style));
          if (!discipline) throw rowError('UNKNOWN_STYLE', `This School has no style named "${style}".`, 'belts');
          const rank = discipline.ranks.find((r) => sameText(r.name, belt));
          const rungId = rank?.stripeTiers[0]?.id;
          if (!rungId) throw rowError('UNKNOWN_BELT', `"${discipline.name}" has no belt named "${belt}".`, 'belts');
          if (promotable && !promotable.has(discipline.id)) {
            // Grading's own refusal (GradingService.gradeAuthorizer).
            warnings.push({ code: 'BELT_NOT_SET', style: discipline.name, reason: NO_GRADING_PERMISSION, message: `${discipline.name}: ${NO_GRADING_PERMISSION}` });
          }
          return { style: discipline.name, disciplineId: discipline.id, rungId };
        });
        const settable = belts.filter((b) => !promotable || promotable.has(b.disciplineId));

        if (isAdultOn(new Date(dateOfBirth), ctx.now)) {
          const email = parseEmail(values, 'email', true)!;
          const phone = parsePhone(values);
          if (seen.has(email) || madeInBatch.has(email)) throw rowSkip('DUPLICATE_IN_FILE', 'This email is on an earlier row of the file.', 'email');
          seen.add(email);
          if (accountByEmail.has(email)) throw rowSkip('EMAIL_EXISTS', 'An account with this email already exists. Invite them instead.', 'email');
          madeInBatch.add(email);
          return {
            code: 'NEW_MEMBER',
            message: READY_MESSAGES.NEW_MEMBER!,
            warnings,
            plan: { kind: 'ADULT', email, firstName, surname, dateOfBirth, gender, phone, joinedOn, branchId, belts: settable },
          };
        }

        // A child (under 18): added with their Guardian's email (item 12).
        if (!ctx.isOwner) throw rowError('CHILD_OWNER_ONLY', "Only the School owner can add a child, as with Add manually.");
        const guardianEmail = parseEmail(values, 'guardian_email', false) ?? parseEmail(values, 'email', false);
        if (!guardianEmail) throw rowError('MISSING_VALUE', "guardian_email is empty: a child is added with their Guardian's email.", 'guardian_email');
        if (values.get('phone')) warnings.push({ code: 'CHILD_PHONE_NOT_USED', message: 'A child has no phone of their own on ULTM8, so the phone is not used.' });
        const key = `${guardianEmail}|${firstName.toLowerCase()}|${surname.toLowerCase()}|${dateOfBirth}`;
        if (seen.has(key)) throw rowSkip('DUPLICATE_IN_FILE', 'This child is on an earlier row of the file.');
        seen.add(key);
        const guardian = accountByEmail.get(guardianEmail);
        if (guardian) {
          if (guardian.dateOfBirth && !isAdultOn(guardian.dateOfBirth, ctx.now)) throw rowError('GUARDIAN_UNDER_18', 'A Guardian must be 18 or over.', 'guardian_email');
          const sameChild = (n: { first: string; last: string; dob: Date | null }) =>
            sameText(n.first, firstName) && sameText(n.last, surname) && !!n.dob && n.dob.toISOString().slice(0, 10) === dateOfBirth;
          if (invites.some((i) => i.guardianId === guardian.id && sameChild({ first: i.childFirstName, last: i.childSurname, dob: i.childDateOfBirth }))) {
            throw rowSkip('INVITE_PENDING', 'This Guardian already has an invite for this child.');
          }
          const linked = links.filter((l) => l.guardianId === guardian.id).map((l) => minors.find((m) => m.id === l.studentId)).filter(Boolean);
          if (linked.some((m) => enrolledMinors.has(m!.id) && sameChild({ first: m!.firstName, last: m!.surname, dob: m!.dateOfBirth }))) {
            throw rowSkip('ALREADY_MEMBER', 'This child is already a student here.');
          }
        }
        const exists = !!guardian || madeInBatch.has(guardianEmail);
        const guardianFirstName = values.get('guardian_first_name');
        const guardianSurname = values.get('guardian_last_name');
        if (!exists && (!guardianFirstName || !guardianSurname)) {
          throw rowError('GUARDIAN_NAME_REQUIRED', "The Guardian has no account yet: fill in guardian_first_name and guardian_last_name.", guardianFirstName ? 'guardian_last_name' : 'guardian_first_name');
        }
        madeInBatch.add(guardianEmail);
        if (exists && belts.length) {
          warnings.push({ code: 'BELTS_AFTER_ACCEPT', message: "Belts aren't set yet: the child joins when their Guardian accepts. Set them on the child's page then." });
        }
        const code: ImportRowCode = exists ? 'NEW_CHILD_GUARDIAN_INVITED' : 'NEW_CHILD_NEW_GUARDIAN';
        return {
          code,
          message: READY_MESSAGES[code]!,
          warnings,
          plan: {
            kind: 'CHILD',
            firstName,
            surname,
            dateOfBirth,
            gender,
            joinedOn,
            branchId,
            belts: exists ? [] : settable,
            guardian: { email: guardianEmail, firstName: guardianFirstName, surname: guardianSurname, exists },
          },
        };
      }),
    );
  }

  /**
   * The current students of this School that rows name: by their own email,
   * or for a child by their Guardian's email and the child's name. Branch
   * Staff only reach the students of their own branches.
   */
  private async resolveStudents(ctx: ImportContext, rows: RowValues[]): Promise<Array<(() => string)>> {
    const emails = [...new Set(rows.map((r) => cell(r, 'email').toLowerCase()).filter(Boolean))];
    const users = emails.length
      ? await this.prismaAuth.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true, firstName: true, surname: true } })
      : [];
    const links = users.length
      ? await this.prismaJobs.guardianLink.findMany({ where: { guardianId: { in: users.map((u) => u.id) }, revokedAt: null }, select: { guardianId: true, studentId: true } })
      : [];
    const minors = links.length
      ? await this.prismaAuth.user.findMany({ where: { id: { in: links.map((l) => l.studentId) } }, select: { id: true, firstName: true, surname: true } })
      : [];
    const ids = [...users.map((u) => u.id), ...minors.map((m) => m.id)];
    const [enrolled, homes] = ids.length
      ? await Promise.all([
          this.prismaJobs.roleGrant.findMany({ where: { userId: { in: ids }, schoolId: ctx.schoolId, role: 'STUDENT', revokedAt: null }, select: { userId: true } }),
          this.prismaJobs.studentHomeBranch.findMany({ where: { schoolId: ctx.schoolId, studentId: { in: ids } }, select: { studentId: true, branchId: true } }),
        ])
      : [[], []];
    const isStudent = new Set(enrolled.map((g) => g.userId));
    const homeOf = new Map(homes.map((h) => [h.studentId, h.branchId]));

    return rows.map((values) => () => {
      const email = parseEmail(values, 'email', true)!;
      const firstName = values.get('first_name');
      const surname = values.get('last_name');
      const named = !!(firstName || surname);
      const user = users.find((u) => u.email === email);
      const matches = (p: { firstName: string; surname: string }) => (!firstName || sameText(p.firstName, firstName)) && (!surname || sameText(p.surname, surname));
      const candidates: string[] = [];
      if (user && isStudent.has(user.id) && (!named || matches(user))) candidates.push(user.id);
      if (user && named) {
        for (const link of links.filter((l) => l.guardianId === user.id)) {
          const minor = minors.find((m) => m.id === link.studentId);
          if (minor && isStudent.has(minor.id) && matches(minor)) candidates.push(minor.id);
        }
      }
      const unique = [...new Set(candidates)];
      if (unique.length === 0) {
        throw rowError('NOT_A_MEMBER', named ? 'No current student of this School has this email and name.' : 'No current student of this School has this email.', 'email');
      }
      if (unique.length > 1) {
        throw rowError('AMBIGUOUS_MEMBER', 'More than one student matches: add first_name and last_name.', 'first_name');
      }
      const studentId = unique[0];
      // Decision 168: Branch Staff cover the students of their own branches.
      if (ctx.coverage?.hasBranches) {
        const home = homeOf.get(studentId);
        if (!home || !ctx.coverage.branchIds.has(home)) throw rowError('NOT_YOUR_BRANCH', 'This student belongs to a branch you are not assigned to.', 'email');
      }
      return studentId;
    });
  }

  private async checkMemberships(ctx: ImportContext, rows: RowValues[]): Promise<Array<Checked<MembershipPlanRow>>> {
    const plans = await this.prismaJobs.membershipPlan.findMany({
      where: { schoolId: ctx.schoolId, archivedAt: null },
      select: { id: true, title: true, type: true, classesIncluded: true, expiryDurationDays: true, scopedClassId: true, termsWaiverRequired: true },
    });
    const students = await this.resolveStudents(ctx, rows);
    const studentIds = new Set<string>();
    for (const resolve of students) {
      try {
        studentIds.add(resolve());
      } catch {
        // Reported per row below.
      }
    }
    const held = studentIds.size
      ? await this.prismaJobs.membership.findMany({
          where: { schoolId: ctx.schoolId, studentId: { in: [...studentIds] } },
          select: { studentId: true, membershipPlanId: true, startDate: true, status: true, expiryDate: true, classesRemaining: true, membershipPlan: { select: { type: true } } },
        })
      : [];
    const waiverChecked = new Map<string, boolean>();
    const seen = new Set<string>();

    const out: Array<Checked<MembershipPlanRow>> = [];
    for (const [i, values] of rows.entries()) {
      out.push(
        await attemptAsync<MembershipPlanRow>(async () => {
          const studentId = students[i]();
          const title = values.required('plan');
          const matching = plans.filter((p) => sameText(p.title, title));
          if (matching.length === 0) throw rowError('UNKNOWN_PLAN', `This School has no plan named "${title}".`, 'plan');
          if (matching.length > 1) throw rowError('AMBIGUOUS_PLAN', `More than one plan is named "${title}". Rename one first.`, 'plan');
          const plan = matching[0];
          if (plan.type === 'SUBSCRIPTION') {
            throw rowError('PLAN_IS_SUBSCRIPTION', 'A Subscription is paid by card in the app, so it can\'t be imported. The member buys it in the app.', 'plan');
          }
          if (plan.type === 'FRIEND_PASS' || plan.type === 'VISIT_PASS') {
            throw rowError('PLAN_NOT_IMPORTABLE', 'Friend Passes and visit passes are given, not imported.', 'plan');
          }
          const start = parseDay(values, 'start_date', true)!;
          const end = parseDay(values, 'end_date', false);
          if (end && end < start) throw rowError('END_BEFORE_START', "end_date can't be before start_date.", 'end_date');
          const classesLeft = parseCount(values, 'classes_left');
          if (classesLeft !== null && plan.type !== 'CLASS_PACK') throw rowError('NOT_A_CLASS_PACK', 'classes_left is only for a Class Pack.', 'classes_left');

          // As a desk sale (Decision 348): the School's waiver first, when the plan needs it.
          if (plan.termsWaiverRequired) {
            if (!waiverChecked.has(studentId)) {
              waiverChecked.set(studentId, await this.prismaApp.withTenantContext(studentId, (tx) => hasCountingWaiverSignature(tx, studentId, ctx.schoolId)));
            }
            if (!waiverChecked.get(studentId)) throw rowError('WAIVER_NEEDED', "This plan needs the School's waiver signed first, and this student hasn't signed it.", 'plan');
          }

          const startDate = DateTime.fromISO(start, { zone: ctx.zone }).startOf('day').toJSDate();
          const expiryDate = end
            ? DateTime.fromISO(end, { zone: ctx.zone }).plus({ days: 1 }).startOf('day').toJSDate()
            : plan.expiryDurationDays
              ? new Date(startDate.getTime() + plan.expiryDurationDays * DAY_MS)
              : null;
          const classesRemaining = plan.type === 'CLASS_PACK' ? (classesLeft ?? plan.classesIncluded ?? null) : null;

          const key = `${studentId}|${plan.id}|${start}`;
          if (seen.has(key)) throw rowSkip('DUPLICATE_IN_FILE', 'This membership is on an earlier row of the file.');
          seen.add(key);
          if (held.some((m) => m.studentId === studentId && m.membershipPlanId === plan.id && localDay(m.startDate, ctx.zone) === start)) {
            throw rowSkip('ALREADY_IMPORTED', 'This student already has this plan from this start date.');
          }
          const live = isMembershipLive({ status: 'ACTIVE', expiryDate, classesRemaining }, ctx.now);
          // Spec 55 §6.1: one live Subscription or Weekly Pass at a time.
          if (live && (GENERAL_ACCESS_TYPES as readonly string[]).includes(plan.type)) {
            const conflict = held.some(
              (m) => m.studentId === studentId && (GENERAL_ACCESS_TYPES as readonly string[]).includes(m.membershipPlan.type) && isMembershipLive(m, ctx.now),
            );
            if (conflict) throw rowError('GENERAL_ACCESS_CONFLICT', 'This student already holds an active Subscription or Weekly Pass at this School.', 'plan');
          }
          return {
            code: 'NEW_MEMBERSHIP',
            message: READY_MESSAGES.NEW_MEMBERSHIP!,
            warnings: [],
            plan: { studentId, plan, startDate, expiryDate, classesRemaining, live },
          };
        }),
      );
    }
    return out;
  }

  private async checkAttendance(ctx: ImportContext, rows: RowValues[]): Promise<Array<Checked<AttendanceRow>>> {
    const students = await this.resolveStudents(ctx, rows);
    // When each row's class started, in the School's time zone.
    const starts = rows.map((values) => {
      try {
        const day = parseDay(values, 'date', true)!;
        const time = parseTime(values, 'time');
        const at = DateTime.fromISO(`${day}T${time}`, { zone: ctx.zone });
        return at.isValid ? at.toJSDate() : null;
      } catch {
        return null; // Reported per row below.
      }
    });
    const instants = starts.filter((s): s is Date => !!s);
    const classes = instants.length
      ? await this.prismaJobs.class.findMany({
          where: { schoolId: ctx.schoolId, archivedAt: null, startDate: { in: instants } },
          select: { id: true, title: true, startDate: true, branchId: true, cancelledAt: true },
        })
      : [];
    const attended = classes.length
      ? await this.prismaJobs.booking.findMany({ where: { classId: { in: classes.map((c) => c.id) }, status: 'COMPLETED' }, select: { classId: true, studentId: true } })
      : [];
    const mayCheckIn = new Map<string | null, boolean>();
    const earliestDay = DateTime.fromISO(ctx.today, { zone: ctx.zone }).minus({ days: LOG_ATTENDANCE_MAX_DAYS_BACK });
    const earliest = earliestDay.startOf('day').toJSDate();
    const seen = new Set<string>();

    const out: Array<Checked<AttendanceRow>> = [];
    for (const [i, values] of rows.entries()) {
      out.push(
        await attemptAsync<AttendanceRow>(async () => {
          const studentId = students[i]();
          parseDay(values, 'date', true);
          parseTime(values, 'time');
          const title = values.required('class');
          const start = starts[i];
          const matching = start ? classes.filter((c) => c.startDate.getTime() === start.getTime() && sameText(c.title, title)) : [];
          if (matching.length === 0) throw rowError('UNKNOWN_CLASS', `No class "${title}" started at this date and time.`, 'class');
          if (matching.length > 1) throw rowError('AMBIGUOUS_CLASS', `More than one class "${title}" started at this time.`, 'class');
          const cls = matching[0];
          if (cls.cancelledAt) throw rowError('CLASS_CANCELLED', 'This class was cancelled.', 'class');
          if (cls.startDate > ctx.now) throw rowError('CLASS_NOT_STARTED', "This class hasn't started yet.", 'date');
          // Decision 317 item 4: up to 30 days back, as "Log attendance".
          if (cls.startDate < earliest) {
            throw rowError('OUT_OF_RANGE', `Attendance can only be imported from ${earliestDay.toISODate()} to ${ctx.today}.`, 'date');
          }
          if (!ctx.isOwner) {
            if (!mayCheckIn.has(cls.branchId)) mayCheckIn.set(cls.branchId, await this.tenantAuth.staffMay(ctx.callerId, ctx.schoolId, 'bookings', cls.branchId));
            if (!mayCheckIn.get(cls.branchId)) throw rowError('NOT_YOUR_BRANCH', "The School owner hasn't let you manage bookings and check-in at this class's branch.", 'class');
          }
          const key = `${studentId}|${cls.id}`;
          if (seen.has(key)) throw rowSkip('DUPLICATE_IN_FILE', 'This attendance is on an earlier row of the file.');
          seen.add(key);
          if (attended.some((b) => b.classId === cls.id && b.studentId === studentId)) {
            throw rowSkip('ALREADY_ATTENDED', 'This student is already checked in to this class.');
          }
          return { code: 'NEW_ATTENDANCE', message: READY_MESSAGES.NEW_ATTENDANCE!, warnings: [], plan: { studentId, classId: cls.id } };
        }),
      );
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Importing one checked row
  // ---------------------------------------------------------------------------

  /** Does what a checked row says. A refusal from the code it reuses (an
   * HttpException) is kept as the row's result; anything else stops the
   * batch, so it is tried again when the batch is sent again. */
  private async run(ctx: ImportContext, kind: ImportKind, rowNumber: number, checked: Extract<Checked<unknown>, { plan: unknown }>): Promise<RowRecord> {
    try {
      if (kind === 'MEMBERS') return await this.runMember(ctx, rowNumber, checked as Extract<Checked<MemberPlan>, { plan: unknown }>);
      if (kind === 'MEMBERSHIPS') return await this.runMembership(ctx, rowNumber, checked.plan as MembershipPlanRow);
      return await this.runAttendance(ctx, rowNumber, checked.plan as AttendanceRow);
    } catch (err) {
      if (err instanceof RowProblem) return { result: resultOf(rowNumber, { problem: err }, 'CREATED') };
      if (err instanceof HttpException) {
        return { result: { rowNumber, outcome: 'ERROR', code: 'FAILED', column: null, message: messageOf(err), warnings: [] } };
      }
      throw err;
    }
  }

  private async runMember(ctx: ImportContext, rowNumber: number, checked: Extract<Checked<MemberPlan>, { plan: unknown }>): Promise<RowRecord> {
    const plan = checked.plan;
    const warnings = [...checked.warnings];
    if (plan.kind === 'CHILD') {
      // Exactly Add manually's child (Decision 403): the owner's own checks,
      // the Guardian's account or invite, and their email.
      const dto = {
        child: { firstName: plan.firstName, surname: plan.surname, dateOfBirth: plan.dateOfBirth, gender: plan.gender },
        guardian: { email: plan.guardian.email, firstName: plan.guardian.firstName || '-', surname: plan.guardian.surname || '-' },
        branchId: plan.branchId,
        // Decision 315 item 4: set now, or when the Guardian accepts the invite.
        ...(plan.joinedOn ? { joinedOn: plan.joinedOn } : {}),
      } as AddChildManuallyDto;
      let added;
      try {
        added = await this.studentAccess.addChildManually(ctx.callerId, ctx.schoolId, dto);
      } catch (err) {
        // Sent again, or added by hand meanwhile: the invite already waits.
        if (err instanceof ConflictException && messageOf(err).includes('already has an invite')) throw rowSkip('INVITE_PENDING', messageOf(err));
        throw err;
      }
      if (!added.emailSent) warnings.push({ code: 'EMAIL_NOT_SENT', message: "The email to the Guardian couldn't be sent." });
      if (added.studentId) await this.giveBelts(ctx, added.studentId, plan.belts, warnings);
      const code: ImportRowCode = added.outcome === 'GUARDIAN_CREATED' ? 'NEW_CHILD_NEW_GUARDIAN' : 'NEW_CHILD_GUARDIAN_INVITED';
      if (code === 'NEW_CHILD_GUARDIAN_INVITED' && plan.belts.length && !warnings.some((w) => w.code === 'BELTS_AFTER_ACCEPT')) {
        warnings.push({ code: 'BELTS_AFTER_ACCEPT', message: "Belts aren't set yet: the child joins when their Guardian accepts. Set them on the child's page then." });
      }
      return {
        result: { rowNumber, outcome: 'CREATED', code, column: null, message: doneMessage(code), warnings },
        studentId: added.studentId,
        childInviteId: added.inviteId,
      };
    }

    // An adult: Add manually's account (Decision 371/403) and enrolment.
    let account;
    try {
      account = await this.roleGrants.createStudentAccount({
        email: plan.email,
        firstName: plan.firstName,
        surname: plan.surname,
        dateOfBirth: plan.dateOfBirth,
        gender: plan.gender,
        schoolId: ctx.schoolId,
      });
    } catch (err) {
      if (err instanceof ConflictException) throw rowSkip('EMAIL_EXISTS', 'An account with this email already exists. Invite them instead.', 'email');
      throw err;
    }
    const { userId, tempPasscode } = account;
    await this.roleGrants.enrolNewAccount(userId, () =>
      ctx.isOwner
        ? this.schools.join(ctx.callerId, ctx.schoolId, { studentId: userId, branchId: plan.branchId }, { notify: false })
        : // Branch Staff with "Import data": enrolled as a tablet sign-up a
          // staff member approves is (Decision 392), under the new account.
          this.schools.join(userId, ctx.schoolId, { branchId: plan.branchId }, { notify: false }),
    );
    // Decision 315 item 4: an earlier join date, as Add manually sets it.
    if (plan.joinedOn) await setJoinDate(this.prismaJobs, ctx.schoolId, userId, plan.joinedOn, ctx.callerId);
    await this.giveBelts(ctx, userId, plan.belts, warnings);
    const emailSent = await this.sendEmail(plan.email, `You've been added to ${ctx.schoolName} on ULTM8`, [
      `${ctx.schoolName} has added you as a student on ULTM8.`,
      '',
      `Sign in to the ULTM8 app with this email address (${plan.email}) and the temporary passcode below. You'll be asked to choose your own passcode straight away.`,
      '',
      `Temporary passcode: ${tempPasscode}`,
    ]);
    if (!emailSent) warnings.push({ code: 'EMAIL_NOT_SENT', message: "The email with the temporary passcode couldn't be sent. Make a new passcode on the student's page." });
    return {
      result: { rowNumber, outcome: 'CREATED', code: 'NEW_MEMBER', column: null, message: doneMessage('NEW_MEMBER'), warnings },
      studentId: userId,
      phone: plan.phone,
    };
  }

  /** Each belt as a first grade, through grading's own promote (its rules,
   * permissions and history). A belt that can't be set is a warning: the
   * member is already made. */
  private async giveBelts(ctx: ImportContext, studentId: string, belts: Belt[], warnings: ImportWarning[]) {
    for (const belt of belts) {
      try {
        await this.grading.promote(ctx.callerId, studentId, belt.disciplineId, { targetRungId: belt.rungId });
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        warnings.push({ code: 'BELT_NOT_SET', style: belt.style, reason: messageOf(err), message: `${belt.style}: ${messageOf(err)}` });
      }
    }
  }

  private async runMembership(ctx: ImportContext, rowNumber: number, row: MembershipPlanRow): Promise<RowRecord> {
    const membership = await this.prismaApp.withTenantContext(row.studentId, async (tx) => {
      await lockSchoolOpen(tx, ctx.schoolId);
      if (row.live) {
        try {
          await assertCanCreateMembership(tx, row.studentId, ctx.schoolId, row.plan, ctx.now);
        } catch (err) {
          if (err instanceof GeneralAccessConflictError) throw rowError('GENERAL_ACCESS_CONFLICT', err.message, 'plan');
          throw err;
        }
      } else {
        // The same lock, so imports and purchases for this student don't cross.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership:${row.studentId}:${ctx.schoolId}`}, 0))`;
      }
      // Never twice: the same plan from the same day (a batch sent again).
      const same = await tx.membership.findMany({ where: { studentId: row.studentId, schoolId: ctx.schoolId, membershipPlanId: row.plan.id }, select: { startDate: true } });
      if (same.some((m) => localDay(m.startDate, ctx.zone) === localDay(row.startDate, ctx.zone))) {
        throw rowSkip('ALREADY_IMPORTED', 'This student already has this plan from this start date.');
      }
      // No Transaction: an imported membership moves no money.
      return tx.membership.create({
        data: {
          studentId: row.studentId,
          membershipPlanId: row.plan.id,
          schoolId: ctx.schoolId,
          frequency: 'ONE_TIME',
          startDate: row.startDate,
          expiryDate: row.expiryDate,
          classesRemaining: row.classesRemaining,
          scopedClassId: row.plan.scopedClassId,
        },
        select: { id: true },
      });
    });
    return {
      result: { rowNumber, outcome: 'CREATED', code: 'NEW_MEMBERSHIP', column: null, message: doneMessage('NEW_MEMBERSHIP'), warnings: [] },
      studentId: null,
      membershipId: membership.id,
    };
  }

  private async runAttendance(ctx: ImportContext, rowNumber: number, row: AttendanceRow): Promise<RowRecord> {
    try {
      // Exactly "Log attendance" (Decision 317 item 4): its checks, a Class
      // Pack credit when it needs a booking, grading and hours, STAFF_LOGGED.
      const logged = await this.staffAttendance.log(ctx.callerId, ctx.schoolId, { studentId: row.studentId, classId: row.classId });
      return {
        result: { rowNumber, outcome: 'CREATED', code: 'NEW_ATTENDANCE', column: null, message: doneMessage('NEW_ATTENDANCE'), warnings: [] },
        bookingId: logged.bookingId,
      };
    } catch (err) {
      if (err instanceof ConflictException && codeOf(err) === 'ALREADY_ATTENDED') throw rowSkip('ALREADY_ATTENDED', 'This student is already checked in to this class.');
      throw err;
    }
  }

  private async sendEmail(to: string, subject: string, lines: string[]): Promise<boolean> {
    try {
      await this.delivery.sendEmail(to, subject, lines.join('\n'));
      return true;
    } catch (err) {
      this.logger.warn(`An import email could not be sent — ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}

// -----------------------------------------------------------------------------

interface RowRecord {
  result: ImportRowResult;
  studentId?: string | null;
  membershipId?: string | null;
  bookingId?: string | null;
  childInviteId?: string | null;
  phone?: string | null;
}

const cell = (values: RowValues, column: string) => {
  try {
    return values.get(column);
  } catch {
    return '';
  }
};

function attempt<T>(fn: () => Extract<Checked<T>, { plan: unknown }>): Checked<T> {
  try {
    return fn();
  } catch (err) {
    if (err instanceof RowProblem) return { problem: err };
    throw err;
  }
}

async function attemptAsync<T>(fn: () => Promise<Extract<Checked<T>, { plan: unknown }>>): Promise<Checked<T>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RowProblem) return { problem: err };
    throw err;
  }
}

function resultOf(rowNumber: number, checked: Checked<unknown>, ok: 'READY' | 'CREATED'): ImportRowResult {
  if ('problem' in checked) {
    const p = checked.problem;
    return { rowNumber, outcome: p.outcome, code: p.code, column: p.column, message: p.message, warnings: [] };
  }
  return { rowNumber, outcome: ok, code: checked.code, column: null, message: checked.message, warnings: checked.warnings };
}

function doneMessage(code: ImportRowCode): string {
  switch (code) {
    case 'NEW_MEMBER':
      return 'Member added and sent a temporary passcode.';
    case 'NEW_CHILD_NEW_GUARDIAN':
      return 'Child added; their Guardian has a new account and was sent a temporary passcode.';
    case 'NEW_CHILD_GUARDIAN_INVITED':
      return 'The Guardian was invited to add the child in the app.';
    case 'NEW_MEMBERSHIP':
      return 'Membership recorded.';
    default:
      return 'Attendance logged.';
  }
}

function rowResult(row: { rowNumber: number; outcome: string; code: string | null; message: string | null; warnings: unknown; column?: string | null }): ImportRowResult {
  return {
    rowNumber: row.rowNumber,
    outcome: row.outcome as ImportRowOutcome,
    code: (row.code ?? 'FAILED') as ImportRowCode,
    column: row.column ?? null,
    message: row.message ?? '',
    warnings: Array.isArray(row.warnings) ? (row.warnings as unknown as ImportWarning[]) : [],
  };
}

function countOf(rows: ImportRowResult[]) {
  return {
    ok: rows.filter((r) => r.outcome === 'READY' || r.outcome === 'CREATED').length,
    skipped: rows.filter((r) => r.outcome === 'SKIPPED').length,
    errors: rows.filter((r) => r.outcome === 'ERROR').length,
  };
}

function present(
  found: { id: string; kind: string; fileName: string | null; totalRows: number; createdAt: Date },
  rows: Array<{ rowNumber: number; outcome: string; code: string | null; message: string | null; warnings: unknown }>,
): DataImportResponseDto {
  const results = rows.map(rowResult);
  return {
    id: found.id,
    kind: found.kind as ImportKind,
    fileName: found.fileName,
    totalRows: found.totalRows,
    rowsDone: results.length,
    counts: countOf(results),
    createdAt: found.createdAt.toISOString(),
    rows: results,
  };
}

function assertDistinctRows(rows: ImportRowDto[]) {
  if (new Set(rows.map((r) => r.rowNumber)).size !== rows.length) {
    throw new BadRequestException('Each row number can only be sent once.');
  }
}

function codeOf(err: HttpException): string | null {
  const body = err.getResponse();
  return typeof body === 'object' && body && 'code' in body && typeof (body as { code: unknown }).code === 'string' ? (body as { code: string }).code : null;
}

function messageOf(err: HttpException): string {
  const body = err.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.map(String).join(' ');
  return typeof message === 'string' ? message : err.message;
}

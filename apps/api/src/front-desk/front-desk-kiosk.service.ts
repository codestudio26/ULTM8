import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { SchoolsService } from '../tenants/schools/schools.service';
import { StudentRosterStatusDto } from '../tenants/schools/dto/student-roster-query.dto';
import { MembershipsService } from '../memberships/memberships.service';
import { WaiversService } from '../waivers/waivers.service';
import { GuestWaiversService } from '../waivers/guest-waivers.service';
import { GradingService } from '../ranks/grading.service';
import { ProgressBreakdownResponseDto } from '../ranks/dto/student-rank-response.dto';
import { AttendanceService } from '../attendance/attendance.service';
import { FrontDeskCheckInService, frontDeskLookupOwner } from '../attendance/front-desk-check-in.service';
import { DeskCheckInDto } from '../attendance/dto/desk-check-in.dto';
import { FrontDeskSessionContext } from './front-desk-sessions.service';
import { KioskBookingDto, KioskClassDto, KioskStudentCardDto, KioskStudentDto, KioskTodayDto, KioskTodayQueryDto } from './dto/front-desk.dto';

const NAME_RESULTS = 8;
const RECENT = 10;
// "Today" on the tablet's clock is at most a day and a half long, and near now.
const MAX_WINDOW_MS = 36 * 3_600_000;

function initial(surname: string): string {
  return (surname.trim()[0] ?? '').toUpperCase();
}

/** "Lucas M." for a guest's name as typed on their waiver (Decision 351). */
function shortGuestName(fullName: string | null): string | null {
  if (!fullName) return null;
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || null;
  return `${parts[0]} ${initial(parts[parts.length - 1])}.`;
}

/**
 * What a locked front-desk tablet can read and do (Decision 380, handover F1).
 * Each call runs as the staff member who started the session, through the
 * same service methods the staff screens use, so their access decides what is
 * seen; then it is cut down to the tablet's short form: first name and
 * initial, no email, a child's photo only with camera consent, today only,
 * and only the session's Branch.
 */
@Injectable()
export class FrontDeskKioskService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly schools: SchoolsService,
    private readonly memberships: MembershipsService,
    private readonly waivers: WaiversService,
    private readonly guestWaivers: GuestWaiversService,
    private readonly grading: GradingService,
    private readonly attendance: AttendanceService,
    private readonly deskCheckIn: FrontDeskCheckInService,
  ) {}

  async info(session: FrontDeskSessionContext) {
    const school = await this.prismaJobs.school.findUniqueOrThrow({
      where: { id: session.schoolId },
      select: { name: true, checkInOpensMinutesBeforeStart: true, checkInCodeDigits: true },
    });
    const branch = session.branchId ? await this.prismaJobs.branch.findUnique({ where: { id: session.branchId }, select: { name: true } }) : null;
    return {
      sessionId: session.id,
      schoolId: session.schoolId,
      schoolName: school.name,
      branchId: session.branchId,
      branchName: branch?.name ?? null,
      expiresAt: session.expiresAt.toISOString(),
      checkInOpensMinutesBeforeStart: school.checkInOpensMinutesBeforeStart,
      checkInCodeDigits: school.checkInCodeDigits,
    };
  }

  /** Today's Classes at the session's Branch (and the whole School's), with
   * counts only, and today's last 10 check-ins as "Lucas M.". */
  async today(session: FrontDeskSessionContext, query: KioskTodayQueryDto): Promise<KioskTodayDto> {
    const { from, to } = this.window(query);
    const classes = await this.prismaApp.withTenantContext(session.startedById, (tx) =>
      tx.class.findMany({
        where: {
          schoolId: session.schoolId,
          startDate: { gte: from, lte: to },
          cancelledAt: null,
          archivedAt: null,
          ...(session.branchId ? { OR: [{ branchId: session.branchId }, { branchId: null }] } : {}),
        },
        orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
        include: {
          bookings: {
            where: { status: { in: ['UPCOMING', 'COMPLETED'] } },
            select: { id: true, studentId: true, status: true, updatedAt: true, attendees: { select: { checkedInAt: true } } },
          },
        },
      }),
    );
    const recentRows = classes
      .flatMap((c) => c.bookings.filter((b) => b.status === 'COMPLETED').map((b) => ({ id: b.id, studentId: b.studentId, classTitle: c.title, at: b.updatedAt })))
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, RECENT);
    const names = await resolveUserNames(this.prismaAuth, [...classes.map((c) => c.instructorId).filter((id): id is string => !!id), ...recentRows.map((r) => r.studentId)]);
    return {
      classes: classes.map((c): KioskClassDto => {
        const coach = c.instructorId ? names.get(c.instructorId) : undefined;
        return {
          id: c.id,
          title: c.title,
          startDate: c.startDate.toISOString(),
          endDate: c.endDate.toISOString(),
          qrAttendanceEndAt: c.qrAttendanceEndAt?.toISOString() ?? null,
          capacity: c.capacity,
          branchId: c.branchId,
          coachName: coach ? `${coach.firstName} ${coach.surname}`.trim() : null,
          seatsTaken: c.bookings.reduce((n, b) => n + 1 + b.attendees.length, 0),
          checkedIn: c.bookings.reduce((n, b) => n + (b.status === 'COMPLETED' ? 1 : 0) + b.attendees.filter((a) => a.checkedInAt).length, 0),
        };
      }),
      recent: recentRows.map((r) => {
        const who = names.get(r.studentId);
        return { id: r.id, firstName: who?.firstName ?? '', surnameInitial: initial(who?.surname ?? ''), classTitle: r.classTitle, at: r.at.toISOString() };
      }),
    };
  }

  /** Name search on the tablet. Only Students whose home Branch is the
   * session's, or who have none: who may check in at another Branch isn't
   * decided yet (handover F9). At most 8, in the short form. */
  async searchStudents(session: FrontDeskSessionContext, search: string) {
    const { items } = await this.schools.findAllStudentsForSchool(session.startedById, session.schoolId, StudentRosterStatusDto.ACTIVE, search.trim());
    const here = items.filter((s) => !session.branchId || !s.homeBranchId || s.homeBranchId === session.branchId);
    const shown = here.slice(0, NAME_RESULTS);
    const photos = await this.photosFor(shown);
    return {
      items: shown.map((s): KioskStudentDto => ({ id: s.id, firstName: s.firstName, surnameInitial: initial(s.surname), profilePhotoUrl: photos.get(s.id) ?? null })),
      more: here.length > NAME_RESULTS,
    };
  }

  /** The welcome card: membership, waivers, belt progress and the student's
   * own bookings in today's Classes here. */
  async studentCard(session: FrontDeskSessionContext, studentId: string, query: KioskTodayQueryDto): Promise<KioskStudentCardDto> {
    const { from, to } = this.window(query);
    const staffId = session.startedById;
    const [student, membershipStatus, waivers, eligibility] = await Promise.all([
      this.student(session, studentId),
      this.memberships.getMembershipStatus(staffId, studentId, session.schoolId),
      this.waivers.getStudentWaiverStatus(staffId, studentId, session.schoolId),
      this.grading.findEligibilityForStudent(staffId, studentId, session.schoolId),
    ]);
    const bookings = await this.prismaApp.withTenantContext(staffId, (tx) =>
      tx.booking.findMany({
        where: {
          studentId,
          schoolId: session.schoolId,
          status: { in: ['UPCOMING', 'COMPLETED'] },
          class: {
            startDate: { gte: from, lte: to },
            ...(session.branchId ? { OR: [{ branchId: session.branchId }, { branchId: null }] } : {}),
          },
        },
        select: { id: true, classId: true, status: true, _count: { select: { attendees: true } } },
      }),
    );
    const withGuests = await Promise.all(
      bookings.map(async (b): Promise<KioskBookingDto> => {
        const guests = b._count.attendees > 0 ? (await this.guestWaivers.bookingGuests(staffId, b.id)).guests : [];
        return {
          classId: b.classId,
          bookingId: b.id,
          status: b.status as 'UPCOMING' | 'COMPLETED',
          guests: guests.map((g) => ({ attendeeId: g.attendeeId, name: shortGuestName(g.guestFullName), waiverStatus: g.waiverStatus, checkedInAt: g.checkedInAt })),
        };
      }),
    );
    // Typed loosely by findEligibilityForStudent; the shape is ProgressBreakdownResponseDto.
    const breakdowns = eligibility.items.map((i) => (i as { progressBreakdown?: ProgressBreakdownResponseDto | null }).progressBreakdown);
    const classes = breakdowns.map((b) => b?.classes).find((c) => c && c.required > 0);
    return {
      student,
      membershipStatus,
      waiverSigned: waivers.signed,
      waiversToSign: waivers.toSign.map((w) => ({ waiverId: w.waiverId, title: w.title })),
      progress: classes ? { counted: classes.counted, required: classes.required, percent: classes.percent } : null,
      bookings: withGuests,
    };
  }

  /** A scanned app QR, checked once (Decision 377); the lookup it gives only
   * works on this tablet. */
  async qrLookup(session: FrontDeskSessionContext, studentToken: string) {
    const r = await this.attendance.deskQrLookup(session.startedById, session.schoolId, studentToken, frontDeskLookupOwner(session.id));
    return { lookupToken: r.lookupToken, expiresAt: r.expiresAt, student: await this.student(session, r.studentId) };
  }

  /** The one-step check-in (Decision 378), only at this tablet's Branch. */
  checkIn(session: FrontDeskSessionContext, dto: DeskCheckInDto) {
    return this.deskCheckIn.checkIn(session.startedById, session.schoolId, dto, { sessionId: session.id, branchId: session.branchId });
  }

  // ---------------------------------------------------------------------------

  private window(query: KioskTodayQueryDto): { from: Date; to: Date } {
    const from = new Date(query.startsFrom);
    const to = new Date(query.startsTo);
    const now = Date.now();
    if (!(to > from) || to.getTime() - from.getTime() > MAX_WINDOW_MS || from.getTime() > now + MAX_WINDOW_MS || to.getTime() < now - MAX_WINDOW_MS) {
      throw new BadRequestException("The tablet's day is out of range. Check the tablet's date and time.");
    }
    return { from, to };
  }

  /** One Student of this School, in the short form. */
  private async student(session: FrontDeskSessionContext, studentId: string): Promise<KioskStudentDto> {
    // Read via ultm8_jobs: Branch Staff and coaches can't see every RoleGrant.
    const enrolled = await this.prismaJobs.roleGrant.findFirst({ where: { userId: studentId, schoolId: session.schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } });
    if (!enrolled) throw new NotFoundException({ code: 'NOT_A_STUDENT_HERE', message: "This person isn't a Student at this School." });
    const names = await resolveUserNames(this.prismaAuth, [studentId]);
    const who = names.get(studentId);
    if (!who) throw new NotFoundException({ code: 'NOT_A_STUDENT_HERE', message: "This person isn't a Student at this School." });
    const photos = await this.photosFor([{ id: studentId, profilePhotoUrl: who.profilePhotoUrl }]);
    return { id: studentId, firstName: who.firstName, surnameInitial: initial(who.surname), profilePhotoUrl: photos.get(studentId) ?? null };
  }

  /** Photos the tablet may show: a child's (a Student with a Guardian) only
   * while a Guardian's camera consent is active (Decisions 57, 69). */
  private async photosFor(students: Array<{ id: string; profilePhotoUrl?: string | null }>): Promise<Map<string, string | null>> {
    const withPhoto = students.filter((s) => s.profilePhotoUrl);
    if (withPhoto.length === 0) return new Map();
    const ids = withPhoto.map((s) => s.id);
    const [links, consents] = await Promise.all([
      this.prismaJobs.guardianLink.findMany({ where: { studentId: { in: ids }, revokedAt: null }, select: { studentId: true } }),
      this.prismaJobs.consentRecord.findMany({ where: { studentId: { in: ids }, tier: 'CAMERA', status: 'ACTIVE' }, select: { studentId: true } }),
    ]);
    const children = new Set(links.map((l) => l.studentId));
    const consented = new Set(consents.map((c) => c.studentId));
    return new Map(withPhoto.map((s) => [s.id, !children.has(s.id) || consented.has(s.id) ? (s.profilePhotoUrl ?? null) : null]));
  }
}

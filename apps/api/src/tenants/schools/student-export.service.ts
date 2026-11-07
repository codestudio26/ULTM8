import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAuthService } from '../../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import { isMembershipLive } from '../../memberships/membership-creation-guard';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { SchoolsService } from './schools.service';
import { StudentRosterStatusDto, StudentStatusDto } from './dto/student-roster-query.dto';
import { StudentExportFilterDto, type StudentExportRowDto } from './dto/student-export.dto';

/**
 * Export the student list (backlog 3.9; Decision 315 item 11, Decision 399).
 * The owner, or Branch Staff the owner let export, gets the students they can
 * already see on the roster (Branch Staff: those they cover), children
 * included, with contact, age, belts, memberships, last visit and a child's
 * Guardians. Every export is logged. The portal turns the rows into the CSV,
 * with headers in the reader's language.
 */
@Injectable()
export class StudentExportService {
  constructor(
    private readonly schools: SchoolsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly prismaAuth: PrismaAuthService,
  ) {}

  async export(callerId: string, schoolId: string, filter: StudentExportFilterDto = StudentExportFilterDto.ACTIVE) {
    // Someone with no role at the School, or a School that doesn't exist,
    // gets "School not found" as on the roster, not the owner's switch
    // (stress test round 6, R-3; Decision 447 item 3).
    await this.schools.findOne(callerId, schoolId);
    await this.tenantAuth.assertMayExportStudents(callerId, schoolId);
    // The roster's own checks and scope: who the caller may see.
    const roster = await this.schools.findAllStudentsForSchool(
      callerId,
      schoolId,
      filter === StudentExportFilterDto.ALL ? StudentRosterStatusDto.ALL : StudentRosterStatusDto.ACTIVE,
    );
    const rows = roster.items.filter((r) =>
      filter === StudentExportFilterDto.MEMBERS ? !r.visitor : filter === StudentExportFilterDto.VISITORS ? r.visitor : true,
    );
    const ids = rows.map((r) => r.id);

    // Read on the jobs and auth connections, for these students only: the caller has
    // been checked above, and RLS can't show staff a former student's row.
    const [users, memberships, ranks, guardianLinks, visits] = ids.length
      ? await Promise.all([
          // Phone numbers are read on the auth connection, as the roster reads names.
          this.prismaAuth.user.findMany({ where: { id: { in: ids } }, select: { id: true, phone: true, dateOfBirth: true } }),
          this.prismaJobs.membership.findMany({
            where: { schoolId, studentId: { in: ids } },
            orderBy: { startDate: 'asc' },
            select: { studentId: true, status: true, expiryDate: true, classesRemaining: true, membershipPlan: { select: { title: true } } },
          }),
          this.prismaJobs.studentRank.findMany({
            where: { schoolId, studentId: { in: ids } },
            orderBy: { discipline: { name: 'asc' } },
            select: { studentId: true, discipline: { select: { name: true } }, currentRank: { select: { name: true } }, currentStripe: { select: { name: true } } },
          }),
          this.prismaJobs.guardianLink.findMany({
            where: { studentId: { in: ids }, revokedAt: null },
            orderBy: { createdAt: 'asc' },
            select: { studentId: true, guardianId: true, guardian: { select: { firstName: true, surname: true, email: true } } },
          }),
          this.prismaJobs.$queryRaw<Array<{ studentId: string; lastVisitAt: Date }>>`
            SELECT b."studentId", max(c."startDate") AS "lastVisitAt"
            FROM "Booking" b JOIN "Class" c ON c.id = b."classId"
            WHERE b."schoolId" = ${schoolId} AND b.status = 'COMPLETED' AND b."studentId" IN (${Prisma.join(ids)})
            GROUP BY b."studentId"`,
        ])
      : [[], [], [], [], []];

    const knownHere = await this.guardiansKnownHere(schoolId, guardianLinks);
    const user = new Map(users.map((u) => [u.id, u]));
    const lastVisit = new Map(visits.map((v) => [v.studentId, v.lastVisitAt]));
    const now = new Date();
    const items: StudentExportRowDto[] = rows.map((r) => {
      const u = user.get(r.id);
      const mine = memberships.filter((m) => m.studentId === r.id);
      const live = mine.filter((m) => isMembershipLive(m, now));
      // Decision 433 item 11 (PRIV-11, interim until the GDPR programme sets a
      // retention period): a former member's phone and birth date are read
      // live from their account, so the School would keep getting them for
      // ever; the ALL export leaves both blank for them.
      const former = r.status === StudentStatusDto.INACTIVE;
      return {
        id: r.id,
        firstName: r.firstName,
        surname: r.surname,
        email: r.email,
        // A child's account carries a made-up phone number; leave it out.
        phone: r.guardianManaged || former ? null : u?.phone ?? null,
        dateOfBirth: u?.dateOfBirth && !former ? u.dateOfBirth.toISOString().slice(0, 10) : null,
        status: r.status as StudentStatusDto,
        enrolledAt: new Date(r.enrolledAt).toISOString(),
        joinedOn: r.joinedOn ?? null,
        homeBranchName: r.homeBranchName ?? null,
        visitor: r.visitor,
        memberships: live.map((m) => m.membershipPlan.title),
        billingStatus: live.length > 0 ? 'ACTIVE' : mine.length > 0 ? 'EXPIRED' : 'NONE',
        belts: ranks
          .filter((k) => k.studentId === r.id)
          .map((k) => ({ style: k.discipline.name, rank: k.currentStripe?.name ?? k.currentRank.name })),
        lastVisitAt: lastVisit.get(r.id)?.toISOString() ?? null,
        guardians: guardianLinks
          .filter((g) => g.studentId === r.id)
          // Decision 430 item 11 (FAM-11/PRIV-3, interim): a parent this School
          // never dealt with (known only through the child's other School) is
          // listed by name, without their email.
          .map((g) => ({ name: `${g.guardian.firstName} ${g.guardian.surname}`.trim(), email: knownHere.has(`${g.guardianId}:${g.studentId}`) ? g.guardian.email : null })),
      };
    });

    await this.prismaJobs.studentExportLog.create({
      data: { id: randomUUID(), schoolId, exportedById: callerId, filter, rowCount: items.length },
    });
    return { items };
  }

  /**
   * Decision 430 item 11: the (parent, child) pairs where the parent has
   * acted at this School: holds or held any role here, enrolled the child
   * here, signed a waiver here, or was named by this School (a child invite
   * from it). Keys are "guardianId:studentId".
   */
  private async guardiansKnownHere(schoolId: string, links: Array<{ guardianId: string; studentId: string }>): Promise<Set<string>> {
    const guardianIds = [...new Set(links.map((l) => l.guardianId))];
    if (guardianIds.length === 0) return new Set();
    const [ownRoles, enrolled, signed, invited] = await Promise.all([
      this.prismaJobs.roleGrant.findMany({ where: { schoolId, userId: { in: guardianIds } }, select: { userId: true }, distinct: ['userId'] }),
      this.prismaJobs.roleGrant.findMany({
        where: { schoolId, role: 'STUDENT', grantedById: { in: guardianIds }, userId: { in: links.map((l) => l.studentId) } },
        select: { userId: true, grantedById: true },
      }),
      this.prismaJobs.waiverSignature.findMany({ where: { schoolId, signedById: { in: guardianIds } }, select: { signedById: true, studentId: true }, distinct: ['signedById', 'studentId'] }),
      this.prismaJobs.childInvite.findMany({ where: { schoolId, guardianId: { in: guardianIds } }, select: { guardianId: true }, distinct: ['guardianId'] }),
    ]);
    const anyChild = new Set([...ownRoles.map((r) => r.userId), ...invited.map((i) => i.guardianId)]);
    const pairs = new Set([...enrolled.map((r) => `${r.grantedById}:${r.userId}`), ...signed.map((w) => `${w.signedById}:${w.studentId}`)]);
    return new Set(links.filter((l) => anyChild.has(l.guardianId) || pairs.has(`${l.guardianId}:${l.studentId}`)).map((l) => `${l.guardianId}:${l.studentId}`));
  }
}

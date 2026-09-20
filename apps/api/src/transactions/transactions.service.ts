import { Injectable } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';

/**
 * Phase 9 scope only: GET /schools/{id}/transactions — School Owner/Manager only
 * (Spec 55 §7: "GET /schools/{id}/transactions, GET /transactions/{id}/invoice
 * (download)" — the invoice-download half is out of scope this phase, see the Phase
 * 9 kickoff prompt §1.b). No PATCH /transactions/{id}/confirm here — that endpoint
 * is confirmed under PaymentsModule (§7's own table), not TransactionsModule; see
 * PaymentsService.confirmTransaction.
 */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
  ) {}

  // Return type is a structural narrowing of the real row shape below, not the
  // literal shape — the DTO layer (TransactionResponseDto) is authoritative
  // for callers, this signature just satisfies cursorPaginate's generic.
  async findAllForSchool(callerId: string, schoolId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate(
        (args) =>
          tx.transaction.findMany({
            ...args,
            where: { schoolId },
            include: { student: { select: { firstName: true, surname: true } } },
          }),
        cursor,
        limit,
      ),
    );
    // Flatten the joined User fields onto the row — matches
    // TransactionResponseDto's flat convention rather than nesting `student`.
    return {
      ...page,
      items: page.items.map(({ student, ...t }) => ({ ...t, studentFirstName: student.firstName, studentSurname: student.surname })),
    };
  }
}

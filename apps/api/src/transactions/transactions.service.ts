import { Injectable } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
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
    private readonly prismaAuth: PrismaAuthService,
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
      cursorPaginate((args) => tx.transaction.findMany({ ...args, where: { schoolId } }), cursor, limit),
    );
    // Resolved via PrismaAuthService (Decision 113), not a Prisma `include` on
    // Transaction.student — an RLS-scoped include can silently fail to resolve the
    // Student's own User row once their RoleGrant is revoked (e.g.
    // GuardiansService.withdrawConsent's BASELINE cascade), even though this caller
    // is fully authorized to see the Transaction row itself. Originally shipped as
    // an `include` under Decision 109; retrofitted here — see Decision 113 for the
    // full account (found while reviewing the same pattern applied to Bookings/
    // Waitlist/RoleGrant in this same change). See resolveUserNames's own comment.
    const names = await resolveUserNames(this.prismaAuth, page.items.map((t) => t.studentId));
    return {
      ...page,
      items: page.items.map((t) => ({
        ...t,
        studentFirstName: names.get(t.studentId)?.firstName ?? '',
        studentSurname: names.get(t.studentId)?.surname ?? '',
      })),
    };
  }
}

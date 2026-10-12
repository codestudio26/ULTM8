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
 *
 * GET /transactions/me (added later, closing the TRACK-B-ROADMAP.md
 * "Explicitly blocked" gap: "Invoice/receipt viewing, Student-scoped
 * transaction history") — a Student's own self-read, same shape and
 * reasoning as BookingsService.findMyBookings: no School-Owner authorization
 * check is needed because `where: { studentId: callerId }` already scopes
 * every row to the caller's own, and Transaction's own RLS policy
 * (`transaction_school_staff_or_self`, see that migration's header comment)
 * independently enforces the same boundary — a caller can never even reach
 * another Student's row at the Postgres layer, this `where` clause is
 * defense-in-depth on top of that, not the only thing standing in the way.
 * No PDF/invoice generation here either — "receipt viewing" per the backlog
 * item's own wording means a real, readable list of each Transaction (amount,
 * currency, date, status, what it paid for), not a downloadable document;
 * there is no PDF infra anywhere in this codebase to build that against.
 */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
  ) {}

  /** Shared by findAllForSchool/findMyTransactions below — flattens the
   * `membershipPlan: { title }` include onto the row as `membershipPlanTitle`
   * (see TransactionResponseDto's own header comment for why a plain Prisma
   * `include` is safe here, unlike the User-relation join these two methods
   * each handle separately via resolveUserNames/not-at-all). */
  private withMembershipPlanTitle<T extends { membershipPlan: { title: string } }>(
    t: T,
  ): Omit<T, 'membershipPlan'> & { membershipPlanTitle: string } {
    const { membershipPlan, ...rest } = t;
    return { ...rest, membershipPlanTitle: membershipPlan.title };
  }

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
            include: { membershipPlan: { select: { title: true } } },
          }),
        cursor,
        limit,
      ),
    );
    // Resolved via PrismaAuthService (Decision 117), not a Prisma `include` on
    // Transaction.student — an RLS-scoped include can silently fail to resolve the
    // Student's own User row once their RoleGrant is revoked (e.g.
    // GuardiansService.withdrawConsent's BASELINE cascade), even though this caller
    // is fully authorized to see the Transaction row itself. Originally shipped as
    // an `include` under Decision 109; retrofitted here — see Decision 117 for the
    // full account (found while reviewing the same pattern applied to Bookings/
    // Waitlist/RoleGrant in this same change). See resolveUserNames's own comment.
    const names = await resolveUserNames(this.prismaAuth, page.items.map((t) => t.studentId));
    return {
      ...page,
      items: page.items.map((t) => ({
        ...this.withMembershipPlanTitle(t),
        studentFirstName: names.get(t.studentId)?.firstName ?? '',
        studentSurname: names.get(t.studentId)?.surname ?? '',
      })),
    };
  }

  /** GET /transactions/me — see this class's own header comment. */
  async findMyTransactions(callerId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate(
        (args) =>
          tx.transaction.findMany({
            ...args,
            where: { studentId: callerId },
            include: { membershipPlan: { select: { title: true } } },
          }),
        cursor,
        limit,
      ),
    );
    return { ...page, items: page.items.map((t) => this.withMembershipPlanTitle(t)) };
  }
}

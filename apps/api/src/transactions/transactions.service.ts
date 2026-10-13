import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { StripeClientService } from '../payments/stripe-client.service';
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
 * GET /transactions/{id}/invoice (added later, closing Spec 55 §7's own
 * explicitly-deferred half of this module) — see its own method comment
 * below for why this needed no PDF-generation infra after all.
 */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly stripeClient: StripeClientService,
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

  /**
   * GET /transactions/{id}/invoice — Spec 55 §7's own confirmed shape,
   * deferred out of this module's original scope (this class's own header
   * comment). Surfaces Stripe's own hosted receipt page
   * (`StripeClientService.getReceiptUrl` — see its own header comment for why
   * that needs no PDF-rendering infra) rather than generating a document.
   *
   * `findUnique` here, not scoped by `studentId`/`schoolId` the way
   * findAllForSchool/findMyTransactions are — this is a single-resource
   * lookup by its own id, same shape as every other "by id" method in this
   * codebase (e.g. WaiversService's own `findOne`). The RLS policy
   * (`transaction_school_staff_or_self`) already restricts which rows even
   * come back; `assertSchoolOwner` below is the same defense-in-depth
   * `findAllForSchool` already applies on top of it (not RLS-only), for a
   * clean 403 with a specific message rather than a bare 404 standing in for
   * "you're not allowed," and ALSO narrows the already-RLS-visible set
   * (self, or SCHOOL_OWNER_MANAGER) to exactly the same gate the bulk ledger
   * read uses — consistent, not a new authorization shape for this one
   * action.
   */
  async getReceiptUrl(callerId: string, transactionId: string): Promise<{ receiptUrl: string | null }> {
    const transaction = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.transaction.findUnique({
        where: { id: transactionId },
        select: { schoolId: true, studentId: true, stripePaymentIntentId: true, paymentAccount: { select: { stripeConnectedAccountId: true } } },
      }),
    );
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    if (transaction.studentId !== callerId) {
      await this.tenantAuth.assertSchoolOwner(callerId, transaction.schoolId);
    }
    // CASH/BANK_TRANSFER transactions have no Stripe charge at all — a real,
    // normal state (not every Transaction is Stripe-paid), not an error.
    if (!transaction.stripePaymentIntentId || !transaction.paymentAccount.stripeConnectedAccountId) {
      return { receiptUrl: null };
    }
    const receiptUrl = await this.stripeClient.getReceiptUrl(
      transaction.paymentAccount.stripeConnectedAccountId,
      transaction.stripePaymentIntentId,
    );
    return { receiptUrl };
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { schoolsHidingPaymentHistory } from '../member-app/member-app-switches';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { StripeClientService } from '../payments/stripe-client.service';
import { CursorPage, decodeDescCursor, encodeDescCursor, resolveLimit } from '../common/pagination/cursor-paginate';
import { TransactionFilterDto, TransactionListQueryDto } from './dto/transaction-filter-query.dto';
import { formatInvoiceNumber } from '../charges/charge-maths';
import { REVENUE_STATUSES } from '../charges/charge-reports.service';
import { IncomeCategoriesService } from '../income-categories/income-categories.service';
import { includedTax, type IncludedTax } from '../charges/tax-lines';
import { DateTime } from 'luxon';
import { freezeZone } from '../memberships/freeze/membership-freeze';

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
/** A Transaction row as the API shows it (taxSnapshot is internal: Decision 431). */
type WithPlanTitle<T> = Omit<T, 'membershipPlan' | 'booking' | 'membership' | 'charge' | 'taxSnapshot'> & {
  includedTax: IncludedTax | null;
  membershipPlanTitle: string | null;
  bookingClassTitle: string | null;
  chargeDescription: string | null;
  chargeInvoiceLabel: string | null;
};

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly stripeClient: StripeClientService,
    private readonly incomeCategories: IncomeCategoriesService,
  ) {}

  /** Shared by findAllForSchool/findMyTransactions below — flattens the
   * `membershipPlan: { title }` include onto the row as `membershipPlanTitle`
   * (see TransactionResponseDto's own header comment for why a plain Prisma
   * `include` is safe here, unlike the User-relation join these two methods
   * each handle separately via resolveUserNames/not-at-all). */
  private withMembershipPlanTitle<
    T extends {
      membershipPlan: { title: string } | null;
      booking?: { class: { title: string } } | null;
      membership?: { membershipPlan: { title: string } } | null;
      charge?: { description: string; invoiceNumber: number } | null;
    },
  >(
    t: T,
  ): WithPlanTitle<T> {
    const { membershipPlan, booking, membership, charge, ...withSnapshot } = t;
    const { taxSnapshot, ...rest } = withSnapshot as typeof withSnapshot & { taxSnapshot?: unknown };
    // Currency codes in capitals (Decision 339, T3) — belt and braces on top of
    // the write paths and the clean-up migration.
    const currency = (rest as { currency?: string | null }).currency;
    return {
      ...rest,
      ...(currency ? { currency: currency.toUpperCase() } : {}),
      // Decision 431 (MON-6 step 1): the tax a membership price included.
      includedTax: includedTax((rest as { amount?: number }).amount ?? 0, currency ?? null, taxSnapshot),
      membershipPlanTitle: membershipPlan?.title ?? membership?.membershipPlan.title ?? null,
      // A late-cancellation fee (Decision 346) names the class it was for.
      bookingClassTitle: booking?.class.title ?? null,
      // A desk payment toward a staff-created charge (Decision 338 item 9).
      chargeDescription: charge?.description ?? null,
      chargeInvoiceLabel: charge ? formatInvoiceNumber(charge.invoiceNumber) : null,
    } as unknown as WithPlanTitle<T>;
  }

  /** The Transactions page's filters (Decision 346, G3) as a Prisma filter. */
  private filterWhere(schoolId: string, f: TransactionFilterDto, timezone: string | null | undefined): Prisma.TransactionWhereInput {
    // Decision 431 (MON-7): from/to are days in the School's time zone (as the
    // billing reports count them), not UTC days: a Tokyo payment at 08:00 on
    // the 1st is on the 1st.
    const zone = freezeZone(timezone);
    const billingDate: Prisma.DateTimeFilter = {};
    if (f.from) billingDate.gte = DateTime.fromISO(f.from, { zone }).startOf('day').toJSDate();
    if (f.to) billingDate.lt = DateTime.fromISO(f.to, { zone }).startOf('day').plus({ days: 1 }).toJSDate();
    return {
      schoolId,
      // Decisions 338 item 1, 414 item 7: a cancelled payment is stored FAILED but is not a
      // failed one. FAILED means failed and not cancelled; CANCELLED, cancelled.
      ...(f.status === 'CANCELLED'
        ? { status: 'FAILED' as const, cancelledAt: { not: null } }
        : f.status === 'FAILED'
          ? { status: 'FAILED' as const, cancelledAt: null }
          : f.status
            ? { status: f.status }
            : {}),
      ...(f.paymentMethod ? { paymentMethod: f.paymentMethod } : {}),
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.membershipPlanId ? { membershipPlanId: f.membershipPlanId } : {}),
      ...(f.from || f.to ? { billingDate } : {}),
    };
  }

  /**
   * Newest first by billing date (Decision 339, T2) — the plain id-ordered
   * `cursorPaginate` sorted by random UUID, so a ledger's rows came back in no
   * useful order and today's payment could sit on page 3. Same `(sortValue, id)
   * DESC` keyset the curriculum lists use (`encodeDescCursor`).
   */
  private async pageNewestFirst(
    tx: Prisma.TransactionClient,
    where: Prisma.TransactionWhereInput,
    cursor: string | undefined,
    limit: number | undefined,
  ) {
    const take = resolveLimit(limit);
    let decoded: { sortValue: Date; id: string } | null = null;
    if (cursor) {
      try {
        decoded = decodeDescCursor(cursor);
      } catch {
        throw new BadRequestException('cursor is not valid');
      }
      if (Number.isNaN(decoded.sortValue.getTime())) throw new BadRequestException('cursor is not valid');
    }
    const rows = await tx.transaction.findMany({
      where: decoded
        ? { AND: [where, { OR: [{ billingDate: { lt: decoded.sortValue } }, { billingDate: decoded.sortValue, id: { lt: decoded.id } }] }] }
        : where,
      include: {
        membershipPlan: { select: { title: true, incomeCategoryId: true } },
        booking: { select: { class: { select: { title: true } } } },
        // Decision 404: a freeze fee names the frozen membership's plan.
        membership: { select: { membershipPlan: { select: { title: true } } } },
        // Decision 338 item 9: a desk payment names the charge it paid.
        charge: { select: { description: true, invoiceNumber: true, incomeCategoryId: true } },
      },
      orderBy: [{ billingDate: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore ? encodeDescCursor(last.billingDate, last.id) : null };
  }

  // Return type is a structural narrowing of the real row shape below, not the
  // literal shape — the DTO layer (TransactionResponseDto) is authoritative
  // for callers.
  async findAllForSchool(callerId: string, schoolId: string, query: TransactionListQueryDto = {}): Promise<CursorPage<{ id: string }>> {
    const school = await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    this.assertDateRange(query);
    const where = this.filterWhere(schoolId, query, school.timezone);
    const page = await this.prismaApp.withTenantContext(callerId, (tx) => this.pageNewestFirst(tx, where, query.cursor, query.limit));
    // Resolved via PrismaAuthService (Decision 117), not a Prisma `include` on
    // Transaction.student — an RLS-scoped include can silently fail to resolve the
    // Student's own User row once their RoleGrant is revoked (e.g.
    // GuardiansService.withdrawConsent's BASELINE cascade), even though this caller
    // is fully authorized to see the Transaction row itself. Originally shipped as
    // an `include` under Decision 109; retrofitted here — see Decision 117 for the
    // full account (found while reviewing the same pattern applied to Bookings/
    // Waitlist/RoleGrant in this same change). See resolveUserNames's own comment.
    const names = await resolveUserNames(this.prismaAuth, [
      ...page.items.map((t) => t.studentId),
      ...page.items.map((t) => t.cancelledById).filter((id): id is string => !!id),
    ]);
    const fullName = (id: string | null) => {
      const n = id ? names.get(id) : undefined;
      return n ? `${n.firstName} ${n.surname}`.trim() : null;
    };
    // Decision 316 item 10: the income category of the plan or charge each
    // payment is for, as it is now (the export shows it). Read on the jobs
    // connection for this School only, after the owner check above.
    const categoryOf = (t: (typeof page.items)[number]) => t.membershipPlan?.incomeCategoryId ?? t.charge?.incomeCategoryId ?? null;
    const categoryNames = await this.incomeCategories.namesFor(schoolId, page.items.map(categoryOf));
    return {
      ...page,
      items: page.items.map((t) => ({
        ...this.withMembershipPlanTitle(t),
        incomeCategoryName: categoryNames.get(categoryOf(t) ?? '') ?? null,
        studentFirstName: names.get(t.studentId)?.firstName ?? '',
        studentSurname: names.get(t.studentId)?.surname ?? '',
        // Decision 338 item 1: who cancelled it, for staff.
        cancelledByName: fullName(t.cancelledById),
      })),
    };
  }

  /** GET /transactions/me — see this class's own header comment. A cancelled
   * payment says when, never who or why: the reason is for staff only
   * (Decision 338 item 1). */
  async findMyTransactions(callerId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    // Decision 318 item 7: a School can hide payment history from its members.
    const mySchools = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.transaction.findMany({ where: { studentId: callerId }, distinct: ['schoolId'], select: { schoolId: true } }),
    );
    const hidden = await schoolsHidingPaymentHistory(this.prismaJobs, mySchools.map((r) => r.schoolId));
    const where: Prisma.TransactionWhereInput = hidden.length ? { studentId: callerId, schoolId: { notIn: hidden } } : { studentId: callerId };
    const page = await this.prismaApp.withTenantContext(callerId, (tx) => this.pageNewestFirst(tx, where, cursor, limit));
    return {
      ...page,
      items: page.items.map((t) => ({ ...this.withMembershipPlanTitle(t), cancelledById: null, cancelledByName: null, cancelReason: null, incomeCategoryName: null })),
    };
  }

  /**
   * GET /schools/{id}/transactions/summary (Decision 339, T1) — the page's
   * tiles, counted over the whole ledger on the server. The page used to add up
   * whichever 20 rows it had loaded, so every tile was wrong once a School had
   * more. Revenue is what the School kept, one figure per currency (codes are
   * compared in capitals: rows written before Decision 339 may be lower-case):
   * Successful and Refunded rows less what was refunded on each (Decision 446
   * item 4, the billing overview's rule, REVENUE_STATUSES).
   */
  async summaryForSchool(callerId: string, schoolId: string, filter: TransactionFilterDto = {}) {
    const school = await this.schoolsService.findOne(callerId, schoolId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    this.assertDateRange(filter);
    const where = this.filterWhere(schoolId, filter, school.timezone);
    const groups = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.transaction.groupBy({ by: ['status', 'currency'], where, _count: { _all: true }, _sum: { amount: true } }),
    );
    // Decisions 338 item 1, 414 item 7: cancelled payments are stored FAILED; they are
    // counted on their own, not as failed ones.
    const cancelled = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.transaction.count({ where: { AND: [where, { status: 'FAILED', cancelledAt: { not: null } }] } }),
    );
    // Decision 446 item 4: each Successful or Refunded row at its amount less
    // what was refunded on it, as the billing overview counts it. A row
    // refunded as much as its amount or more (the surcharge too) counts
    // nothing, so it is left out here rather than counted below zero.
    const kept = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.transaction.groupBy({
        by: ['currency'],
        where: {
          AND: [
            where,
            { status: { in: [...REVENUE_STATUSES] } },
            { OR: [{ refundedAmount: null }, { refundedAmount: { lt: tx.transaction.fields.amount } }] },
          ],
        },
        _sum: { amount: true, refundedAmount: true },
      }),
    );
    const count = (statuses: string[]) => groups.filter((g) => statuses.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
    const revenue = new Map<string, number>();
    for (const g of groups) {
      if (g.status !== 'SUCCESSFUL') continue;
      revenue.set((g.currency ?? '').toUpperCase(), 0);
    }
    for (const g of kept) {
      const key = (g.currency ?? '').toUpperCase();
      revenue.set(key, (revenue.get(key) ?? 0) + (g._sum.amount ?? 0) - (g._sum.refundedAmount ?? 0));
    }
    return {
      total: groups.reduce((n, g) => n + g._count._all, 0),
      successful: count(['SUCCESSFUL']),
      pending: count(['PENDING']),
      failedOrDisputed: count(['FAILED', 'DISPUTED']) - cancelled,
      cancelled,
      revenue: [...revenue.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, amount]) => ({ currency: currency || null, amount })),
    };
  }

  private assertDateRange(f: TransactionFilterDto) {
    if (f.from && f.to && f.from > f.to) {
      throw new BadRequestException('The start date must be on or before the end date.');
    }
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
    } else if ((await schoolsHidingPaymentHistory(this.prismaJobs, [transaction.schoolId])).length > 0) {
      // Decision 318 item 7: hidden from the member, as in their list.
      throw new NotFoundException('Transaction not found');
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

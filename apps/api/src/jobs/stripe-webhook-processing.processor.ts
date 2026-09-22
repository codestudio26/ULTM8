import { Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Prisma, Transaction, FranchiseFeeCharge, PlatformCharge } from '@prisma/client';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { StripeClientService } from '../payments/stripe-client.service';
import { NOTIFICATION_FANOUT_QUEUE, STRIPE_WEBHOOK_PROCESSING_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

type WebhookJobData = { stripeEventId: string; eventType: string; objectId: string; stripeAccountId?: string };

/**
 * Decision 111 — the two real, external-facing side effects a `charge.dispute.*`
 * webhook can produce: a School Owner/Manager or Franchise Owner notification, and
 * a Membership Subscription cancellation on a lost dispute. Returned by
 * dispatch()/handleChargeDispute() rather than carried out inline — see
 * process()'s own comment for why these only ever run AFTER the DB transaction
 * they're derived from has actually committed, never from inside it.
 */
type DisputeSideEffects = {
  notifications: NotificationFanoutJobData[];
  subscriptionCancellations: { connectedAccountId: string; subscriptionId: string }[];
};

/**
 * Consumes the `stripe-webhook-processing` queue — the dedup+handling half of Spec
 * 55 §10.2's confirmed webhook flow; signature verification and enqueueing happen
 * upstream in PaymentsService.handleIncomingWebhook, not here.
 *
 * Runs via `PrismaJobsService` (`ultm8_jobs` role) — see this phase's migration for
 * the additive SELECT/INSERT/UPDATE policies granted on MembershipPlan/Membership/
 * Transaction specifically for this job (unrestricted `USING/WITH CHECK (true)`,
 * matching class-occurrence-generation's own established shape for a no-single-
 * caller background job triggered by a global event, not a School-scoped request).
 * Phase 16b-ii's own migration additively granted the equivalent for
 * FranchiseFeeCharge + a narrow School/Franchise column set; Phase 54's migration
 * does the same for PlatformCharge + Franchise/School's own
 * platformSubscriptionStatus column specifically (School's own grant was already
 * unrestricted from Phase 16b-ii; Franchise's needed one new column added to its
 * existing narrow grant).
 *
 * **Phase 9 is the first real handler** — Phase 8 shipped this as a deliberate no-op
 * logger with no per-event-type branching at all. Structured as specific-case-plus-
 * safe-default, not an exhaustive enumeration: Stripe delivers event types this
 * codebase doesn't name a handler for (customer.subscription.updated — see below),
 * and the safe default is exactly Phase 8's old behavior (dedup, log, return), so
 * an unhandled type is inert, never a crash.
 *
 * **Decision 111 — charge.dispute.created/updated/closed are real handlers now**,
 * no longer the safe default. See handleChargeDispute's own comment for the full
 * account (Decision 55's confirmed contract: idempotent status-driven processing
 * across Transaction/FranchiseFeeCharge/PlatformCharge, Membership force-Expiry +
 * Subscription cancellation on a lost Membership-purchase dispute, notification
 * routed by who's financially exposed).
 *
 * **Ordering fix**: Phase 8's own header comment flagged a real ordering gap — the
 * dedup INSERT committed before the (then nonexistent) handler logic ran, so a
 * handler failure after dedup would make a BullMQ retry see "already processed" and
 * silently skip the event. Restructured here exactly as that comment asked:
 * the dedup INSERT and the handler's own writes now run inside ONE
 * `prismaJobs.$transaction`, so a handler failure rolls back the dedup row too — a
 * retry sees a fresh (non-deduped) event and tries again, rather than silently
 * losing it.
 */
@Processor(STRIPE_WEBHOOK_PROCESSING_QUEUE)
export class StripeWebhookProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(StripeWebhookProcessingProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly stripeClient: StripeClientService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly notificationFanoutQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { stripeEventId, eventType, objectId, stripeAccountId } = job.data;

    // Phase 16b-ii addition — pre-fetched OUTSIDE the DB transaction below,
    // deliberately: an external Stripe API call has no place holding a DB
    // transaction open. Only invoice.paid/invoice.payment_failed need this —
    // see handleInvoicePaid's own comment for why the queue payload alone
    // (objectId = the Invoice id) isn't enough for these two specifically,
    // unlike every other handler in this file, which only ever matches an id
    // against a stored correlator column.
    //
    // FOUND ON REVIEW, independently by three separate review angles, before
    // this ever shipped: a first draft silently no-op'd (dispatch()'s own
    // `if (invoice)` guard) whenever `stripeAccountId` was missing from the
    // job payload — with NO log line at all, and the event still got marked
    // processed by the dedup INSERT below (which doesn't depend on `invoice`).
    // That's the exact "silently swallowed money-relevant event" failure mode
    // this file's own `isProcessedStripeEventConflict` comment already says
    // this codebase should never allow again. `event.account`
    // (payments.service.ts's own `handleIncomingWebhook`) should always be
    // populated for these two event types — every Stripe call this codebase
    // makes for a franchise-fee Subscription uses `scopedClient()` — so a
    // missing `stripeAccountId` here is a genuine anomaly, not an expected
    // case to quietly tolerate. Fixed by throwing instead: the dedup
    // transaction below never commits, and BullMQ's own retry + eventual
    // `onFailed` alarm (already wired below) surfaces it loudly, the same way
    // every other real failure in this file already does.
    let invoice: Stripe.Invoice | undefined;
    if (eventType === 'invoice.paid' || eventType === 'invoice.payment_failed') {
      if (!stripeAccountId) {
        throw new Error(
          `${eventType} for object ${objectId} (event ${stripeEventId}) arrived with no stripeAccountId on the job payload — cannot fetch its Invoice, refusing to silently mark this event processed.`,
        );
      }
      // Decision 111 — `expand: ['payments']` added so handleInvoicePaid can
      // capture the PaymentIntent id behind this Invoice (see that method's own
      // comment for why this is the only reachable correlator path).
      invoice = await this.stripeClient.scopedClient(stripeAccountId).invoices.retrieve(objectId, { expand: ['payments'] });
    }

    // Decision 111 — same "pre-fetch outside the transaction" discipline as the
    // invoice fetch above, for the identical reason (an external Stripe API call
    // has no place holding a DB transaction open): the queue payload's `objectId`
    // for a charge.dispute.* event is the Dispute's OWN id (payments.service.ts's
    // handleIncomingWebhook sets objectId = event.data.object.id uniformly), so
    // the full Dispute object — in particular its `payment_intent` correlator —
    // has to be fetched here, exactly like the Invoice fetch above. Unlike
    // invoice.paid/invoice.payment_failed, a MISSING `stripeAccountId` here is the
    // EXPECTED case, not an anomaly: a platform-billed (PlatformCharge) dispute
    // has no connected account at all, so platformClient() is used instead of
    // throwing.
    let dispute: Stripe.Dispute | undefined;
    if (eventType === 'charge.dispute.created' || eventType === 'charge.dispute.updated' || eventType === 'charge.dispute.closed') {
      const client = stripeAccountId ? this.stripeClient.scopedClient(stripeAccountId) : this.stripeClient.platformClient();
      dispute = await client.disputes.retrieve(objectId);
    }

    let sideEffects: DisputeSideEffects = { notifications: [], subscriptionCancellations: [] };
    try {
      await this.prismaJobs.$transaction(async (tx) => {
        await tx.processedStripeEvent.create({ data: { stripeEventId, eventType } });
        sideEffects = await this.dispatch(tx, eventType, objectId, stripeEventId, invoice, dispute);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && this.isProcessedStripeEventConflict(err)) {
        this.logger.log(`Stripe event ${stripeEventId} (${eventType}) already processed — skipping (redelivery).`);
        return;
      }
      throw err;
    }

    // Decision 111 — a dispute's own notification/Subscription-cancellation side
    // effects are carried out ONLY here, after the transaction above has actually
    // committed, never from inside dispatch()/handleChargeDispute(). Neither
    // BullMQ (Redis) nor Stripe's own API participates in the Postgres
    // transaction, so performing either one before the transaction is known to
    // have committed would risk a real notification/cancellation for a DB write
    // that then rolled back.
    //
    // FLAGGED, not fully closed: a process crash in the narrow window between the
    // transaction committing and this code running would still lose these side
    // effects permanently — the dedup row committed above means a BullMQ retry of
    // this same event would just see "already processed" (the catch block above)
    // and skip straight past this code, never re-attempting it. Same class of
    // narrow, documented, out-of-scope gap FranchiseFeesService.refund()'s own
    // comment already accepts for an analogous post-Stripe-call reconciliation
    // window, not solved here either. A failure in the loop/enqueue below is
    // caught and logged rather than thrown for the identical reason: letting it
    // propagate would mark this BullMQ job failed and trigger a retry, but that
    // retry can never reach this code again either (same dedup-row blocker) — so
    // throwing here would only turn a real failure into a *second*, misleading
    // "permanently failed" alarm from onFailed, not a genuine chance to recover.
    try {
      for (const cancellation of sideEffects.subscriptionCancellations) {
        await this.stripeClient.scopedClient(cancellation.connectedAccountId).subscriptions.cancel(cancellation.subscriptionId);
      }
      if (sideEffects.notifications.length > 0) {
        await this.notificationFanoutQueue.addBulk(
          sideEffects.notifications.map((notification) => ({
            name: 'notify',
            data: notification,
            opts: { jobId: notification.notificationId, attempts: 3, backoff: { type: 'exponential' as const, delay: 5000 } },
          })),
        );
      }
    } catch (err) {
      this.logger.error(
        `Stripe event ${stripeEventId} (${eventType}) — DB write committed but a post-commit side effect (Subscription cancellation or notification fan-out) failed and cannot be retried (the dedup row already committed). Needs manual follow-up.`,
        err as Error,
      );
    }
  }

  /**
   * FOUND ON REVIEW (independently by 4 review angles) — an earlier draft defaulted
   * to `true` (treat as the benign ProcessedStripeEvent dedup redelivery, safe to
   * swallow) whenever `err.meta?.target` wasn't an array. That's backwards: this
   * catch block now wraps not just the dedup INSERT but every handler's own writes
   * too, including `handlePaymentIntentSucceeded`'s `tx.membership.create()` against
   * `Membership_one_active_general_access_per_school` — a hand-authored partial
   * unique index with no `@@unique` in schema.prisma, so Prisma's engine has no
   * column-name mapping for it and may report `meta.target` in a shape this code
   * can't confidently parse as an array. Defaulting `true` there would silently
   * swallow the exact real, money-relevant collision that method's own header
   * comment spends a paragraph explaining must propagate loudly instead. Defaulting
   * to `false` (rethrow, let BullMQ retry, eventually alarm via onFailed) is the
   * safe direction to be wrong in: worst case a genuine redelivery gets one
   * spurious retry-and-refail cycle before permanently failing loudly; the old
   * default's worst case was a real payment/Membership inconsistency vanishing
   * with no alert at all.
   */
  private isProcessedStripeEventConflict(err: Prisma.PrismaClientKnownRequestError): boolean {
    const target = err.meta?.target;
    return Array.isArray(target) && target.includes('stripeEventId');
  }

  /** `tx` is the interactive-transaction client from `process()`'s own
   * `$transaction` call — every handler below writes through it, never through
   * `this.prismaJobs` directly, so a handler's writes commit-or-rollback atomically
   * with the dedup row above. */
  private async dispatch(
    tx: Prisma.TransactionClient,
    eventType: string,
    objectId: string,
    stripeEventId: string,
    invoice: Stripe.Invoice | undefined,
    dispute: Stripe.Dispute | undefined,
  ): Promise<DisputeSideEffects> {
    const noSideEffects: DisputeSideEffects = { notifications: [], subscriptionCancellations: [] };
    switch (eventType) {
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(tx, objectId);
        return noSideEffects;
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(tx, objectId);
        return noSideEffects;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(tx, objectId);
        return noSideEffects;
      // Phase 16b-ii — real handlers, no longer safe-default no-ops. Decision
      // 6's own "invoice.paid does NOT create a Membership" reasoning (still
      // true, unchanged) was never a blanket "invoice.paid has no role" —
      // FranchiseFeeCharge is a genuinely different entity with a genuinely
      // different creation-timing shape (Spec 55 §6.1: one row PER BILLING
      // CYCLE, not once per relationship the way Membership is), and these two
      // events are its own confirmed trigger (§10.2). See each handler's own
      // comment for the full account, including why they don't touch
      // Membership/Transaction at all — a franchise-fee invoice and a
      // Membership invoice are distinguished by which correlator (School vs
      // Transaction) actually matches, never by branching on event type alone.
      case 'invoice.paid':
      case 'invoice.payment_failed':
        // `invoice` is guaranteed set here — process() now throws before ever
        // reaching dispatch() for these two event types if it couldn't fetch
        // one (see process()'s own comment). This check exists purely as a
        // defensive backstop against a future refactor reintroducing the
        // silent-drop gap that comment describes — if it ever somehow fires,
        // fail loudly, don't repeat that mistake a second time.
        if (!invoice) {
          throw new Error(`dispatch() reached ${eventType} (event ${stripeEventId}) with no Invoice — this should be unreachable; see process()'s own guard.`);
        }
        if (eventType === 'invoice.paid') {
          await this.handleInvoicePaid(tx, invoice);
        } else {
          await this.handleInvoicePaymentFailed(tx, invoice);
        }
        return noSideEffects;
      // Decision 111 — real handler, no longer a safe-default no-op. See
      // handleChargeDispute's own comment for the full account.
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
        // Same "guaranteed set, defensive backstop only" reasoning as the
        // Invoice guard above — process() throws first if it couldn't fetch one.
        if (!dispute) {
          throw new Error(`dispatch() reached ${eventType} (event ${stripeEventId}) with no Dispute — this should be unreachable; see process()'s own guard.`);
        }
        return this.handleChargeDispute(tx, dispute, stripeEventId);
      // Safe default — see this file's own header comment for why this stays
      // log-only: nothing built yet reacts differently to past_due vs Active
      // beyond what customer.subscription.deleted already covers on cancellation.
      case 'customer.subscription.updated':
      default:
        this.logger.log(`Stripe event ${stripeEventId} (${eventType}) received and recorded — no handler for this type yet.`);
        return noSideEffects;
    }
  }

  /**
   * Decision 6's confirmed Membership-creation trigger, for ALL plan types
   * including SUBSCRIPTION (see MembershipsService.purchase()'s own comment on why
   * invoice.paid does NOT also get this role). `objectId` is the PaymentIntent id —
   * looked up against Transaction.stripePaymentIntentId, the correlation column
   * MembershipsService.purchase() sets at Transaction-creation time.
   */
  private async handlePaymentIntentSucceeded(tx: Prisma.TransactionClient, paymentIntentId: string): Promise<void> {
    const transaction = await tx.transaction.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
    if (!transaction) {
      this.logger.warn(`payment_intent.succeeded for ${paymentIntentId} — no matching Transaction found. Ignoring (not a Membership purchase this platform created).`);
      return;
    }
    if (transaction.status !== 'PENDING') {
      // Already settled by an earlier delivery of this same event, or a duplicate
      // payment_intent.succeeded Stripe occasionally sends for the same intent —
      // idempotent no-op, not an error.
      return;
    }

    const updateResult = await tx.transaction.updateMany({
      where: { id: transaction.id, status: 'PENDING' },
      data: { status: 'SUCCESSFUL' },
    });
    if (updateResult.count === 0) {
      return; // lost a race with a concurrent delivery — the other one already won.
    }

    const plan = await tx.membershipPlan.findUniqueOrThrow({ where: { id: transaction.membershipPlanId } });

    // Deliberately NOT caught here. An earlier draft of this method wrapped this
    // create() in its own try/catch to swallow a P2002 collision (Spec 55 §11.5's
    // two-simultaneous-Active-Memberships constraint) and log-and-continue within
    // the SAME transaction — that doesn't work: once any statement inside a
    // Postgres transaction errors, the whole transaction is aborted at the
    // database level regardless of a JS-level try/catch, so "catch and keep going"
    // would have left the surrounding `tx.transaction.updateMany` above and the
    // dedup INSERT in `process()` unable to commit either, throwing a confusing
    // second error instead of the clean rollback this comment now documents.
    // Letting it propagate is correct: the WHOLE transaction (dedup row + the
    // Transaction status flip above + this create) rolls back together — the
    // Transaction row stays PENDING (not falsely SUCCESSFUL-with-no-Membership),
    // and since the dedup row never committed, BullMQ's retry sees a fresh event
    // and tries the whole thing again. The business condition causing the
    // collision won't have changed between retries, so this repeats until BullMQ's
    // attempts exhaust and `onFailed` below logs it loudly and permanently — an
    // honest, visible failure rather than a silently-swallowed one.
    //
    // Spec 55 §6.1's confirmed collision handling is a Stripe Refund API call (and,
    // for a Subscription, cancelling it too) — NOT built here: this processor has
    // no StripeClientService wired up this phase, and an unverified money-moving
    // Stripe call inside this already-large phase risks shipping something
    // untested. TODO(Phase 9 follow-up): inject StripeClientService here and issue
    // the refund/cancel automatically instead of relying on `onFailed`'s log alone.
    const membership = await tx.membership.create({
      data: {
        id: randomUUID(),
        studentId: transaction.studentId,
        membershipPlanId: transaction.membershipPlanId,
        schoolId: transaction.schoolId,
        frequency: plan.type === 'SUBSCRIPTION' ? 'RECURRING' : 'ONE_TIME',
        classesRemaining: plan.classesIncluded ?? undefined,
        expiryDate: plan.expiryDurationDays ? new Date(Date.now() + plan.expiryDurationDays * 24 * 60 * 60 * 1000) : undefined,
        scopedClassId: plan.scopedClassId,
        stripeSubscriptionId: transaction.stripeSubscriptionId ?? undefined,
      },
    });
    await tx.transaction.update({ where: { id: transaction.id }, data: { membershipId: membership.id } });
  }

  /** payment_intent.payment_failed — flips a PENDING Transaction to FAILED. No
   * Membership was ever created for this Transaction (Decision 6), so nothing else
   * to undo. */
  private async handlePaymentIntentFailed(tx: Prisma.TransactionClient, paymentIntentId: string): Promise<void> {
    const transaction = await tx.transaction.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
    if (!transaction || transaction.status !== 'PENDING') {
      return;
    }
    await tx.transaction.updateMany({ where: { id: transaction.id, status: 'PENDING' }, data: { status: 'FAILED' } });
  }

  /**
   * Spec 55 §6.1 (quoted): "a failed renewal charge... Stripe's own retry schedule
   * keeps the Membership Active while... past_due, Expiring it... only once Stripe
   * exhausts retries and cancels the subscription." `customer.subscription.deleted`
   * fires exactly at that final-cancellation point (both voluntary cancellation and
   * exhausted-retries land here identically per that same confirmed text).
   *
   * The "same-day sweep cancels the Student's own future Bookings" half of this
   * rule is NOT built here — Booking doesn't exist in this codebase yet (Phase 11).
   */
  private async handleSubscriptionDeleted(tx: Prisma.TransactionClient, subscriptionId: string): Promise<void> {
    const membership = await tx.membership.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
    if (membership && membership.status === 'ACTIVE') {
      await tx.membership.updateMany({ where: { id: membership.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
      this.logger.log(
        `Membership ${membership.id} (Student ${membership.studentId}) Expired on subscription cancellation (${subscriptionId}). ` +
          'Booking sweep NOT run — Booking does not exist in this codebase yet (Phase 11 scope).',
      );
      return;
    }

    // Phase 16b-ii — not every cancelled Subscription is a Membership's; a
    // franchise-fee Subscription (FranchiseFeeBillingService.ensureSubscription)
    // reaching final cancellation lands here identically (Stripe fires
    // customer.subscription.deleted the same way for both). Correlated by
    // School.stripeFranchiseFeeSubscriptionId, not re-checked against
    // Membership again — the two correlator columns can never both match the
    // same subscriptionId, so this is a genuine either/or, not a fallback
    // guess. stripeFranchiseFeeSubscriptionId itself is deliberately NOT
    // cleared — kept as the historical correlator, same "never clear a Stripe
    // id after cancellation, only flip status" convention
    // Membership.stripeSubscriptionId's own handling above already follows.
    const franchiseFeeSchool = await tx.school.findUnique({ where: { stripeFranchiseFeeSubscriptionId: subscriptionId } });
    if (franchiseFeeSchool) {
      await tx.school.updateMany({ where: { id: franchiseFeeSchool.id }, data: { franchiseFeeSubscriptionStatus: 'CANCELED' } });
      this.logger.log(`School ${franchiseFeeSchool.id}'s franchise-fee Subscription (${subscriptionId}) Canceled.`);
      return;
    }

    // Phase 54 — a third, genuinely different Subscription kind can reach
    // customer.subscription.deleted identically: a platform SubscriptionPlan
    // Subscription, School- or Franchise-side (either may subscribe
    // independently, Spec 55 §6.1). Same either/or correlator-column reasoning
    // as the franchise-fee branch above — stripePlatformSubscriptionId can never
    // also match a Membership or franchise-fee Subscription id.
    const platformSchool = await tx.school.findUnique({ where: { stripePlatformSubscriptionId: subscriptionId } });
    if (platformSchool) {
      await tx.school.updateMany({ where: { id: platformSchool.id }, data: { platformSubscriptionStatus: 'CANCELED' } });
      this.logger.log(`School ${platformSchool.id}'s platform SubscriptionPlan Subscription (${subscriptionId}) Canceled — portal access now read-only.`);
      return;
    }
    const platformFranchise = await tx.franchise.findUnique({ where: { stripePlatformSubscriptionId: subscriptionId } });
    if (platformFranchise) {
      await tx.franchise.updateMany({ where: { id: platformFranchise.id }, data: { platformSubscriptionStatus: 'CANCELED' } });
      this.logger.log(`Franchise ${platformFranchise.id}'s platform SubscriptionPlan Subscription (${subscriptionId}) Canceled.`);
    }
  }

  /**
   * FranchiseFeeCharge's own confirmed creation trigger (Spec 55 §10.2) — a
   * genuinely different creation-timing shape from every other billing entity
   * in this codebase: one row per BILLING CYCLE, not once per relationship
   * (Membership's own shape). `invoice` is pre-fetched in `process()` (see that
   * method's own comment for why the queue payload's bare `objectId` — the
   * Invoice id — isn't enough on its own: nothing else in this file's handlers
   * has ever needed to call back into Stripe before now, only match ids
   * against stored correlator columns).
   *
   * Three distinct correlator paths tried in turn, matching FranchiseFeeCharge/
   * PlatformCharge's own schema.prisma comments exactly:
   *  - Per-Headcount franchise-fee: the franchise-fee-usage-reporting job already
   *    created a PENDING row (with the activeStudentCountSnapshot captured at
   *    report-time — not recoverable from this webhook's own payload) — find
   *    the most recent one for this subscription and flip it to Successful.
   *  - Flat franchise-fee (or a defensive fallback if no Pending row exists for
   *    some other reason): nothing was snapshotted in advance — create the row
   *    directly, already Successful, using the Invoice's own period/amount/
   *    currency.
   *  - Platform SubscriptionPlan (Phase 54, tried last, once neither
   *    franchise-fee path matches): same "nothing snapshotted in advance,
   *    create directly" shape as the Flat case — creates a PlatformCharge row
   *    instead of a FranchiseFeeCharge one, correlated against School OR
   *    Franchise's own stripePlatformSubscriptionId rather than School's
   *    stripeFranchiseFeeSubscriptionId. See SubscriptionPlan/PlatformCharge's
   *    own schema.prisma comments for the full field-by-field account.
   */
  private async handleInvoicePaid(tx: Prisma.TransactionClient, invoice: Stripe.Invoice): Promise<void> {
    const subRef = invoice.parent?.subscription_details?.subscription;
    const subscriptionId = typeof subRef === 'string' ? subRef : subRef?.id;
    if (!subscriptionId) {
      return; // a one-off, non-subscription invoice — never ours (franchise fees are always subscription-billed)
    }
    // Decision 111 — captured here (requires `expand: ['payments']` on the fetch
    // in process()) and stored on the row this method creates/updates, so a later
    // charge.dispute.* webhook (payment_intent-keyed only) can find it. See
    // extractPaymentIntentId's own comment for why this forward path — never a
    // reverse Charge/PaymentIntent -> Invoice lookup — is the only one that exists
    // in the installed Stripe API version.
    const paymentIntentId = this.extractPaymentIntentId(invoice);

    const pending = await tx.franchiseFeeCharge.findFirst({
      where: { stripeSubscriptionId: subscriptionId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      // FOUND ON REVIEW: `amount` is deliberately NOT overwritten with
      // `invoice.amount_paid` here, unlike the fallback branch below — the
      // Per-Headcount row's amount was already computed by
      // franchise-fee-usage-reporting.processor.ts's own usageReportPass() at
      // report-time, from that same job's own reasoning about what Stripe
      // should charge. Review flagged a real, if narrow, risk this doesn't
      // fully close: if `Franchise.perHeadcountRate` changes between when the
      // Meter/Price was first created and now (FranchisesService.update()'s
      // own guard, added the same review pass, blocks this ONCE billing has
      // started — but can't retroactively fix a Price created before that
      // guard existed, or any other Stripe-side proration/rounding
      // difference), the locally-recorded `amount` and Stripe's real
      // `invoice.amount_paid` could genuinely disagree. Not silently trusted
      // either way — logged loudly here so a real mismatch is visible and
      // investigable, rather than reconciled by a guess at which value is
      // "more correct."
      if (pending.amount !== invoice.amount_paid) {
        this.logger.error(
          `FranchiseFeeCharge ${pending.id} (subscription ${subscriptionId}) was recorded with amount ${pending.amount} but Stripe's invoice.amount_paid is ${invoice.amount_paid} — these should always match. NOT auto-corrected; needs investigation.`,
        );
      }
      await tx.franchiseFeeCharge.update({
        where: { id: pending.id },
        data: { status: 'SUCCESSFUL', stripeInvoiceId: invoice.id, stripePaymentIntentId: paymentIntentId },
      });
      await tx.school.updateMany({
        where: { stripeFranchiseFeeSubscriptionId: subscriptionId, franchiseFeeSubscriptionStatus: { not: 'ACTIVE' } },
        data: { franchiseFeeSubscriptionStatus: 'ACTIVE' },
      });
      return;
    }

    const franchiseFeeSchool = await tx.school.findUnique({ where: { stripeFranchiseFeeSubscriptionId: subscriptionId } });
    if (franchiseFeeSchool && franchiseFeeSchool.franchiseId) {
      const franchise = await tx.franchise.findUniqueOrThrow({ where: { id: franchiseFeeSchool.franchiseId } });
      const paymentAccount = await tx.paymentAccount.findUnique({ where: { franchiseId: franchise.id } });
      if (!paymentAccount) {
        this.logger.error(`invoice.paid for School ${franchiseFeeSchool.id}'s Franchise ${franchise.id} — no PaymentAccount found, cannot record a FranchiseFeeCharge.`);
        return;
      }
      await tx.franchiseFeeCharge.create({
        data: {
          id: randomUUID(),
          franchiseId: franchise.id,
          schoolId: franchiseFeeSchool.id,
          franchisePaymentAccountId: paymentAccount.id,
          billingPeriodStart: new Date(invoice.period_start * 1000),
          billingPeriodEnd: new Date(invoice.period_end * 1000),
          feeBasisSnapshot: franchise.feeModel,
          amount: invoice.amount_paid,
          currency: invoice.currency?.toUpperCase() ?? 'USD',
          status: 'SUCCESSFUL',
          stripeInvoiceId: invoice.id,
          stripeSubscriptionId: subscriptionId,
          stripePaymentIntentId: paymentIntentId,
        },
      });
      await tx.school.updateMany({
        where: { stripeFranchiseFeeSubscriptionId: subscriptionId, franchiseFeeSubscriptionStatus: { not: 'ACTIVE' } },
        data: { franchiseFeeSubscriptionStatus: 'ACTIVE' },
      });
      return;
    }

    // Phase 54 — PlatformCharge's own confirmed creation trigger, the exact same
    // shape the franchise-fee Flat branch above already uses: nothing was
    // snapshotted in advance (no usage-reporting job exists for platform
    // SubscriptionPlan billing — it's a flat plan price, not metered), so the
    // row is created directly, already Successful, from the Invoice's own
    // amount/currency. Either the School side or the Franchise side matches,
    // never both (their stripePlatformSubscriptionId values can never collide).
    const platformSchool = await tx.school.findUnique({ where: { stripePlatformSubscriptionId: subscriptionId } });
    const platformFranchise = platformSchool ? null : await tx.franchise.findUnique({ where: { stripePlatformSubscriptionId: subscriptionId } });
    if (!platformSchool && !platformFranchise) {
      this.logger.warn(`invoice.paid for subscription ${subscriptionId} (invoice ${invoice.id}) — no matching School, Franchise, or franchise-fee relationship found. Ignoring (not a Subscription this platform created).`);
      return;
    }

    await tx.platformCharge.create({
      data: {
        id: randomUUID(),
        schoolId: platformSchool?.id,
        franchiseId: platformFranchise?.id,
        chargeType: 'SUBSCRIPTION_PLAN_FEE',
        amount: invoice.amount_paid,
        currency: invoice.currency?.toUpperCase() ?? 'USD',
        status: 'SUCCESSFUL',
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: subscriptionId,
        stripePaymentIntentId: paymentIntentId,
      },
    });

    if (platformSchool) {
      await tx.school.updateMany({
        where: { id: platformSchool.id, platformSubscriptionStatus: { not: 'ACTIVE' } },
        data: { platformSubscriptionStatus: 'ACTIVE' },
      });
    } else if (platformFranchise) {
      await tx.franchise.updateMany({
        where: { id: platformFranchise.id, platformSubscriptionStatus: { not: 'ACTIVE' } },
        data: { platformSubscriptionStatus: 'ACTIVE' },
      });
    }
  }

  /** Flips an existing PENDING FranchiseFeeCharge (Per-Headcount case only —
   * see handleInvoicePaid's own comment) to Failed. Flat case: no pre-existing
   * Pending row to flip — Stripe's own Smart Retry schedule keeps attempting
   * automatically (Spec 55 §10.2's confirmed "lean on Stripe's own retry, not a
   * custom BullMQ one" reasoning, same as Membership's own renewal retries) —
   * nothing to record until either a later invoice.paid succeeds or the
   * Subscription is eventually cancelled (handleSubscriptionDeleted, above).
   *
   * FLAGGED ON REVIEW, not fixed: the trailing `franchiseFeeSubscriptionStatus`
   * write below is unconditional, unlike `handleInvoicePaid`'s own guarded
   * equivalent (`{ not: 'ACTIVE' }`). Stripe doesn't strictly guarantee webhook
   * delivery order, and a delayed `invoice.payment_failed` for a charge that a
   * LATER `invoice.paid` already resolved (a Smart Retry that succeeded before
   * the earlier failure notification arrived) could downgrade a genuinely
   * current-and-paid School back to PAST_DUE. Closing this properly needs a
   * real way to compare event recency (e.g. tracking the Stripe event's own
   * `created` timestamp against when this School's status was last set) that
   * doesn't exist anywhere in this codebase yet — not built here rather than
   * guessed at with a fragile partial fix. Narrow and self-correcting in
   * practice (the next real invoice.paid/customer.subscription.updated
   * eventually re-syncs it), but a real, open gap — flagged for whenever this
   * needs to be closed properly, not silently accepted as correct.
   *
   * Phase 54's own platformSubscriptionStatus write below (School/Franchise,
   * tried only once the franchise-fee correlator above doesn't match at all —
   * `franchiseFeeResult.count === 0`) carries the identical unconditional-write
   * caveat this comment already describes, for the identical reason — not a new,
   * separate gap.
   */
  private async handleInvoicePaymentFailed(tx: Prisma.TransactionClient, invoice: Stripe.Invoice): Promise<void> {
    const subRef = invoice.parent?.subscription_details?.subscription;
    const subscriptionId = typeof subRef === 'string' ? subRef : subRef?.id;
    if (!subscriptionId) {
      return;
    }

    const pending = await tx.franchiseFeeCharge.findFirst({
      where: { stripeSubscriptionId: subscriptionId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      await tx.franchiseFeeCharge.update({ where: { id: pending.id }, data: { status: 'FAILED' } });
    }

    const franchiseFeeResult = await tx.school.updateMany({
      where: { stripeFranchiseFeeSubscriptionId: subscriptionId },
      data: { franchiseFeeSubscriptionStatus: 'PAST_DUE' },
    });
    if (franchiseFeeResult.count > 0) {
      return;
    }

    // Phase 54 — same either/or correlator reasoning as handleInvoicePaid above.
    // No PlatformCharge row to flip — this phase's platform SubscriptionPlan
    // billing has no PENDING-row-in-advance case (see handleInvoicePaid's own
    // comment), so there's nothing here analogous to the franchiseFeeCharge
    // PENDING-flip above; only the status sync matters.
    const platformSchoolResult = await tx.school.updateMany({
      where: { stripePlatformSubscriptionId: subscriptionId },
      data: { platformSubscriptionStatus: 'PAST_DUE' },
    });
    if (platformSchoolResult.count === 0) {
      await tx.franchise.updateMany({
        where: { stripePlatformSubscriptionId: subscriptionId },
        data: { platformSubscriptionStatus: 'PAST_DUE' },
      });
    }
  }

  /** Decision 111 — extracts the PaymentIntent id behind this Invoice, from its
   * own `payments` list (requires `expand: ['payments']` on the fetch — see
   * process()'s own comment). Verified against the installed Stripe SDK's own
   * type definitions before writing this: neither Charge nor PaymentIntent
   * carries a reverse `invoice` reference in this API version (an earlier draft
   * of this phase's own design assumed one still existed), so this forward path
   * (Invoice -> its own InvoicePayment -> payment_intent) is the only reachable
   * one. Returns undefined for a `payment.type !== 'payment_intent'` entry (e.g.
   * a Cash/Bank Out-of-Band payment recorded against the invoice) — nothing for
   * a later dispute webhook to correlate against in that case, which is correct:
   * Stripe only ever disputes a real card charge, never an Out-of-Band payment.
   */
  private extractPaymentIntentId(invoice: Stripe.Invoice): string | undefined {
    const payment = invoice.payments?.data.find((p) => p.payment.type === 'payment_intent');
    const ref = payment?.payment.payment_intent;
    return typeof ref === 'string' ? ref : ref?.id;
  }

  /**
   * Decision 111 (Decision 55's own confirmed contract) — unified handler for
   * charge.dispute.created/updated/closed, driven entirely by `dispute.status`
   * rather than by which of the three event names delivered it: Stripe fires all
   * three identically shaped, and the entity-level consequence only ever depends
   * on where the dispute currently stands, never on the event name itself.
   *
   * Correlation: `dispute.payment_intent` is the only correlator a Dispute object
   * carries (verified against the installed SDK's own type definitions — Dispute
   * has no Invoice id anywhere on it) — tried against Transaction, then
   * FranchiseFeeCharge, then PlatformCharge's own stripePaymentIntentId in turn,
   * mirroring handleSubscriptionDeleted's own established "try each correlator
   * column in turn, genuine either/or" shape above (the three columns can never
   * all match the same paymentIntentId — Decision 111's own migration adds a
   * `@unique` constraint on each).
   *
   * Idempotency relies entirely on the outer dedup (ProcessedStripeEvent,
   * process()'s own transaction) — each distinct Stripe event id reaches this
   * method at most once, so no extra guard logic is needed here beyond what the
   * Membership-force-expire branch's own `updateMany({ where: { status: 'ACTIVE' } })`
   * already gives it (protecting a *different*, narrower race: the Membership
   * reaching EXPIRED some other way in between).
   *
   * Returns the notification/Subscription-cancellation side effects to carry out
   * — NOT performed here. See process()'s own comment for why both wait until
   * this method's own DB writes have actually committed.
   */
  private async handleChargeDispute(tx: Prisma.TransactionClient, dispute: Stripe.Dispute, stripeEventId: string): Promise<DisputeSideEffects> {
    const noSideEffects: DisputeSideEffects = { notifications: [], subscriptionCancellations: [] };
    const paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!paymentIntentId) {
      this.logger.warn(`Dispute ${dispute.id} (status ${dispute.status}) has no payment_intent — cannot correlate to any charge. Ignoring.`);
      return noSideEffects;
    }

    const transaction = await tx.transaction.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
    if (transaction) {
      return this.applyDisputeToTransaction(tx, transaction, dispute, stripeEventId);
    }

    const franchiseFeeCharge = await tx.franchiseFeeCharge.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
    if (franchiseFeeCharge) {
      return this.applyDisputeToFranchiseFeeCharge(tx, franchiseFeeCharge, dispute, stripeEventId);
    }

    const platformCharge = await tx.platformCharge.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
    if (platformCharge) {
      return this.applyDisputeToPlatformCharge(tx, platformCharge, dispute);
    }

    this.logger.warn(`Dispute ${dispute.id} (payment_intent ${paymentIntentId}, status ${dispute.status}) — no matching Transaction, FranchiseFeeCharge, or PlatformCharge found. Ignoring.`);
    return noSideEffects;
  }

  /** `won` reverts the entity to SUCCESSFUL with no disputedAmount; `lost` sets
   * DISPUTED with the Stripe-reported amount and IS the terminal outcome —
   * Decision 55/the schema deliberately has no separate "chargeback lost" status
   * beyond DISPUTED (TransactionStatus, reused directly by all three entities).
   * Every other Dispute.status (needs_response, under_review, warning_*,
   * prevented, or an unrecognized future value) is still genuinely in-progress —
   * recorded identically to a loss at the entity level (DISPUTED + the current
   * disputed amount) but without `lost`'s own further consequences.
   */
  private resolveDisputeOutcome(dispute: Stripe.Dispute): { status: 'SUCCESSFUL' | 'DISPUTED'; disputedAmount: number | null; lost: boolean } {
    if (dispute.status === 'won') {
      return { status: 'SUCCESSFUL', disputedAmount: null, lost: false };
    }
    return { status: 'DISPUTED', disputedAmount: dispute.amount, lost: dispute.status === 'lost' };
  }

  /** Transaction (Membership purchase) disputes — the only one of the three that
   * carries Decision 55's further "lost" consequence: force-Expire the Membership
   * and cancel its Stripe Subscription (SUBSCRIPTION-type plans only —
   * stripeSubscriptionId is null for a one-time purchase, so there is nothing to
   * cancel). Notifies the School Owner/Manager — the School's own PaymentAccount
   * is the party whose money is actually at stake (Decision 55's "notification
   * routed by who's financially exposed").
   */
  private async applyDisputeToTransaction(tx: Prisma.TransactionClient, transaction: Transaction, dispute: Stripe.Dispute, stripeEventId: string): Promise<DisputeSideEffects> {
    const outcome = this.resolveDisputeOutcome(dispute);
    await tx.transaction.update({ where: { id: transaction.id }, data: { status: outcome.status, disputedAmount: outcome.disputedAmount } });

    const subscriptionCancellations: DisputeSideEffects['subscriptionCancellations'] = [];
    if (outcome.lost && transaction.membershipId) {
      const membershipUpdate = await tx.membership.updateMany({ where: { id: transaction.membershipId, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
      if (membershipUpdate.count > 0) {
        this.logger.log(`Dispute ${dispute.id} lost — Membership ${transaction.membershipId} force-Expired (Decision 55).`);
        const membership = await tx.membership.findUnique({ where: { id: transaction.membershipId }, select: { stripeSubscriptionId: true } });
        if (membership?.stripeSubscriptionId) {
          // scopedClient(), not platformClient() — this Subscription was created
          // on the School's own connected account (PaymentsService.subscribe()'s
          // own Direct-charge pattern, Decision 86), never the platform account.
          const paymentAccount = await tx.paymentAccount.findUnique({ where: { schoolId: transaction.schoolId } });
          if (paymentAccount?.stripeConnectedAccountId) {
            subscriptionCancellations.push({ connectedAccountId: paymentAccount.stripeConnectedAccountId, subscriptionId: membership.stripeSubscriptionId });
          } else {
            this.logger.error(
              `Dispute ${dispute.id} — Membership ${transaction.membershipId}'s Subscription ${membership.stripeSubscriptionId} could not be canceled: School ${transaction.schoolId} has no PaymentAccount with a connected Stripe account.`,
            );
          }
        }
      }
    }

    const ownerGrants = await tx.roleGrant.findMany({
      where: { schoolId: transaction.schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });
    return {
      notifications: ownerGrants.map((grant) => this.buildDisputeNotification(grant.userId, dispute, outcome, stripeEventId, 'Membership payment')),
      subscriptionCancellations,
    };
  }

  /** FranchiseFeeCharge disputes — no further forced consequence beyond recording
   * the outcome (nothing in Decision 55 or the schema implies an equivalent
   * forced action here the way a lost Membership-purchase dispute gets one).
   * Notifies the Franchise Owner — the Franchise's own PaymentAccount is the
   * party financially exposed for this relationship.
   */
  private async applyDisputeToFranchiseFeeCharge(
    tx: Prisma.TransactionClient,
    charge: FranchiseFeeCharge,
    dispute: Stripe.Dispute,
    stripeEventId: string,
  ): Promise<DisputeSideEffects> {
    const outcome = this.resolveDisputeOutcome(dispute);
    await tx.franchiseFeeCharge.update({ where: { id: charge.id }, data: { status: outcome.status, disputedAmount: outcome.disputedAmount } });

    const ownerGrants = await tx.roleGrant.findMany({
      where: { franchiseId: charge.franchiseId, role: 'FRANCHISE_OWNER', revokedAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });
    return {
      notifications: ownerGrants.map((grant) => this.buildDisputeNotification(grant.userId, dispute, outcome, stripeEventId, 'franchise fee charge')),
      subscriptionCancellations: [],
    };
  }

  /** PlatformCharge disputes — ULTM8 itself is the financially exposed party, and
   * there is no notification channel for that: Notification.userId only ever
   * points at a tenant User, never AdminUser (Platform Admin is a structurally
   * separate identity with no notification inbox anywhere in this codebase —
   * confirmed by reading Notification's own schema.prisma model before writing
   * this). A loud log line is the reasonable-minimum treatment, same class of
   * "flagged for Architect review, not a fabricated notification path" Decision
   * 95 already gave an analogous gap — deliberately NOT AuditLogService: that
   * service's RecordAuditLogInput requires a real adminUserId actor (checked
   * directly against its own interface before writing this), which a
   * system/webhook-triggered event genuinely has none of.
   */
  private async applyDisputeToPlatformCharge(tx: Prisma.TransactionClient, charge: PlatformCharge, dispute: Stripe.Dispute): Promise<DisputeSideEffects> {
    const outcome = this.resolveDisputeOutcome(dispute);
    await tx.platformCharge.update({ where: { id: charge.id }, data: { status: outcome.status, disputedAmount: outcome.disputedAmount } });
    this.logger.error(
      `PlatformCharge ${charge.id} (School ${charge.schoolId ?? '-'} / Franchise ${charge.franchiseId ?? '-'}) disputed — Stripe status ${dispute.status}, amount ${dispute.amount} ${dispute.currency}. ` +
        "No Platform Admin notification channel exists for this — see this method's own comment. Needs manual review.",
    );
    return { notifications: [], subscriptionCancellations: [] };
  }

  /** One notification per event per recipient, keyed by (stripeEventId, userId)
   * so `created`/`updated`/`closed` for the SAME dispute (Dispute.id stays
   * constant across all three) each get their own delivery rather than deduping
   * against each other via BullMQ's own jobId mechanism — `dispute.id` alone
   * would have collided a dispute's opening notification with its closing one.
   */
  private buildDisputeNotification(
    userId: string,
    dispute: Stripe.Dispute,
    outcome: { status: 'SUCCESSFUL' | 'DISPUTED'; disputedAmount: number | null; lost: boolean },
    stripeEventId: string,
    chargeLabel: string,
  ): NotificationFanoutJobData {
    const amount = this.formatDisputeAmount(dispute);
    const title = outcome.lost ? 'Payment dispute lost' : dispute.status === 'won' ? 'Payment dispute resolved' : 'Payment dispute opened';
    const body = outcome.lost
      ? `A disputed ${chargeLabel} of ${amount} was lost — the charge is no longer considered paid.`
      : dispute.status === 'won'
        ? `A disputed ${chargeLabel} of ${amount} was resolved in your favor.`
        : `A ${chargeLabel} of ${amount} has been disputed by the payer (status: ${dispute.status}).`;
    return {
      notificationId: `dispute-${stripeEventId}-${userId}`,
      userId,
      title,
      body,
      type: 'PAYMENT_DISPUTE',
    };
  }

  private formatDisputeAmount(dispute: Stripe.Dispute): string {
    return `${(dispute.amount / 100).toFixed(2)} ${dispute.currency.toUpperCase()}`;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<WebhookJobData> | undefined, error: Error) {
    if (!job) return;
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;
    if (attemptsMade >= maxAttempts) {
      this.logger.error(
        `Stripe webhook processing permanently failed after ${attemptsMade} attempt(s) for event ${job.data?.stripeEventId} (${job.data?.eventType}) — Stripe already has the money/state change and this platform hasn't recorded it.`,
        error,
      );
    }
  }
}

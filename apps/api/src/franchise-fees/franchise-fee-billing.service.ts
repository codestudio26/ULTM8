import { Injectable, Logger } from '@nestjs/common';
import { Franchise, PaymentAccount, School } from '@prisma/client';
import Stripe from 'stripe';
import { DateTime } from 'luxon';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { StripeClientService } from '../payments/stripe-client.service';

/**
 * Stripe primitives for the franchise-fee standing Subscription + Per-Headcount
 * metered billing — the job-scoped counterpart to PaymentsService's own
 * CALLER-scoped Stripe primitives (charge()/subscribe(), Phase 9). Deliberately a
 * separate service, not bolted onto PaymentsService: every method here runs with
 * no single caller/tenant context (franchise-fee-usage-reporting sweeps every
 * affiliated School), the same "job-scoped work gets its own service, called
 * directly by the job's own processor" split NotificationDeliveryService already
 * established for NotificationFanoutProcessor (Phase 15) — not a new convention.
 *
 * Runs entirely via PrismaJobsService (ultm8_jobs role) — this phase's migration
 * grants it SELECT/UPDATE on Franchise, SELECT on PaymentAccount, and SELECT/
 * UPDATE on School specifically for what these methods need; never
 * PrismaAppService/withTenantContext, since there is no caller to scope a
 * transaction to.
 */
@Injectable()
export class FranchiseFeeBillingService {
  private readonly logger = new Logger(FranchiseFeeBillingService.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly stripeClient: StripeClientService,
  ) {}

  /**
   * Ensures a standing Stripe Subscription exists for this School<->Franchise
   * franchise-fee relationship — creates one (Flat: inline `price_data`, same
   * shape PaymentsService.subscribe() already established for Membership
   * Subscriptions; Per-Headcount: a real, persisted metered Price, via
   * `ensureMeterAndPrice` below) if `school.stripeFranchiseFeeSubscriptionId` is
   * still null, and persists the new id onto School. Idempotent by construction —
   * a School that already has one is returned as-is, no second Subscription ever
   * created.
   *
   * Returns `null` (a skip, not an error — matches class-occurrence-generation's
   * own "log and move on" convention for a per-row precondition failure that
   * shouldn't abort the whole sweep) when this School/Franchise pair genuinely
   * isn't ready yet: the Franchise has no fully-onboarded Stripe PaymentAccount,
   * or hasn't configured the rate its own current feeModel needs. Both are
   * expected, ordinary states (a Franchise Owner may set up billing well after
   * Schools have already joined, Decision 98) — not failures to log loudly about
   * on every single monthly run.
   *
   * A throwaway Stripe Customer is created per School, scoped to the Franchise's
   * own connected account — the same "throwaway Customer per subscription, no
   * persisted reusable id" simplification PaymentsService.subscribe() already
   * documents and accepts as a known limitation for Membership Subscriptions,
   * applied here School->Franchise instead of Student->School.
   */
  async ensureSubscription(
    franchise: Franchise & { paymentAccount: PaymentAccount | null },
    school: School,
  ): Promise<string | null> {
    if (school.stripeFranchiseFeeSubscriptionId) {
      return school.stripeFranchiseFeeSubscriptionId;
    }

    const account = franchise.paymentAccount;
    if (!account || account.provider !== 'STRIPE' || !account.stripeConnectedAccountId) {
      this.logger.log(
        `Skipping franchise-fee Subscription for School ${school.id} (Franchise ${franchise.id}) — Franchise has no fully-onboarded Stripe PaymentAccount yet.`,
      );
      return null;
    }
    if (franchise.feeModel === 'FLAT' && franchise.flatFeeAmount == null) {
      this.logger.log(`Skipping franchise-fee Subscription for School ${school.id} — Franchise ${franchise.id} has no flatFeeAmount configured yet.`);
      return null;
    }
    if (franchise.feeModel === 'PER_HEADCOUNT' && franchise.perHeadcountRate == null) {
      this.logger.log(`Skipping franchise-fee Subscription for School ${school.id} — Franchise ${franchise.id} has no perHeadcountRate configured yet.`);
      return null;
    }

    const stripe = this.stripeClient.scopedClient(account.stripeConnectedAccountId);
    const customer = await stripe.customers.create({ name: `Franchise fee — ${school.name}` });

    // Idempotency key, stable per School<->Franchise pair — guards against the
    // narrow but real crash-between-Stripe-call-and-DB-write window: if the
    // process dies after Stripe creates the Subscription but before the
    // `school.update` below commits, the next job run's retry reuses this same
    // key instead of creating a SECOND standing Subscription for the same School.
    // Stripe's own idempotency-key mechanism (any `.create()` call's second
    // params argument), not a bespoke one.
    // Decision 336 (F15) — the Franchise and the School row's updatedAt are part
    // of the key. With the School id alone, a School that left and rejoined within
    // Stripe's 24-hour key window would get the old request's answer (or a
    // parameter-mismatch error) instead of a new subscription. Leaving and joining
    // both write the School row, so a rejoin always gets a new key, while a retry
    // after a crash or a second concurrent run reads the same row and the same key.
    const idempotencyKey = `franchise-fee-sub-${school.id}-${franchise.id}-${school.updatedAt.getTime()}`;

    let subscription: Stripe.Subscription;
    if (franchise.feeModel === 'FLAT') {
      const product = await stripe.products.create({ name: `Franchise fee — ${franchise.name}` });
      subscription = await stripe.subscriptions.create(
        {
          customer: customer.id,
          items: [
            {
              price_data: {
                currency: 'usd', // domain-rules §11.2/Decision 7 — Franchise-fee is always the single anchor currency
                unit_amount: franchise.flatFeeAmount!,
                recurring: { interval: 'month' },
                product: product.id,
              },
            },
          ],
        },
        { idempotencyKey },
      );
    } else {
      const { priceId } = await this.ensureMeterAndPrice(franchise, stripe);
      subscription = await stripe.subscriptions.create(
        {
          customer: customer.id,
          items: [{ price: priceId }], // metered — no `quantity`, Stripe derives it from reported usage
          // Decision 336 (F18) — billing months run midnight to midnight UTC on the
          // 1st. Otherwise each month would end at the second this subscription was
          // created (about 03:00 on the 1st, when the monthly job runs), and next
          // month's 03:00 usage report could land a few seconds before that and be
          // billed in the old month. Metered, so there is nothing to prorate.
          billing_cycle_anchor: Math.floor(DateTime.utc().startOf('month').plus({ months: 1 }).toSeconds()),
          proration_behavior: 'none',
        },
        { idempotencyKey },
      );
    }

    await this.prismaJobs.school.update({
      where: { id: school.id },
      data: { stripeFranchiseFeeSubscriptionId: subscription.id, franchiseFeeSubscriptionStatus: 'ACTIVE' },
    });
    return subscription.id;
  }

  /**
   * Lazily creates the Stripe Billing Meter + a real, persisted metered Price for
   * this Franchise's own PER_HEADCOUNT billing — idempotent (returns the existing
   * pair if already created). Verified directly against the installed `stripe`
   * SDK v22's own type definitions before writing this, not assumed from memory:
   * a Meter is an account-scoped resource (here, the Franchise's own connected
   * account — Stripe Connect gives each connected account its own separate Meter
   * namespace, so a shared platform-wide Meter isn't possible even if it were
   * desirable), and a Subscription item referencing metered usage needs a real,
   * persisted Price with `recurring.usage_type: 'metered'` + `recurring.meter` —
   * unlike the Flat case, inline `price_data` on a Subscription item does NOT
   * support `usage_type`/`meter` at all (checked directly against
   * `Subscriptions.d.ts`'s own `PriceData.Recurring` interface, which only
   * carries `interval`/`interval_count`), so this cannot reuse `ensureSubscription`'s
   * own inline-price_data shape the way the Flat branch does.
   */
  private async ensureMeterAndPrice(franchise: Franchise, stripe: Stripe): Promise<{ meterId: string; priceId: string }> {
    if (franchise.stripeMeterId && franchise.stripeUsagePriceId) {
      return { meterId: franchise.stripeMeterId, priceId: franchise.stripeUsagePriceId };
    }

    const meter = await stripe.billing.meters.create({
      display_name: `Franchise active students — ${franchise.name}`,
      event_name: this.meterEventName(franchise.id),
      default_aggregation: { formula: 'sum' },
    });
    const product = await stripe.products.create({ name: `Franchise fee (Per-Headcount) — ${franchise.name}` });
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: franchise.perHeadcountRate!,
      recurring: { interval: 'month', usage_type: 'metered', meter: meter.id },
      product: product.id,
    });

    await this.prismaJobs.franchise.update({
      where: { id: franchise.id },
      data: { stripeMeterId: meter.id, stripeUsagePriceId: price.id },
    });
    return { meterId: meter.id, priceId: price.id };
  }

  /**
   * Reports this month's active-student-count for a PER_HEADCOUNT Franchise's
   * metered Subscription — `stripe.billing.meterEvents.create()`, the modern
   * Billing Meters API (v22 SDK; the legacy `usage_record` API this replaced no
   * longer exists in the installed SDK at all — verified by its absence from
   * `node_modules/stripe/cjs/resources`, not assumed). `periodKey` (e.g.
   * "2026-09") makes the event's own `identifier` idempotent per billing period —
   * a retried job run within the same period reports the same identifier, which
   * Stripe dedupes within its own rolling 24h+ uniqueness window, rather than
   * double-counting usage.
   *
   * Looks up the Subscription's own Customer id fresh via `subscriptions.retrieve`
   * rather than persisting one — same "don't add a column for a value that's one
   * cheap read away" reasoning already applied elsewhere in this phase (no new
   * FranchiseFeeCharge column for the Stripe Customer id either).
   */
  async reportUsage(
    franchise: Franchise & { paymentAccount: PaymentAccount | null },
    subscriptionId: string,
    activeStudentCount: number,
    periodKey: string,
  ): Promise<void> {
    // FOUND ON REVIEW: a first draft went straight to the non-null assertions
    // below, trusting that a Subscription existing at all implies a valid,
    // still-Stripe-provider PaymentAccount — weaker than `ensureSubscription`'s
    // own explicit check just above, which this method doesn't otherwise
    // duplicate. If a Franchise's PaymentAccount is ever reconfigured (provider
    // changed, or its connected-account id cleared) after a Subscription
    // already exists, this would have thrown an unhandled TypeError deep
    // inside `scopedClient()` instead of a clear, actionable error the caller
    // (the usage-reporting job's own per-row try/catch) can log meaningfully.
    if (franchise.paymentAccount?.provider !== 'STRIPE' || !franchise.paymentAccount.stripeConnectedAccountId) {
      throw new Error(`Franchise ${franchise.id} has an active franchise-fee Subscription (${subscriptionId}) but no valid Stripe PaymentAccount — cannot report usage.`);
    }
    const stripe = this.stripeClient.scopedClient(franchise.paymentAccount.stripeConnectedAccountId);
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

    await stripe.billing.meterEvents.create({
      event_name: this.meterEventName(franchise.id),
      payload: { stripe_customer_id: customerId, value: String(activeStudentCount) },
      identifier: `franchise-fee-usage-${subscriptionId}-${periodKey}`,
    });
  }

  /** Franchise-scoped event name — see `ensureMeterAndPrice`'s own comment on why
   * a shared platform-wide Meter isn't possible; the `franchise.id` suffix keeps
   * this collision-free even though Connect's own per-account Meter namespace
   * already would on its own, for clarity when reading Stripe Dashboard data. */
  private meterEventName(franchiseId: string): string {
    return `franchise_active_students_${franchiseId}`;
  }

  /**
   * Decision 99's own follow-up (franchise-fee-rate-migration.processor.ts) —
   * creates a brand-new, persisted metered Price for a PER_HEADCOUNT rate change,
   * pointing at the Franchise's EXISTING Stripe Billing Meter (Meters aren't
   * re-created — only a Price is, same "Stripe Prices are immutable, create a
   * replacement" mechanism `migrateSubscriptionToNewPrice` already established for
   * Membership plans, applied here to a Meter-backed Price instead of a flat one).
   * Persists the new id onto `Franchise.stripeUsagePriceId` so every School that
   * joins (or has `ensureSubscription` run for it) AFTER this point automatically
   * gets the new rate too, not just the Schools this rate change's own job walks.
   *
   * Throws if `stripeMeterId` is unset — this method is only ever called once
   * franchise-fee billing has already started for at least one School (the same
   * precondition FranchisesService.update()'s own schoolsAlreadyBilling guard
   * checks before enqueueing this job at all), which means `ensureMeterAndPrice`
   * must have already run and set it; a missing Meter at this point is a real,
   * unexpected inconsistency worth failing loudly on rather than silently creating
   * an orphaned second Meter.
   */
  async createReplacementMeteredPrice(franchise: Franchise, stripe: Stripe, newPerHeadcountRate: number): Promise<string> {
    if (!franchise.stripeMeterId) {
      throw new Error(`Franchise ${franchise.id} has no stripeMeterId — cannot create a replacement metered Price before PER_HEADCOUNT billing has ever started.`);
    }
    const product = await stripe.products.create({ name: `Franchise fee (Per-Headcount) — ${franchise.name} [rate change]` });
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: newPerHeadcountRate,
      recurring: { interval: 'month', usage_type: 'metered', meter: franchise.stripeMeterId },
      product: product.id,
    });
    await this.prismaJobs.franchise.update({ where: { id: franchise.id }, data: { stripeUsagePriceId: price.id } });
    return price.id;
  }

  /**
   * Decision 99's own follow-up — a new Price for a FLAT rate change, on the SAME
   * Product the target School's existing Subscription Item already uses.
   * Deliberately NOT inline `price_data` on the Subscription update itself (the
   * SDK's own `SubscriptionUpdateParams.Item.price_data` would work too, verified
   * directly against `Subscriptions.d.ts`) — a real, persisted Price is created
   * instead so this method's own return value is independently inspectable/
   * reusable the same way `migrateSubscriptionToNewPrice`'s own newPriceId already
   * is, rather than an anonymous object Stripe generates and this code never sees
   * again. Each FLAT School has its own ad-hoc Product (`ensureSubscription`'s own
   * comment) — unlike Per-Headcount, there is no single shared Price to reuse
   * across Schools here, one new Price per School's own migration.
   */
  async createReplacementFlatPrice(stripe: Stripe, existingProductId: string, newFlatFeeAmount: number): Promise<string> {
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: newFlatFeeAmount,
      recurring: { interval: 'month' },
      product: existingProductId,
    });
    return price.id;
  }

  /**
   * Swaps a standing franchise-fee Subscription's sole item onto a new Price —
   * the Franchise-fee-side mirror of `PaymentsService.migrateSubscriptionToNewPrice()`'s
   * exact shape (Decision 99's own follow-up; see that method's own header comment
   * for the `proration_behavior` precedent this reuses for the FLAT/MIGRATE_NEXT_CYCLE
   * case specifically).
   */
  async swapSubscriptionPrice(stripe: Stripe, subscriptionId: string, newPriceId: string, prorationBehavior: Stripe.SubscriptionUpdateParams.ProrationBehavior): Promise<void> {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const item = subscription.items.data[0];
    if (!item) {
      throw new Error(`Stripe Subscription ${subscriptionId} has no Subscription Item to migrate.`);
    }
    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, price: newPriceId }],
      proration_behavior: prorationBehavior,
    });
  }
}

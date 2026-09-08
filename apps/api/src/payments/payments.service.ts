import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { StripeClientService } from './stripe-client.service';
import { CreatePaymentAccountDto } from './dto/create-payment-account.dto';
import { STRIPE_WEBHOOK_PROCESSING_QUEUE } from '../jobs/queue.constants';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly stripeClient: StripeClientService,
    @InjectQueue(STRIPE_WEBHOOK_PROCESSING_QUEUE) private readonly webhookQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // School-side PaymentAccount CRUD — fully reachable this phase.
  // ---------------------------------------------------------------------------

  /** School Owner/Manager only (Spec §8.2) — same gate as every other write. */
  async createForSchool(callerId: string, schoolId: string, dto: CreatePaymentAccountDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    // "has one PaymentAccount set" (School's own confirmed entity row) — pre-checked
    // explicitly (same convention InstructorsService.create()/RoleGrantsService.create()
    // use) rather than relying on the generic P2002 catch-all, so the caller gets a
    // specific message.
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.findUnique({ where: { schoolId }, select: { id: true } }),
    );
    if (existing) {
      throw new ConflictException('This School already has a PaymentAccount.');
    }

    const id = randomUUID();
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.create({
        data: {
          id,
          schoolId,
          provider: dto.provider,
          accountTitle: dto.accountTitle,
          country: dto.country,
        },
      }),
    );
  }

  /**
   * Singular resource, not a paginated list — a School has at most one
   * PaymentAccount ("has one PaymentAccount set"), so a cursor-paginated
   * items/nextCursor envelope would be misleading complexity for something that can
   * only ever hold 0 or 1 result. Deliberately deviates from the Phase 8 kickoff
   * prompt's own "GET .../payment-accounts" (list-shaped) suggestion — caught during
   * implementation, same as prior phases' own build-time corrections — matches the
   * singular-resource shape /users/me already established instead.
   *
   * **Read visibility, flagged for Architect review**: no `assertSchoolOwner` call
   * here — matches this codebase's established "RLS admits any role, only writes are
   * owner-gated" convention (every other module's own `findOne`/`findForSchool`-style
   * read does the same). `PaymentAccount` is the first RLS-readable table exposing a
   * live `stripeConnectedAccountId`, though — whether that field's sensitivity
   * actually warrants Owner-only reads (an asymmetric deviation from every other
   * module) is a genuine open question this phase deliberately did NOT decide
   * unilaterally either way, rather than silently narrowing (or silently not
   * narrowing) a business rule Spec 55 doesn't itself state. Confirmed step-up MFA
   * (§11.5) gates payout/bank-detail *changes*, not reads — this code follows that
   * literally, not by extension.
   */
  async findForSchool(callerId: string, schoolId: string) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.findUnique({ where: { schoolId } }),
    );
    // RLS returns null (not another tenant's row) for a PaymentAccount outside the
    // caller's scope — a genuine "none exists yet" and a cross-tenant-blocked read
    // are indistinguishable at this layer by design (ultm8-tenant-isolation §2) —
    // and also indistinguishable from each other here, which is fine: both cases mean
    // "there's nothing for this School to show the caller."
    if (!found) {
      throw new NotFoundException('PaymentAccount not found');
    }
    return found;
  }

  // ---------------------------------------------------------------------------
  // Franchise-side PaymentAccount CRUD — schema-correct, practically unreachable
  // this phase (no FranchisesController/FranchisesService, no FRANCHISE_OWNER
  // grantability anywhere in this codebase — see the Phase 8 kickoff prompt). Built
  // correctly anyway; exercised only via direct-seed e2e fixtures.
  // ---------------------------------------------------------------------------

  async createForFranchise(callerId: string, franchiseId: string, dto: CreatePaymentAccountDto) {
    // No FranchisesService.findOne() exists yet — assertFranchiseOwner is the only
    // check available, and it already 403s (not 404s) for a nonexistent franchiseId
    // too, since a RoleGrant can never match one. No confirmed way to distinguish
    // "Franchise doesn't exist" from "you're not its Owner" without Franchise CRUD to
    // build a real existence check against — flagged, not silently assumed away.
    await this.tenantAuth.assertFranchiseOwner(callerId, franchiseId);

    const existing = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.findUnique({ where: { franchiseId }, select: { id: true } }),
    );
    if (existing) {
      throw new ConflictException('This Franchise already has a PaymentAccount.');
    }

    const id = randomUUID();
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.create({
        data: {
          id,
          franchiseId,
          provider: dto.provider,
          accountTitle: dto.accountTitle,
          country: dto.country,
        },
      }),
    );
  }

  /**
   * **Corrected on code review** — an earlier draft of this method had no
   * `assertFranchiseOwner` call at all, which the diff's own e2e test caught as a
   * mismatch (the test expected 403 for a caller with zero grants on this Franchise;
   * RLS-only visibility actually produces 404, matching `findForSchool`'s own
   * documented "RLS-blocked and genuine-404 are indistinguishable" convention). On
   * review, kept consistent with `findForSchool` (RLS-only reads, no owner-narrowing)
   * rather than silently choosing the opposite — see `findForSchool`'s own comment
   * for the full "should PaymentAccount reads be Owner-only" open question, flagged
   * for Architect review rather than decided here. The e2e test was corrected to
   * match this, not the other way around.
   */
  async findForFranchise(callerId: string, franchiseId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.findUnique({ where: { franchiseId } }),
    );
    if (!found) {
      throw new NotFoundException('PaymentAccount not found');
    }
    return found;
  }

  // ---------------------------------------------------------------------------
  // Stripe Connect Express onboarding (Decision 86).
  // ---------------------------------------------------------------------------

  /**
   * `stripeConnectedAccountId` is set HERE, synchronously, not by a webhook handler
   * — corrected from an earlier draft of the Phase 8 kickoff prompt, which assumed
   * the id itself arrived via `account.updated`. Checked directly against Stripe's
   * own API shape before writing this: `stripe.accounts.create()` returns the new
   * Connected Account's `id` synchronously in its response, no webhook needed for
   * that specific value — a webhook only becomes necessary for tracking whether
   * onboarding has actually *completed* (`details_submitted`/`charges_enabled` on
   * `account.updated`), and there's no confirmed field yet to write that outcome
   * into beyond the id itself, so that half stays a logged TODO in
   * stripe-webhook-processing.processor.ts (JobsModule) rather than built against a
   * guess at what field it should update.
   *
   * Any `Stripe.errors.*` this method's own calls raise (e.g. an unsupported/typo'd
   * `country`) propagates to `HttpExceptionFilter`'s own Stripe-error mapping — no
   * local try/catch needed here, same centralized handling every future Stripe SDK
   * call in this codebase gets for free (see that filter's own comment for why this
   * moved there instead of being a one-off catch per call site — code review caught
   * an earlier draft that only handled the webhook-signature case this way).
   */
  async initiateConnectOnboarding(callerId: string, paymentAccountId: string) {
    const account = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.findUnique({ where: { id: paymentAccountId } }),
    );
    if (!account) {
      throw new NotFoundException('PaymentAccount not found');
    }
    if (account.schoolId) {
      await this.tenantAuth.assertSchoolOwner(callerId, account.schoolId);
    } else if (account.franchiseId) {
      await this.tenantAuth.assertFranchiseOwner(callerId, account.franchiseId);
    } else {
      // Unreachable in practice — every row has exactly one owner, enforced at
      // creation (createForSchool/createForFranchise each set exactly one FK) — but
      // checked explicitly rather than assumed, same defensive convention every
      // other service's findOne uses.
      throw new BadRequestException('PaymentAccount has no owner');
    }
    if (account.provider !== 'STRIPE') {
      throw new BadRequestException('Only a STRIPE-provider PaymentAccount can onboard through Stripe Connect');
    }

    const returnUrl = process.env.STRIPE_CONNECT_RETURN_URL;
    const refreshUrl = process.env.STRIPE_CONNECT_REFRESH_URL;
    if (!returnUrl || !refreshUrl) {
      throw new Error('STRIPE_CONNECT_RETURN_URL / STRIPE_CONNECT_REFRESH_URL are not set');
    }

    const stripe = this.stripeClient.platformClient();

    let stripeAccountId = account.stripeConnectedAccountId;
    if (!stripeAccountId) {
      // Decision 86 — Express, not Standard.
      const created = await stripe.accounts.create({ type: 'express', country: account.country });
      stripeAccountId = created.id;
      try {
        await this.prismaApp.withTenantContext(callerId, (tx) =>
          tx.paymentAccount.update({
            where: { id: paymentAccountId },
            data: { stripeConnectedAccountId: stripeAccountId },
          }),
        );
      } catch (dbError) {
        // Caught on code review: Stripe account creation and the DB persist below
        // aren't one atomic operation — if Stripe succeeds but this write fails
        // (a transient DB hiccup), the new Connected Account id was otherwise lost
        // entirely (never persisted, no cleanup), and a caller's retry would create
        // a SECOND orphaned Stripe account on top of the first, since
        // stripeAccountId would still read as unset. Best-effort compensating
        // delete of the just-created Stripe account, so a retry doesn't compound
        // the orphan rather than just leaving one behind — deliberately not a full
        // saga/outbox pattern (out of scope for this phase's stakes), but silently
        // leaking Stripe accounts is not an acceptable middle ground.
        try {
          await stripe.accounts.del(stripeAccountId);
        } catch (cleanupError) {
          this.logger.error(
            `Stripe Connect account ${stripeAccountId} was created but the DB write recording it on PaymentAccount ${paymentAccountId} failed, AND the compensating Stripe account deletion also failed — this account is now orphaned at Stripe with nothing in ULTM8 pointing back to it. Manual cleanup needed.`,
            cleanupError instanceof Error ? cleanupError.stack : String(cleanupError),
          );
          throw dbError;
        }
        throw dbError;
      }
    }
    // Already onboarded once, no fresh Account Link needed to *start* — but Stripe's
    // own Account Links are short-lived/single-use, so re-requesting one against an
    // existing Connected Account (to resume/finish onboarding) is the normal,
    // supported flow, not an error case — no branch needed here beyond the
    // `!stripeAccountId` check above.

    const link = await stripe.accountLinks.create({
      account: stripeAccountId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type: 'account_onboarding',
    });
    return { onboardingUrl: link.url };
  }

  // ---------------------------------------------------------------------------
  // Webhook receiving (Spec 55 §10.2's confirmed flow) — signature verification and
  // enqueueing only. The dedup+processing half lives in
  // stripe-webhook-processing.processor.ts (JobsModule), matching §10.2's own text:
  // "pushes events onto the stripe-webhook-processing BullMQ queue for idempotent,
  // asynchronous handling" — the receiving endpoint stays fast, the (slower) dedup
  // check happens downstream in the worker, not here.
  // ---------------------------------------------------------------------------

  /**
   * An invalid/missing signature throws `Stripe.errors.StripeSignatureVerificationError`
   * from `constructWebhookEvent` — propagates straight to `HttpExceptionFilter`'s own
   * Stripe-error mapping (400), no local try/catch needed. An earlier draft of this
   * method caught it locally instead; centralized on code review once a second Stripe
   * call site (`initiateConnectOnboarding`) needed the identical translation and a
   * copy-pasted try/catch stopped being the right shape for a pattern with more than
   * one caller.
   */
  async handleIncomingWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const event = this.stripeClient.constructWebhookEvent(rawBody, signature);
    await this.webhookQueue.add(
      'process',
      { stripeEventId: event.id, eventType: event.type },
      // Kept on the default 3-attempts/exponential-backoff policy every other job in
      // this codebase gets (Decision 23) — deliberately, not by omission. Decision
      // 23's own "except stripe-webhook-processing" carve-out reads (on this review)
      // as being about the underlying PAYMENT retry (don't build a custom BullMQ
      // retry-the-charge job — Stripe's own Subscription dunning schedule already
      // handles that), not about this job's own infrastructure-level retry for a
      // transient failure while processing an already-received event. Since this
      // endpoint returns 200 to Stripe as soon as the event is enqueued (Stripe's
      // own redelivery never fires for a downstream processing failure after that),
      // dropping this job's own retry entirely would risk silently losing an event
      // to a one-off DB hiccup with no other safety net catching it. Flagged as a
      // genuine ambiguity in the spec's own wording, not a confident reading —
      // Architect review welcome, but "keep the safer default" is the right call
      // while it's unresolved, not silence in either direction.
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
  }
}

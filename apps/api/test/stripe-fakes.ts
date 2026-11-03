import { randomUUID } from 'crypto';

/**
 * Fake Stripe replies shaped like the API version the installed SDK pins
 * (2026-08-26.dahlia), checked against the real test-mode sandbox on 30 Oct
 * 2026. Fakes shaped like an older version (an Invoice's `payment_intent`, a
 * Checkout Session's PaymentIntent at creation) are why the e2e suites passed
 * while every subscription and hosted Checkout purchase failed against Stripe.
 */

/** `subscriptions.create()` with `payment_behavior: 'default_incomplete'` and
 * `expand: ['latest_invoice.payments', 'latest_invoice.confirmation_secret']`:
 * no `payment_intent` on the Invoice; its PaymentIntent is the default
 * InvoicePayment, and its client secret is the Invoice's confirmation secret. */
export function fakeIncompleteSubscription(paymentIntentId = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`, lines?: FakeInvoiceLine[]) {
  const invoiceId = `in_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  return {
    id: `sub_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    object: 'subscription' as const,
    status: 'incomplete' as const,
    latest_invoice: {
      id: invoiceId,
      object: 'invoice' as const,
      status: 'open' as const,
      // An Invoice carries its first lines without an expand.
      ...(lines ? { lines: fakeInvoiceLines(invoiceId, lines) } : {}),
      payments: {
        object: 'list' as const,
        data: [
          {
            id: `inpay_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
            object: 'invoice_payment' as const,
            invoice: invoiceId,
            is_default: true,
            status: 'open',
            payment: { type: 'payment_intent' as const, payment_intent: paymentIntentId },
          },
        ],
        has_more: false,
      },
      confirmation_secret: { type: 'payment_intent', client_secret: `${paymentIntentId}_secret_${randomUUID().replace(/-/g, '').slice(0, 24)}` },
    },
  };
}

/** `checkout.sessions.create()` in `mode: 'payment'`: open, with its hosted
 * URL, and no PaymentIntent until the member pays. */
export function fakePaymentCheckoutSession(params: { metadata?: Record<string, string> } = {}) {
  const id = `cs_test_${randomUUID().replace(/-/g, '')}`;
  return {
    id,
    object: 'checkout.session' as const,
    mode: 'payment' as const,
    status: 'open' as const,
    payment_status: 'unpaid' as const,
    url: `https://checkout.stripe.com/c/pay/${id}`,
    payment_intent: null,
    metadata: params.metadata ?? {},
  };
}

/** The webhook job the intake (PaymentsService.handleIncomingWebhook) queues for
 * a payment_intent.* event on the PaymentIntent a paid Checkout made: the
 * Transaction id comes from the PaymentIntent's metadata, which Stripe copies
 * from the Session's `payment_intent_data.metadata`. */
export function checkoutPaymentJob(eventType: string, transactionId: string, stripeAccountId: string, paymentIntentId: string) {
  return { stripeEventId: `evt_${randomUUID()}`, eventType, objectId: paymentIntentId, stripeAccountId, transactionId };
}

/** One line of a Subscription invoice: what it charged, and the Product of
 * the Subscription item behind it. */
export type FakeInvoiceLine = { amount: number; product: string; currency?: string };

function fakeInvoiceLines(invoiceId: string, lines: FakeInvoiceLine[]) {
  return {
    object: 'list' as const,
    has_more: false,
    data: lines.map((line) => ({
      id: `il_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      object: 'line_item' as const,
      invoice: invoiceId,
      amount: line.amount,
      currency: line.currency ?? 'usd',
      // On this API version a line's Price and Product are under `pricing`,
      // and its Subscription item under `parent` (no top-level `price`).
      pricing: { type: 'price_details', price_details: { price: `price_${randomUUID().replace(/-/g, '').slice(0, 24)}`, product: line.product }, unit_amount_decimal: String(line.amount) },
      parent: { type: 'subscription_item_details', subscription_item_details: { subscription_item: `si_${randomUUID().replace(/-/g, '').slice(0, 14)}`, proration: false } },
    })),
  };
}

/** `invoices.retrieve(id, { expand: ['payments'] })` for a membership
 * Subscription's invoice (invoice.paid / invoice.payment_failed): its lines,
 * its PaymentIntent on `payments`, and the snapshot of the Subscription's
 * metadata Stripe keeps on `parent.subscription_details`. */
export function fakeSubscriptionInvoice(params: {
  subscriptionId: string;
  lines: FakeInvoiceLine[];
  id?: string;
  paymentIntentId?: string;
  billingReason?: string;
  currency?: string;
  paid?: boolean;
  subscriptionMetadata?: Record<string, string>;
}) {
  const id = params.id ?? `in_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const total = params.lines.reduce((sum, line) => sum + line.amount, 0);
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    object: 'invoice' as const,
    billing_reason: params.billingReason ?? 'subscription_cycle',
    currency: params.currency ?? 'usd',
    amount_due: total,
    amount_paid: params.paid === false ? 0 : total,
    created: now,
    period_start: now - 31 * 86_400,
    period_end: now,
    status_transitions: { paid_at: params.paid === false ? null : now },
    parent: { type: 'subscription_details', subscription_details: { subscription: params.subscriptionId, metadata: params.subscriptionMetadata ?? {} } },
    lines: fakeInvoiceLines(id, params.lines.map((line) => ({ currency: params.currency, ...line }))),
    payments: {
      object: 'list' as const,
      data: params.paymentIntentId ? [{ id: `inpay_${randomUUID().replace(/-/g, '').slice(0, 24)}`, object: 'invoice_payment' as const, payment: { type: 'payment_intent' as const, payment_intent: params.paymentIntentId } }] : [],
    },
  };
}

/** One item of a fake running Subscription: its price and that price's Product. */
export type FakeSubscriptionItem = { id: string; price: { id: string; product: string; unit_amount: number; currency: string } };
export type FakeRunningSubscription = {
  id: string;
  object: 'subscription';
  status: string;
  /** Unix seconds, as Stripe sends it. */
  created: number;
  metadata: Record<string, string>;
  items: { object: 'list'; data: FakeSubscriptionItem[] };
};

/**
 * Running Subscriptions on fake connected accounts, kept as Stripe keeps them:
 * `subscriptions.retrieve()` returns the current items and metadata, and
 * `subscriptions.update()` applies what it is sent (an item sent with
 * `deleted: true` goes; a metadata key set to '' is unset, as Stripe does).
 * `renewal()` builds the next renewal invoice from the items still there, with
 * the metadata snapshot Stripe copies onto it, so a test sees what the next
 * renewal would charge. `failNextUpdate()` makes updates throw a Stripe-like
 * connection error.
 */
export class FakeSubscriptionStore {
  readonly subscriptions = new Map<string, FakeRunningSubscription>();
  /** Every update that went through, with what was sent. */
  readonly updates: Array<{ id: string; params: Record<string, unknown> }> = [];
  private readonly failing = new Map<string, number>();

  /** A running Subscription with these items (the plan's first). */
  add(params: { id?: string; items: Array<{ amount: number; product: string; currency?: string }>; metadata?: Record<string, string>; created?: Date; status?: string }): FakeRunningSubscription {
    const subscription: FakeRunningSubscription = {
      id: params.id ?? `sub_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      object: 'subscription',
      status: params.status ?? 'active',
      created: Math.floor((params.created ?? new Date()).getTime() / 1000),
      metadata: { ...(params.metadata ?? {}) },
      items: {
        object: 'list',
        data: params.items.map((item) => ({
          id: `si_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
          price: { id: `price_${randomUUID().replace(/-/g, '').slice(0, 24)}`, product: item.product, unit_amount: item.amount, currency: item.currency ?? 'usd' },
        })),
      },
    };
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  /** The next `times` updates of this Subscription throw. */
  failNextUpdate(id: string, times = 1): void {
    this.failing.set(id, times);
  }

  retrieve = async (id: string): Promise<FakeRunningSubscription> => {
    const subscription = this.subscriptions.get(id);
    if (!subscription) throw Object.assign(new Error(`No such subscription: '${id}'`), { type: 'StripeInvalidRequestError', statusCode: 404 });
    return structuredClone(subscription);
  };

  update = async (id: string, params: { items?: Array<{ id?: string; deleted?: boolean }>; metadata?: Record<string, string> } & Record<string, unknown>): Promise<FakeRunningSubscription> => {
    const remaining = this.failing.get(id) ?? 0;
    if (remaining > 0) {
      this.failing.set(id, remaining - 1);
      throw Object.assign(new Error('An error occurred with our connection to Stripe.'), { type: 'StripeConnectionError' });
    }
    const subscription = this.subscriptions.get(id);
    if (!subscription) throw Object.assign(new Error(`No such subscription: '${id}'`), { type: 'StripeInvalidRequestError', statusCode: 404 });
    this.updates.push({ id, params });
    for (const item of params.items ?? []) {
      if (item.deleted) subscription.items.data = subscription.items.data.filter((i) => i.id !== item.id);
    }
    for (const [key, value] of Object.entries(params.metadata ?? {})) {
      if (value === '') delete subscription.metadata[key];
      else subscription.metadata[key] = value;
    }
    return structuredClone(subscription);
  };

  /** What the Subscription's items on this Product charge each month (0 once gone). */
  itemAmount(id: string, product: string): number {
    return this.subscriptions.get(id)!.items.data.filter((item) => item.price.product === product).reduce((sum, item) => sum + item.price.unit_amount, 0);
  }

  /** The next renewal invoice: one line per item still on the Subscription. */
  renewal(id: string, opts: { paymentIntentId?: string } = {}) {
    const subscription = this.subscriptions.get(id)!;
    return fakeSubscriptionInvoice({
      subscriptionId: id,
      paymentIntentId: opts.paymentIntentId ?? `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      subscriptionMetadata: { ...subscription.metadata },
      lines: subscription.items.data.map((item) => ({ amount: item.price.unit_amount, product: item.price.product, currency: item.price.currency })),
    });
  }
}

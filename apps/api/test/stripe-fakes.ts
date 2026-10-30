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
export function fakeIncompleteSubscription(paymentIntentId = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`) {
  const invoiceId = `in_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  return {
    id: `sub_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    object: 'subscription' as const,
    status: 'incomplete' as const,
    latest_invoice: {
      id: invoiceId,
      object: 'invoice' as const,
      status: 'open' as const,
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

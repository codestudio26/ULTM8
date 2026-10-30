import Stripe from 'stripe';

/**
 * What `subscriptions.create()` must expand so firstInvoicePayment() below can
 * read the first invoice's PaymentIntent. On the API version the installed SDK
 * pins (2026-08-26.dahlia) an Invoice no longer has a `payment_intent` field:
 * the PaymentIntent's id is on the invoice's `payments` list
 * (InvoicePayment.payment.payment_intent, the same path the webhook processor's
 * extractPaymentIntentId() reads), and its client secret is the invoice's
 * `confirmation_secret` (Invoice.ConfirmationSecret, type "payment_intent").
 * Both are includable fields, so neither comes back unless expanded. Checked
 * against the real test-mode sandbox, 30 Oct 2026: a `default_incomplete`
 * Subscription returns one default InvoicePayment `{ type: 'payment_intent',
 * payment_intent: 'pi_…' }` and a confirmation secret `pi_…_secret_…` for that
 * same PaymentIntent.
 */
export const FIRST_INVOICE_PAYMENT_EXPAND = ['latest_invoice.payments', 'latest_invoice.confirmation_secret'];

/** The PaymentIntent behind a new Subscription's first invoice: its id (the
 * Transaction's correlator for payment_intent.succeeded) and the client secret
 * the member's app confirms the payment with. Throws when Stripe returned
 * neither, as the old `latest_invoice.payment_intent` read did. */
export function firstInvoicePayment(subscription: Stripe.Subscription): { paymentIntentId: string; clientSecret: string } {
  const invoice = typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null;
  const payments = invoice?.payments?.data ?? [];
  const payment = payments.find((p) => p.is_default && p.payment.type === 'payment_intent') ?? payments.find((p) => p.payment.type === 'payment_intent');
  const ref = payment?.payment.payment_intent;
  const paymentIntentId = typeof ref === 'string' ? ref : ref?.id;
  const clientSecret = invoice?.confirmation_secret?.type === 'payment_intent' ? invoice.confirmation_secret.client_secret : undefined;
  if (!paymentIntentId || !clientSecret) {
    throw new Error("Stripe Subscription did not return its first invoice's PaymentIntent (latest_invoice.payments / latest_invoice.confirmation_secret).");
  }
  return { paymentIntentId, clientSecret };
}

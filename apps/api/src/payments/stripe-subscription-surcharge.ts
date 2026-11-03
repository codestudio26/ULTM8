import Stripe from 'stripe';
import { fromStripeAmount } from './stripe-amount';

/**
 * Decision 406 on a membership Subscription (backlog 3.8): the card surcharge
 * is its own recurring item on the Stripe Subscription, beside the plan's
 * item, priced on its own Product ("Card surcharge"). Stripe then charges it
 * on the first invoice and on every renewal, prorates it with the plan's item
 * (Decision 259's shared billing day), and shows it as its own line on each
 * Stripe invoice.
 *
 * Why its own item, not a bigger plan price or an invoice item added to each
 * renewal: the plan's item keeps the plan's own price (a persisted
 * Grandfather/Migrate Price can still be shared by every member), and each
 * invoice says exactly how much of it was surcharge, so every renewal is
 * recorded from what Stripe charged, never recomputed from the School's
 * current rate. A Subscription keeps the rate it started with: the School
 * turning the surcharge off or changing its % leaves running Subscriptions as
 * they are, until the member subscribes again. The one exception (Decision
 * 419 item 3): Platform Admin taking the School's country off the allow-list
 * removes the surcharge item from every running Subscription there, from its
 * next renewal (PaymentsService.removeSubscriptionSurcharge, run by the
 * card-surcharge-country-removal job). Adding the country back doesn't put it
 * back on them.
 *
 * The Subscription's metadata says which item is the surcharge. Stripe copies
 * a snapshot of it onto every invoice (Invoice.parent.subscription_details.
 * metadata), so the webhook needs no extra call to read a renewal's surcharge.
 */
export const SUBSCRIPTION_SURCHARGE_METADATA = {
  /** The surcharge item's Product id. Kept when the item is re-priced. */
  product: 'cardSurchargeProduct',
  /** The rate the Subscription started with, in basis points. */
  bps: 'cardSurchargeBps',
  /** The surcharge for one full month, in ULTM8 hundredths (as a one-off
   * payment's PaymentIntent metadata `surchargeAmount`). */
  amount: 'surchargeAmount',
} as const;

function productOf(ref: string | { id: string } | null | undefined): string | undefined {
  return typeof ref === 'string' ? ref : ref?.id;
}

/**
 * The surcharge on one Stripe invoice of a membership Subscription, in ULTM8
 * hundredths: the sum of its lines on the surcharge Product (a proration
 * included). `surchargeProduct` defaults to the one the invoice's own
 * Subscription metadata snapshot names; 0 when there is none (a Subscription
 * started without a surcharge, or before this was built).
 */
export function invoiceSurchargeAmount(invoice: Stripe.Invoice, surchargeProduct?: string): number {
  const product = surchargeProduct ?? invoice.parent?.subscription_details?.metadata?.[SUBSCRIPTION_SURCHARGE_METADATA.product];
  if (!product) return 0;
  const stripeAmount = (invoice.lines?.data ?? [])
    .filter((line) => productOf(line.pricing?.price_details?.product) === product)
    .reduce((sum, line) => sum + line.amount, 0);
  return fromStripeAmount(stripeAmount, invoice.currency);
}

/** The Subscription's surcharge item and its other (the plan's) item, told
 * apart by the surcharge Product its metadata names. */
export function splitSubscriptionItems(subscription: Stripe.Subscription): { planItem?: Stripe.SubscriptionItem; surchargeItem?: Stripe.SubscriptionItem } {
  const product = subscription.metadata?.[SUBSCRIPTION_SURCHARGE_METADATA.product];
  const isSurcharge = (item: Stripe.SubscriptionItem) => Boolean(product) && productOf(item.price?.product as string | { id: string } | null) === product;
  return {
    planItem: subscription.items.data.find((item) => !isSurcharge(item)),
    surchargeItem: subscription.items.data.find(isSurcharge),
  };
}

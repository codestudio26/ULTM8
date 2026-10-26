import Stripe from 'stripe';

/**
 * Decision 336 — how a School's franchise-fee subscription is ended when the
 * School leaves its Franchise (F19) or when the School or its Franchise is
 * closed (F16). `invoice_now` bills what has accrued this month (a Per-headcount
 * School's student count is reported on the 1st), so the month's Pending fee
 * charge resolves instead of staying Pending forever; `prorate: false` means no
 * part-month credit. A plain constant, not a service, so TenantsModule and
 * PlatformAdminModule can use it without depending on FranchiseFeesModule.
 */
export const FRANCHISE_FEE_FINAL_CANCEL: Stripe.SubscriptionCancelParams = { invoice_now: true, prorate: false };

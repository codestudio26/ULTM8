/**
 * Decision 441 item 6 — a School's (or Franchise's) Stripe connected account is
 * ready once Stripe has the business's details (onboarding finished,
 * `details_submitted`) and lets it take charges (`charges_enabled`). The same
 * test Decision 407's "Connected" uses. Read from Stripe's own Account object:
 * by the connect-status reads and by the account.updated webhook, which saves
 * it on PaymentAccount.stripeAccountReady for the setup checklist.
 */
export function isStripeAccountReady(account: { details_submitted?: boolean | null; charges_enabled?: boolean | null }): boolean {
  return account.details_submitted === true && account.charges_enabled === true;
}

/** Connected / Action needed / Not connected (Decision 407), with Decision
 * 437's country gate for the Connect Stripe button. */
export type ConnectStatus = {
  status: 'CONNECTED' | 'ACTION_NEEDED' | 'NOT_CONNECTED';
  connectAvailable: boolean;
  connectCountries: string[];
};

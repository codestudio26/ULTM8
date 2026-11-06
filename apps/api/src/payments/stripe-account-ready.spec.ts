import { isStripeAccountReady } from './stripe-account-ready';

describe('isStripeAccountReady (Decision 441 item 6)', () => {
  it('is ready only once Stripe has the details and lets the account take charges', () => {
    expect(isStripeAccountReady({ details_submitted: true, charges_enabled: true })).toBe(true);
    expect(isStripeAccountReady({ details_submitted: true, charges_enabled: false })).toBe(false);
    expect(isStripeAccountReady({ details_submitted: false, charges_enabled: true })).toBe(false);
    expect(isStripeAccountReady({ details_submitted: false, charges_enabled: false })).toBe(false);
    expect(isStripeAccountReady({})).toBe(false);
    expect(isStripeAccountReady({ details_submitted: null, charges_enabled: null })).toBe(false);
  });
});

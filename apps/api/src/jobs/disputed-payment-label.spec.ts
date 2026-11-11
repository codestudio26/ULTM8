import { disputedPaymentLabel } from './stripe-webhook-processing.processor';

/** Decision 452 item 7: the owner's dispute notice calls a fee a "fee payment",
 * never a "Membership payment". */
describe('disputedPaymentLabel', () => {
  it.each([
    ['MEMBERSHIP', 'Membership payment'],
    ['RENEWAL', 'Membership payment'],
    ['CHARGE_PAYMENT', 'charge payment'],
    ['FREEZE_FEE', 'fee payment'],
    ['LATE_CANCEL_FEE', 'fee payment'],
    ['NO_SHOW_FEE', 'fee payment'],
  ] as const)('%s → %s', (kind, label) => {
    expect(disputedPaymentLabel(kind)).toBe(label);
  });
});

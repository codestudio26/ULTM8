import { describe, expect, it } from '@jest/globals';
import { mayCloseFee, mayCloseFeeCharge } from './feeAccess';

/** Decision 420 item 2: the owner, or staff with "Can cancel charges", waive
 * or cancel a promotion fee. */
describe('who sees Waive / Cancel on a promotion fee', () => {
  it('shows them to the owner, whatever their access says', () => {
    expect(mayCloseFee(true, undefined)).toBe(true);
    expect(mayCloseFee(true, { cancelCharges: false })).toBe(true);
  });

  it('shows them to staff with "Can cancel charges", and hides them from staff without it', () => {
    expect(mayCloseFee(false, { cancelCharges: true })).toBe(true);
    expect(mayCloseFee(false, { cancelCharges: false })).toBe(false);
  });

  it('hides them while the access is still loading or could not be read', () => {
    expect(mayCloseFee(false, undefined)).toBe(false);
    expect(mayCloseFee(false, null)).toBe(false);
  });
});

describe('Waive fee / Cancel fee on the Payments card', () => {
  it('shows them on an accepted fee to anyone the card lets cancel charges', () => {
    expect(mayCloseFeeCharge(true, { status: 'ACCEPTED' })).toBe(true);
  });

  it('hides them without "Can cancel charges"', () => {
    expect(mayCloseFeeCharge(false, { status: 'ACCEPTED' })).toBe(false);
  });

  it('hides them on a fee that is already closed, and on a charge that is not a promotion fee', () => {
    for (const status of ['PAID', 'WAIVED', 'CANCELLED', 'PENDING', 'DECLINED']) expect(mayCloseFeeCharge(true, { status })).toBe(false);
    expect(mayCloseFeeCharge(true, null)).toBe(false);
  });
});

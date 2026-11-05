import { assertJoiningFeeAllowed, nonRefundableJoiningFee } from './joining-fee';
import { classShare } from '../bookings/cancellation.service';

describe('joining fee (Decision 435 items 1 and 5)', () => {
  it('is allowed only on a paid plan that is sold', () => {
    expect(() => assertJoiningFeeAllowed('CLASS_PACK', 1000, 500)).not.toThrow();
    expect(() => assertJoiningFeeAllowed('CLASS_PACK', 0, undefined)).not.toThrow();
    expect(() => assertJoiningFeeAllowed('CLASS_PACK', 0, null)).not.toThrow();
    expect(() => assertJoiningFeeAllowed('TRIAL_MEMBERSHIP', 0, 500)).toThrow('Only a paid plan can have a joining fee.');
    expect(() => assertJoiningFeeAllowed('FRIEND_PASS', 1000, 500)).toThrow('Only a paid plan can have a joining fee.');
    expect(() => assertJoiningFeeAllowed('SUBSCRIPTION', 2147483000, 1000)).toThrow('too big');
  });

  it('leaves a non-refundable fee out of refunds, and a refundable one in', () => {
    expect(nonRefundableJoiningFee({ joiningFeeAmount: 1500, joiningFeeRefundable: false })).toBe(1500);
    expect(nonRefundableJoiningFee({ joiningFeeAmount: 1500, joiningFeeRefundable: true })).toBe(0);
    expect(nonRefundableJoiningFee({ joiningFeeAmount: 0, joiningFeeRefundable: false })).toBe(0);
  });

  it("shares only the refundable part of a Class Pack's payment among its classes", () => {
    // A 4-class pack at 4000 with a non-refundable 1000 fee: the payment is
    // 5000, each class's share is 1000 and the four shares add up to 4000.
    const paid = 5000 - nonRefundableJoiningFee({ joiningFeeAmount: 1000, joiningFeeRefundable: false });
    const shares = [0, 1, 2, 3].map((prior) => classShare(paid, prior * 1000, 4, prior, 1));
    expect(shares).toEqual([1000, 1000, 1000, 1000]);
  });
});

import { keptRevenue } from './charge-reports.service';

/** Decision 448 item 1: what the School kept of a payment, price and card surcharge apart. */
describe('keptRevenue', () => {
  const row = (o: Partial<Parameters<typeof keptRevenue>[0]>) => ({ amount: 3000, surchargeAmount: 90, refundedAmount: null, joiningFeeAmount: 0, joiningFeeRefundable: false, ...o });

  it('keeps the price and the surcharge apart when nothing was refunded', () => {
    expect(keptRevenue(row({}))).toEqual({ price: 3000, surcharge: 90 });
    expect(keptRevenue(row({ surchargeAmount: 0 }))).toEqual({ price: 3000, surcharge: 0 });
  });

  it('takes a refund off the price first, then the surcharge', () => {
    expect(keptRevenue(row({ refundedAmount: 1000 }))).toEqual({ price: 2000, surcharge: 90 });
    expect(keptRevenue(row({ refundedAmount: 3040 }))).toEqual({ price: 0, surcharge: 50 });
    expect(keptRevenue(row({ refundedAmount: 3090 }))).toEqual({ price: 0, surcharge: 0 });
  });

  it('a non-refundable joining fee is kept as price; the surcharge goes back before it', () => {
    const fee = { amount: 5000, joiningFeeAmount: 1000, joiningFeeRefundable: false };
    expect(keptRevenue(row({ ...fee, refundedAmount: 4090 }))).toEqual({ price: 1000, surcharge: 0 });
    expect(keptRevenue(row({ ...fee, refundedAmount: 4040 }))).toEqual({ price: 1000, surcharge: 50 });
    // Only a Stripe dashboard refund reaches the fee itself.
    expect(keptRevenue(row({ ...fee, refundedAmount: 4590 }))).toEqual({ price: 500, surcharge: 0 });
    // A refundable fee is refunded with the price.
    expect(keptRevenue(row({ ...fee, joiningFeeRefundable: true, refundedAmount: 4500 }))).toEqual({ price: 500, surcharge: 90 });
  });

  it('is never below nothing', () => {
    expect(keptRevenue(row({ refundedAmount: 99999 }))).toEqual({ price: 0, surcharge: 0 });
    expect(keptRevenue(row({ refundedAmount: -5 }))).toEqual({ price: 3000, surcharge: 90 });
  });
});

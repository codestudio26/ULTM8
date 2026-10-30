import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import * as auth from '../auth/AuthContext';
import * as stepUpQueries from '../auth/stepUpQueries';
import * as q from './chargeQueries';
import { MyChargesScreen } from './MyChargesScreen';

jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../auth/stepUpQueries', () => ({ useVerifyStepUp: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('./chargeQueries', () => ({
  useMemberCharges: jest.fn(),
  useStartChargeCheckout: jest.fn(),
  useSetChargeAutoPay: jest.fn(),
  useInvalidateMemberCharges: jest.fn(),
}));

// The first render loads every React Native component this screen uses; on a
// busy runner that alone can pass jest's default 5 s.
jest.setTimeout(30_000);

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;
const ok = (data: unknown) => ({ data, isLoading: false, error: null });
const nav = () => ({ navigate: jest.fn() }) as never;

const charge = (over: Record<string, unknown>) => ({
  id: 'c1',
  schoolId: 's1',
  studentId: 'me',
  invoiceNumber: 1,
  invoiceLabel: '#0000001',
  description: 'Rash guard',
  unitAmount: 12000,
  discountType: null,
  discountValue: null,
  discountAmount: 0,
  taxCountry: 'GB',
  taxRateBasisPoints: 2000,
  taxInclusive: true,
  netAmount: 10000,
  taxAmount: 2000,
  grossAmount: 12000,
  currency: 'GBP',
  dueDate: '2026-11-15',
  paidAmount: 5000,
  owedAmount: 7000,
  status: 'PART_PAID',
  overdue: true,
  createdAt: '2026-10-30T10:00:00.000Z',
  createdByName: null,
  cancelledAt: null,
  cancelledByName: null,
  cancelReason: null,
  cardSurchargeAmount: 0,
  refundedAmount: 0,
  refundStatus: null,
  ...over,
});

const PAY_IN_APP = { available: true, blockedReason: null, savedCard: false, autoPay: false, canSetAutoPay: false };
const payment = (over: Record<string, unknown>) => ({
  id: 't1',
  schoolId: 's1',
  amount: 5000,
  currency: 'GBP',
  paymentMethod: 'CASH',
  channel: 'DESK',
  status: 'SUCCESSFUL',
  surchargeAmount: 0,
  invoiceLabel: '#0000001',
  receivedAt: '2026-10-30T11:00:00.000Z',
  recordedByName: null,
  allocations: [{ chargeId: 'c1', invoiceLabel: '#0000001', amount: 5000 }],
  creditAmount: 0,
  refundedAmount: 0,
  refundStatus: null,
  refunds: [],
  refundable: null,
  ...over,
});

const SCHOOL = {
  schoolId: 's1',
  schoolName: 'Alpha Dojo',
  taxId: 'GB123',
  receiptAddress: null,
  receiptPaymentInstructions: null,
  credits: [],
  balances: [{ schoolId: 's1', currency: 'GBP', owed: 7000, credit: 0, net: 7000, overdue: 7000, payableAmount: 7000, cardSurchargeAmount: 0 }],
  charges: [
    charge({}),
    charge({ id: 'c2', invoiceNumber: 2, invoiceLabel: '#0000002', description: 'Patch', status: 'CANCELLED', cancelledAt: '2026-10-31T10:00:00.000Z', owedAmount: 0, paidAmount: 0, overdue: false }),
  ],
  payments: [payment({})],
  payInApp: { ...PAY_IN_APP, available: false, blockedReason: 'NO_CARD_PAYMENTS' },
};

const idle = () => ({ mutate: jest.fn(), isPending: false, isError: false, error: null });
let checkout: ReturnType<typeof idle>;
let setAutoPay: ReturnType<typeof idle>;
let invalidate: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  checkout = idle();
  setAutoPay = idle();
  invalidate = jest.fn();
  mocked(auth.useAuth).mockReturnValue({ claims: { sub: 'me', grants: [] } });
  mocked(q.useMemberCharges).mockReturnValue(ok({ schools: [SCHOOL] }));
  mocked(q.useStartChargeCheckout).mockReturnValue(checkout);
  mocked(q.useSetChargeAutoPay).mockReturnValue(setAutoPay);
  mocked(q.useInvalidateMemberCharges).mockReturnValue(invalidate);
  mocked(stepUpQueries.useVerifyStepUp).mockReturnValue({
    mutate: jest.fn((_p: string, opts?: { onSuccess?: (d: { stepUpToken: string }) => void }) => opts?.onSuccess?.({ stepUpToken: 'tok' })),
    isPending: false,
    isError: false,
    error: null,
  });
});

describe('MyChargesScreen (Decisions 303, 338)', () => {
  it('shows the balance, each invoice with ex. tax, tax and inc. tax, and the receipts', async () => {
    const { getByText, getAllByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(mocked(q.useMemberCharges)).toHaveBeenCalledWith('me');
    expect(getByText(/You owe/)).toBeTruthy();
    expect(getByText(/overdue/)).toBeTruthy();
    expect(getByText('Tax ID: GB123')).toBeTruthy();
    expect(getByText('Rash guard')).toBeTruthy();
    expect(getByText('Part paid')).toBeTruthy();
    expect(getAllByText('Price ex. tax')).toHaveLength(2);
    expect(getAllByText('Tax (20%)')).toHaveLength(2);
    expect(getAllByText('Price inc. tax')).toHaveLength(2);
    expect(getByText('Still to pay')).toBeTruthy();
    // A cancelled charge stays listed, with nothing to pay.
    expect(getByText('Cancelled')).toBeTruthy();
    expect(getByText(/Nothing to pay\.$/)).toBeTruthy();
    expect(getByText(/paid on .* by cash/)).toBeTruthy();
    expect(getByText('Toward #0000001')).toBeTruthy();
  });

  it('a guardian opens it for their child', async () => {
    const { getByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: { studentId: 'kid', name: 'Kai' } } as never} />);
    expect(mocked(q.useMemberCharges)).toHaveBeenCalledWith('kid');
    expect(getByText(/^Owes /)).toBeTruthy();
  });

  it('says so when there are no invoices', async () => {
    mocked(q.useMemberCharges).mockReturnValue(ok({ schools: [] }));
    const { getByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText('No invoices yet.')).toBeTruthy();
  });

  it('shows credit, and nothing to pay', async () => {
    mocked(q.useMemberCharges).mockReturnValue(
      ok({ schools: [{ ...SCHOOL, charges: [], payments: [], balances: [{ schoolId: 's1', currency: 'GBP', owed: 0, credit: 3000, net: -3000, overdue: 0 }] }] }),
    );
    const { getByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText(/in credit/)).toBeTruthy();
  });

  it('without card payments at the School, says to pay at the desk and offers no Pay button', async () => {
    const { getByText, queryByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText("To pay, ask at your School's front desk.")).toBeTruthy();
    expect(queryByText(/^Pay /)).toBeNull();
  });
});

const CARD_SCHOOL = {
  ...SCHOOL,
  balances: [{ ...SCHOOL.balances[0], cardSurchargeAmount: 140 }],
  charges: [charge({ cardSurchargeAmount: 140 })],
  payInApp: PAY_IN_APP,
};

describe('MyChargesScreen: paying in the app (backlog 3.6 step 2)', () => {
  it('shows the surcharge before paying and opens a Checkout for the balance, then re-reads', async () => {
    mocked(q.useMemberCharges).mockReturnValue(ok({ schools: [CARD_SCHOOL] }));
    checkout.mutate.mockImplementation(((_v: unknown, opts: { onSuccess: (r: unknown) => Promise<void> }) => opts.onSuccess({ checkoutUrl: 'https://checkout.example/s' })) as never);
    const { getByText, getAllByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getAllByText('Includes a card surcharge of £1.40')).toHaveLength(2);
    await fireEvent.press(getByText('Pay balance (£71.40)'));
    expect(checkout.mutate).toHaveBeenCalledWith({ studentId: 'me', schoolId: 's1', currency: 'GBP' }, expect.anything());
    await waitFor(() => expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith('https://checkout.example/s', 'ultm8-student://charge-payment/complete'));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it('pays a single charge', async () => {
    mocked(q.useMemberCharges).mockReturnValue(ok({ schools: [CARD_SCHOOL] }));
    const { getByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: undefined } as never} />);
    await fireEvent.press(getByText('Pay £71.40'));
    expect(checkout.mutate).toHaveBeenCalledWith({ studentId: 'me', schoolId: 's1', chargeId: 'c1' }, expect.anything());
  });

  it('a Guardian pays for a child, and is not offered automatic payment', async () => {
    mocked(q.useMemberCharges).mockReturnValue(ok({ schools: [CARD_SCHOOL] }));
    const { getByText, queryByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: { studentId: 'kid', name: 'Kai' } } as never} />);
    await fireEvent.press(getByText('Pay balance (£71.40)'));
    expect(checkout.mutate).toHaveBeenCalledWith({ studentId: 'kid', schoolId: 's1', currency: 'GBP' }, expect.anything());
    expect(queryByText('Pay charges automatically with my saved card')).toBeNull();
  });

  it('a restricted account is told to pay at the desk', async () => {
    mocked(q.useMemberCharges).mockReturnValue(ok({ schools: [{ ...CARD_SCHOOL, payInApp: { ...PAY_IN_APP, available: false, blockedReason: 'RESTRICTED' } }] }));
    const { getByText, queryByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText('This account can only pay by cash or bank transfer. Pay at the front desk.')).toBeTruthy();
    expect(queryByText(/^Pay balance/)).toBeNull();
  });

  it('turning automatic payment on asks for the passcode; turning it off does not', async () => {
    mocked(q.useMemberCharges).mockReturnValue(ok({ schools: [{ ...CARD_SCHOOL, payInApp: { ...PAY_IN_APP, savedCard: true, canSetAutoPay: true } }] }));
    const { getByLabelText, getByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: undefined } as never} />);
    await fireEvent(getByLabelText('Pay charges automatically with my saved card'), 'valueChange', true);
    expect(setAutoPay.mutate).not.toHaveBeenCalled();
    expect(getByText('Confirm')).toBeTruthy();
  });

  it('turning it off needs no passcode', async () => {
    mocked(q.useMemberCharges).mockReturnValue(ok({ schools: [{ ...CARD_SCHOOL, payInApp: { ...PAY_IN_APP, savedCard: true, autoPay: true, canSetAutoPay: true } }] }));
    const { getByLabelText, getByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText('Your saved card is charged on each due date.')).toBeTruthy();
    await fireEvent(getByLabelText('Pay charges automatically with my saved card'), 'valueChange', false);
    expect(setAutoPay.mutate).toHaveBeenCalledWith({ studentId: 'me', schoolId: 's1', enabled: false });
  });

  it('without a saved card, says how to get one', async () => {
    mocked(q.useMemberCharges).mockReturnValue(ok({ schools: [CARD_SCHOOL] }));
    const { getByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText('Save a card in Payment methods to pay charges automatically.')).toBeTruthy();
  });

  it('shows card receipts with their surcharge, a payment in progress and a failed automatic payment', async () => {
    mocked(q.useMemberCharges).mockReturnValue(
      ok({
        schools: [
          {
            ...CARD_SCHOOL,
            payments: [
              payment({ id: 'a', paymentMethod: 'STRIPE', channel: 'APP', surchargeAmount: 100, amount: 5000 }),
              payment({ id: 'b', paymentMethod: 'STRIPE', channel: 'AUTOMATIC', status: 'PENDING', allocations: [] }),
              payment({ id: 'c', paymentMethod: 'STRIPE', channel: 'AUTOMATIC', status: 'FAILED', allocations: [] }),
            ],
          },
        ],
      }),
    );
    const { getByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText(/£51.00 paid on .* by card in the app/)).toBeTruthy();
    expect(getByText('Includes a card surcharge of £1.00')).toBeTruthy();
    expect(getByText(/£50.00 card payment processing/)).toBeTruthy();
    expect(getByText(/Automatic payment of £50.00 failed on/)).toBeTruthy();
  });
});

describe('MyChargesScreen: refunds, credit and receipt details (backlog 3.6 step 4)', () => {
  it('shows Refunded on a refunded charge and payment, each refund, credit from the School and the School\'s address and payment instructions', async () => {
    mocked(q.useMemberCharges).mockReturnValue(
      ok({
        schools: [
          {
            ...SCHOOL,
            receiptAddress: '1 High Street, London',
            receiptPaymentInstructions: 'Sort code 00-00-00',
            balances: [{ ...SCHOOL.balances[0], owed: 0, net: 0, overdue: 0, payableAmount: 0 }],
            charges: [charge({ status: 'PAID', owedAmount: 0, paidAmount: 7000, overdue: false, refundedAmount: 5000, refundStatus: 'PART_REFUNDED' })],
            payments: [
              payment({
                amount: 12000,
                refundedAmount: 5000,
                refundStatus: 'PART_REFUNDED',
                refunds: [{ id: 'r1', kind: 'CARD', amount: 5000, refundedAt: '2026-10-31T10:00:00.000Z', notes: null, refundedByName: null }],
              }),
            ],
            credits: [{ id: 'cr1', amount: 1000, currency: 'GBP', givenAt: '2026-10-31T12:00:00.000Z', note: null, givenByName: null }],
          },
        ],
      }),
    );
    const { getByText, getAllByText } = await render(<MyChargesScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getAllByText('Part refunded')).toHaveLength(2);
    expect(getByText(/£50.00 refunded to your card on/)).toBeTruthy();
    expect(getByText(/£10.00 credit from your School on/)).toBeTruthy();
    expect(getByText('Address: 1 High Street, London')).toBeTruthy();
    expect(getByText('How to pay: Sort code 00-00-00')).toBeTruthy();
  });
});

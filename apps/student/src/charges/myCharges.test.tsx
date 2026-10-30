import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import * as auth from '../auth/AuthContext';
import * as q from './chargeQueries';
import { MyChargesScreen } from './MyChargesScreen';

jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('./chargeQueries', () => ({ useMemberCharges: jest.fn() }));

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
  ...over,
});

const SCHOOL = {
  schoolId: 's1',
  schoolName: 'Alpha Dojo',
  taxId: 'GB123',
  balances: [{ schoolId: 's1', currency: 'GBP', owed: 7000, credit: 0, net: 7000, overdue: 7000 }],
  charges: [
    charge({}),
    charge({ id: 'c2', invoiceNumber: 2, invoiceLabel: '#0000002', description: 'Patch', status: 'CANCELLED', cancelledAt: '2026-10-31T10:00:00.000Z', owedAmount: 0, paidAmount: 0, overdue: false }),
  ],
  payments: [
    { id: 't1', schoolId: 's1', amount: 5000, currency: 'GBP', paymentMethod: 'CASH', receivedAt: '2026-10-30T11:00:00.000Z', recordedByName: null, allocations: [{ chargeId: 'c1', invoiceLabel: '#0000001', amount: 5000 }], creditAmount: 0 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked(auth.useAuth).mockReturnValue({ claims: { sub: 'me', grants: [] } });
  mocked(q.useMemberCharges).mockReturnValue(ok({ schools: [SCHOOL] }));
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
});

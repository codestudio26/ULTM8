import { describe, expect, it } from '@jest/globals';
import { formatMoney } from './money';
import { schoolTime, transactionsCsv } from '../transactions/transactionsCsv';
import { taxLinesProblem } from '../charges/taxLines';

/** Decision 430 (stress test round 5, MONEY): the portal's own money helpers. */
describe('each currency its own decimals (TXT-6, MON-10)', () => {
  it('shows yen without decimals and dollars with two', () => {
    expect(formatMoney(123400, 'JPY')).not.toMatch(/[.,]00\b/);
    expect(formatMoney(123400, 'JPY')).toMatch(/1,?234/);
    expect(formatMoney(1250, 'USD')).toContain('12.50');
  });
});

describe("the CSV's School time column (MON-7)", () => {
  it("writes the moment in the School's time zone", () => {
    expect(schoolTime('2026-03-31T16:00:00.000Z', 'Asia/Tokyo')).toBe('2026-04-01 01:00');
    expect(schoolTime('2026-03-31T16:00:00.000Z', null)).toBe('2026-03-31 16:00');
    expect(schoolTime('2026-03-31T16:00:00.000Z', 'Not/AZone')).toBe('2026-03-31 16:00');
  });

  it('puts it right after the ISO date', () => {
    const csv = transactionsCsv([{ billingDate: '2026-03-31T16:00:00.000Z', amount: 100000, currency: 'JPY', surchargeAmount: 0 } as never], {
      headers: ['Date', 'Date (School time)'],
      item: () => '',
      student: () => '',
      kind: () => '',
      status: () => '',
      method: () => '',
      timeZone: 'Asia/Tokyo',
    });
    expect(csv.split('\r\n')[1].startsWith('2026-03-31T16:00:00.000Z,2026-04-01 01:00,')).toBe(true);
  });
});

describe('two tax lines (MON-6)', () => {
  const line = (name: string, rate: string) => ({ name, rate, taxId: '' });
  it('needs a name on a second line with a rate, and at most 100% together', () => {
    expect(taxLinesProblem(line('GST', '5'), line('', '7'))).toBe('secondNameRequired');
    expect(taxLinesProblem(line('GST', '60'), line('PST', '50'))).toBe('tooHigh');
    expect(taxLinesProblem(line('GST', '5'), line('PST', '7'))).toBeNull();
    expect(taxLinesProblem(line('GST', '5'), line('', '0'))).toBeNull();
  });
});

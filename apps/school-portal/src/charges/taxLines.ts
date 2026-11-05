/** Decision 431 (MON-6 step 2): the pure parts of the tax line fields. */

/** "20" / "8.10" / "0" → 2000 / 810 / 0; null when it isn't a rate from 0 to 100 with at most 2 decimals. */
export function parseRate(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return bp <= 10000 ? bp : null;
}

export function rateText(basisPoints: number): string {
  return String(basisPoints / 100);
}

/**
 * Decision 431 (MON-6 step 2): one named tax line as an owner types it: its
 * name (GST, PST, VAT…), its rate in percent and its registration number,
 * shown on invoices and receipts. Used for the School's two lines and a
 * Branch's own two.
 */
export interface TaxLineDraft {
  name: string;
  rate: string;
  taxId: string;
}

export function taxLineDraft(name: string | null | undefined, rateBasisPoints: number | null | undefined, taxId: string | null | undefined): TaxLineDraft {
  return { name: name ?? '', rate: rateText(rateBasisPoints ?? 0), taxId: taxId ?? '' };
}

/** The line as the API takes it; rate null when it isn't a rate. */
export function taxLineBody(line: TaxLineDraft) {
  return { name: line.name.trim() || null, rateBasisPoints: parseRate(line.rate), taxId: line.taxId.trim() || null };
}

/** Both lines together at most 100%, and a second line with a rate has a name
 * (the API checks the same: TAX_LINES_TOO_HIGH, TAX_LINE_NAME_REQUIRED). */
export function taxLinesProblem(line1: TaxLineDraft, line2: TaxLineDraft): 'invalid' | 'tooHigh' | 'secondNameRequired' | null {
  const r1 = parseRate(line1.rate);
  const r2 = parseRate(line2.rate);
  if (r1 === null || r2 === null) return 'invalid';
  if (r1 + r2 > 10000) return 'tooHigh';
  if (r2 > 0 && !line2.name.trim()) return 'secondNameRequired';
  return null;
}


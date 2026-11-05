import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MAX_BASIS_POINTS, computeCharge } from './charge-maths';

/**
 * Named tax lines (Decision 431, stress test round 5 MON-6 step 2): up to two
 * per School, each with a name, a rate and its own registration number (GST
 * 5% and PST 7% in British Columbia; 消費税 10% in Japan; VAT 5% in the UAE),
 * and a Branch override for both. Whether prices include tax and the tax
 * country stay School-wide (Decision 411).
 */
export interface TaxLineSetting {
  name: string | null;
  rateBasisPoints: number;
  /** The line's registration number, shown on invoices and receipts. */
  taxId: string | null;
}

/** A line as worked out on one charge or receipt. */
export interface TaxLineAmount extends TaxLineSetting {
  amount: number;
}

export interface EffectiveTax {
  taxCountry: string | null;
  taxInclusive: boolean;
  /** Lines with a rate above 0, in order (line 1, then line 2). */
  lines: TaxLineSetting[];
  /** The Branch whose override applies, or null for the School's own lines. */
  branchId: string | null;
}

type TaxColumns = {
  taxName: string | null;
  taxRateBasisPoints: number;
  taxId: string | null;
  tax2Name: string | null;
  tax2RateBasisPoints: number;
  tax2Id: string | null;
};

/** The two lines of a School or Branch row, without the ones at 0%. */
export function linesOf(row: TaxColumns): TaxLineSetting[] {
  return [
    { name: row.taxName, rateBasisPoints: row.taxRateBasisPoints, taxId: row.taxId },
    { name: row.tax2Name, rateBasisPoints: row.tax2RateBasisPoints, taxId: row.tax2Id },
  ].filter((l) => l.rateBasisPoints > 0);
}

const TAX_COLUMNS = { taxName: true, taxRateBasisPoints: true, taxId: true, tax2Name: true, tax2RateBasisPoints: true, tax2Id: true } as const;

/**
 * The tax a member's charges use at a School: their home Branch's lines when
 * that Branch overrides them, else the School's. The same rule as the
 * effective_tax_snapshot() database function (migration 20270221000000), which
 * stamps membership receipts. Read on a connection that may read the School,
 * its Branches and home Branches (the jobs connection).
 */
export async function loadEffectiveTax(
  db: Pick<Prisma.TransactionClient, 'school' | 'studentHomeBranch'>,
  schoolId: string,
  studentId: string | null,
): Promise<EffectiveTax> {
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { taxCountry: true, taxInclusive: true, ...TAX_COLUMNS } });
  const home = studentId
    ? await db.studentHomeBranch.findUnique({
        where: { schoolId_studentId: { schoolId, studentId } },
        select: { branch: { select: { id: true, schoolId: true, taxOverride: true, ...TAX_COLUMNS } } },
      })
    : null;
  const branch = home?.branch && home.branch.schoolId === schoolId && home.branch.taxOverride ? home.branch : null;
  return { taxCountry: school.taxCountry, taxInclusive: school.taxInclusive, lines: linesOf(branch ?? school), branchId: branch?.id ?? null };
}

/** The combined rate of some lines, in hundredths of a percent. */
export function combinedRate(lines: Pick<TaxLineSetting, 'rateBasisPoints'>[]): number {
  return lines.reduce((sum, l) => sum + l.rateBasisPoints, 0);
}

/**
 * Checks two lines as an owner saves them (School page or Branch page): each
 * rate 0-100% (the DTOs check that), together at most 100%, and a second line
 * needs a name, so the receipt can tell the two apart.
 */
export function assertTaxLinesValid(line1Rate: number, line2Rate: number, line2Name: string | null | undefined): void {
  if (line1Rate + line2Rate > MAX_BASIS_POINTS) {
    throw new BadRequestException({ code: 'TAX_LINES_TOO_HIGH', message: 'The two tax rates together can be at most 100%.' });
  }
  if (line2Rate > 0 && !line2Name?.trim()) {
    throw new BadRequestException({ code: 'TAX_LINE_NAME_REQUIRED', message: 'Give the second tax a name, such as PST.' });
  }
}

/** A stored Transaction.taxSnapshot, read defensively (it is JSON). */
export function readTaxSnapshot(value: unknown): { inclusive: boolean; lines: TaxLineSetting[] } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { inclusive?: unknown; lines?: unknown };
  if (typeof v.inclusive !== 'boolean' || !Array.isArray(v.lines)) return null;
  const lines = v.lines
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map((l) => ({
      name: typeof l.name === 'string' ? l.name : null,
      rateBasisPoints: typeof l.rateBasisPoints === 'number' ? l.rateBasisPoints : 0,
      taxId: typeof l.taxId === 'string' ? l.taxId : null,
    }))
    .filter((l) => l.rateBasisPoints > 0);
  return { inclusive: v.inclusive, lines };
}

/** A stored Charge.taxLines, read defensively (it is JSON); null when absent. */
export function readChargeTaxLines(value: unknown): TaxLineAmount[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map((l) => ({
      name: typeof l.name === 'string' ? l.name : null,
      rateBasisPoints: typeof l.rateBasisPoints === 'number' ? l.rateBasisPoints : 0,
      taxId: typeof l.taxId === 'string' ? l.taxId : null,
      amount: typeof l.amount === 'number' ? l.amount : 0,
    }));
}

export interface IncludedTax {
  amount: number;
  lines: TaxLineAmount[];
}

/**
 * Decision 431 (MON-6 step 1): the tax a membership sale or renewal of
 * `amount` included, from the tax settings stamped on its Transaction when it
 * was paid (taxSnapshot). Membership prices are never taxed on top (that is
 * MON-6 step 3, v1.3 backlog), so this is only shown when the School's prices
 * include tax; null otherwise, for 0% or for a row from before the stamp.
 * Worked out as a charge's tax is (computeCharge), rounded to the currency's
 * own minor unit.
 */
export function includedTax(amount: number, currency: string | null, snapshot: unknown): IncludedTax | null {
  const tax = readTaxSnapshot(snapshot);
  if (!tax || !tax.inclusive || tax.lines.length === 0 || amount <= 0) return null;
  try {
    const totals = computeCharge({ unitAmount: amount, taxRateBasisPoints: combinedRate(tax.lines), taxInclusive: true, taxLines: tax.lines, currency });
    return totals.taxAmount > 0 ? { amount: totals.taxAmount, lines: totals.taxLines ?? [] } : null;
  } catch {
    return null;
  }
}

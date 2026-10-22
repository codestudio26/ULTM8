import { BadRequestException } from '@nestjs/common';
import { Branch } from '@prisma/client';
import { CursorPage, resolveLimit } from '../../common/pagination/cursor-paginate';

/** Lower case, accents removed, so "Sao Paulo" finds "São Paulo". */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** Postcodes compare without spaces ("sw1a1aa" finds "SW1A 1AA"). */
function foldPostcode(value: string): string {
  return foldText(value).replace(/\s+/g, '');
}

export interface BranchListFilter {
  /** Exact city (case and accents ignored) against `addressCity`. A Branch
   * saved before Decision 276 has no `addressCity`, so it falls back to its
   * free-text `address` containing the city. */
  city?: string;
  /** Branch name, city or postcode containing the text. */
  q?: string;
  /** ISO 3166-1 alpha-2, against `addressCountry`. */
  country?: string;
}

/** Decision 294 — done in memory rather than in SQL, because Postgres can't
 * ignore accents without the `unaccent` extension, which this database
 * doesn't have, and a School's Branch list is small (tens, not thousands).
 * Matching here also makes `%` and `_` plain characters, which Prisma's
 * `contains` passed through to LIKE as wildcards. */
export function matchesBranchFilter(branch: Pick<Branch, 'name' | 'address' | 'addressCity' | 'addressPostalCode' | 'addressCountry'>, filter: BranchListFilter): boolean {
  if (filter.city) {
    const city = foldText(filter.city);
    if (branch.addressCity) {
      if (foldText(branch.addressCity) !== city) return false;
    } else if (!branch.address || !foldText(branch.address).includes(city)) {
      return false;
    }
  }
  if (filter.country && branch.addressCountry !== filter.country.toUpperCase()) return false;
  if (filter.q) {
    const q = foldText(filter.q);
    const haystacks = [branch.name, branch.addressCity ?? (branch.addressCountry ? null : branch.address)];
    const textHit = haystacks.some((h) => h && foldText(h).includes(q));
    const postcodeHit = !!branch.addressPostalCode && foldPostcode(branch.addressPostalCode).includes(q.replace(/\s+/g, ''));
    if (!textHit && !postcodeHit) return false;
  }
  return true;
}

/** Name order, A to Z, ignoring case and accents; id breaks ties. */
export function compareBranches(a: Pick<Branch, 'name' | 'id'>, b: Pick<Branch, 'name' | 'id'>): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function encodeCursor(row: Pick<Branch, 'name' | 'id'>): string {
  return Buffer.from(JSON.stringify({ name: row.name, id: row.id })).toString('base64url');
}

function decodeCursor(cursor: string): { name: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed?.name === 'string' && typeof parsed?.id === 'string') return parsed;
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor');
}

/** Keyset pagination over an already name-sorted list. The cursor carries
 * the last row's name and id, so a Branch renamed or archived between pages
 * never makes the next page skip or repeat a row. */
export function paginateSorted<T extends Pick<Branch, 'name' | 'id'>>(sorted: T[], cursor: string | undefined, limit: number | undefined): CursorPage<T> {
  const take = resolveLimit(limit);
  const after = cursor ? decodeCursor(cursor) : null;
  const start = after ? sorted.findIndex((row) => compareBranches(row, after) > 0) : 0;
  const rest = start < 0 ? [] : sorted.slice(start);
  const items = rest.slice(0, take);
  return { items, nextCursor: rest.length > take ? encodeCursor(items[items.length - 1]) : null };
}

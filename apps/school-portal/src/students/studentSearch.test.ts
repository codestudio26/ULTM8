import { describe, expect, it } from '@jest/globals';
import { matchesNameSearch } from '@ultm8/i18n';
import { NAME_SEARCH_MUST_MATCH, NAME_SEARCH_MUST_NOT_MATCH } from '@ultm8/i18n/src/search/nameSearchVectors';
import { matchesSearch } from './studentSearch';

const student = (firstName: string, surname: string, email = 'someone@example.test') => ({ firstName, surname, email });

describe('the shared search fold (Decision 433, TXT-1)', () => {
  it('finds every spelling of the 46 shared vectors that must be found, and merges none that must not', () => {
    expect(NAME_SEARCH_MUST_MATCH.filter(([f, l, q]) => !matchesNameSearch(f, l, q))).toEqual([]);
    expect(NAME_SEARCH_MUST_NOT_MATCH.filter(([f, l, q]) => matchesNameSearch(f, l, q))).toEqual([]);
  });
});

describe('Students list search (Decision 371, folded per Decision 433)', () => {
  it('every typed word starts a word of the name, ignoring case and accents', () => {
    expect(matchesSearch(student('João', 'Conceição'), 'joao conc')).toBe(true);
    expect(matchesSearch(student('Sébastien', 'Martin'), 'Sebastien')).toBe(true);
    expect(matchesSearch(student('Ana', 'Souza'), 'na')).toBe(false);
  });

  it('Arabic spelling variants and a name typed surname first without spaces', () => {
    expect(matchesSearch(student('فاطمة', 'المنصوري'), 'فاطمه')).toBe(true);
    expect(matchesSearch(student('翔太', '佐藤'), '佐藤翔太')).toBe(true);
    expect(matchesSearch(student('翔太', '佐藤'), '佐藤\u3000翔太')).toBe(true);
  });

  it('keeps Hindi names that differ by a virama apart', () => {
    expect(matchesSearch(student('Rahul', 'शर\u094Dम\u093E'), 'शरम\u093E')).toBe(false);
  });

  it('still matches the email, and a person with only one name', () => {
    expect(matchesSearch(student('Ana', 'Souza', 'ana.souza@example.test'), 'ana.souza')).toBe(true);
    expect(matchesSearch(student('Venkataraghavan', ''), 'venkat')).toBe(true);
  });
});

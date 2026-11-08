import { firstGrapheme as appFirstGrapheme, foldForSearch as appFold, isSymbolsOnlySearch, matchesNameSearch } from '@ultm8/i18n';
import { NAME_SEARCH_MUST_MATCH, NAME_SEARCH_MUST_NOT_MATCH } from '@ultm8/i18n/src/search/nameSearchVectors';
import { firstGrapheme, foldForSearch, foldText, matchesPersonName } from './name-search';

/**
 * Decision 434 (TXT-1, TXT-7): one search fold, kept as two identical copies
 * (this API's and packages/i18n's for the apps), both checked against the
 * round-5 text panel's 46 shared vectors.
 */
describe('foldForSearch / matchesPersonName (Decision 434, TXT-1)', () => {
  it('has the 46 shared vectors', () => {
    expect(NAME_SEARCH_MUST_MATCH.length + NAME_SEARCH_MUST_NOT_MATCH.length).toBe(46);
  });

  for (const [label, matches] of [
    ['API', matchesPersonName],
    ['packages/i18n', matchesNameSearch],
  ] as const) {
    it(`${label}: finds every spelling that must be found`, () => {
      const missed = NAME_SEARCH_MUST_MATCH.filter(([first, last, typed]) => !matches(first, last, typed));
      expect(missed).toEqual([]);
    });
    it(`${label}: keeps different names apart`, () => {
      const merged = NAME_SEARCH_MUST_NOT_MATCH.filter(([first, last, typed]) => matches(first, last, typed));
      expect(merged).toEqual([]);
    });
  }

  it('both copies fold every vector the same way', () => {
    for (const row of [...NAME_SEARCH_MUST_MATCH, ...NAME_SEARCH_MUST_NOT_MATCH]) {
      for (const text of row) expect(appFold(text)).toBe(foldForSearch(text));
    }
  });

  it('treats the one-character za (U+095B) and ja + nukta (U+091C U+093C) as the same letter', () => {
    expect(matchesPersonName('\u095B\u094B\u092F\u093E', 'x', '\u091C\u093C\u094B\u092F\u093E')).toBe(true);
    expect(matchesPersonName('\u091C\u093C\u094B\u092F\u093E', 'x', '\u095B\u094B\u092F\u093E')).toBe(true);
  });

  it('a blank query matches everyone; a mononym (empty surname) is found by its one name', () => {
    expect(matchesPersonName('Ana', 'Souza', '   ')).toBe(true);
    expect(matchesPersonName('Venkataraghavan', '', 'venkata')).toBe(true);
    expect(matchesPersonName('Venkataraghavan', '', 'souza')).toBe(false);
  });

  it('Decision 448 item 13: a query of only symbols matches nobody, in both copies', () => {
    for (const matches of [matchesPersonName, matchesNameSearch]) {
      for (const q of ['%', '_', '%_%', ' !! ', '-', '\u3000@\u3000']) expect(matches('Ana', 'Souza', q)).toBe(false);
      expect(matches('Ana', 'Souza', '')).toBe(true);
      expect(matches('Ana', 'Souza', '%ana%')).toBe(true);
    }
    expect(['%', '_', ' !! '].every(isSymbolsOnlySearch)).toBe(true);
    expect(['', '   ', 'a%', '7'].some(isSymbolsOnlySearch)).toBe(false);
  });

  it('foldText is the same fold, keeping punctuation (Branch filters and waiver signatures)', () => {
    expect(foldText('São Paulo')).toBe('sao paulo');
    expect(foldText('शर\u094Dम\u093E')).not.toBe(foldText('शरम\u093E'));
    // Decision 294: punctuation stays plain text in Branch filters.
    expect(foldText('100% Fight Club')).toBe('100% fight club');
    expect(foldText('Lond_n')).toBe('lond_n');
  });
});

describe('firstGrapheme (Decision 434, TXT-7)', () => {
  const cases: Array<[string, string]> = [
    // A whole grapheme: the consonant with its nukta and vowel sign, never "ख" alone.
    ['ख\u093C\u093Eन', 'ख\u093C\u093E'],
    ['ஸ\u0BCDர\u0BC0ந\u0BBFவ\u0BBEசன\u0BCD', 'ஸ\u0BCD'],
    ['\u{1D49C}rjun', '\u{1D49C}'],
    ['  smith', 'S'],
    ['', ''],
    ['João', 'J'],
  ];
  for (const [label, impl] of [
    ['API', firstGrapheme],
    ['packages/i18n', appFirstGrapheme],
  ] as const) {
    it(`${label}: takes the first whole letter`, () => {
      for (const [name, want] of cases) expect(impl(name)).toBe(want);
      expect(impl(null)).toBe('');
      // Never a lone surrogate.
      expect(impl('\u{1F600}x')).toBe('\u{1F600}');
    });
  }
});

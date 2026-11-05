/**
 * Shared test vectors for foldForSearch / matchesNameSearch (Decision 433, TXT-1):
 * the 46 cases the round-5 text panel checked across five scripts. Each row is
 * [stored first name, stored surname, what was typed]. Both copies of the fold
 * (this package's, and apps/api's common/search/name-search.ts) are tested
 * against these same rows. Invisible marks are written as \u escapes.
 */
export type NameSearchVector = readonly [first: string, surname: string, typed: string];

/** Must be found. */
export const NAME_SEARCH_MUST_MATCH: readonly NameSearchVector[] = [
  ['म\u0941हम\u094dमद', 'ज\u093c\u094bय\u093e', 'ज\u093c\u094bय\u093e'],
  ['ज\u093c\u094bय\u093e', 'x', 'ज\u093c\u094bय\u093e'],
  ['x', 'शर\u094dम\u093e', 'शर\u094dम\u093e'],
  ['க\u0bbeர\u0bcdத\u0bcdத\u0bbfக\u0bcd', 'x', 'க\u0bbeர\u0bcd\u200cத\u0bcd'],
  ['ف\u064eاط\u0650م\u064eة', 'x', 'فاطمه'],
  ['عائشة', 'x', 'عائشه'],
  ['x', 'المنصوري', 'المنصورى'],
  ['فاطمة', 'x', 'فـاطمة'],
  ['x', 'Al-Mansouri', 'Al Mansouri'],
  ['م\u064fح\u064eم\u064e\u0651د', 'x', 'محمد'],
  ['أحمد', 'x', 'احمد'],
  ['\u200fفاطمة', 'x', 'فاطمة'],
  ['علی', 'x', 'علي'],
  ['João', 'Conceição', 'Joao Conceicao'],
  ['Joa\u0303o', 'x', 'João'],
  ['Sébastien', 'x', 'Sebastien'],
  ['Björn', 'Kru\u0308ger-Weiß', 'Krüger-Weiß'],
  ['x', 'Straßenbahnfahrer', 'STRASSENBAHNFAHRER'],
  ['Ênio', 'x', 'Enio'],
  ['x', 'D\'Ávila', 'Davila'],
  ['Ọ\u0300lábísí', 'x', 'Olabisi'],
  ['Łukasz', 'x', 'Lukasz'],
  ['İsmail', 'x', 'ismail'],
  ['翔太', '佐藤', '佐藤 翔太'],
  ['翔太', '佐藤', '佐藤\u3000翔太'],
  ['翔太', '佐藤', '佐藤翔太'],
  ['x', 'イトウ', 'ｲﾄｳ'],
  ['カ\u3099', 'x', 'ガ'],
  ['ガ', 'x', 'カ\u3099'],
  ['ＳＡＴＯ', 'x', 'sato'],
  ['Пётр', 'x', 'Петр'],
  ['สมศ\u0e31กด\u0e34\u0e4c', 'x', 'สมศ\u0e31กด\u0e34'],
  ['サトー', 'x', 'サト'],
  ['ﾃﾞﾙ', 'x', 'デル'],
];

/** Different names that must not be merged. */
export const NAME_SEARCH_MUST_NOT_MATCH: readonly NameSearchVector[] = [
  ['x', 'शर\u094dम\u093e', 'शरम\u093e'],
  ['x', 'शरम\u093e', 'शर\u094dम\u093e'],
  ['ज\u093c\u094bय\u093e', 'x', 'ज\u094bय\u093e'],
  ['x', 'ख\u093c\u093eन', 'ख\u093eन'],
  ['x', 'ख\u093eन', 'ख\u093c\u093eन'],
  ['க\u0bbeரதத\u0bbfக', 'x', 'க\u0bbeர\u0bcdத\u0bcdத\u0bbfக\u0bcd'],
  ['ガトウ', 'x', 'カトウ'],
  ['カトウ', 'x', 'ガトウ'],
  ['パ', 'x', 'ハ'],
  ['x', 'Müller', 'Mueller'],
  ['x', 'Андрей', 'Андреи'],
  ['サト', 'x', 'サトー'],
];

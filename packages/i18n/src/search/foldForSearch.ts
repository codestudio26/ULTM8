/**
 * One fold for every name and text search (Decision 434, TXT-1; extends
 * Decision 278): case, Latin and Greek accents, Arabic spelling variants and
 * invisible marks are ignored, while the marks that make a different name in
 * Hindi, Tamil, Japanese or Thai (virama, nukta, pulli, dakuten, tone marks)
 * are kept. apps/api keeps an identical copy in common/search/name-search.ts;
 * both are tested against the same vectors (./nameSearchVectors.ts).
 *
 * Steps, in order: NFKC (full-width and half-width forms, U+3000) → drop format
 * characters (bidi marks, zero-width joiners, soft hyphen) → lower case →
 * strip combining marks after a Latin or Greek letter only → Arabic: drop
 * harakat and tatweel, آأإٱ→ا, ة→ه, ى/ی→ي, ؤ→و, ئ→ي, ک→ك → ß→ss, ł→l, ø→o,
 * đ→d, æ→ae, œ→oe, ı→i, ё→е → anything that isn't a letter, mark or digit
 * becomes one space.
 */
const ARABIC: ReadonlyArray<[RegExp, string]> = [
  [/[\u064B-\u065F\u0670\u0640]/gu, ''],
  [/[\u0622\u0623\u0625\u0671]/gu, '\u0627'],
  [/\u0629/gu, '\u0647'],
  [/[\u0649\u06CC]/gu, '\u064A'],
  [/\u0624/gu, '\u0648'],
  [/\u0626/gu, '\u064A'],
  [/\u06A9/gu, '\u0643'],
];

const LETTERS: Readonly<Record<string, string>> = {
  '\u0451': '\u0435',
  '\u00DF': 'ss',
  '\u0142': 'l',
  '\u00F8': 'o',
  '\u0111': 'd',
  '\u00E6': 'ae',
  '\u0153': 'oe',
  '\u0131': 'i',
};

export function foldForSearch(value: string): string {
  let text = value
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/([\p{Script=Latin}\p{Script=Greek}])[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF]+/gu, '$1')
    .normalize('NFC');
  for (const [re, to] of ARABIC) text = text.replace(re, to);
  text = text.replace(/[\u0451\u00DF\u0142\u00F8\u0111\u00E6\u0153\u0131]/gu, (c) => LETTERS[c]);
  return text.replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

/**
 * A person's name search (Decision 278 as extended by Decision 434): the
 * folded query is part of the first name, the surname, "first surname" or
 * "surname first" (family name first, as Japanese is written), with or
 * without the spaces. A blank query matches everyone; one of only symbols
 * ("%", "_") matches nobody (Decision 448 item 13).
 */
export function matchesNameSearch(firstName: string | null | undefined, surname: string | null | undefined, query: string): boolean {
  const q = foldForSearch(query);
  // Blank means no filter; a query of only symbols ("%", "_") finds nobody
  // (Decision 448 item 13), never everyone.
  if (!q) return !query.trim();
  const first = foldForSearch(firstName ?? '');
  const last = foldForSearch(surname ?? '');
  const compact = q.replace(/ /g, '');
  return [first, last, `${first} ${last}`, `${last} ${first}`].some((h) => h.includes(q) || h.replace(/ /g, '').includes(compact));
}

/** Decision 448 item 13: true when something was typed but none of it is a
 * letter or a digit ("%", "_", "!!"), so a name search finds nobody. The
 * portal then explains that symbols can't be used to search. */
export function isSymbolsOnlySearch(query: string): boolean {
  return query.trim() !== '' && foldForSearch(query) === '';
}

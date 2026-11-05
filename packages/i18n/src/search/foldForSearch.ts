/**
 * One fold for every name and text search (Decision 433, TXT-1; extends
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
  [/[ً-ٰٟـ]/gu, ''],
  [/[آأإٱ]/gu, 'ا'],
  [/ة/gu, 'ه'],
  [/[ىی]/gu, 'ي'],
  [/ؤ/gu, 'و'],
  [/ئ/gu, 'ي'],
  [/ک/gu, 'ك'],
];

const LETTERS: Readonly<Record<string, string>> = {
  'ё': 'е',
  'ß': 'ss',
  'ł': 'l',
  'ø': 'o',
  'đ': 'd',
  'æ': 'ae',
  'œ': 'oe',
  'ı': 'i',
};

export function foldForSearch(value: string): string {
  let text = value
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/([\p{Script=Latin}\p{Script=Greek}])[̀-ͯ᪰-᫿᷀-᷿]+/gu, '$1')
    .normalize('NFC');
  for (const [re, to] of ARABIC) text = text.replace(re, to);
  text = text.replace(/[ёßłøđæœı]/gu, (c) => LETTERS[c]);
  return text.replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

/**
 * A person's name search (Decision 278 as extended by Decision 433): the
 * folded query is part of the first name, the surname, "first surname" or
 * "surname first" (family name first, as Japanese is written), with or
 * without the spaces. A blank query matches everyone.
 */
export function matchesNameSearch(firstName: string | null | undefined, surname: string | null | undefined, query: string): boolean {
  const q = foldForSearch(query);
  if (!q) return true;
  const first = foldForSearch(firstName ?? '');
  const last = foldForSearch(surname ?? '');
  const compact = q.replace(/ /g, '');
  return [first, last, `${first} ${last}`, `${last} ${first}`].some((h) => h.includes(q) || h.replace(/ /g, '').includes(compact));
}

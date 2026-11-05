/**
 * Decision 278 — the header Global Search's name matching for a person
 * (Student, Instructor): substring on first name, surname, or the full name
 * ("jo" finds "John", "john sm" finds "John Smith"). Only ever applied to rows
 * the caller's own, unchanged list query has already authorized — it narrows a
 * result, it never widens one.
 *
 * Decision 433 (TXT-1) extends it to ignore case, accents and spelling
 * variants (`foldForSearch`), and to match the name written surname first
 * ("佐藤 翔太") and with or without spaces ("佐藤翔太", "Al Mansouri" for
 * "Al-Mansouri").
 *
 * Done in memory, not as a Prisma `contains` on the `user` relation: a
 * person's name lives on `User`, whose RLS visibility (user_self_or_shared_school)
 * does not cover every row these lists show (Decision 117), so a relation
 * filter would silently drop some of them; and Prisma cannot match a
 * concatenated full name.
 */
export function matchesPersonName(firstName: string | null | undefined, surname: string | null | undefined, search: string): boolean {
  const q = foldForSearch(search);
  if (!q) return true;
  const first = foldForSearch(firstName ?? '');
  const last = foldForSearch(surname ?? '');
  const compact = q.replace(/ /g, '');
  return [first, last, `${first} ${last}`, `${last} ${first}`].some((h) => h.includes(q) || h.replace(/ /g, '').includes(compact));
}

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

/**
 * One fold for every name and text search (Decision 433, TXT-1). Case, Latin
 * and Greek accents, Arabic spelling variants and invisible marks are
 * ignored; the marks that make a different name in Hindi, Tamil, Japanese or
 * Thai (virama, nukta, pulli, dakuten, tone marks) are kept, so शर्मा and
 * शरमा, or カ and ガ, stay different names. `packages/i18n`
 * (search/foldForSearch.ts) keeps an identical copy for the apps; both are
 * tested against the same vectors.
 *
 * Steps: NFKC (full-width and half-width forms, U+3000) → drop format
 * characters (bidi marks, zero-width joiners) → lower case → strip combining
 * marks after a Latin or Greek letter only → Arabic: drop harakat and
 * tatweel, آأإٱ→ا, ة→ه, ى/ی→ي, ؤ→و, ئ→ي, ک→ك → ß→ss, ł, ø, đ, æ, œ, ı, ё →
 * anything that isn't a letter, mark or digit becomes one space.
 */
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

/** The older name for `foldForSearch` (Branch filters, waiver signatures). It
 * used to strip every `\p{Diacritic}`, which merged different Hindi, Tamil
 * and Japanese names; it is now the one shared fold. */
export const foldText = foldForSearch;

/**
 * The first whole letter of a name, upper-cased (Decision 433, TXT-7): "ख़ान"
 * gives "ख़", not "ख", and a letter outside the Basic Multilingual Plane is
 * never cut in half. `packages/i18n` (text/firstGrapheme.ts) keeps an
 * identical copy for the apps. Blank in, blank out.
 */
export function firstGrapheme(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return '';
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) return part.segment.toLocaleUpperCase();
  return '';
}

/** Trims a raw `search` query value; blank (or only spaces) means "no filter". */
export function trimSearch(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Escapes the LIKE wildcards (`%`, `_`) and the escape character itself in a
 * `search` value before it goes into a Prisma `contains` filter, which Prisma
 * turns into `ILIKE '%' || value || '%'` without escaping — so "%" or "_" typed
 * into a search box would otherwise match unrelated names. Backslash is
 * Postgres's default LIKE escape character (no ESCAPE clause needed).
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

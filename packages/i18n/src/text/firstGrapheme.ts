/**
 * The first whole letter of a name, upper-cased (Decision 434, TXT-7): "ख़ान"
 * gives "ख़", not "ख"; an emoji or a letter outside the Basic Multilingual
 * Plane is never cut in half. Uses `Intl.Segmenter` where the runtime has it;
 * Hermes (the student app) doesn't, so there it takes one character plus the
 * marks that follow it. apps/api keeps an identical copy
 * (common/search/name-search.ts). Blank in, blank out.
 */
export function firstGrapheme(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return '';
  let first: string | undefined;
  const Segmenter = (Intl as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) {
    for (const part of new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      first = part.segment;
      break;
    }
  } else {
    first = text.match(/^\P{M}\p{M}*/u)?.[0];
  }
  return (first ?? '').toLocaleUpperCase();
}

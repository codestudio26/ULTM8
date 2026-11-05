import { DEFAULT_LOCALE, directionFor } from '@ultm8/i18n';
import { formatLocale } from '../i18n/format';

/**
 * The opening of a page the portal writes for printing (the student list, a
 * membership card): `<html>` carries the reader's language and direction, so
 * an Arabic printout reads right to left (Decision 433, TXT-5). Pair it with
 * `text-align: start` in the page's own styles.
 */
export function printHtmlOpening(locale: string = formatLocale() ?? DEFAULT_LOCALE): string {
  return `<!doctype html><html lang="${locale.replace(/[^A-Za-z0-9-]/g, '')}" dir="${directionFor(locale)}"><head><meta charset="utf-8">`;
}

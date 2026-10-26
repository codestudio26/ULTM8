import { formatLocale } from '../i18n/format';

/** Minutes as hours, at most one decimal: 90 → "1.5", 3600 → "60"
 * (hours trained, Decisions 301, 306). */
export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  try {
    return new Intl.NumberFormat(formatLocale(), { maximumFractionDigits: 1 }).format(hours);
  } catch {
    return String(hours);
  }
}

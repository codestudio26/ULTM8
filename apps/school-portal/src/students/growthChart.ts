/** Students → Growth's monthly chart: plain bars, no chart library. */

/** A YYYY-MM month as a short label in the viewer's language ("Oct 26"). */
export function monthLabel(month: string, locale: string | undefined): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  return date.toLocaleDateString(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** Each value as a percentage of the largest of them, so the tallest bar
 * fills the chart. A value above 0 is never drawn shorter than 2%. */
export function barHeights(values: number[]): number[] {
  const max = Math.max(0, ...values);
  if (max === 0) return values.map(() => 0);
  return values.map((v) => (v <= 0 ? 0 : Math.max(2, Math.round((v / max) * 100))));
}

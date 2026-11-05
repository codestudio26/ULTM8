import { DateTime } from 'luxon';

/**
 * A class's date and time as a notice stores it (Decision 434, TXT-3): the
 * wall time in the class's own zone, in a machine form, "2026-11-12 20:00",
 * which each reader's app formats in their own language
 * (@ultm8/i18n server/translate.ts `formatWhen`). Notices used to carry it in
 * English ("Thu, 12 Nov 2026, 20:00"), which every other language then showed
 * as it was. A zone Luxon can't read gives the UTC time, marked " UTC".
 */
export function noticeWallTime(date: Date, zone: string): string {
  const local = DateTime.fromJSDate(date).setZone(zone);
  if (local.isValid) return local.toFormat('yyyy-MM-dd HH:mm');
  return `${DateTime.fromJSDate(date).setZone('UTC').toFormat('yyyy-MM-dd HH:mm')} UTC`;
}

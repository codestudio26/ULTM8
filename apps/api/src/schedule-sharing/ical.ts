/**
 * Decision 319 item 4: a staff member's classes as an iCalendar feed
 * (RFC 5545), the format Google Calendar subscribes to "From URL". Times are
 * UTC; the calendar app shows them on the viewer's own clock.
 */
export interface FeedClass {
  id: string;
  title: string;
  description: string | null;
  startDate: Date;
  endDate: Date;
  cancelledAt: Date | null;
  updatedAt: Date;
  branchName: string | null;
}

/** RFC 5545 §3.3.11 TEXT: backslash, semicolon, comma and line breaks escaped. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** 20261105T183000Z */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 §3.1: lines longer than 75 octets are folded (CRLF and a space),
 * never inside a multi-byte character. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      out.push(current);
      current = '';
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function buildCalendar(calendarName: string, classes: FeedClass[], now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ULTM8//Staff classes//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    // Ask calendar apps to check for changes every few hours (a hint only;
    // Google Calendar refreshes on its own schedule).
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H',
  ];
  for (const c of classes) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${c.id}@ultm8`,
      `DTSTAMP:${icsDate(now)}`,
      `LAST-MODIFIED:${icsDate(c.updatedAt)}`,
      `DTSTART:${icsDate(c.startDate)}`,
      `DTEND:${icsDate(c.endDate)}`,
      `SUMMARY:${escapeText(c.title)}`,
    );
    if (c.branchName) lines.push(`LOCATION:${escapeText(c.branchName)}`);
    if (c.description) lines.push(`DESCRIPTION:${escapeText(c.description)}`);
    lines.push(`STATUS:${c.cancelledAt ? 'CANCELLED' : 'CONFIRMED'}`, 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

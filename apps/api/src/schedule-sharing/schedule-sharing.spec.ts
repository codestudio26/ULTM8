import { buildCalendar, escapeText, foldLine } from './ical';
import { EMBED_LOCALES, EMBED_TEXTS, embedLocale, escapeHtml, schedulePage } from './embed-page';
import { calendarFeedToken, hashCalendarFeedToken, isLinkToken, newScheduleEmbedKey } from './calendar-feed-token';

describe('Decision 319 item 4 — staff calendar links and the schedule embed', () => {
  describe('the iCal feed', () => {
    it('escapes text and folds long lines at 75 octets without splitting a character', () => {
      expect(escapeText('Kids; BJJ, beginners\\all\nlevels')).toBe('Kids\\; BJJ\\, beginners\\\\all\\nlevels');
      const folded = foldLine(`SUMMARY:${'é'.repeat(80)}`);
      for (const part of folded.split('\r\n')) expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
      expect(folded.split('\r\n ').join('')).toBe(`SUMMARY:${'é'.repeat(80)}`);
    });

    it('writes one event per class, in UTC, with cancelled classes marked cancelled', () => {
      const ics = buildCalendar(
        'Dojo, North',
        [
          { id: 'c1', title: 'Open Mat', description: null, startDate: new Date('2026-11-10T18:00:00Z'), endDate: new Date('2026-11-10T19:30:00Z'), cancelledAt: null, updatedAt: new Date('2026-11-01T00:00:00Z'), branchName: 'Main' },
          { id: 'c2', title: 'Kids', description: 'Bring water', startDate: new Date('2026-11-11T16:00:00Z'), endDate: new Date('2026-11-11T17:00:00Z'), cancelledAt: new Date(), updatedAt: new Date('2026-11-02T00:00:00Z'), branchName: null },
        ],
        new Date('2026-11-05T12:00:00Z'),
      );
      expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(ics).toContain('X-WR-CALNAME:Dojo\\, North\r\n');
      expect(ics).toContain('UID:c1@ultm8\r\nDTSTAMP:20261105T120000Z\r\n');
      expect(ics).toContain('DTSTART:20261110T180000Z\r\nDTEND:20261110T193000Z\r\n');
      expect(ics).toContain('LOCATION:Main\r\n');
      expect(ics).toContain('DESCRIPTION:Bring water\r\nSTATUS:CANCELLED\r\n');
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
      expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    });
  });

  describe('the links', () => {
    const secret = process.env.JWT_ACCESS_SECRET;
    beforeAll(() => {
      process.env.JWT_ACCESS_SECRET = secret ?? 'unit-test-secret-for-calendar-links';
    });
    afterAll(() => {
      if (secret === undefined) delete process.env.JWT_ACCESS_SECRET;
    });
    it('a calendar token is stable for a feed, differs between feeds, and only its hash is stored', () => {
      const a = calendarFeedToken('feed-a');
      expect(calendarFeedToken('feed-a')).toBe(a);
      expect(calendarFeedToken('feed-b')).not.toBe(a);
      expect(isLinkToken(a)).toBe(true);
      expect(hashCalendarFeedToken(a)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('an embed key is random and link-shaped; anything else is refused before a lookup', () => {
      const k = newScheduleEmbedKey();
      expect(isLinkToken(k)).toBe(true);
      expect(newScheduleEmbedKey()).not.toBe(k);
      expect(isLinkToken("x' OR 1=1")).toBe(false);
      expect(isLinkToken('short')).toBe(false);
    });
  });

  describe('the embed page', () => {
    it('has every text in all 15 languages, and falls back to English', () => {
      expect(EMBED_LOCALES).toHaveLength(15);
      for (const locale of EMBED_LOCALES) {
        const t = EMBED_TEXTS[locale];
        for (const key of Object.keys(EMBED_TEXTS.en) as Array<keyof typeof t>) expect([locale, key, t[key].length > 0]).toEqual([locale, key, true]);
        expect(t.timesIn).toContain('{tz}');
      }
      expect(embedLocale('pt-br')).toBe('pt-BR');
      expect(embedLocale('xx')).toBe('en');
      expect(embedLocale(undefined)).toBe('en');
    });

    it("escapes the School's text, groups by day on the Branch's clock, and marks cancelled classes", () => {
      expect(escapeHtml('<script>"x"</script>')).toBe('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
      const html = schedulePage('en', { schoolName: 'Dojo <b>', timezone: 'Europe/London' }, [
        { title: '<img src=x onerror=alert(1)>', startDate: new Date('2026-11-10T18:00:00Z'), endDate: new Date('2026-11-10T19:00:00Z'), cancelled: true, branchName: 'North', branchTimezone: null },
      ]);
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<script');
      expect(html).toContain('Dojo &lt;b&gt;');
      expect(html).toContain('Tuesday, November 10');
      expect(html).toContain('06:00');
      expect(html).toContain('Cancelled');
      expect(html).toContain('Times are in Europe/London.');
    });

    it('says when there are no classes, and writes right to left in Arabic', () => {
      expect(schedulePage('en', { schoolName: 'Dojo', timezone: null }, [])).toContain('No classes in the next four weeks.');
      expect(schedulePage('ar', { schoolName: 'Dojo', timezone: null }, [])).toContain('dir="rtl"');
    });
  });
});
